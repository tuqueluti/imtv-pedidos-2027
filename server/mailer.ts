import nodemailer from 'nodemailer';
import type { VideoOrderCard } from '../shared/domain.ts';

export interface SmtpConfig {
  enabled: boolean;
  to: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface EmailSendResult {
  sent: boolean;
  error?: string;
}

export type CustomMailTransport = (params: {
  to: string;
  subject: string;
  text: string;
  html: string;
  order: VideoOrderCard;
}) => Promise<EmailSendResult>;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendOrderNotificationEmail(
  config: SmtpConfig,
  order: VideoOrderCard,
  customTransport?: CustomMailTransport
): Promise<EmailSendResult> {
  if (!config.enabled || !config.to.trim()) {
    return { sent: false, error: 'Notificações por e-mail desativadas.' };
  }

  const subject = `[IMTV 2027] Novo pedido ${order.protocol} · ${order.unitName} (${order.title})`;
  const driveLine = order.materialsDriveUrl
    ? order.materialsDriveUrl
    : 'Materiais ainda em preparação pela unidade';

  const text = [
    `Novo pedido de vídeo recebido em ${order.recipientTeamName}`,
    `Protocolo: ${order.protocol}`,
    `Título: ${order.title}`,
    `Unidade: ${order.unitName} (${order.city}/${order.uf})`,
    `Solicitante: ${order.requesterName} <${order.requesterEmail}>`,
    `WhatsApp: ${order.whatsappDisplay} (${order.whatsappE164})`,
    `Prazo desejado: ${order.desiredDate}`,
    `Canal: ${order.distributionChannel} | Formato: ${order.videoFormat}`,
    `Objetivo: ${order.objective}`,
    `Público: ${order.targetAudience}`,
    `Mensagem principal: ${order.mainMessage}`,
    order.mandatoryInfo ? `Informações obrigatórias: ${order.mandatoryInfo}` : '',
    `Materiais no Drive: ${driveLine}`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="background:#0e1014;color:#f3f5f8;padding:24px;font-family:system-ui,-apple-system,sans-serif;line-height:1.5">
      <div style="background:#171b22;border:1px solid #282f3d;border-radius:10px;padding:20px;max-width:600px">
        <p style="margin:0 0 8px;color:#ff6422;font-weight:700;font-size:13px;letter-spacing:0.04em;text-transform:uppercase">
          ${escapeHtml(order.recipientTeamName)} · Protocolo ${escapeHtml(order.protocol)}
        </p>
        <h2 style="margin:0 0 16px;color:#ffffff;font-size:20px">${escapeHtml(order.title)}</h2>
        <p style="margin:4px 0"><strong>Unidade:</strong> ${escapeHtml(order.unitName)} (${escapeHtml(order.city)}/${escapeHtml(order.uf)})</p>
        <p style="margin:4px 0"><strong>Solicitante:</strong> ${escapeHtml(order.requesterName)} (${escapeHtml(order.requesterEmail)})</p>
        <p style="margin:4px 0"><strong>WhatsApp:</strong> ${escapeHtml(order.whatsappDisplay)}</p>
        <p style="margin:4px 0"><strong>Data desejada:</strong> ${escapeHtml(order.desiredDate)}</p>
        <p style="margin:4px 0"><strong>Canal / Formato:</strong> ${escapeHtml(order.distributionChannel)} · ${escapeHtml(order.videoFormat)}</p>
        <hr style="border:none;border-top:1px solid #282f3d;margin:16px 0" />
        <p style="margin:4px 0"><strong>Objetivo:</strong> ${escapeHtml(order.objective)}</p>
        <p style="margin:4px 0"><strong>Público:</strong> ${escapeHtml(order.targetAudience)}</p>
        <p style="margin:4px 0"><strong>Mensagem principal:</strong> ${escapeHtml(order.mainMessage)}</p>
        ${order.mandatoryInfo ? `<p style="margin:4px 0"><strong>Informações obrigatórias:</strong> ${escapeHtml(order.mandatoryInfo)}</p>` : ''}
        <p style="margin:12px 0 0"><strong>Materiais no Drive:</strong> ${escapeHtml(driveLine)}</p>
      </div>
    </div>
  `;

  if (customTransport) {
    return customTransport({
      to: config.to.trim(),
      subject,
      text,
      html,
      order,
    });
  }

  if (!config.host.trim()) {
    return {
      sent: false,
      error: 'Servidor SMTP não configurado para envio ao endereço de notificação.',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host.trim(),
      port: config.port || 587,
      secure: config.secure,
      auth: config.user.trim()
        ? {
            user: config.user.trim(),
            pass: config.pass,
          }
        : undefined,
      connectionTimeout: 6000,
      greetingTimeout: 6000,
      socketTimeout: 8000,
    });

    await transporter.sendMail({
      from: config.from.trim() || config.user.trim() || 'noreply@imtv.com.br',
      to: config.to.trim(),
      subject,
      text,
      html,
    });

    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha ao enviar e-mail SMTP.';
    return { sent: false, error: message };
  }
}
