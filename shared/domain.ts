export const BOARD_COLUMNS = [
  'Recebido',
  'Luti',
  'Tati',
  'Marcio',
  'Aguardando',
  'Finalizados',
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const QUEUE_OWNERS = ['Luti', 'Tati', 'Marcio'] as const;
export type QueueOwner = (typeof QUEUE_OWNERS)[number];

export const BRAZIL_UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export interface PublicPortalConfig {
  recipientTeamName: string;
  logoUrl: string | null;
}

export interface TeamMemberPublic {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: 'admin' | 'member';
  queueColumn: QueueOwner | null;
  active: boolean;
}

export interface AdminSettingsPayload {
  recipientTeamName: string;
  logoUrl: string | null;
  logoFilename: string | null;
  notificationEmailEnabled: boolean;
  notificationEmailTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpFrom: string;
  smtpSecure: boolean;
  hasSmtpPassword: boolean;
  members: TeamMemberPublic[];
}

export interface OrderSubmissionInput {
  idempotencyKey: string;
  unitName: string;
  city: string;
  uf: string;
  requesterName: string;
  requesterEmail: string;
  whatsappCountryCode: string;
  whatsappDdd: string;
  whatsappNumber: string;
  title: string;
  objective: string;
  targetAudience: string;
  distributionChannel: string;
  videoFormat: string;
  needsFormatGuidance: boolean;
  desiredDate: string;
  mainMessage: string;
  mandatoryInfo: string;
  materialsDriveUrl: string;
  materialsPending: boolean;
  materialsNotes?: string;
}

export interface VideoOrderCard {
  id: number;
  protocol: string;
  unitName: string;
  city: string;
  uf: string;
  requesterName: string;
  requesterEmail: string;
  whatsappCountryCode: string;
  whatsappDdd: string;
  whatsappDisplay: string;
  whatsappE164: string;
  recipientTeamName: string;
  title: string;
  objective: string;
  targetAudience: string;
  distributionChannel: string;
  videoFormat: string;
  needsFormatGuidance: boolean;
  desiredDate: string;
  mainMessage: string;
  mandatoryInfo: string;
  materialsDriveUrl: string | null;
  materialsPending: boolean;
  materialsNotes: string;
  boardColumn: BoardColumn;
  assignee: QueueOwner | null;
  waitingReason: string;
  finalVideoUrl: string | null;
  whatsappDeliveryStatus: 'pending' | 'confirmed';
  whatsappOpenedAt: string | null;
  whatsappConfirmedAt: string | null;
  whatsappConfirmedBy: string | null;
  emailNotificationStatus: 'disabled' | 'sent' | 'failed';
  emailNotificationError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderEventItem {
  id: number;
  orderId: number;
  actorName: string;
  eventType: string;
  description: string;
  createdAt: string;
}

export interface WhatsAppValidationResult {
  valid: boolean;
  error?: string;
  countryCode: string;
  ddd: string;
  localDigits: string;
  e164: string;
  display: string;
}

export function isBoardColumn(val: string): val is BoardColumn {
  return (BOARD_COLUMNS as readonly string[]).includes(val);
}

export function isQueueOwner(val: string): val is QueueOwner {
  return (QUEUE_OWNERS as readonly string[]).includes(val);
}

export function computeNextAssignee(
  currentAssignee: QueueOwner | null,
  nextColumn: BoardColumn
): QueueOwner | null {
  if (isQueueOwner(nextColumn)) {
    return nextColumn;
  }
  if (nextColumn === 'Aguardando' || nextColumn === 'Finalizados') {
    return currentAssignee;
  }
  return null;
}

export function parseAndValidateWhatsApp(input: {
  countryCode: string;
  ddd: string;
  number: string;
}): WhatsAppValidationResult {
  let rawCc = (input.countryCode || '').trim().replace(/\s+/g, '');
  if (rawCc && !rawCc.startsWith('+')) {
    rawCc = `+${rawCc}`;
  }
  if (!/^\+\d{1,4}$/.test(rawCc)) {
    return {
      valid: false,
      error: 'Informe o código do país com + e de 1 a 4 dígitos (ex.: +55).',
      countryCode: rawCc || '+55',
      ddd: '',
      localDigits: '',
      e164: '',
      display: '',
    };
  }

  const rawDdd = (input.ddd || '').trim();
  if (/[^0-9()\s-]/.test(rawDdd)) {
    return {
      valid: false,
      error: 'O DDD deve conter apenas números.',
      countryCode: rawCc,
      ddd: '',
      localDigits: '',
      e164: '',
      display: '',
    };
  }
  const dddDigits = rawDdd.replace(/\D/g, '');

  const rawNum = (input.number || '').trim();
  if (!rawNum) {
    return {
      valid: false,
      error: 'Informe seu número de WhatsApp para receber o vídeo.',
      countryCode: rawCc,
      ddd: dddDigits,
      localDigits: '',
      e164: '',
      display: '',
    };
  }
  if (/[^0-9()\s-.+]/.test(rawNum)) {
    return {
      valid: false,
      error: 'Use apenas números, espaços, parênteses ou hífen no WhatsApp.',
      countryCode: rawCc,
      ddd: dddDigits,
      localDigits: '',
      e164: '',
      display: '',
    };
  }

  let numDigits = rawNum.replace(/\D/g, '');

  // If user pasted country code + DDD + number into number field, normalize gracefully
  const ccDigits = rawCc.slice(1);
  if (
    rawNum.startsWith('+') &&
    numDigits.startsWith(ccDigits) &&
    numDigits.length > ccDigits.length + 7
  ) {
    numDigits = numDigits.slice(ccDigits.length);
  }

  let finalDdd = dddDigits;
  if (!finalDdd && rawCc === '+55' && (numDigits.length === 10 || numDigits.length === 11)) {
    finalDdd = numDigits.slice(0, 2);
    numDigits = numDigits.slice(2);
  } else if (
    finalDdd &&
    numDigits.startsWith(finalDdd) &&
    (numDigits.length === finalDdd.length + 8 || numDigits.length === finalDdd.length + 9)
  ) {
    numDigits = numDigits.slice(finalDdd.length);
  }

  if (rawCc === '+55') {
    if (!/^[1-9][1-9]$/.test(finalDdd)) {
      return {
        valid: false,
        error: 'Informe um DDD válido com 2 dígitos (ex.: 48, 11, 51).',
        countryCode: rawCc,
        ddd: finalDdd,
        localDigits: numDigits,
        e164: '',
        display: '',
      };
    }
    if (!/^\d{8,9}$/.test(numDigits) || /^0+$/.test(numDigits)) {
      return {
        valid: false,
        error: 'Informe um WhatsApp válido com 8 ou 9 dígitos após o DDD.',
        countryCode: rawCc,
        ddd: finalDdd,
        localDigits: numDigits,
        e164: '',
        display: '',
      };
    }
    if (numDigits.length === 9 && !numDigits.startsWith('9')) {
      return {
        valid: false,
        error: 'Celulares de 9 dígitos no Brasil começam com o dígito 9.',
        countryCode: rawCc,
        ddd: finalDdd,
        localDigits: numDigits,
        e164: '',
        display: '',
      };
    }
  } else {
    if (!/^\d{1,5}$/.test(finalDdd)) {
      return {
        valid: false,
        error: 'Informe o código de área / DDD.',
        countryCode: rawCc,
        ddd: finalDdd,
        localDigits: numDigits,
        e164: '',
        display: '',
      };
    }
    const combined = `${ccDigits}${finalDdd}${numDigits}`;
    if (combined.length < 8 || combined.length > 15 || /^0+$/.test(numDigits)) {
      return {
        valid: false,
        error: 'Informe um telefone internacional válido (entre 8 e 15 dígitos no total).',
        countryCode: rawCc,
        ddd: finalDdd,
        localDigits: numDigits,
        e164: '',
        display: '',
      };
    }
  }

  const formattedLocal =
    numDigits.length === 9
      ? `${numDigits.slice(0, 5)}-${numDigits.slice(5)}`
      : numDigits.length === 8
        ? `${numDigits.slice(0, 4)}-${numDigits.slice(4)}`
        : numDigits;

  const e164 = `${rawCc}${finalDdd}${numDigits}`;
  const display = `${rawCc} (${finalDdd}) ${formattedLocal}`;

  return {
    valid: true,
    countryCode: rawCc,
    ddd: finalDdd,
    localDigits: numDigits,
    e164,
    display,
  };
}

export function validateHttpsUrl(raw: string): { valid: boolean; url: string; error?: string } {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { valid: false, url: '', error: 'Informe uma URL HTTPS completa.' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      return {
        valid: false,
        url: trimmed,
        error: 'Use um endereço seguro começando com https://.',
      };
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return {
        valid: false,
        url: trimmed,
        error: 'Informe um domínio válido na URL HTTPS.',
      };
    }
    // Return exact trimmed string so every sharing query parameter and fragment is preserved untouched
    return { valid: true, url: trimmed };
  } catch {
    return {
      valid: false,
      url: trimmed,
      error: 'Formato de URL inválido. Exemplo: https://drive.google.com/...',
    };
  }
}

export function isValidValidPhoneE164(e164: string | null | undefined): boolean {
  if (!e164) return false;
  return /^\+\d{8,15}$/.test(e164.trim());
}

export function buildWhatsAppMessage(params: {
  requesterName: string;
  title: string;
  unitName: string;
  finalVideoUrl: string;
  protocol: string;
}): string {
  return (
    `Olá, ${params.requesterName.trim()}! O vídeo “${params.title.trim()}”, que você pediu para a unidade ${params.unitName.trim()}, está pronto.\n` +
    `${params.finalVideoUrl.trim()}\n` +
    `Protocolo ${params.protocol.trim()}. Equipe IMTV`
  );
}

export function buildWhatsAppUrl(params: {
  whatsappE164: string;
  requesterName: string;
  title: string;
  unitName: string;
  finalVideoUrl: string;
  protocol: string;
}): string {
  const digits = params.whatsappE164.replace(/\D/g, '');
  const message = buildWhatsAppMessage(params);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
