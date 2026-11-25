import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  type AdminSettingsPayload,
  type BoardColumn,
  type OrderEventItem,
  type OrderSubmissionInput,
  type PublicPortalConfig,
  type QueueOwner,
  type TeamMemberPublic,
  type VideoOrderCard,
  BRAZIL_UFS,
  computeNextAssignee,
  isBoardColumn,
  isQueueOwner,
  parseAndValidateWhatsApp,
  validateHttpsUrl,
} from '../shared/domain.ts';
import type { SmtpConfig } from './mailer.ts';

function hashPassword(password: string, salt?: string): string {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return `${actualSalt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export interface CreateOrderResult {
  order: VideoOrderCard;
  createdNew: boolean;
  retryToken: string;
}

export interface ValidationErrorMap {
  [field: string]: string;
}

export class DomainValidationError extends Error {
  public readonly fields: ValidationErrorMap;
  constructor(message: string, fields: ValidationErrorMap = {}) {
    super(message);
    this.name = 'DomainValidationError';
    this.fields = fields;
  }
}

export class PortalStore {
  public readonly db: DatabaseSync;

  constructor(dbFilePath: string) {
    if (dbFilePath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });
    }
    this.db = new DatabaseSync(dbFilePath);
    this.initSchema();
    this.seedDefaults();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS portal_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        recipient_team_name TEXT NOT NULL DEFAULT 'Equipe de Produção da IMTV',
        logo_mode TEXT NOT NULL DEFAULT 'bundled', -- 'bundled' | 'uploaded' | 'pending'
        logo_mime TEXT,
        logo_bytes BLOB,
        logo_filename TEXT,
        logo_version INTEGER NOT NULL DEFAULT 1,
        notification_email_enabled INTEGER NOT NULL DEFAULT 0,
        notification_email_to TEXT NOT NULL DEFAULT '',
        smtp_host TEXT NOT NULL DEFAULT '',
        smtp_port INTEGER NOT NULL DEFAULT 587,
        smtp_secure INTEGER NOT NULL DEFAULT 0,
        smtp_user TEXT NOT NULL DEFAULT '',
        smtp_pass TEXT NOT NULL DEFAULT '',
        smtp_from TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS team_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
        queue_column TEXT CHECK (queue_column IN ('Luti', 'Tati', 'Marcio') OR queue_column IS NULL),
        password_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES team_users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS video_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        protocol TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        payload_fingerprint TEXT NOT NULL,
        unit_name TEXT NOT NULL,
        city TEXT NOT NULL,
        uf TEXT NOT NULL,
        requester_name TEXT NOT NULL,
        requester_email TEXT NOT NULL,
        whatsapp_country_code TEXT NOT NULL,
        whatsapp_ddd TEXT NOT NULL,
        whatsapp_display TEXT NOT NULL,
        whatsapp_e164 TEXT NOT NULL,
        recipient_team_name TEXT NOT NULL,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        target_audience TEXT NOT NULL,
        distribution_channel TEXT NOT NULL,
        video_format TEXT NOT NULL,
        needs_format_guidance INTEGER NOT NULL DEFAULT 0,
        desired_date TEXT NOT NULL,
        main_message TEXT NOT NULL,
        mandatory_info TEXT NOT NULL DEFAULT '',
        materials_drive_url TEXT,
        materials_pending INTEGER NOT NULL DEFAULT 0,
        materials_notes TEXT NOT NULL DEFAULT '',
        board_column TEXT NOT NULL DEFAULT 'Recebido' CHECK (board_column IN ('Recebido', 'Luti', 'Tati', 'Marcio', 'Aguardando', 'Finalizados')),
        assignee TEXT CHECK (assignee IN ('Luti', 'Tati', 'Marcio') OR assignee IS NULL),
        waiting_reason TEXT NOT NULL DEFAULT '',
        final_video_url TEXT,
        whatsapp_delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (whatsapp_delivery_status IN ('pending', 'confirmed')),
        whatsapp_opened_at TEXT,
        whatsapp_confirmed_at TEXT,
        whatsapp_confirmed_by TEXT,
        email_notification_status TEXT NOT NULL DEFAULT 'disabled' CHECK (email_notification_status IN ('disabled', 'sent', 'failed')),
        email_notification_error TEXT,
        notification_retry_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_column ON video_orders(board_column);
      CREATE INDEX IF NOT EXISTS idx_orders_fingerprint ON video_orders(payload_fingerprint);

      CREATE TABLE IF NOT EXISTS order_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES video_orders(id) ON DELETE CASCADE,
        actor_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  private seedDefaults(): void {
    const now = new Date().toISOString();
    const existingSettings = this.db
      .prepare('SELECT id FROM portal_settings WHERE id = 1')
      .get();

    if (!existingSettings) {
      this.db
        .prepare(
          `INSERT INTO portal_settings (
            id, recipient_team_name, logo_mode, logo_filename, logo_version, updated_at
          ) VALUES (1, 'Equipe de Produção da IMTV', 'bundled', 'imtv-logo-oficial.png', 1, ?)`
        )
        .run(now);
    }

    const userCountRow = this.db
      .prepare('SELECT COUNT(*) as total FROM team_users')
      .get() as { total: number };

    if (userCountRow.total === 0) {
      const defaultPass = process.env.IMTV_INITIAL_PASSWORD || 'imtv2027';
      const hashed = hashPassword(defaultPass);
      const insertUser = this.db.prepare(`
        INSERT INTO team_users (id, username, display_name, email, role, queue_column, password_hash, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `);

      insertUser.run('usr_luti', 'luti', 'Luti', 'luti@imtv.com.br', 'admin', 'Luti', hashed, now);
      insertUser.run('usr_tati', 'tati', 'Tati', 'tati@imtv.com.br', 'member', 'Tati', hashed, now);
      insertUser.run('usr_marcio', 'marcio', 'Marcio', 'marcio@imtv.com.br', 'member', 'Marcio', hashed, now);
      insertUser.run('usr_monica', 'monica', 'Monica', 'monica@imtv.com.br', 'admin', null, hashed, now);
    }
  }

  public close(): void {
    this.db.close();
  }

  private computeLogoUrl(row: {
    logo_mode: string;
    logo_version: number;
  }): string | null {
    if (row.logo_mode === 'pending') {
      return null;
    }
    if (row.logo_mode === 'uploaded') {
      return `/api/public/logo?v=${row.logo_version}`;
    }
    return `/branding/imtv-logo-oficial.png?v=${row.logo_version}`;
  }

  public getPublicConfig(): PublicPortalConfig {
    const row = this.db
      .prepare(
        'SELECT recipient_team_name, logo_mode, logo_version FROM portal_settings WHERE id = 1'
      )
      .get() as {
      recipient_team_name: string;
      logo_mode: string;
      logo_version: number;
    };

    return {
      recipientTeamName: row.recipient_team_name,
      logoUrl: this.computeLogoUrl(row),
    };
  }

  public getUploadedLogoBinary(): { mime: string; bytes: Uint8Array } | null {
    const row = this.db
      .prepare('SELECT logo_mode, logo_mime, logo_bytes FROM portal_settings WHERE id = 1')
      .get() as {
      logo_mode: string;
      logo_mime: string | null;
      logo_bytes: Uint8Array | null;
    };

    if (row.logo_mode !== 'uploaded' || !row.logo_bytes || !row.logo_mime) {
      return null;
    }
    return { mime: row.logo_mime, bytes: row.logo_bytes };
  }

  public getSmtpConfig(): SmtpConfig {
    const row = this.db
      .prepare(
        `SELECT notification_email_enabled, notification_email_to, smtp_host, smtp_port,
                smtp_secure, smtp_user, smtp_pass, smtp_from
         FROM portal_settings WHERE id = 1`
      )
      .get() as {
      notification_email_enabled: number;
      notification_email_to: string;
      smtp_host: string;
      smtp_port: number;
      smtp_secure: number;
      smtp_user: string;
      smtp_pass: string;
      smtp_from: string;
    };

    return {
      enabled: Boolean(row.notification_email_enabled),
      to: row.notification_email_to,
      host: row.smtp_host,
      port: row.smtp_port,
      secure: Boolean(row.smtp_secure),
      user: row.smtp_user,
      pass: row.smtp_pass,
      from: row.smtp_from,
    };
  }

  public getAdminSettings(): AdminSettingsPayload {
    const row = this.db
      .prepare('SELECT * FROM portal_settings WHERE id = 1')
      .get() as Record<string, unknown>;

    const members = this.listTeamMembers();

    return {
      recipientTeamName: String(row.recipient_team_name),
      logoUrl: this.computeLogoUrl({
        logo_mode: String(row.logo_mode),
        logo_version: Number(row.logo_version),
      }),
      logoFilename: row.logo_filename ? String(row.logo_filename) : null,
      notificationEmailEnabled: Boolean(row.notification_email_enabled),
      notificationEmailTo: String(row.notification_email_to || ''),
      smtpHost: String(row.smtp_host || ''),
      smtpPort: Number(row.smtp_port || 587),
      smtpUser: String(row.smtp_user || ''),
      smtpFrom: String(row.smtp_from || ''),
      smtpSecure: Boolean(row.smtp_secure),
      hasSmtpPassword: Boolean(row.smtp_pass && String(row.smtp_pass).length > 0),
      members,
    };
  }

  public updateAdminSettings(params: {
    recipientTeamName: string;
    notificationEmailEnabled: boolean;
    notificationEmailTo: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPass?: string;
    smtpFrom?: string;
    smtpSecure?: boolean;
  }): AdminSettingsPayload {
    const teamName = (params.recipientTeamName || '').trim();
    if (teamName.length < 2) {
      throw new DomainValidationError('Informe o nome da equipe destinatária.', {
        recipientTeamName: 'O nome da equipe precisa ter ao menos 2 caracteres.',
      });
    }

    const emailTo = (params.notificationEmailTo || '').trim();
    if (params.notificationEmailEnabled) {
      if (!emailTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
        throw new DomainValidationError('Informe um e-mail real válido para receber os avisos.', {
          notificationEmailTo: 'Informe um endereço de e-mail válido.',
        });
      }
    }

    const current = this.db
      .prepare('SELECT smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from FROM portal_settings WHERE id = 1')
      .get() as {
      smtp_host: string;
      smtp_port: number;
      smtp_secure: number;
      smtp_user: string;
      smtp_pass: string;
      smtp_from: string;
    };

    const nextHost = params.smtpHost !== undefined ? params.smtpHost.trim() : current.smtp_host;
    const nextPort = params.smtpPort !== undefined ? Number(params.smtpPort) || 587 : current.smtp_port;
    const nextSecure = params.smtpSecure !== undefined ? (params.smtpSecure ? 1 : 0) : current.smtp_secure;
    const nextUser = params.smtpUser !== undefined ? params.smtpUser.trim() : current.smtp_user;
    const nextFrom = params.smtpFrom !== undefined ? params.smtpFrom.trim() : current.smtp_from;
    const nextPass =
      params.smtpPass !== undefined && params.smtpPass !== ''
        ? params.smtpPass
        : current.smtp_pass;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE portal_settings
         SET recipient_team_name = ?,
             notification_email_enabled = ?,
             notification_email_to = ?,
             smtp_host = ?,
             smtp_port = ?,
             smtp_secure = ?,
             smtp_user = ?,
             smtp_pass = ?,
             smtp_from = ?,
             updated_at = ?
         WHERE id = 1`
      )
      .run(
        teamName,
        params.notificationEmailEnabled ? 1 : 0,
        emailTo,
        nextHost,
        nextPort,
        nextSecure,
        nextUser,
        nextPass,
        nextFrom,
        now
      );

    return this.getAdminSettings();
  }

  public updateOfficialLogo(params: {
    mode: 'uploaded' | 'bundled' | 'pending';
    mime?: string;
    bytes?: Uint8Array;
    filename?: string;
  }): PublicPortalConfig {
    const now = new Date().toISOString();
    const current = this.db
      .prepare('SELECT logo_version FROM portal_settings WHERE id = 1')
      .get() as { logo_version: number };
    const nextVersion = (current?.logo_version || 1) + 1;

    if (params.mode === 'uploaded') {
      const allowedMimes = ['image/png', 'image/svg+xml', 'image/webp', 'image/jpeg'];
      if (!params.mime || !allowedMimes.includes(params.mime) || !params.bytes || params.bytes.length === 0) {
        throw new DomainValidationError('Envie um arquivo oficial PNG, SVG, WebP ou JPG válido.');
      }
      if (params.bytes.length > 4 * 1024 * 1024) {
        throw new DomainValidationError('O arquivo do logo deve ter no máximo 4 MB.');
      }
      this.db
        .prepare(
          `UPDATE portal_settings
           SET logo_mode = 'uploaded',
               logo_mime = ?,
               logo_bytes = ?,
               logo_filename = ?,
               logo_version = ?,
               updated_at = ?
           WHERE id = 1`
        )
        .run(params.mime, params.bytes, params.filename || 'logo-imtv', nextVersion, now);
    } else if (params.mode === 'pending') {
      this.db
        .prepare(
          `UPDATE portal_settings
           SET logo_mode = 'pending',
               logo_mime = NULL,
               logo_bytes = NULL,
               logo_filename = NULL,
               logo_version = ?,
               updated_at = ?
           WHERE id = 1`
        )
        .run(nextVersion, now);
    } else {
      this.db
        .prepare(
          `UPDATE portal_settings
           SET logo_mode = 'bundled',
               logo_mime = NULL,
               logo_bytes = NULL,
               logo_filename = 'imtv-logo-oficial.png',
               logo_version = ?,
               updated_at = ?
           WHERE id = 1`
        )
        .run(nextVersion, now);
    }

    return this.getPublicConfig();
  }

  // --- Auth & Team Members ---

  public listTeamMembers(): TeamMemberPublic[] {
    const rows = this.db
      .prepare(
        `SELECT id, username, display_name, email, role, queue_column, active
         FROM team_users ORDER BY role ASC, display_name ASC`
      )
      .all() as Array<{
      id: string;
      username: string;
      display_name: string;
      email: string;
      role: 'admin' | 'member';
      queue_column: QueueOwner | null;
      active: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      email: r.email,
      role: r.role,
      queueColumn: r.queue_column,
      active: Boolean(r.active),
    }));
  }

  public upsertTeamMember(params: {
    username: string;
    displayName: string;
    email: string;
    role: 'admin' | 'member';
    queueColumn: QueueOwner | null;
    password?: string;
    active?: boolean;
  }): TeamMemberPublic[] {
    const username = (params.username || '').trim().toLowerCase();
    const displayName = (params.displayName || '').trim();
    const email = (params.email || '').trim();

    if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
      throw new DomainValidationError('Usuário inválido (use letras minúsculas e números, de 2 a 32 caracteres).');
    }
    if (displayName.length < 2) {
      throw new DomainValidationError('Informe o nome de exibição do integrante.');
    }
    if (params.queueColumn && !isQueueOwner(params.queueColumn)) {
      throw new DomainValidationError('Fila inválida.');
    }

    const existing = this.db
      .prepare('SELECT id, password_hash, active FROM team_users WHERE username = ?')
      .get(username) as { id: string; password_hash: string; active: number } | undefined;

    if (!existing) {
      if (!params.password || params.password.length < 6) {
        throw new DomainValidationError('Defina uma senha com pelo menos 6 caracteres para o novo integrante.');
      }
      const id = `usr_${crypto.randomUUID().slice(0, 8)}`;
      this.db
        .prepare(
          `INSERT INTO team_users (id, username, display_name, email, role, queue_column, password_hash, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          username,
          displayName,
          email,
          params.role,
          params.queueColumn,
          hashPassword(params.password),
          params.active === false ? 0 : 1,
          new Date().toISOString()
        );
    } else {
      const nextHash =
        params.password && params.password.length >= 6
          ? hashPassword(params.password)
          : existing.password_hash;
      const nextActive = params.active !== undefined ? (params.active ? 1 : 0) : existing.active;
      this.db
        .prepare(
          `UPDATE team_users
           SET display_name = ?, email = ?, role = ?, queue_column = ?, password_hash = ?, active = ?
           WHERE id = ?`
        )
        .run(
          displayName,
          email,
          params.role,
          params.queueColumn,
          nextHash,
          nextActive,
          existing.id
        );
    }

    return this.listTeamMembers();
  }

  public authenticate(usernameOrEmail: string, password: string): {
    token: string;
    user: TeamMemberPublic;
  } | null {
    const key = (usernameOrEmail || '').trim().toLowerCase();
    if (!key || !password) return null;

    const row = this.db
      .prepare(
        `SELECT id, username, display_name, email, role, queue_column, password_hash, active
         FROM team_users
         WHERE (LOWER(username) = ? OR (email <> '' AND LOWER(email) = ?)) AND active = 1`
      )
      .get(key, key) as
      | {
          id: string;
          username: string;
          display_name: string;
          email: string;
          role: 'admin' | 'member';
          queue_column: QueueOwner | null;
          password_hash: string;
          active: number;
        }
      | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      return null;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(rawToken);
    const now = new Date();
    const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(tokenHash, row.id, expires.toISOString(), now.toISOString());

    return {
      token: rawToken,
      user: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        email: row.email,
        role: row.role,
        queueColumn: row.queue_column,
        active: Boolean(row.active),
      },
    };
  }

  public getSessionUser(rawToken: string | undefined | null): TeamMemberPublic | null {
    if (!rawToken) return null;
    const tokenHash = sha256Hex(rawToken);
    const nowIso = new Date().toISOString();

    const row = this.db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.email, u.role, u.queue_column, u.active, s.expires_at
         FROM sessions s
         JOIN team_users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash) as
      | {
          id: string;
          username: string;
          display_name: string;
          email: string;
          role: 'admin' | 'member';
          queue_column: QueueOwner | null;
          active: number;
          expires_at: string;
        }
      | undefined;

    if (!row || !row.active || row.expires_at <= nowIso) {
      if (row) {
        this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      }
      return null;
    }

    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      role: row.role,
      queueColumn: row.queue_column,
      active: Boolean(row.active),
    };
  }

  public revokeSession(rawToken: string | undefined | null): void {
    if (!rawToken) return;
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256Hex(rawToken));
  }

  // --- Orders & Pipefy Workflow ---

  private mapOrderRow(row: Record<string, unknown>): VideoOrderCard {
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
      mandatoryInfo: String(row.mandatory_info || ''),
      materialsDriveUrl: row.materials_drive_url ? String(row.materials_drive_url) : null,
      materialsPending: Boolean(row.materials_pending),
      materialsNotes: String(row.materials_notes || ''),
      boardColumn: String(row.board_column) as BoardColumn,
      assignee: row.assignee ? (String(row.assignee) as QueueOwner) : null,
      waitingReason: String(row.waiting_reason || ''),
      finalVideoUrl: row.final_video_url ? String(row.final_video_url) : null,
      whatsappDeliveryStatus: String(row.whatsapp_delivery_status) as 'pending' | 'confirmed',
      whatsappOpenedAt: row.whatsapp_opened_at ? String(row.whatsapp_opened_at) : null,
      whatsappConfirmedAt: row.whatsapp_confirmed_at ? String(row.whatsapp_confirmed_at) : null,
      whatsappConfirmedBy: row.whatsapp_confirmed_by ? String(row.whatsapp_confirmed_by) : null,
      emailNotificationStatus: String(row.email_notification_status) as
        | 'disabled'
        | 'sent'
        | 'failed',
      emailNotificationError: row.email_notification_error
        ? String(row.email_notification_error)
        : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  public createOrder(input: OrderSubmissionInput): CreateOrderResult {
    const errors: ValidationErrorMap = {};

    const idempotencyKey = (input.idempotencyKey || '').trim();
    if (!idempotencyKey || idempotencyKey.length < 8) {
      errors.idempotencyKey = 'Chave de envio ausente. Recarregue a página e tente novamente.';
    }

    const unitName = (input.unitName || '').trim();
    if (unitName.length < 2) {
      errors.unitName = 'Informe a unidade do Instituto Mix.';
    }

    const city = (input.city || '').trim();
    if (city.length < 2) {
      errors.city = 'Informe a cidade da unidade.';
    }

    const uf = (input.uf || '').trim().toUpperCase();
    if (!(BRAZIL_UFS as readonly string[]).includes(uf)) {
      errors.uf = 'Selecione uma UF válida.';
    }

    const requesterName = (input.requesterName || '').trim();
    if (requesterName.length < 2) {
      errors.requesterName = 'Informe seu nome.';
    }

    const requesterEmail = (input.requesterEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
      errors.requesterEmail = 'Informe um endereço de e-mail válido.';
    }

    const wa = parseAndValidateWhatsApp({
      countryCode: input.whatsappCountryCode,
      ddd: input.whatsappDdd,
      number: input.whatsappNumber,
    });
    if (!wa.valid) {
      errors.whatsappNumber = wa.error || 'Número de WhatsApp inválido.';
    }

    const title = (input.title || '').trim();
    if (title.length < 3) {
      errors.title = 'Informe o título do pedido.';
    }

    const objective = (input.objective || '').trim();
    if (objective.length < 3) {
      errors.objective = 'Descreva o objetivo do vídeo.';
    }

    const targetAudience = (input.targetAudience || '').trim();
    if (targetAudience.length < 2) {
      errors.targetAudience = 'Informe o público do vídeo.';
    }

    const distributionChannel = (input.distributionChannel || '').trim();
    if (distributionChannel.length < 2) {
      errors.distributionChannel = 'Informe o canal de divulgação.';
    }

    const needsFormatGuidance = Boolean(input.needsFormatGuidance);
    const rawFormat = (input.videoFormat || '').trim();
    const videoFormat =
      needsFormatGuidance && !rawFormat ? 'Preciso de orientação da IMTV' : rawFormat;
    if (!videoFormat) {
      errors.videoFormat = 'Selecione o formato ou marque "Preciso de orientação".';
    }

    const desiredDate = (input.desiredDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desiredDate)) {
      errors.desiredDate = 'Informe a data desejada para o vídeo.';
    }

    const mainMessage = (input.mainMessage || '').trim();
    if (mainMessage.length < 5) {
      errors.mainMessage = 'Descreva a mensagem principal da peça.';
    }

    const mandatoryInfo = (input.mandatoryInfo || '').trim();
    const materialsPending = Boolean(input.materialsPending);
    const rawDriveUrl = (input.materialsDriveUrl || '').trim();
    let validatedDriveUrl: string | null = null;

    if (rawDriveUrl) {
      const urlCheck = validateHttpsUrl(rawDriveUrl);
      if (!urlCheck.valid) {
        errors.materialsDriveUrl =
          urlCheck.error || 'Informe um link HTTPS válido do Google Drive.';
      } else {
        validatedDriveUrl = urlCheck.url;
      }
    } else if (!materialsPending) {
      errors.materialsDriveUrl =
        'Cole o link do Google Drive com os materiais ou marque que os materiais ainda não estão prontos.';
    }

    if (Object.keys(errors).length > 0) {
      throw new DomainValidationError(
        'Confira os campos destacados antes de enviar o pedido.',
        errors
      );
    }

    // Check existing order by idempotency_key OR recent identical payload fingerprint (60s window)
    const existingByIdem = this.db
      .prepare('SELECT * FROM video_orders WHERE idempotency_key = ?')
      .get(idempotencyKey) as Record<string, unknown> | undefined;

    if (existingByIdem) {
      return {
        order: this.mapOrderRow(existingByIdem),
        createdNew: false,
        retryToken: String(existingByIdem.notification_retry_token),
      };
    }

    const payloadFingerprint = sha256Hex(
      JSON.stringify({
        unitName: unitName.toLowerCase(),
        uf,
        requesterEmail,
        whatsappE164: wa.e164,
        title: title.toLowerCase(),
        desiredDate,
        mainMessage: mainMessage.toLowerCase(),
        materialsDriveUrl: validatedDriveUrl || '',
      })
    );

    const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
    const existingByFingerprint = this.db
      .prepare(
        'SELECT * FROM video_orders WHERE payload_fingerprint = ? AND created_at >= ? ORDER BY id DESC LIMIT 1'
      )
      .get(payloadFingerprint, sixtySecondsAgo) as Record<string, unknown> | undefined;

    if (existingByFingerprint) {
      return {
        order: this.mapOrderRow(existingByFingerprint),
        createdNew: false,
        retryToken: String(existingByFingerprint.notification_retry_token),
      };
    }

    const publicConfig = this.getPublicConfig();
    const smtp = this.getSmtpConfig();
    const initialEmailStatus = smtp.enabled && smtp.to.trim() ? 'failed' : 'disabled';
    const retryToken = crypto.randomBytes(24).toString('hex');
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Double-check inside transaction
      const raceCheck = this.db
        .prepare('SELECT * FROM video_orders WHERE idempotency_key = ?')
        .get(idempotencyKey) as Record<string, unknown> | undefined;
      if (raceCheck) {
        this.db.exec('COMMIT');
        return {
          order: this.mapOrderRow(raceCheck),
          createdNew: false,
          retryToken: String(raceCheck.notification_retry_token),
        };
      }

      const seqRow = this.db
        .prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next_seq FROM video_orders')
        .get() as { next_seq: number };
      const protocol = `IMTV-2027-${String(seqRow.next_seq).padStart(4, '0')}`;

      const insertResult = this.db
        .prepare(
          `INSERT INTO video_orders (
            protocol, idempotency_key, payload_fingerprint,
            unit_name, city, uf, requester_name, requester_email,
            whatsapp_country_code, whatsapp_ddd, whatsapp_display, whatsapp_e164,
            recipient_team_name,
            title, objective, target_audience, distribution_channel, video_format,
            needs_format_guidance, desired_date, main_message, mandatory_info,
            materials_drive_url, materials_pending, materials_notes,
            board_column, assignee, waiting_reason,
            final_video_url, whatsapp_delivery_status,
            email_notification_status, notification_retry_token,
            created_at, updated_at
          ) VALUES (
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            'Recebido', NULL, '',
            NULL, 'pending',
            ?, ?,
            ?, ?
          )`
        )
        .run(
          protocol,
          idempotencyKey,
          payloadFingerprint,
          unitName,
          city,
          uf,
          requesterName,
          requesterEmail,
          wa.countryCode,
          wa.ddd,
          wa.display,
          wa.e164,
          publicConfig.recipientTeamName,
          title,
          objective,
          targetAudience,
          distributionChannel,
          videoFormat,
          needsFormatGuidance ? 1 : 0,
          desiredDate,
          mainMessage,
          mandatoryInfo,
          validatedDriveUrl,
          materialsPending ? 1 : 0,
          (input.materialsNotes || '').trim(),
          initialEmailStatus,
          retryToken,
          now,
          now
        );

      const newId = Number(insertResult.lastInsertRowid);
      this.db
        .prepare(
          `INSERT INTO order_events (order_id, actor_name, event_type, description, created_at)
           VALUES (?, ?, 'created', ?, ?)`
        )
        .run(
          newId,
          requesterName,
          `Pedido ${protocol} enviado pela unidade ${unitName} (${city}/${uf}) para ${publicConfig.recipientTeamName}.`,
          now
        );

      this.db.exec('COMMIT');

      const createdRow = this.db
        .prepare('SELECT * FROM video_orders WHERE id = ?')
        .get(newId) as Record<string, unknown>;

      return {
        order: this.mapOrderRow(createdRow),
        createdNew: true,
        retryToken,
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public recordEmailNotificationResult(
    orderId: number,
    result: { sent: boolean; error?: string }
  ): VideoOrderCard {
    const now = new Date().toISOString();
    const status = result.sent ? 'sent' : 'failed';
    const errorMsg = result.sent ? null : result.error || 'Falha no envio do aviso por e-mail.';

    this.db
      .prepare(
        `UPDATE video_orders
         SET email_notification_status = ?, email_notification_error = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(status, errorMsg, now, orderId);

    const row = this.db
      .prepare('SELECT * FROM video_orders WHERE id = ?')
      .get(orderId) as Record<string, unknown>;
    return this.mapOrderRow(row);
  }

  public getOrderByProtocolAndRetryToken(
    protocol: string,
    retryToken: string
  ): VideoOrderCard | null {
    const row = this.db
      .prepare(
        'SELECT * FROM video_orders WHERE protocol = ? AND notification_retry_token = ?'
      )
      .get((protocol || '').trim(), (retryToken || '').trim()) as
      | Record<string, unknown>
      | undefined;

    return row ? this.mapOrderRow(row) : null;
  }

  public getOrderById(orderId: number): VideoOrderCard | null {
    const row = this.db
      .prepare('SELECT * FROM video_orders WHERE id = ?')
      .get(orderId) as Record<string, unknown> | undefined;
    return row ? this.mapOrderRow(row) : null;
  }

  public listOrders(filters?: {
    unit?: string;
    assignee?: string;
    deadline?: string;
  }): VideoOrderCard[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters?.unit && filters.unit.trim()) {
      clauses.push('(LOWER(unit_name) LIKE ? OR LOWER(city) LIKE ? OR LOWER(title) LIKE ? OR LOWER(protocol) LIKE ?)');
      const term = `%${filters.unit.trim().toLowerCase()}%`;
      params.push(term, term, term, term);
    }

    if (filters?.assignee && filters.assignee !== 'all') {
      if (filters.assignee === 'unassigned') {
        clauses.push('assignee IS NULL');
      } else if (isQueueOwner(filters.assignee)) {
        clauses.push('assignee = ?');
        params.push(filters.assignee);
      }
    }

    if (filters?.deadline && filters.deadline !== 'all') {
      const today = new Date().toISOString().slice(0, 10);
      if (filters.deadline === 'overdue') {
        clauses.push("desired_date < ? AND board_column <> 'Finalizados'");
        params.push(today);
      } else if (filters.deadline === 'next7') {
        const d7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
        clauses.push('desired_date >= ? AND desired_date <= ?');
        params.push(today, d7);
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(filters.deadline)) {
        clauses.push('desired_date <= ?');
        params.push(filters.deadline);
      }
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT * FROM video_orders ${whereSql} ORDER BY desired_date ASC, id DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapOrderRow(r));
  }

  public getOrderEvents(orderId: number): OrderEventItem[] {
    const rows = this.db
      .prepare(
        'SELECT id, order_id, actor_name, event_type, description, created_at FROM order_events WHERE order_id = ? ORDER BY id DESC'
      )
      .all(orderId) as Array<{
      id: number;
      order_id: number;
      actor_name: string;
      event_type: string;
      description: string;
      created_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      actorName: r.actor_name,
      eventType: r.event_type,
      description: r.description,
      createdAt: r.created_at,
    }));
  }

  public moveOrderColumn(params: {
    orderId: number;
    targetColumn: BoardColumn;
    waitingReason?: string;
    actorName: string;
  }): VideoOrderCard {
    if (!isBoardColumn(params.targetColumn)) {
      throw new DomainValidationError('Coluna de destino inválida.');
    }

    const existing = this.getOrderById(params.orderId);
    if (!existing) {
      throw new DomainValidationError('Pedido não encontrado.');
    }

    const nextAssignee = computeNextAssignee(existing.assignee, params.targetColumn);
    const nextWaitingReason =
      params.targetColumn === 'Aguardando'
        ? params.waitingReason !== undefined
          ? params.waitingReason.trim()
          : existing.waitingReason
        : existing.waitingReason;

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE video_orders
         SET board_column = ?, assignee = ?, waiting_reason = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(params.targetColumn, nextAssignee, nextWaitingReason, now, params.orderId);

    const assigneeNote = nextAssignee ? ` (Responsável: ${nextAssignee})` : '';
    const waitingNote =
      params.targetColumn === 'Aguardando' && nextWaitingReason
        ? ` · Pendência: ${nextWaitingReason}`
        : '';

    this.db
      .prepare(
        `INSERT INTO order_events (order_id, actor_name, event_type, description, created_at)
         VALUES (?, ?, 'moved', ?, ?)`
      )
      .run(
        params.orderId,
        params.actorName,
        `Movido de "${existing.boardColumn}" para "${params.targetColumn}"${assigneeNote}${waitingNote}.`,
        now
      );

    return this.getOrderById(params.orderId)!;
  }

  public updateWaitingReason(params: {
    orderId: number;
    waitingReason: string;
    actorName: string;
  }): VideoOrderCard {
    const existing = this.getOrderById(params.orderId);
    if (!existing) {
      throw new DomainValidationError('Pedido não encontrado.');
    }

    const reason = (params.waitingReason || '').trim();
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE video_orders SET waiting_reason = ?, updated_at = ? WHERE id = ?')
      .run(reason, now, params.orderId);

    this.db
      .prepare(
        `INSERT INTO order_events (order_id, actor_name, event_type, description, created_at)
         VALUES (?, ?, 'waiting_note', ?, ?)`
      )
      .run(
        params.orderId,
        params.actorName,
        reason ? `Pendência registrada: ${reason}` : 'Pendência limpa.',
        now
      );

    return this.getOrderById(params.orderId)!;
  }

  public saveFinalVideoUrl(params: {
    orderId: number;
    finalVideoUrl: string;
    actorName: string;
  }): VideoOrderCard {
    const existing = this.getOrderById(params.orderId);
    if (!existing) {
      throw new DomainValidationError('Pedido não encontrado.');
    }

    const check = validateHttpsUrl(params.finalVideoUrl);
    if (!check.valid) {
      throw new DomainValidationError(
        check.error || 'Informe uma URL HTTPS completa para o vídeo final.',
        { finalVideoUrl: check.error || 'URL HTTPS inválida.' }
      );
    }

    const now = new Date().toISOString();
    // Saving a new final video URL resets delivery status to pending if URL changed, or keeps pending until confirmed
    const urlChanged = existing.finalVideoUrl !== check.url;
    const nextStatus = urlChanged ? 'pending' : existing.whatsappDeliveryStatus;
    const nextConfirmedAt = urlChanged ? null : existing.whatsappConfirmedAt;
    const nextConfirmedBy = urlChanged ? null : existing.whatsappConfirmedBy;

    this.db
      .prepare(
        `UPDATE video_orders
         SET final_video_url = ?,
             whatsapp_delivery_status = ?,
             whatsapp_confirmed_at = ?,
             whatsapp_confirmed_by = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(check.url, nextStatus, nextConfirmedAt, nextConfirmedBy, now, params.orderId);

    this.db
      .prepare(
        `INSERT INTO order_events (order_id, actor_name, event_type, description, created_at)
         VALUES (?, ?, 'final_link', ?, ?)`
      )
      .run(params.orderId, params.actorName, 'Link do vídeo final salvo para entrega.', now);

    return this.getOrderById(params.orderId)!;
  }

  public recordWhatsAppOpened(orderId: number, actorName: string): VideoOrderCard {
    const existing = this.getOrderById(orderId);
    if (!existing) {
      throw new DomainValidationError('Pedido não encontrado.');
    }
    const now = new Date().toISOString();
    // IMPORTANT: Opening WhatsApp MUST NOT mark delivery as confirmed! Status remains 'pending' until explicit confirmation.
    this.db
      .prepare('UPDATE video_orders SET whatsapp_opened_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, orderId);

    this.db
      .prepare(
        `INSERT INTO order_events (order_id, actor_name, event_type, description, created_at)
         VALUES (?, ?, 'whatsapp_opened', 'Conversa do WhatsApp aberta para revisão da entrega (envio segue pendente até confirmação).', ?)`
      )
      .run(orderId, actorName, now);

    return this.getOrderById(orderId)!;
  }

  public confirmWhatsAppDelivery(orderId: number, actorName: string): VideoOrderCard {
    const existing = this.getOrderById(orderId);
    if (!existing) {
      throw new DomainValidationError('Pedido não encontrado.');
    }
    if (!existing.finalVideoUrl) {
      throw new DomainValidationError(
        'Salve o link do vídeo final antes de confirmar o envio pelo WhatsApp.'
      );
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE video_orders
         SET whatsapp_delivery_status = 'confirmed',
             whatsapp_confirmed_at = ?,
             whatsapp_confirmed_by = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(now, actorName, now, orderId);

    this.db
      .prepare(
        `INSERT INTO order_events (order_id, actor_name, event_type, description, created_at)
         VALUES (?, ?, 'whatsapp_confirmed', ?, ?)`
      )
      .run(
        orderId,
        actorName,
        `Envio pelo WhatsApp confirmado por ${actorName}.`,
        now
      );

    return this.getOrderById(orderId)!;
  }

  public deleteOrderById(orderId: number): void {
    const existing = this.getOrderById(orderId);
    if (!existing) {
      throw new DomainValidationError('Pedido não encontrado.');
    }
    this.db.prepare('DELETE FROM video_orders WHERE id = ?').run(orderId);
    const rem = this.db
      .prepare('SELECT COUNT(*) as total FROM video_orders')
      .get() as { total: number };
    if (rem.total === 0) {
      this.db.exec("DELETE FROM sqlite_sequence WHERE name IN ('video_orders', 'order_events');");
    }
  }
}
