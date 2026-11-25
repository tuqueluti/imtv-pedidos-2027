import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  BOARD_COLUMNS,
  type BoardColumn,
  type OrderSubmissionInput,
  type QueueOwner,
} from '../shared/domain.ts';
import { DomainValidationError, type PortalStore } from './db.ts';
import { type CustomMailTransport, sendOrderNotificationEmail } from './mailer.ts';

const SESSION_COOKIE_NAME = 'imtv_session_2027';

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function applyCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  if (!origin) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Test-Fail-Db-Write');
  res.setHeader('Vary', 'Origin');
}

function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : undefined;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders?: Record<string, string>
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

async function readJsonBody<T = Record<string, unknown>>(
  req: http.IncomingMessage,
  maxBytes = 6 * 1024 * 1024
): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new DomainValidationError('Payload excede o limite permitido.');
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {} as T;
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new DomainValidationError('Formato JSON inválido na requisição.');
  }
}

export interface ApiAppOptions {
  mailTransport?: CustomMailTransport;
  publicDir?: string;
  distDir?: string;
  simulateOrderWriteFailureHeader?: boolean;
}

export function createPortalApp(store: PortalStore, options: ApiAppOptions = {}): http.RequestListener {
  const publicDir = options.publicDir || path.resolve(process.cwd(), 'public');
  const distDir = options.distDir || path.resolve(process.cwd(), 'dist');

  return async (req, res) => {
    try {
      applyCorsHeaders(req, res);

      const host = req.headers.host || '127.0.0.1';
      const url = new URL(req.url || '/', `http://${host}`);
      const pathname = url.pathname;
      const method = (req.method || 'GET').toUpperCase();

      if (method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (pathname === '/api/health' && method === 'GET') {
        sendJson(res, 200, { ok: true, service: 'imtv-pedidos-2027' });
        return;
      }

      // --- PUBLIC API (No internal contacts, no internal board, no other units' orders) ---
      if (pathname === '/api/public/config' && method === 'GET') {
        const config = store.getPublicConfig();
        sendJson(res, 200, config);
        return;
      }

      if (pathname === '/api/public/logo' && method === 'GET') {
        const logo = store.getUploadedLogoBinary();
        if (!logo) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Logo pendente');
          return;
        }
        res.writeHead(200, {
          'Content-Type': logo.mime,
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(Buffer.from(logo.bytes));
        return;
      }

      if (pathname === '/api/public/orders' && method === 'POST') {
        if (
          options.simulateOrderWriteFailureHeader &&
          req.headers['x-test-fail-db-write'] === '1'
        ) {
          sendJson(res, 503, {
            ok: false,
            error: 'Falha temporária ao gravar o pedido no banco de dados. Seus dados continuam na tela para nova tentativa.',
          });
          return;
        }

        const body = await readJsonBody<OrderSubmissionInput>(req);
        const { order, createdNew, retryToken } = store.createOrder(body);

        const smtp = store.getSmtpConfig();
        let emailStatus = order.emailNotificationStatus;
        let emailError: string | null = order.emailNotificationError;

        if (createdNew && smtp.enabled && smtp.to.trim()) {
          const sendRes = await sendOrderNotificationEmail(smtp, order, options.mailTransport);
          const updated = store.recordEmailNotificationResult(order.id, sendRes);
          emailStatus = updated.emailNotificationStatus;
          emailError = updated.emailNotificationError;
        }

        sendJson(res, createdNew ? 201 : 200, {
          ok: true,
          createdNew,
          protocol: order.protocol,
          recipientTeamName: order.recipientTeamName,
          createdAt: order.createdAt,
          emailNotification: {
            enabled: Boolean(smtp.enabled && smtp.to.trim()),
            status: emailStatus,
            hasError: emailStatus === 'failed',
            errorMessage:
              emailStatus === 'failed'
                ? 'O pedido foi registrado com segurança, mas o aviso automático por e-mail não pôde ser entregue agora.'
                : null,
            retryToken: emailStatus === 'failed' ? retryToken : null,
          },
        });
        return;
      }

      const publicRetryMatch = pathname.match(/^\/api\/public\/orders\/([^/]+)\/retry-notification$/);
      if (publicRetryMatch && method === 'POST') {
        const protocol = decodeURIComponent(publicRetryMatch[1]);
        const body = await readJsonBody<{ retryToken?: string }>(req);
        const order = store.getOrderByProtocolAndRetryToken(protocol, body.retryToken || '');
        if (!order) {
          sendJson(res, 403, {
            ok: false,
            error: 'Token de repetição de notificação inválido ou expirado.',
          });
          return;
        }

        const smtp = store.getSmtpConfig();
        if (!smtp.enabled || !smtp.to.trim()) {
          sendJson(res, 200, {
            ok: true,
            emailNotification: {
              enabled: false,
              status: 'disabled',
              hasError: false,
              errorMessage: null,
            },
          });
          return;
        }

        const sendRes = await sendOrderNotificationEmail(smtp, order, options.mailTransport);
        const updated = store.recordEmailNotificationResult(order.id, sendRes);
        sendJson(res, 200, {
          ok: true,
          emailNotification: {
            enabled: true,
            status: updated.emailNotificationStatus,
            hasError: updated.emailNotificationStatus === 'failed',
            errorMessage:
              updated.emailNotificationStatus === 'failed'
                ? 'Ainda não foi possível entregar o aviso por e-mail. Seu pedido permanece salvo.'
                : null,
          },
        });
        return;
      }

      // --- AUTHENTICATION API (aceita Cookie HttpOnly same-origin ou Bearer token cross-origin/iOS) ---
      const cookies = parseCookies(req.headers.cookie);
      const bearerToken = extractBearerToken(req.headers.authorization);
      const sessionToken = bearerToken || cookies[SESSION_COOKIE_NAME];
      const currentUser = store.getSessionUser(sessionToken);

      if (pathname === '/api/auth/me' && method === 'GET') {
        sendJson(res, 200, {
          authenticated: Boolean(currentUser),
          user: currentUser,
        });
        return;
      }

      if (pathname === '/api/auth/login' && method === 'POST') {
        const body = await readJsonBody<{ username?: string; password?: string }>(req);
        const auth = store.authenticate(body.username || '', body.password || '');
        if (!auth) {
          sendJson(res, 401, {
            ok: false,
            error: 'Usuário ou senha inválidos.',
          });
          return;
        }

        const maxAge = 14 * 24 * 60 * 60;
        sendJson(
          res,
          200,
          { ok: true, user: auth.user, token: auth.token },
          {
            'Set-Cookie': `${SESSION_COOKIE_NAME}=${encodeURIComponent(auth.token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`,
          }
        );
        return;
      }

      if (pathname === '/api/auth/logout' && method === 'POST') {
        store.revokeSession(sessionToken);
        sendJson(
          res,
          200,
          { ok: true },
          {
            'Set-Cookie': `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
          }
        );
        return;
      }

      // --- AUTHENTICATED BOARD & ADMIN ROUTES ---
      if (pathname.startsWith('/api/board') || pathname.startsWith('/api/admin')) {
        if (!currentUser) {
          sendJson(res, 401, {
            ok: false,
            error: 'Acesso restrito à equipe autenticada da IMTV.',
          });
          return;
        }

        if (pathname.startsWith('/api/admin') && currentUser.role !== 'admin') {
          sendJson(res, 403, {
            ok: false,
            error: 'Apenas administradores da IMTV podem alterar configurações internas.',
          });
          return;
        }

        // Board list & filters
        if (pathname === '/api/board/orders' && method === 'GET') {
          const unit = url.searchParams.get('unit') || '';
          const assignee = url.searchParams.get('assignee') || 'all';
          const deadline = url.searchParams.get('deadline') || 'all';
          const orders = store.listOrders({ unit, assignee, deadline });
          const allUnits = Array.from(
            new Set(store.listOrders().map((o) => o.unitName))
          ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

          sendJson(res, 200, {
            columns: BOARD_COLUMNS,
            orders,
            units: allUnits,
            recipientTeamName: store.getPublicConfig().recipientTeamName,
          });
          return;
        }

        const orderDetailMatch = pathname.match(/^\/api\/board\/orders\/(\d+)$/);
        if (orderDetailMatch && method === 'GET') {
          const orderId = Number(orderDetailMatch[1]);
          const order = store.getOrderById(orderId);
          if (!order) {
            sendJson(res, 404, { ok: false, error: 'Pedido não encontrado.' });
            return;
          }
          const events = store.getOrderEvents(orderId);
          sendJson(res, 200, { order, events });
          return;
        }

        if (orderDetailMatch && method === 'DELETE') {
          if (currentUser.role !== 'admin') {
            sendJson(res, 403, {
              ok: false,
              error: 'Apenas administradores da IMTV podem excluir pedidos.',
            });
            return;
          }
          const orderId = Number(orderDetailMatch[1]);
          store.deleteOrderById(orderId);
          sendJson(res, 200, { ok: true, deletedId: orderId });
          return;
        }

        const moveMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/move$/);
        if (moveMatch && method === 'POST') {
          const orderId = Number(moveMatch[1]);
          const body = await readJsonBody<{ targetColumn?: BoardColumn; waitingReason?: string }>(req);
          const order = store.moveOrderColumn({
            orderId,
            targetColumn: body.targetColumn as BoardColumn,
            waitingReason: body.waitingReason,
            actorName: currentUser.displayName,
          });
          const events = store.getOrderEvents(orderId);
          sendJson(res, 200, { ok: true, order, events });
          return;
        }

        const waitingMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/waiting$/);
        if (waitingMatch && method === 'PATCH') {
          const orderId = Number(waitingMatch[1]);
          const body = await readJsonBody<{ waitingReason?: string }>(req);
          const order = store.updateWaitingReason({
            orderId,
            waitingReason: body.waitingReason || '',
            actorName: currentUser.displayName,
          });
          const events = store.getOrderEvents(orderId);
          sendJson(res, 200, { ok: true, order, events });
          return;
        }

        const finalVideoMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/final-video$/);
        if (finalVideoMatch && method === 'PATCH') {
          const orderId = Number(finalVideoMatch[1]);
          const body = await readJsonBody<{ finalVideoUrl?: string }>(req);
          const order = store.saveFinalVideoUrl({
            orderId,
            finalVideoUrl: body.finalVideoUrl || '',
            actorName: currentUser.displayName,
          });
          const events = store.getOrderEvents(orderId);
          sendJson(res, 200, { ok: true, order, events });
          return;
        }

        const waOpenMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/whatsapp-opened$/);
        if (waOpenMatch && method === 'POST') {
          const orderId = Number(waOpenMatch[1]);
          const order = store.recordWhatsAppOpened(orderId, currentUser.displayName);
          const events = store.getOrderEvents(orderId);
          sendJson(res, 200, { ok: true, order, events });
          return;
        }

        const waConfirmMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/confirm-whatsapp$/);
        if (waConfirmMatch && method === 'POST') {
          const orderId = Number(waConfirmMatch[1]);
          const order = store.confirmWhatsAppDelivery(orderId, currentUser.displayName);
          const events = store.getOrderEvents(orderId);
          sendJson(res, 200, { ok: true, order, events });
          return;
        }

        const boardRetryEmailMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/retry-notification$/);
        if (boardRetryEmailMatch && method === 'POST') {
          const orderId = Number(boardRetryEmailMatch[1]);
          const order = store.getOrderById(orderId);
          if (!order) {
            sendJson(res, 404, { ok: false, error: 'Pedido não encontrado.' });
            return;
          }
          const smtp = store.getSmtpConfig();
          const sendRes = await sendOrderNotificationEmail(smtp, order, options.mailTransport);
          const updated = store.recordEmailNotificationResult(order.id, sendRes);
          const events = store.getOrderEvents(orderId);
          sendJson(res, 200, { ok: true, order: updated, events });
          return;
        }

        // Admin Settings
        if (pathname === '/api/admin/settings' && method === 'GET') {
          sendJson(res, 200, store.getAdminSettings());
          return;
        }

        if (pathname === '/api/admin/settings' && method === 'PUT') {
          const body = await readJsonBody<{
            recipientTeamName: string;
            notificationEmailEnabled: boolean;
            notificationEmailTo: string;
            smtpHost?: string;
            smtpPort?: number;
            smtpUser?: string;
            smtpPass?: string;
            smtpFrom?: string;
            smtpSecure?: boolean;
          }>(req);
          const updated = store.updateAdminSettings(body);
          sendJson(res, 200, { ok: true, settings: updated });
          return;
        }

        if (pathname === '/api/admin/logo' && method === 'POST') {
          const body = await readJsonBody<{
            mode: 'uploaded' | 'bundled' | 'pending';
            mime?: string;
            base64?: string;
            filename?: string;
          }>(req);

          if (body.mode === 'uploaded') {
            const rawBase64 = (body.base64 || '').replace(/^data:[^;]+;base64,/, '');
            const bytes = new Uint8Array(Buffer.from(rawBase64, 'base64'));
            const publicConfig = store.updateOfficialLogo({
              mode: 'uploaded',
              mime: body.mime,
              bytes,
              filename: body.filename,
            });
            sendJson(res, 200, { ok: true, publicConfig, settings: store.getAdminSettings() });
            return;
          }

          const publicConfig = store.updateOfficialLogo({
            mode: body.mode === 'pending' ? 'pending' : 'bundled',
          });
          sendJson(res, 200, { ok: true, publicConfig, settings: store.getAdminSettings() });
          return;
        }

        if (pathname === '/api/admin/members' && method === 'POST') {
          const body = await readJsonBody<{
            username: string;
            displayName: string;
            email: string;
            role: 'admin' | 'member';
            queueColumn: QueueOwner | null;
            password?: string;
            active?: boolean;
          }>(req);
          const members = store.upsertTeamMember(body);
          sendJson(res, 200, { ok: true, members });
          return;
        }
      }

      if (pathname.startsWith('/api/')) {
        sendJson(res, 404, { ok: false, error: 'Rota da API não encontrada.' });
        return;
      }

      // --- STATIC FILES & SPA FALLBACK ---
      const tryServeStatic = (baseDir: string, relPath: string): boolean => {
        const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
        const fullPath = path.join(baseDir, safeRel);
        if (!fullPath.startsWith(baseDir)) return false;
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return false;
        const ext = path.extname(fullPath).toLowerCase();
        const mime = MIME_MAP[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': mime,
          'X-Content-Type-Options': 'nosniff',
        });
        fs.createReadStream(fullPath).pipe(res);
        return true;
      };

      if (pathname !== '/' && pathname !== '/quadro') {
        if (tryServeStatic(distDir, pathname.slice(1))) return;
        if (tryServeStatic(publicDir, pathname.slice(1))) return;
      }

      // SPA fallback to dist/index.html
      if (tryServeStatic(distDir, 'index.html')) return;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html lang="pt-BR"><body style="background:#0c0e12;color:#f3f5f8;font-family:sans-serif;padding:2rem">Portal IMTV 2027 · Execute npm run build para servir a interface compilada ou acesse via servidor Vite.</body></html>'
      );
    } catch (err) {
      if (err instanceof DomainValidationError) {
        sendJson(res, 400, {
          ok: false,
          error: err.message,
          fields: err.fields,
        });
        return;
      }
      console.error('[IMTV Portal API Error]', err);
      sendJson(res, 500, {
        ok: false,
        error: 'Erro interno no servidor. Seus dados foram preservados na tela para nova tentativa.',
      });
    }
  };
}
