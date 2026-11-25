import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const BOARD_COLUMNS = [
  "Recebido",
  "Luti",
  "Tati",
  "Marcio",
  "Aguardando",
  "Finalizados",
] as const;
type BoardColumn = (typeof BOARD_COLUMNS)[number];

const QUEUE_OWNERS = ["Luti", "Tati", "Marcio"] as const;
type QueueOwner = (typeof QUEUE_OWNERS)[number];

const BRAZIL_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

const SESSION_COOKIE_NAME = "imtv_session_2027";

class DomainValidationError extends Error {
  public readonly fields: Record<string, string>;
  constructor(message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = "DomainValidationError";
    this.fields = fields;
  }
}

function isBoardColumn(val: string): val is BoardColumn {
  return (BOARD_COLUMNS as readonly string[]).includes(val);
}

function isQueueOwner(val: string): val is QueueOwner {
  return (QUEUE_OWNERS as readonly string[]).includes(val);
}

function computeNextAssignee(
  currentAssignee: QueueOwner | null,
  nextColumn: BoardColumn,
): QueueOwner | null {
  if (isQueueOwner(nextColumn)) return nextColumn;
  if (nextColumn === "Aguardando" || nextColumn === "Finalizados") {
    return currentAssignee;
  }
  return null;
}

function parseAndValidateWhatsApp(input: {
  countryCode: string;
  ddd: string;
  number: string;
}): {
  valid: boolean;
  error?: string;
  countryCode: string;
  ddd: string;
  localDigits: string;
  e164: string;
  display: string;
} {
  let rawCc = (input.countryCode || "").trim().replace(/\s+/g, "");
  if (rawCc && !rawCc.startsWith("+")) rawCc = `+${rawCc}`;
  if (!/^\+\d{1,4}$/.test(rawCc)) {
    return {
      valid: false,
      error: "Informe o código do país com + e de 1 a 4 dígitos (ex.: +55).",
      countryCode: rawCc || "+55",
      ddd: "",
      localDigits: "",
      e164: "",
      display: "",
    };
  }

  const rawDdd = (input.ddd || "").trim();
  if (/[^0-9()\s-]/.test(rawDdd)) {
    return {
      valid: false,
      error: "O DDD deve conter apenas números.",
      countryCode: rawCc,
      ddd: "",
      localDigits: "",
      e164: "",
      display: "",
    };
  }
  const dddDigits = rawDdd.replace(/\D/g, "");

  const rawNum = (input.number || "").trim();
  if (!rawNum) {
    return {
      valid: false,
      error: "Informe seu número de WhatsApp para receber o vídeo.",
      countryCode: rawCc,
      ddd: dddDigits,
      localDigits: "",
      e164: "",
      display: "",
    };
  }
  if (/[^0-9()\s-.+]/.test(rawNum)) {
    return {
      valid: false,
      error: "Use apenas números, espaços, parênteses ou hífen no WhatsApp.",
      countryCode: rawCc,
      ddd: dddDigits,
      localDigits: "",
      e164: "",
      display: "",
    };
  }

  let numDigits = rawNum.replace(/\D/g, "");
  const ccDigits = rawCc.slice(1);
  if (
    rawNum.startsWith("+") &&
    numDigits.startsWith(ccDigits) &&
    numDigits.length > ccDigits.length + 7
  ) {
    numDigits = numDigits.slice(ccDigits.length);
  }

  let finalDdd = dddDigits;
  if (!finalDdd && rawCc === "+55" && (numDigits.length === 10 || numDigits.length === 11)) {
    finalDdd = numDigits.slice(0, 2);
    numDigits = numDigits.slice(2);
  } else if (
    finalDdd &&
    numDigits.startsWith(finalDdd) &&
    (numDigits.length === finalDdd.length + 8 || numDigits.length === finalDdd.length + 9)
  ) {
    numDigits = numDigits.slice(finalDdd.length);
  }

  if (rawCc === "+55") {
    if (!/^[1-9][1-9]$/.test(finalDdd)) {
      return {
        valid: false,
        error: "Informe um DDD válido com 2 dígitos (ex.: 48, 11, 51).",
        countryCode: rawCc,
        ddd: finalDdd,
        localDigits: numDigits,
        e164: "",
        display: "",
      };
    }
    if (!/^\d{8,9}$/.test(numDigits) || /^0+$/.test(numDigits)) {
      return {
        valid: false,
        error: "Informe um WhatsApp válido com 8 ou 9 dígitos após o DDD.",
        countryCode: rawCc,
        ddd: finalDdd,
        localDigits: numDigits,
        e164: "",
        display: "",
      };
    }
    if (numDigits.length === 9 && !numDigits.startsWith("9")) {
      return {
        valid: false,
        error: "Celulares de 9 dígitos no Brasil começam com o dígito 9.",
        countryCode: rawCc,
        ddd: finalDdd,
        localDigits: numDigits,
        e164: "",
        display: "",
      };
    }
  } else {
    if (!/^\d{1,5}$/.test(finalDdd)) {
      return {
        valid: false,
        error: "Informe o código de área / DDD.",
        countryCode: rawCc,
        ddd: finalDdd,
        localDigits: numDigits,
        e164: "",
        display: "",
      };
    }
    const combined = `${ccDigits}${finalDdd}${numDigits}`;
    if (combined.length < 8 || combined.length > 15 || /^0+$/.test(numDigits)) {
      return {
        valid: false,
        error: "Informe um telefone internacional válido (entre 8 e 15 dígitos no total).",
        countryCode: rawCc,
        ddd: finalDdd,
        localDigits: numDigits,
        e164: "",
        display: "",
      };
    }
  }

  const formattedLocal =
    numDigits.length === 9
      ? `${numDigits.slice(0, 5)}-${numDigits.slice(5)}`
      : numDigits.length === 8
      ? `${numDigits.slice(0, 4)}-${numDigits.slice(4)}`
      : numDigits;

  return {
    valid: true,
    countryCode: rawCc,
    ddd: finalDdd,
    localDigits: numDigits,
    e164: `${rawCc}${finalDdd}${numDigits}`,
    display: `${rawCc} (${finalDdd}) ${formattedLocal}`,
  };
}

function validateHttpsUrl(raw: string): { valid: boolean; url: string; error?: string } {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { valid: false, url: "", error: "Informe uma URL HTTPS completa." };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") {
      return {
        valid: false,
        url: trimmed,
        error: "Use um endereço seguro começando com https://.",
      };
    }
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      return {
        valid: false,
        url: trimmed,
        error: "Informe um domínio válido na URL HTTPS.",
      };
    }
    return { valid: true, url: trimmed };
  } catch {
    return {
      valid: false,
      url: trimmed,
      error: "Formato de URL inválido. Exemplo: https://drive.google.com/...",
    };
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(byteLength: number): string {
  const arr = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToHex(arr);
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hash));
}

async function hashPasswordPbkdf2(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    256,
  );
  return `pbkdf2:${iterations}:${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`;
}

async function verifyPasswordPbkdf2(password: string, stored: string): Promise<boolean> {
  const parts = (stored || "").split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  const salt = hexToBytes(parts[2]);
  const expected = hexToBytes(parts[3]);
  if (salt.length === 0 || expected.length === 0) return false;

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    expected.length * 8,
  );
  const actual = new Uint8Array(bits);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual[i] ^ expected[i];
  }
  return diff === 0;
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const pair of cookieHeader.split(";")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function extractBearerToken(authHeader: string | null): string | undefined {
  if (!authHeader) return undefined;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : undefined;
}

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (origin) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Client-Info, Apikey, X-Test-Fail-Db-Write",
      "Vary": "Origin",
    };
  }
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Client-Info, Apikey, X-Test-Fail-Db-Write",
  };
}

function jsonResponse(
  req: Request,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

async function readJsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DomainValidationError("Formato JSON inválido na requisição.");
  }
}

function computeLogoUrl(row: { logo_mode: string; logo_version: number }): string | null {
  if (row.logo_mode === "pending") return null;
  if (row.logo_mode === "uploaded") return `/api/public/logo?v=${row.logo_version}`;
  return `/branding/imtv-logo-oficial.png?v=${row.logo_version}`;
}

function mapOrderRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    protocol: String(row.protocol),
    unitName: String(row.unit_name),
    city: String(row.city),
    uf: String(row.uf),
    requesterName: String(row.requester_name),
    requesterEmail: String(row.requester_email),
    whatsappCountryCode: String(row.whatsapp_country_code),
    whatsappDdd: String(row.whatsapp_ddd),
    whatsappDisplay: String(row.whatsapp_display),
    whatsappE164: String(row.whatsapp_e164),
    recipientTeamName: String(row.recipient_team_name),
    title: String(row.title),
    objective: String(row.objective),
    targetAudience: String(row.target_audience),
    distributionChannel: String(row.distribution_channel),
    videoFormat: String(row.video_format),
    needsFormatGuidance: Boolean(row.needs_format_guidance),
    desiredDate: String(row.desired_date),
    mainMessage: String(row.main_message),
    mandatoryInfo: String(row.mandatory_info || ""),
    materialsDriveUrl: row.materials_drive_url ? String(row.materials_drive_url) : null,
    materialsPending: Boolean(row.materials_pending),
    materialsNotes: String(row.materials_notes || ""),
    boardColumn: String(row.board_column) as BoardColumn,
    assignee: row.assignee ? (String(row.assignee) as QueueOwner) : null,
    waitingReason: String(row.waiting_reason || ""),
    finalVideoUrl: row.final_video_url ? String(row.final_video_url) : null,
    whatsappDeliveryStatus: String(row.whatsapp_delivery_status) as "pending" | "confirmed",
    whatsappOpenedAt: row.whatsapp_opened_at ? String(row.whatsapp_opened_at) : null,
    whatsappConfirmedAt: row.whatsapp_confirmed_at ? String(row.whatsapp_confirmed_at) : null,
    whatsappConfirmedBy: row.whatsapp_confirmed_by ? String(row.whatsapp_confirmed_by) : null,
    emailNotificationStatus: String(row.email_notification_status) as
      | "disabled"
      | "sent"
      | "failed",
    emailNotificationError: row.email_notification_error
      ? String(row.email_notification_error)
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapEventRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    actorName: String(row.actor_name),
    eventType: String(row.event_type),
    description: String(row.description),
    createdAt: String(row.created_at),
  };
}

function mapMemberRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    username: String(row.username),
    displayName: String(row.display_name),
    email: String(row.email || ""),
    role: String(row.role) as "admin" | "member",
    queueColumn: row.queue_column ? (String(row.queue_column) as QueueOwner) : null,
    active: Boolean(row.active),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method.toUpperCase() === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(req),
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(req, 500, {
        ok: false,
        error: "Configuração interna do servidor Supabase incompleta.",
      });
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const url = new URL(req.url);
    const pathname =
      url.pathname
        .replace(/^\/functions\/v1\/imtv-api(?=\/|$)/, "")
        .replace(/^\/imtv-api(?=\/|$)/, "") || "/";
    const method = req.method.toUpperCase();

    if ((pathname === "/" || pathname === "/api/health") && method === "GET") {
      return jsonResponse(req, 200, {
        ok: true,
        service: "imtv-pedidos-2027-supabase",
      });
    }

    // --- PUBLIC ROUTES ---
    if (pathname === "/api/public/config" && method === "GET") {
      const { data, error } = await db
        .from("imtv_portal_settings")
        .select("recipient_team_name, logo_mode, logo_version")
        .eq("id", 1)
        .single();
      if (error || !data) {
        throw new Error(error?.message || "Falha ao carregar configuração pública.");
      }
      return jsonResponse(req, 200, {
        recipientTeamName: String(data.recipient_team_name),
        logoUrl: computeLogoUrl({
          logo_mode: String(data.logo_mode),
          logo_version: Number(data.logo_version),
        }),
      });
    }

    if (pathname === "/api/public/logo" && method === "GET") {
      const { data } = await db
        .from("imtv_portal_settings")
        .select("logo_mode, logo_mime, logo_data_url")
        .eq("id", 1)
        .single();

      if (!data || data.logo_mode !== "uploaded" || !data.logo_data_url || !data.logo_mime) {
        return new Response("Logo pendente", {
          status: 404,
          headers: {
            ...buildCorsHeaders(req),
            "Content-Type": "text/plain; charset=utf-8",
          },
        });
      }

      const rawB64 = String(data.logo_data_url).replace(/^data:[^;]+;base64,/, "");
      const binaryStr = atob(rawB64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      return new Response(bytes, {
        status: 200,
        headers: {
          ...buildCorsHeaders(req),
          "Content-Type": String(data.logo_mime),
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (pathname === "/api/public/orders" && method === "POST") {
      const input = await readJsonBody<Record<string, unknown>>(req);
      const errors: Record<string, string> = {};

      const idempotencyKey = String(input.idempotencyKey || "").trim();
      if (!idempotencyKey || idempotencyKey.length < 8) {
        errors.idempotencyKey = "Chave de envio ausente. Recarregue a página e tente novamente.";
      }

      const unitName = String(input.unitName || "").trim();
      if (unitName.length < 2) errors.unitName = "Informe a unidade do Instituto Mix.";

      const city = String(input.city || "").trim();
      if (city.length < 2) errors.city = "Informe a cidade da unidade.";

      const uf = String(input.uf || "").trim().toUpperCase();
      if (!(BRAZIL_UFS as readonly string[]).includes(uf)) {
        errors.uf = "Selecione uma UF válida.";
      }

      const requesterName = String(input.requesterName || "").trim();
      if (requesterName.length < 2) errors.requesterName = "Informe seu nome.";

      const requesterEmail = String(input.requesterEmail || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
        errors.requesterEmail = "Informe um endereço de e-mail válido.";
      }

      const wa = parseAndValidateWhatsApp({
        countryCode: String(input.whatsappCountryCode || ""),
        ddd: String(input.whatsappDdd || ""),
        number: String(input.whatsappNumber || ""),
      });
      if (!wa.valid) {
        errors.whatsappNumber = wa.error || "Número de WhatsApp inválido.";
      }

      const title = String(input.title || "").trim();
      if (title.length < 3) errors.title = "Informe o título do pedido.";

      const objective = String(input.objective || "").trim();
      if (objective.length < 3) errors.objective = "Descreva o objetivo do vídeo.";

      const targetAudience = String(input.targetAudience || "").trim();
      if (targetAudience.length < 2) errors.targetAudience = "Informe o público do vídeo.";

      const distributionChannel = String(input.distributionChannel || "").trim();
      if (distributionChannel.length < 2) {
        errors.distributionChannel = "Informe o canal de divulgação.";
      }

      const needsFormatGuidance = Boolean(input.needsFormatGuidance);
      const rawFormat = String(input.videoFormat || "").trim();
      const videoFormat =
        needsFormatGuidance && !rawFormat ? "Preciso de orientação da IMTV" : rawFormat;
      if (!videoFormat) {
        errors.videoFormat = 'Selecione o formato ou marque "Preciso de orientação".';
      }

      const desiredDate = String(input.desiredDate || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(desiredDate)) {
        errors.desiredDate = "Informe a data desejada para o vídeo.";
      }

      const mainMessage = String(input.mainMessage || "").trim();
      if (mainMessage.length < 5) errors.mainMessage = "Descreva a mensagem principal da peça.";

      const mandatoryInfo = String(input.mandatoryInfo || "").trim();
      const materialsPending = Boolean(input.materialsPending);
      const rawDriveUrl = String(input.materialsDriveUrl || "").trim();
      let validatedDriveUrl: string | null = null;

      if (rawDriveUrl) {
        const urlCheck = validateHttpsUrl(rawDriveUrl);
        if (!urlCheck.valid) {
          errors.materialsDriveUrl =
            urlCheck.error || "Informe um link HTTPS válido do Google Drive.";
        } else {
          validatedDriveUrl = urlCheck.url;
        }
      } else if (!materialsPending) {
        errors.materialsDriveUrl =
          "Cole o link do Google Drive com os materiais ou marque que os materiais ainda não estão prontos.";
      }

      if (Object.keys(errors).length > 0) {
        throw new DomainValidationError(
          "Confira os campos destacados antes de enviar o pedido.",
          errors,
        );
      }

      // Check existing by idempotency_key
      const { data: existingByIdem } = await db
        .from("imtv_video_orders")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existingByIdem) {
        const mapped = mapOrderRow(existingByIdem);
        return jsonResponse(req, 200, {
          ok: true,
          createdNew: false,
          protocol: mapped.protocol,
          recipientTeamName: mapped.recipientTeamName,
          createdAt: mapped.createdAt,
          emailNotification: {
            enabled: false,
            status: mapped.emailNotificationStatus,
            hasError: mapped.emailNotificationStatus === "failed",
            errorMessage: null,
            retryToken: null,
          },
        });
      }

      // Check recent identical payload fingerprint (60s anti-double-submit window)
      const payloadFingerprint = await sha256Hex(
        JSON.stringify({
          unitName: unitName.toLowerCase(),
          uf,
          requesterEmail,
          whatsappE164: wa.e164,
          title: title.toLowerCase(),
          desiredDate,
          mainMessage: mainMessage.toLowerCase(),
          materialsDriveUrl: validatedDriveUrl || "",
        }),
      );

      const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
      const { data: existingByFp } = await db
        .from("imtv_video_orders")
        .select("*")
        .eq("payload_fingerprint", payloadFingerprint)
        .gte("created_at", sixtySecondsAgo)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingByFp) {
        const mapped = mapOrderRow(existingByFp);
        return jsonResponse(req, 200, {
          ok: true,
          createdNew: false,
          protocol: mapped.protocol,
          recipientTeamName: mapped.recipientTeamName,
          createdAt: mapped.createdAt,
          emailNotification: {
            enabled: false,
            status: mapped.emailNotificationStatus,
            hasError: mapped.emailNotificationStatus === "failed",
            errorMessage: null,
            retryToken: null,
          },
        });
      }

      const { data: settingsRow } = await db
        .from("imtv_portal_settings")
        .select("recipient_team_name")
        .eq("id", 1)
        .single();
      const recipientTeamName = String(
        settingsRow?.recipient_team_name || "Equipe de Produção da IMTV",
      );

      const retryToken = randomHex(24);
      const now = new Date().toISOString();

      const { data: insertedRow, error: insertErr } = await db
        .from("imtv_video_orders")
        .insert({
          idempotency_key: idempotencyKey,
          payload_fingerprint: payloadFingerprint,
          unit_name: unitName,
          city,
          uf,
          requester_name: requesterName,
          requester_email: requesterEmail,
          whatsapp_country_code: wa.countryCode,
          whatsapp_ddd: wa.ddd,
          whatsapp_display: wa.display,
          whatsapp_e164: wa.e164,
          recipient_team_name: recipientTeamName,
          title,
          objective,
          target_audience: targetAudience,
          distribution_channel: distributionChannel,
          video_format: videoFormat,
          needs_format_guidance: needsFormatGuidance,
          desired_date: desiredDate,
          main_message: mainMessage,
          mandatory_info: mandatoryInfo,
          materials_drive_url: validatedDriveUrl,
          materials_pending: materialsPending,
          materials_notes: String(input.materialsNotes || "").trim(),
          board_column: "Recebido",
          assignee: null,
          waiting_reason: "",
          final_video_url: null,
          whatsapp_delivery_status: "pending",
          email_notification_status: "disabled",
          notification_retry_token: retryToken,
          created_at: now,
          updated_at: now,
        })
        .select("*")
        .single();

      if (insertErr) {
        if (insertErr.code === "23505") {
          const { data: raceRow } = await db
            .from("imtv_video_orders")
            .select("*")
            .eq("idempotency_key", idempotencyKey)
            .single();
          if (raceRow) {
            const mapped = mapOrderRow(raceRow);
            return jsonResponse(req, 200, {
              ok: true,
              createdNew: false,
              protocol: mapped.protocol,
              recipientTeamName: mapped.recipientTeamName,
              createdAt: mapped.createdAt,
              emailNotification: {
                enabled: false,
                status: mapped.emailNotificationStatus,
                hasError: false,
                errorMessage: null,
                retryToken: null,
              },
            });
          }
        }
        throw new Error(insertErr.message);
      }

      const createdOrder = mapOrderRow(insertedRow);
      await db.from("imtv_order_events").insert({
        order_id: createdOrder.id,
        actor_name: requesterName,
        event_type: "created",
        description: `Pedido ${createdOrder.protocol} enviado pela unidade ${unitName} (${city}/${uf}) para ${recipientTeamName}.`,
        created_at: now,
      });

      return jsonResponse(req, 201, {
        ok: true,
        createdNew: true,
        protocol: createdOrder.protocol,
        recipientTeamName: createdOrder.recipientTeamName,
        createdAt: createdOrder.createdAt,
        emailNotification: {
          enabled: false,
          status: "disabled",
          hasError: false,
          errorMessage: null,
          retryToken: null,
        },
      });
    }

    const publicRetryMatch = pathname.match(
      /^\/api\/public\/orders\/([^/]+)\/retry-notification$/,
    );
    if (publicRetryMatch && method === "POST") {
      const protocol = decodeURIComponent(publicRetryMatch[1]);
      const body = await readJsonBody<{ retryToken?: string }>(req);
      const { data: orderRow } = await db
        .from("imtv_video_orders")
        .select("id")
        .eq("protocol", protocol.trim())
        .eq("notification_retry_token", String(body.retryToken || "").trim())
        .maybeSingle();

      if (!orderRow) {
        return jsonResponse(req, 403, {
          ok: false,
          error: "Token de repetição de notificação inválido ou expirado.",
        });
      }

      return jsonResponse(req, 200, {
        ok: true,
        emailNotification: {
          enabled: false,
          status: "disabled",
          hasError: false,
          errorMessage: null,
        },
      });
    }

    // --- SESSION RESOLUTION ---
    const cookies = parseCookies(req.headers.get("cookie"));
    const bearerToken = extractBearerToken(req.headers.get("authorization"));
    const sessionToken = bearerToken || cookies[SESSION_COOKIE_NAME];

    let currentUser: ReturnType<typeof mapMemberRow> | null = null;
    if (sessionToken) {
      const tokenHash = await sha256Hex(sessionToken);
      const { data: sessionRow } = await db
        .from("imtv_sessions")
        .select("token_hash, user_id, expires_at")
        .eq("token_hash", tokenHash)
        .maybeSingle();

      if (sessionRow) {
        const nowIso = new Date().toISOString();
        if (String(sessionRow.expires_at) <= nowIso) {
          await db.from("imtv_sessions").delete().eq("token_hash", tokenHash);
        } else {
          const { data: userRow } = await db
            .from("imtv_team_users")
            .select("id, username, display_name, email, role, queue_column, active")
            .eq("id", String(sessionRow.user_id))
            .maybeSingle();
          if (userRow && userRow.active) {
            currentUser = mapMemberRow(userRow);
          }
        }
      }
    }

    if (pathname === "/api/auth/me" && method === "GET") {
      return jsonResponse(req, 200, {
        authenticated: Boolean(currentUser),
        user: currentUser,
      });
    }

    if (pathname === "/api/auth/login" && method === "POST") {
      const body = await readJsonBody<{ username?: string; password?: string }>(req);
      const key = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!key || !password) {
        return jsonResponse(req, 401, {
          ok: false,
          error: "Usuário ou senha inválidos.",
        });
      }

      const { data: candidates } = await db
        .from("imtv_team_users")
        .select("id, username, display_name, email, role, queue_column, password_hash, active")
        .eq("active", true);

      const matched = (candidates || []).find(
        (u) =>
          String(u.username).toLowerCase() === key ||
          (String(u.email || "") !== "" && String(u.email).toLowerCase() === key),
      );

      if (!matched || !(await verifyPasswordPbkdf2(password, String(matched.password_hash)))) {
        return jsonResponse(req, 401, {
          ok: false,
          error: "Usuário ou senha inválidos.",
        });
      }

      const rawToken = randomHex(32);
      const tokenHash = await sha256Hex(rawToken);
      const now = new Date();
      const maxAge = 14 * 24 * 60 * 60;
      const expires = new Date(now.getTime() + maxAge * 1000);

      await db.from("imtv_sessions").insert({
        token_hash: tokenHash,
        user_id: String(matched.id),
        expires_at: expires.toISOString(),
        created_at: now.toISOString(),
      });

      const pubUser = mapMemberRow(matched);
      return jsonResponse(
        req,
        200,
        { ok: true, user: pubUser, token: rawToken },
        {
          "Set-Cookie": `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=${maxAge}`,
        },
      );
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      if (sessionToken) {
        const tokenHash = await sha256Hex(sessionToken);
        await db.from("imtv_sessions").delete().eq("token_hash", tokenHash);
      }
      return jsonResponse(
        req,
        200,
        { ok: true },
        {
          "Set-Cookie": `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=0`,
        },
      );
    }

    // --- PROTECTED BOARD & ADMIN ROUTES ---
    if (pathname.startsWith("/api/board") || pathname.startsWith("/api/admin")) {
      if (!currentUser) {
        return jsonResponse(req, 401, {
          ok: false,
          error: "Acesso restrito à equipe autenticada da IMTV.",
        });
      }

      if (pathname.startsWith("/api/admin") && currentUser.role !== "admin") {
        return jsonResponse(req, 403, {
          ok: false,
          error: "Apenas administradores da IMTV podem alterar configurações internas.",
        });
      }

      const getOrderEvents = async (orderId: number) => {
        const { data: evRows } = await db
          .from("imtv_order_events")
          .select("id, order_id, actor_name, event_type, description, created_at")
          .eq("order_id", orderId)
          .order("id", { ascending: false });
        return (evRows || []).map(mapEventRow);
      };

      if (pathname === "/api/board/orders" && method === "GET") {
        const unit = (url.searchParams.get("unit") || "").trim().toLowerCase();
        const assignee = url.searchParams.get("assignee") || "all";
        const deadline = url.searchParams.get("deadline") || "all";

        const [{ data: allRows, error: listErr }, { data: cfgRow }] = await Promise.all([
          db
            .from("imtv_video_orders")
            .select("*")
            .order("desired_date", { ascending: true })
            .order("id", { ascending: false })
            .limit(2000),
          db
            .from("imtv_portal_settings")
            .select("recipient_team_name")
            .eq("id", 1)
            .single(),
        ]);

        if (listErr) throw new Error(listErr.message);

        const allOrders = (allRows || []).map(mapOrderRow);
        const allUnits = Array.from(new Set(allOrders.map((o) => o.unitName))).sort((a, b) =>
          a.localeCompare(b, "pt-BR"),
        );

        const today = new Date().toISOString().slice(0, 10);
        const d7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

        const filtered = allOrders.filter((o) => {
          if (
            unit &&
            !o.unitName.toLowerCase().includes(unit) &&
            !o.city.toLowerCase().includes(unit) &&
            !o.title.toLowerCase().includes(unit) &&
            !o.protocol.toLowerCase().includes(unit)
          ) {
            return false;
          }
          if (assignee === "unassigned" && o.assignee !== null) return false;
          if (
            assignee !== "all" &&
            assignee !== "unassigned" &&
            isQueueOwner(assignee) &&
            o.assignee !== assignee
          ) {
            return false;
          }
          if (deadline === "overdue" && !(o.desiredDate < today && o.boardColumn !== "Finalizados")) {
            return false;
          }
          if (deadline === "next7" && !(o.desiredDate >= today && o.desiredDate <= d7)) {
            return false;
          }
          if (/^\d{4}-\d{2}-\d{2}$/.test(deadline) && !(o.desiredDate <= deadline)) {
            return false;
          }
          return true;
        });

        return jsonResponse(req, 200, {
          columns: BOARD_COLUMNS,
          orders: filtered,
          units: allUnits,
          recipientTeamName: String(
            cfgRow?.recipient_team_name || "Equipe de Produção da IMTV",
          ),
        });
      }

      const orderDetailMatch = pathname.match(/^\/api\/board\/orders\/(\d+)$/);
      if (orderDetailMatch && method === "GET") {
        const orderId = Number(orderDetailMatch[1]);
        const { data: row } = await db
          .from("imtv_video_orders")
          .select("*")
          .eq("id", orderId)
          .maybeSingle();
        if (!row) {
          return jsonResponse(req, 404, { ok: false, error: "Pedido não encontrado." });
        }
        const events = await getOrderEvents(orderId);
        return jsonResponse(req, 200, { order: mapOrderRow(row), events });
      }

      const moveMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/move$/);
      if (moveMatch && method === "POST") {
        const orderId = Number(moveMatch[1]);
        const body = await readJsonBody<{ targetColumn?: string; waitingReason?: string }>(req);
        const targetColumn = String(body.targetColumn || "");
        if (!isBoardColumn(targetColumn)) {
          throw new DomainValidationError("Coluna de destino inválida.");
        }

        const { data: existingRow } = await db
          .from("imtv_video_orders")
          .select("*")
          .eq("id", orderId)
          .maybeSingle();
        if (!existingRow) {
          throw new DomainValidationError("Pedido não encontrado.");
        }

        const existing = mapOrderRow(existingRow);
        const nextAssignee = computeNextAssignee(existing.assignee, targetColumn);
        const nextWaitingReason =
          targetColumn === "Aguardando"
            ? body.waitingReason !== undefined
              ? String(body.waitingReason).trim()
              : existing.waitingReason
            : existing.waitingReason;

        const now = new Date().toISOString();
        const { data: updatedRow, error: updErr } = await db
          .from("imtv_video_orders")
          .update({
            board_column: targetColumn,
            assignee: nextAssignee,
            waiting_reason: nextWaitingReason,
            updated_at: now,
          })
          .eq("id", orderId)
          .select("*")
          .single();
        if (updErr) throw new Error(updErr.message);

        const assigneeNote = nextAssignee ? ` (Responsável: ${nextAssignee})` : "";
        const waitingNote =
          targetColumn === "Aguardando" && nextWaitingReason
            ? ` · Pendência: ${nextWaitingReason}`
            : "";

        await db.from("imtv_order_events").insert({
          order_id: orderId,
          actor_name: currentUser.displayName,
          event_type: "moved",
          description: `Movido de "${existing.boardColumn}" para "${targetColumn}"${assigneeNote}${waitingNote}.`,
          created_at: now,
        });

        const events = await getOrderEvents(orderId);
        return jsonResponse(req, 200, { ok: true, order: mapOrderRow(updatedRow), events });
      }

      const waitingMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/waiting$/);
      if (waitingMatch && method === "PATCH") {
        const orderId = Number(waitingMatch[1]);
        const body = await readJsonBody<{ waitingReason?: string }>(req);
        const reason = String(body.waitingReason || "").trim();
        const now = new Date().toISOString();

        const { data: updatedRow, error: updErr } = await db
          .from("imtv_video_orders")
          .update({ waiting_reason: reason, updated_at: now })
          .eq("id", orderId)
          .select("*")
          .maybeSingle();
        if (updErr) throw new Error(updErr.message);
        if (!updatedRow) {
          throw new DomainValidationError("Pedido não encontrado.");
        }

        await db.from("imtv_order_events").insert({
          order_id: orderId,
          actor_name: currentUser.displayName,
          event_type: "waiting_note",
          description: reason ? `Pendência registrada: ${reason}` : "Pendência limpa.",
          created_at: now,
        });

        const events = await getOrderEvents(orderId);
        return jsonResponse(req, 200, { ok: true, order: mapOrderRow(updatedRow), events });
      }

      const finalVideoMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/final-video$/);
      if (finalVideoMatch && method === "PATCH") {
        const orderId = Number(finalVideoMatch[1]);
        const body = await readJsonBody<{ finalVideoUrl?: string }>(req);
        const check = validateHttpsUrl(String(body.finalVideoUrl || ""));
        if (!check.valid) {
          throw new DomainValidationError(
            check.error || "Informe uma URL HTTPS completa para o vídeo final.",
            { finalVideoUrl: check.error || "URL HTTPS inválida." },
          );
        }

        const { data: existingRow } = await db
          .from("imtv_video_orders")
          .select("*")
          .eq("id", orderId)
          .maybeSingle();
        if (!existingRow) {
          throw new DomainValidationError("Pedido não encontrado.");
        }

        const existing = mapOrderRow(existingRow);
        const urlChanged = existing.finalVideoUrl !== check.url;
        const now = new Date().toISOString();

        const { data: updatedRow, error: updErr } = await db
          .from("imtv_video_orders")
          .update({
            final_video_url: check.url,
            whatsapp_delivery_status: urlChanged ? "pending" : existing.whatsappDeliveryStatus,
            whatsapp_confirmed_at: urlChanged ? null : existing.whatsappConfirmedAt,
            whatsapp_confirmed_by: urlChanged ? null : existing.whatsappConfirmedBy,
            updated_at: now,
          })
          .eq("id", orderId)
          .select("*")
          .single();
        if (updErr) throw new Error(updErr.message);

        await db.from("imtv_order_events").insert({
          order_id: orderId,
          actor_name: currentUser.displayName,
          event_type: "final_link",
          description: "Link do vídeo final salvo para entrega.",
          created_at: now,
        });

        const events = await getOrderEvents(orderId);
        return jsonResponse(req, 200, { ok: true, order: mapOrderRow(updatedRow), events });
      }

      const waOpenMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/whatsapp-opened$/);
      if (waOpenMatch && method === "POST") {
        const orderId = Number(waOpenMatch[1]);
        const now = new Date().toISOString();

        const { data: updatedRow, error: updErr } = await db
          .from("imtv_video_orders")
          .update({ whatsapp_opened_at: now, updated_at: now })
          .eq("id", orderId)
          .select("*")
          .maybeSingle();
        if (updErr) throw new Error(updErr.message);
        if (!updatedRow) {
          throw new DomainValidationError("Pedido não encontrado.");
        }

        await db.from("imtv_order_events").insert({
          order_id: orderId,
          actor_name: currentUser.displayName,
          event_type: "whatsapp_opened",
          description:
            "Conversa do WhatsApp aberta para revisão da entrega (envio segue pendente até confirmação).",
          created_at: now,
        });

        const events = await getOrderEvents(orderId);
        return jsonResponse(req, 200, { ok: true, order: mapOrderRow(updatedRow), events });
      }

      const waConfirmMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/confirm-whatsapp$/);
      if (waConfirmMatch && method === "POST") {
        const orderId = Number(waConfirmMatch[1]);
        const { data: existingRow } = await db
          .from("imtv_video_orders")
          .select("*")
          .eq("id", orderId)
          .maybeSingle();
        if (!existingRow) {
          throw new DomainValidationError("Pedido não encontrado.");
        }
        if (!existingRow.final_video_url) {
          throw new DomainValidationError(
            "Salve o link do vídeo final antes de confirmar o envio pelo WhatsApp.",
          );
        }

        const now = new Date().toISOString();
        const { data: updatedRow, error: updErr } = await db
          .from("imtv_video_orders")
          .update({
            whatsapp_delivery_status: "confirmed",
            whatsapp_confirmed_at: now,
            whatsapp_confirmed_by: currentUser.displayName,
            updated_at: now,
          })
          .eq("id", orderId)
          .select("*")
          .single();
        if (updErr) throw new Error(updErr.message);

        await db.from("imtv_order_events").insert({
          order_id: orderId,
          actor_name: currentUser.displayName,
          event_type: "whatsapp_confirmed",
          description: `Envio pelo WhatsApp confirmado por ${currentUser.displayName}.`,
          created_at: now,
        });

        const events = await getOrderEvents(orderId);
        return jsonResponse(req, 200, { ok: true, order: mapOrderRow(updatedRow), events });
      }

      const boardRetryMatch = pathname.match(
        /^\/api\/board\/orders\/(\d+)\/retry-notification$/,
      );
      if (boardRetryMatch && method === "POST") {
        const orderId = Number(boardRetryMatch[1]);
        const { data: row } = await db
          .from("imtv_video_orders")
          .select("*")
          .eq("id", orderId)
          .maybeSingle();
        if (!row) {
          return jsonResponse(req, 404, { ok: false, error: "Pedido não encontrado." });
        }
        const events = await getOrderEvents(orderId);
        return jsonResponse(req, 200, { ok: true, order: mapOrderRow(row), events });
      }

      if (orderDetailMatch && method === "DELETE") {
        if (currentUser.role !== "admin") {
          return jsonResponse(req, 403, {
            ok: false,
            error: "Apenas administradores da IMTV podem excluir pedidos.",
          });
        }
        const orderId = Number(orderDetailMatch[1]);
        const { error: delErr } = await db
          .from("imtv_video_orders")
          .delete()
          .eq("id", orderId);
        if (delErr) throw new Error(delErr.message);

        await db.rpc("imtv_reset_protocol_seq_if_empty");
        return jsonResponse(req, 200, { ok: true, deletedId: orderId });
      }

      // --- ADMIN ROUTES ---
      const buildAdminSettingsPayload = async () => {
        const [{ data: row }, { data: memberRows }] = await Promise.all([
          db.from("imtv_portal_settings").select("*").eq("id", 1).single(),
          db
            .from("imtv_team_users")
            .select("id, username, display_name, email, role, queue_column, active")
            .order("role", { ascending: true })
            .order("display_name", { ascending: true }),
        ]);

        return {
          recipientTeamName: String(row?.recipient_team_name || "Equipe de Produção da IMTV"),
          logoUrl: computeLogoUrl({
            logo_mode: String(row?.logo_mode || "bundled"),
            logo_version: Number(row?.logo_version || 1),
          }),
          logoFilename: row?.logo_filename ? String(row.logo_filename) : null,
          notificationEmailEnabled: Boolean(row?.notification_email_enabled),
          notificationEmailTo: String(row?.notification_email_to || ""),
          smtpHost: String(row?.smtp_host || ""),
          smtpPort: Number(row?.smtp_port || 587),
          smtpUser: String(row?.smtp_user || ""),
          smtpFrom: String(row?.smtp_from || ""),
          smtpSecure: Boolean(row?.smtp_secure),
          hasSmtpPassword: Boolean(row?.smtp_pass && String(row.smtp_pass).length > 0),
          members: (memberRows || []).map(mapMemberRow),
        };
      };

      if (pathname === "/api/admin/settings" && method === "GET") {
        return jsonResponse(req, 200, await buildAdminSettingsPayload());
      }

      if (pathname === "/api/admin/settings" && method === "PUT") {
        const body = await readJsonBody<{
          recipientTeamName?: string;
          notificationEmailEnabled?: boolean;
          notificationEmailTo?: string;
          smtpHost?: string;
          smtpPort?: number;
          smtpUser?: string;
          smtpPass?: string;
          smtpFrom?: string;
          smtpSecure?: boolean;
        }>(req);

        const teamName = String(body.recipientTeamName || "").trim();
        if (teamName.length < 2) {
          throw new DomainValidationError("Informe o nome da equipe destinatária.", {
            recipientTeamName: "O nome da equipe precisa ter ao menos 2 caracteres.",
          });
        }

        const emailTo = String(body.notificationEmailTo || "").trim();
        if (body.notificationEmailEnabled) {
          if (!emailTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
            throw new DomainValidationError(
              "Informe um e-mail real válido para receber os avisos.",
              { notificationEmailTo: "Informe um endereço de e-mail válido." },
            );
          }
        }

        const { data: current } = await db
          .from("imtv_portal_settings")
          .select("smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from")
          .eq("id", 1)
          .single();

        const now = new Date().toISOString();
        const { error: updErr } = await db
          .from("imtv_portal_settings")
          .update({
            recipient_team_name: teamName,
            notification_email_enabled: Boolean(body.notificationEmailEnabled),
            notification_email_to: emailTo,
            smtp_host:
              body.smtpHost !== undefined ? body.smtpHost.trim() : String(current?.smtp_host || ""),
            smtp_port:
              body.smtpPort !== undefined
                ? Number(body.smtpPort) || 587
                : Number(current?.smtp_port || 587),
            smtp_secure:
              body.smtpSecure !== undefined
                ? Boolean(body.smtpSecure)
                : Boolean(current?.smtp_secure),
            smtp_user:
              body.smtpUser !== undefined ? body.smtpUser.trim() : String(current?.smtp_user || ""),
            smtp_from:
              body.smtpFrom !== undefined ? body.smtpFrom.trim() : String(current?.smtp_from || ""),
            smtp_pass:
              body.smtpPass !== undefined && body.smtpPass !== ""
                ? body.smtpPass
                : String(current?.smtp_pass || ""),
            updated_at: now,
          })
          .eq("id", 1);
        if (updErr) throw new Error(updErr.message);

        return jsonResponse(req, 200, {
          ok: true,
          settings: await buildAdminSettingsPayload(),
        });
      }

      if (pathname === "/api/admin/logo" && method === "POST") {
        const body = await readJsonBody<{
          mode?: "uploaded" | "bundled" | "pending";
          mime?: string;
          base64?: string;
          filename?: string;
        }>(req);

        const { data: current } = await db
          .from("imtv_portal_settings")
          .select("logo_version, recipient_team_name")
          .eq("id", 1)
          .single();
        const nextVersion = Number(current?.logo_version || 1) + 1;
        const now = new Date().toISOString();

        if (body.mode === "uploaded") {
          const allowedMimes = ["image/png", "image/svg+xml", "image/webp", "image/jpeg"];
          const rawB64 = String(body.base64 || "").replace(/^data:[^;]+;base64,/, "");
          if (!body.mime || !allowedMimes.includes(body.mime) || !rawB64) {
            throw new DomainValidationError(
              "Envie um arquivo oficial PNG, SVG, WebP ou JPG válido.",
            );
          }
          if (rawB64.length > 5.6 * 1024 * 1024) {
            throw new DomainValidationError("O arquivo do logo deve ter no máximo 4 MB.");
          }
          const dataUrl = `data:${body.mime};base64,${rawB64}`;
          await db
            .from("imtv_portal_settings")
            .update({
              logo_mode: "uploaded",
              logo_mime: body.mime,
              logo_data_url: dataUrl,
              logo_filename: body.filename || "logo-imtv",
              logo_version: nextVersion,
              updated_at: now,
            })
            .eq("id", 1);
        } else if (body.mode === "pending") {
          await db
            .from("imtv_portal_settings")
            .update({
              logo_mode: "pending",
              logo_mime: null,
              logo_data_url: null,
              logo_filename: null,
              logo_version: nextVersion,
              updated_at: now,
            })
            .eq("id", 1);
        } else {
          await db
            .from("imtv_portal_settings")
            .update({
              logo_mode: "bundled",
              logo_mime: null,
              logo_data_url: null,
              logo_filename: "imtv-logo-oficial.png",
              logo_version: nextVersion,
              updated_at: now,
            })
            .eq("id", 1);
        }

        const settings = await buildAdminSettingsPayload();
        return jsonResponse(req, 200, {
          ok: true,
          publicConfig: {
            recipientTeamName: settings.recipientTeamName,
            logoUrl: settings.logoUrl,
          },
          settings,
        });
      }

      if (pathname === "/api/admin/members" && method === "POST") {
        const body = await readJsonBody<{
          username?: string;
          displayName?: string;
          email?: string;
          role?: "admin" | "member";
          queueColumn?: QueueOwner | null;
          password?: string;
          active?: boolean;
        }>(req);

        const username = String(body.username || "").trim().toLowerCase();
        const displayName = String(body.displayName || "").trim();
        const email = String(body.email || "").trim();
        const role = body.role === "admin" ? "admin" : "member";
        const queueColumn = body.queueColumn ? body.queueColumn : null;

        if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
          throw new DomainValidationError(
            "Usuário inválido (use letras minúsculas e números, de 2 a 32 caracteres).",
          );
        }
        if (displayName.length < 2) {
          throw new DomainValidationError("Informe o nome de exibição do integrante.");
        }
        if (queueColumn && !isQueueOwner(queueColumn)) {
          throw new DomainValidationError("Fila inválida.");
        }

        const { data: existing } = await db
          .from("imtv_team_users")
          .select("id, password_hash, active")
          .eq("username", username)
          .maybeSingle();

        if (!existing) {
          if (!body.password || body.password.length < 6) {
            throw new DomainValidationError(
              "Defina uma senha com pelo menos 6 caracteres para o novo integrante.",
            );
          }
          const id = `usr_${randomHex(4)}`;
          const pwHash = await hashPasswordPbkdf2(body.password);
          const { error: insErr } = await db.from("imtv_team_users").insert({
            id,
            username,
            display_name: displayName,
            email,
            role,
            queue_column: queueColumn,
            password_hash: pwHash,
            active: body.active === false ? false : true,
            created_at: new Date().toISOString(),
          });
          if (insErr) throw new Error(insErr.message);
        } else {
          const nextHash =
            body.password && body.password.length >= 6
              ? await hashPasswordPbkdf2(body.password)
              : String(existing.password_hash);
          const nextActive =
            body.active !== undefined ? Boolean(body.active) : Boolean(existing.active);
          const { error: updErr } = await db
            .from("imtv_team_users")
            .update({
              display_name: displayName,
              email,
              role,
              queue_column: queueColumn,
              password_hash: nextHash,
              active: nextActive,
            })
            .eq("id", String(existing.id));
          if (updErr) throw new Error(updErr.message);
        }

        const { data: memberRows } = await db
          .from("imtv_team_users")
          .select("id, username, display_name, email, role, queue_column, active")
          .order("role", { ascending: true })
          .order("display_name", { ascending: true });

        return jsonResponse(req, 200, {
          ok: true,
          members: (memberRows || []).map(mapMemberRow),
        });
      }
    }

    return jsonResponse(req, 404, {
      ok: false,
      error: "Rota da API não encontrada.",
    });
  } catch (err) {
    if (err instanceof DomainValidationError) {
      return jsonResponse(req, 400, {
        ok: false,
        error: err.message,
        fields: err.fields,
      });
    }
    console.error("[IMTV Supabase Edge Error]", err);
    return jsonResponse(req, 500, {
      ok: false,
      error:
        "Erro interno no servidor. Seus dados foram preservados na tela para nova tentativa.",
    });
  }
});
