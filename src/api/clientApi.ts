import {
  BOARD_COLUMNS,
  type AdminSettingsPayload,
  type BoardColumn,
  type OrderEventItem,
  type OrderSubmissionInput,
  type PublicPortalConfig,
  type QueueOwner,
  type TeamMemberPublic,
  type VideoOrderCard,
  computeNextAssignee,
  isBoardColumn,
  isQueueOwner,
  parseAndValidateWhatsApp,
  validateHttpsUrl,
} from '../../shared/domain.ts';

export function assetUrl(cleanPath: string): string {
  if (
    cleanPath.startsWith('data:') ||
    cleanPath.startsWith('http://') ||
    cleanPath.startsWith('https://') ||
    cleanPath.startsWith('blob:')
  ) {
    return cleanPath;
  }
  const base = import.meta.env.BASE_URL || '/';
  // Se cleanPath já começa com base (ex.: /imtv-pedidos-2027/...), mantém
  if (base !== '/' && cleanPath.startsWith(base)) {
    return cleanPath;
  }
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedRel = cleanPath.replace(/^\/+/, '');
  return `${normalizedBase}${normalizedRel}`;
}

export function normalizeLogoUrl(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  if (logoUrl.startsWith('/branding/')) {
    return assetUrl(logoUrl);
  }
  return logoUrl;
}

// ============================================================================
// Motor Local-First Embarcado (ativado automaticamente apenas em hospedagem
// estática como GitHub Pages quando não há backend Node conectado)
// ============================================================================

const LS_KEY = 'imtv_portal_2027_static_db_v1';
const LS_SESSION_KEY = 'imtv_portal_2027_static_session_v1';

interface StaticDbState {
  recipientTeamName: string;
  logoMode: 'bundled' | 'uploaded' | 'pending';
  logoDataUrl: string | null;
  logoFilename: string | null;
  notificationEmailEnabled: boolean;
  notificationEmailTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpFrom: string;
  smtpSecure: boolean;
  members: Array<TeamMemberPublic & { passwordPlain: string }>;
  orders: Array<VideoOrderCard & { idempotencyKey: string }>;
  events: OrderEventItem[];
  nextId: number;
  nextEventId: number;
}

function createInitialStaticDb(): StaticDbState {
  const now = new Date().toISOString();
  const demoOrders: Array<VideoOrderCard & { idempotencyKey: string }> = [
    {
      id: 1,
      protocol: 'IMTV-2027-0022',
      idempotencyKey: 'seed_1',
      unitName: 'Unidade Centro',
      city: 'Florianópolis',
      uf: 'SC',
      requesterName: 'Carla Mendes',
      requesterEmail: 'carla@unidadecentro.example',
      whatsappCountryCode: '+55',
      whatsappDdd: '48',
      whatsappDisplay: '+55 (48) 99812-3401',
      whatsappE164: '+5548998123401',
      recipientTeamName: 'Equipe de Produção da IMTV',
      title: 'Campanha de matrículas',
      objective: 'Captar alunos para as turmas do primeiro semestre.',
      targetAudience: 'Jovens e adultos de 18 a 40 anos',
      distributionChannel: 'Instagram (Reels / Stories / Feed)',
      videoFormat: 'Vertical 9:16 (Reels / Shorts / Stories)',
      needsFormatGuidance: false,
      desiredDate: '2027-03-12',
      mainMessage: 'Matrículas abertas com aulas práticas desde a primeira semana.',
      mandatoryInfo: 'Unidade Centro',
      materialsDriveUrl: 'https://drive.google.com/drive/folders/1ExemploCampanhaMatriculas',
      materialsPending: false,
      materialsNotes: '',
      boardColumn: 'Recebido',
      assignee: null,
      waitingReason: '',
      finalVideoUrl: null,
      whatsappDeliveryStatus: 'pending',
      whatsappOpenedAt: null,
      whatsappConfirmedAt: null,
      whatsappConfirmedBy: null,
      emailNotificationStatus: 'disabled',
      emailNotificationError: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 2,
      protocol: 'IMTV-2027-0023',
      idempotencyKey: 'seed_2',
      unitName: 'Unidade Norte',
      city: 'Joinville',
      uf: 'SC',
      requesterName: 'Marcos Silva',
      requesterEmail: 'marcos@unidadenorte.example',
      whatsappCountryCode: '+55',
      whatsappDdd: '47',
      whatsappDisplay: '+55 (47) 99741-1120',
      whatsappE164: '+5547997411120',
      recipientTeamName: 'Equipe de Produção da IMTV',
      title: 'Aula inaugural',
      objective: 'Convidar alunos matriculados para a aula inaugural.',
      targetAudience: 'Novos alunos 2027',
      distributionChannel: 'WhatsApp Comercial / Matrículas',
      videoFormat: 'Vertical 9:16 (Reels / Shorts / Stories)',
      needsFormatGuidance: false,
      desiredDate: '2027-03-10',
      mainMessage: 'Sua jornada profissional começa nesta segunda-feira.',
      mandatoryInfo: '',
      materialsDriveUrl: 'https://drive.google.com/drive/folders/1ExemploAulaInaugural',
      materialsPending: false,
      materialsNotes: '',
      boardColumn: 'Luti',
      assignee: 'Luti',
      waitingReason: '',
      finalVideoUrl: null,
      whatsappDeliveryStatus: 'pending',
      whatsappOpenedAt: null,
      whatsappConfirmedAt: null,
      whatsappConfirmedBy: null,
      emailNotificationStatus: 'disabled',
      emailNotificationError: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 3,
      protocol: 'IMTV-2027-0024',
      idempotencyKey: 'seed_3',
      unitName: 'Unidade Sul',
      city: 'Criciúma',
      uf: 'SC',
      requesterName: 'Fernanda Costa',
      requesterEmail: 'fernanda@unidadesul.example',
      whatsappCountryCode: '+55',
      whatsappDdd: '48',
      whatsappDisplay: '+55 (48) 99630-8840',
      whatsappE164: '+5548996308840',
      recipientTeamName: 'Equipe de Produção da IMTV',
      title: 'Tour da unidade',
      objective: 'Apresentar os novos laboratórios reformados.',
      targetAudience: 'Interessados nos cursos presenciais',
      distributionChannel: 'Instagram (Reels / Stories / Feed)',
      videoFormat: 'Versão dupla (16:9 + 9:16)',
      needsFormatGuidance: false,
      desiredDate: '2027-03-11',
      mainMessage: 'Conheça de perto a estrutura completa da Unidade Sul.',
      mandatoryInfo: '',
      materialsDriveUrl: 'https://drive.google.com/drive/folders/1ExemploTourUnidade',
      materialsPending: false,
      materialsNotes: '',
      boardColumn: 'Tati',
      assignee: 'Tati',
      waitingReason: '',
      finalVideoUrl: null,
      whatsappDeliveryStatus: 'pending',
      whatsappOpenedAt: null,
      whatsappConfirmedAt: null,
      whatsappConfirmedBy: null,
      emailNotificationStatus: 'disabled',
      emailNotificationError: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 4,
      protocol: 'IMTV-2027-0025',
      idempotencyKey: 'seed_4',
      unitName: 'Unidade Leste',
      city: 'Itajaí',
      uf: 'SC',
      requesterName: 'Lucas Almeida',
      requesterEmail: 'lucas@unidadeleste.example',
      whatsappCountryCode: '+55',
      whatsappDdd: '47',
      whatsappDisplay: '+55 (47) 99904-5521',
      whatsappE164: '+5547999045521',
      recipientTeamName: 'Equipe de Produção da IMTV',
      title: 'Feira de profissões',
      objective: 'Divulgar oficinas gratuitas da feira.',
      targetAudience: 'Estudantes do ensino médio',
      distributionChannel: 'Tráfego Pago (Meta Ads / Google Ads)',
      videoFormat: 'Vertical 9:16 (Reels / Shorts / Stories)',
      needsFormatGuidance: false,
      desiredDate: '2027-03-15',
      mainMessage: 'Participe das oficinas práticas gratuitas na Feira de Profissões.',
      mandatoryInfo: '',
      materialsDriveUrl: 'https://drive.google.com/drive/folders/1ExemploFeiraProfissoes',
      materialsPending: false,
      materialsNotes: '',
      boardColumn: 'Marcio',
      assignee: 'Marcio',
      waitingReason: '',
      finalVideoUrl: null,
      whatsappDeliveryStatus: 'pending',
      whatsappOpenedAt: null,
      whatsappConfirmedAt: null,
      whatsappConfirmedBy: null,
      emailNotificationStatus: 'disabled',
      emailNotificationError: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 5,
      protocol: 'IMTV-2027-0026',
      idempotencyKey: 'seed_5',
      unitName: 'Unidade Oeste',
      city: 'Chapecó',
      uf: 'SC',
      requesterName: 'Patrícia Rocha',
      requesterEmail: 'patricia@unidadeoeste.example',
      whatsappCountryCode: '+55',
      whatsappDdd: '49',
      whatsappDisplay: '+55 (49) 99822-7710',
      whatsappE164: '+5549998227710',
      recipientTeamName: 'Equipe de Produção da IMTV',
      title: 'Depoimento de aluna',
      objective: 'Prova social de ex-aluna formada em Gastronomia.',
      targetAudience: 'Público geral da região Oeste',
      distributionChannel: 'Instagram (Reels / Stories / Feed)',
      videoFormat: 'Vertical 9:16 (Reels / Shorts / Stories)',
      needsFormatGuidance: false,
      desiredDate: '2027-03-14',
      mainMessage: 'História real de conquista no mercado gastronômico.',
      mandatoryInfo: '',
      materialsDriveUrl: 'https://drive.google.com/drive/folders/1ExemploDepoimentoAluna',
      materialsPending: false,
      materialsNotes: '',
      boardColumn: 'Aguardando',
      assignee: 'Tati',
      waitingReason: 'falta aprovação',
      finalVideoUrl: null,
      whatsappDeliveryStatus: 'pending',
      whatsappOpenedAt: null,
      whatsappConfirmedAt: null,
      whatsappConfirmedBy: null,
      emailNotificationStatus: 'disabled',
      emailNotificationError: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 6,
      protocol: 'IMTV-2027-0027',
      idempotencyKey: 'seed_6',
      unitName: 'Unidade Centro',
      city: 'Araranguá',
      uf: 'SC',
      requesterName: 'Ana da unidade',
      requesterEmail: 'ana@unidadecentro.example',
      whatsappCountryCode: '+55',
      whatsappDdd: '48',
      whatsappDisplay: '+55 (48) 99915-2027',
      whatsappE164: '+5548999152027',
      recipientTeamName: 'Equipe de Produção da IMTV',
      title: 'Semana da Beleza',
      objective: 'Divulgar as oficinas da Semana da Beleza.',
      targetAudience: 'Interessados na área da beleza',
      distributionChannel: 'Instagram (Reels / Stories / Feed)',
      videoFormat: 'Vertical 9:16 (Reels / Shorts / Stories)',
      needsFormatGuidance: false,
      desiredDate: '2027-03-09',
      mainMessage: 'Divulgar as oficinas da Semana da Beleza.',
      mandatoryInfo: '',
      materialsDriveUrl: 'https://drive.google.com/drive/folders/1ExemploSemanaBeleza',
      materialsPending: false,
      materialsNotes: '',
      boardColumn: 'Finalizados',
      assignee: 'Tati',
      waitingReason: '',
      finalVideoUrl: 'https://drive.google.com/file/d/1SemanaDaBelezaFinal2027/view?usp=sharing',
      whatsappDeliveryStatus: 'pending',
      whatsappOpenedAt: null,
      whatsappConfirmedAt: null,
      whatsappConfirmedBy: null,
      emailNotificationStatus: 'disabled',
      emailNotificationError: null,
      createdAt: now,
      updatedAt: now,
    },
  ];

  return {
    recipientTeamName: 'Equipe de Produção da IMTV',
    logoMode: 'bundled',
    logoDataUrl: null,
    logoFilename: 'imtv-logo-oficial.png',
    notificationEmailEnabled: false,
    notificationEmailTo: '',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpFrom: '',
    smtpSecure: false,
    members: [
      { id: 'usr_luti', username: 'luti', displayName: 'Luti', email: 'luti@imtv.com.br', role: 'admin', queueColumn: 'Luti', active: true, passwordPlain: 'imtv2027' },
      { id: 'usr_tati', username: 'tati', displayName: 'Tati', email: 'tati@imtv.com.br', role: 'member', queueColumn: 'Tati', active: true, passwordPlain: 'imtv2027' },
      { id: 'usr_marcio', username: 'marcio', displayName: 'Marcio', email: 'marcio@imtv.com.br', role: 'member', queueColumn: 'Marcio', active: true, passwordPlain: 'imtv2027' },
      { id: 'usr_monica', username: 'monica', displayName: 'Monica', email: 'monica@imtv.com.br', role: 'admin', queueColumn: null, active: true, passwordPlain: 'imtv2027' },
    ],
    orders: demoOrders,
    events: [],
    nextId: 28,
    nextEventId: 1,
  };
}

function loadStaticDb(): StaticDbState {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as StaticDbState;
  } catch {
    // ignore
  }
  const initial = createInitialStaticDb();
  saveStaticDb(initial);
  return initial;
}

function saveStaticDb(db: StaticDbState): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch {
    // ignore
  }
}

function staticJsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function computeStaticLogoUrl(db: StaticDbState): string | null {
  if (db.logoMode === 'pending') return null;
  if (db.logoMode === 'uploaded' && db.logoDataUrl) return db.logoDataUrl;
  return assetUrl('/branding/imtv-logo-oficial.png');
}

function handleStaticApi(pathname: string, urlObj: URL, init?: RequestInit): Response {
  const method = (init?.method || 'GET').toUpperCase();
  const bodyObj =
    typeof init?.body === 'string' && init.body.trim()
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : {};

  const db = loadStaticDb();

  if (pathname === '/api/public/config' && method === 'GET') {
    const cfg: PublicPortalConfig = {
      recipientTeamName: db.recipientTeamName,
      logoUrl: computeStaticLogoUrl(db),
    };
    return staticJsonResponse(200, cfg);
  }

  if (pathname === '/api/public/orders' && method === 'POST') {
    const input = bodyObj as unknown as OrderSubmissionInput;
    const existing = db.orders.find((o) => o.idempotencyKey === input.idempotencyKey);
    if (existing) {
      return staticJsonResponse(200, {
        ok: true,
        createdNew: false,
        protocol: existing.protocol,
        recipientTeamName: existing.recipientTeamName,
        createdAt: existing.createdAt,
        emailNotification: { enabled: false, status: 'disabled', hasError: false, retryToken: null },
      });
    }

    const wa = parseAndValidateWhatsApp({
      countryCode: input.whatsappCountryCode,
      ddd: input.whatsappDdd,
      number: input.whatsappNumber,
    });
    if (!wa.valid) {
      return staticJsonResponse(400, {
        ok: false,
        error: wa.error || 'WhatsApp inválido.',
        fields: { whatsappNumber: wa.error || 'WhatsApp inválido.' },
      });
    }

    const seq = db.nextId++;
    const protocol = `IMTV-2027-${String(seq).padStart(4, '0')}`;
    const now = new Date().toISOString();
    const newOrder: VideoOrderCard & { idempotencyKey: string } = {
      id: seq,
      protocol,
      idempotencyKey: input.idempotencyKey,
      unitName: input.unitName.trim(),
      city: input.city.trim(),
      uf: input.uf.trim().toUpperCase(),
      requesterName: input.requesterName.trim(),
      requesterEmail: input.requesterEmail.trim().toLowerCase(),
      whatsappCountryCode: wa.countryCode,
      whatsappDdd: wa.ddd,
      whatsappDisplay: wa.display,
      whatsappE164: wa.e164,
      recipientTeamName: db.recipientTeamName,
      title: input.title.trim(),
      objective: input.objective.trim(),
      targetAudience: input.targetAudience.trim(),
      distributionChannel: input.distributionChannel.trim(),
      videoFormat: input.needsFormatGuidance ? 'Preciso de orientação da IMTV' : input.videoFormat.trim(),
      needsFormatGuidance: Boolean(input.needsFormatGuidance),
      desiredDate: input.desiredDate,
      mainMessage: input.mainMessage.trim(),
      mandatoryInfo: (input.mandatoryInfo || '').trim(),
      materialsDriveUrl: input.materialsDriveUrl.trim() || null,
      materialsPending: Boolean(input.materialsPending),
      materialsNotes: (input.materialsNotes || '').trim(),
      boardColumn: 'Recebido',
      assignee: null,
      waitingReason: '',
      finalVideoUrl: null,
      whatsappDeliveryStatus: 'pending',
      whatsappOpenedAt: null,
      whatsappConfirmedAt: null,
      whatsappConfirmedBy: null,
      emailNotificationStatus: 'disabled',
      emailNotificationError: null,
      createdAt: now,
      updatedAt: now,
    };

    db.orders.unshift(newOrder);
    db.events.unshift({
      id: db.nextEventId++,
      orderId: newOrder.id,
      actorName: newOrder.requesterName,
      eventType: 'created',
      description: `Pedido ${protocol} enviado pela unidade ${newOrder.unitName}.`,
      createdAt: now,
    });
    saveStaticDb(db);

    return staticJsonResponse(201, {
      ok: true,
      createdNew: true,
      protocol,
      recipientTeamName: db.recipientTeamName,
      createdAt: now,
      emailNotification: { enabled: false, status: 'disabled', hasError: false, retryToken: null },
    });
  }

  const loggedUsername = window.localStorage.getItem(LS_SESSION_KEY);
  const currentMember = db.members.find((m) => m.username === loggedUsername && m.active) || null;
  const currentUser: TeamMemberPublic | null = currentMember
    ? {
        id: currentMember.id,
        username: currentMember.username,
        displayName: currentMember.displayName,
        email: currentMember.email,
        role: currentMember.role,
        queueColumn: currentMember.queueColumn,
        active: currentMember.active,
      }
    : null;

  if (pathname === '/api/auth/me' && method === 'GET') {
    return staticJsonResponse(200, { authenticated: Boolean(currentUser), user: currentUser });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const u = String(bodyObj.username || '').trim().toLowerCase();
    const p = String(bodyObj.password || '');
    const found = db.members.find(
      (m) => (m.username === u || m.email.toLowerCase() === u) && m.passwordPlain === p && m.active
    );
    if (!found) {
      return staticJsonResponse(401, { ok: false, error: 'Usuário ou senha inválidos.' });
    }
    window.localStorage.setItem(LS_SESSION_KEY, found.username);
    const pubUser: TeamMemberPublic = {
      id: found.id,
      username: found.username,
      displayName: found.displayName,
      email: found.email,
      role: found.role,
      queueColumn: found.queueColumn,
      active: found.active,
    };
    return staticJsonResponse(200, { ok: true, user: pubUser });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    window.localStorage.removeItem(LS_SESSION_KEY);
    return staticJsonResponse(200, { ok: true });
  }

  if (!currentUser) {
    return staticJsonResponse(401, { ok: false, error: 'Acesso restrito à equipe IMTV.' });
  }

  if (pathname === '/api/board/orders' && method === 'GET') {
    const unit = (urlObj.searchParams.get('unit') || '').trim().toLowerCase();
    const assignee = urlObj.searchParams.get('assignee') || 'all';
    const deadline = urlObj.searchParams.get('deadline') || 'all';
    const today = new Date().toISOString().slice(0, 10);
    const d7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    const filtered = db.orders.filter((o) => {
      if (
        unit &&
        !o.unitName.toLowerCase().includes(unit) &&
        !o.city.toLowerCase().includes(unit) &&
        !o.title.toLowerCase().includes(unit) &&
        !o.protocol.toLowerCase().includes(unit)
      ) {
        return false;
      }
      if (assignee === 'unassigned' && o.assignee !== null) return false;
      if (assignee !== 'all' && assignee !== 'unassigned' && isQueueOwner(assignee) && o.assignee !== assignee) {
        return false;
      }
      if (deadline === 'overdue' && !(o.desiredDate < today && o.boardColumn !== 'Finalizados')) {
        return false;
      }
      if (deadline === 'next7' && !(o.desiredDate >= today && o.desiredDate <= d7)) {
        return false;
      }
      return true;
    });

    const units = Array.from(new Set(db.orders.map((o) => o.unitName))).sort();
    return staticJsonResponse(200, {
      columns: BOARD_COLUMNS,
      orders: filtered,
      units,
      recipientTeamName: db.recipientTeamName,
    });
  }

  const detailMatch = pathname.match(/^\/api\/board\/orders\/(\d+)$/);
  if (detailMatch && method === 'GET') {
    const id = Number(detailMatch[1]);
    const order = db.orders.find((o) => o.id === id);
    if (!order) return staticJsonResponse(404, { ok: false, error: 'Não encontrado.' });
    const events = db.events.filter((ev) => ev.orderId === id);
    return staticJsonResponse(200, { order, events });
  }

  const moveMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/move$/);
  if (moveMatch && method === 'POST') {
    const id = Number(moveMatch[1]);
    const order = db.orders.find((o) => o.id === id);
    const target = String(bodyObj.targetColumn || '') as BoardColumn;
    if (!order || !isBoardColumn(target)) {
      return staticJsonResponse(400, { ok: false, error: 'Movimento inválido.' });
    }
    order.assignee = computeNextAssignee(order.assignee, target);
    order.boardColumn = target;
    if (target === 'Aguardando' && typeof bodyObj.waitingReason === 'string') {
      order.waitingReason = bodyObj.waitingReason.trim();
    }
    order.updatedAt = new Date().toISOString();
    saveStaticDb(db);
    return staticJsonResponse(200, {
      ok: true,
      order,
      events: db.events.filter((ev) => ev.orderId === id),
    });
  }

  const waitMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/waiting$/);
  if (waitMatch && method === 'PATCH') {
    const id = Number(waitMatch[1]);
    const order = db.orders.find((o) => o.id === id);
    if (!order) return staticJsonResponse(404, { ok: false, error: 'Não encontrado.' });
    order.waitingReason = String(bodyObj.waitingReason || '').trim();
    order.updatedAt = new Date().toISOString();
    saveStaticDb(db);
    return staticJsonResponse(200, {
      ok: true,
      order,
      events: db.events.filter((ev) => ev.orderId === id),
    });
  }

  const finalMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/final-video$/);
  if (finalMatch && method === 'PATCH') {
    const id = Number(finalMatch[1]);
    const order = db.orders.find((o) => o.id === id);
    if (!order) return staticJsonResponse(404, { ok: false, error: 'Não encontrado.' });
    const check = validateHttpsUrl(String(bodyObj.finalVideoUrl || ''));
    if (!check.valid) {
      return staticJsonResponse(400, { ok: false, error: check.error });
    }
    if (order.finalVideoUrl !== check.url) {
      order.whatsappDeliveryStatus = 'pending';
      order.whatsappConfirmedAt = null;
      order.whatsappConfirmedBy = null;
    }
    order.finalVideoUrl = check.url;
    order.updatedAt = new Date().toISOString();
    saveStaticDb(db);
    return staticJsonResponse(200, {
      ok: true,
      order,
      events: db.events.filter((ev) => ev.orderId === id),
    });
  }

  const waOpenMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/whatsapp-opened$/);
  if (waOpenMatch && method === 'POST') {
    const id = Number(waOpenMatch[1]);
    const order = db.orders.find((o) => o.id === id);
    if (!order) return staticJsonResponse(404, { ok: false, error: 'Não encontrado.' });
    order.whatsappOpenedAt = new Date().toISOString();
    saveStaticDb(db);
    return staticJsonResponse(200, {
      ok: true,
      order,
      events: db.events.filter((ev) => ev.orderId === id),
    });
  }

  const waConfirmMatch = pathname.match(/^\/api\/board\/orders\/(\d+)\/confirm-whatsapp$/);
  if (waConfirmMatch && method === 'POST') {
    const id = Number(waConfirmMatch[1]);
    const order = db.orders.find((o) => o.id === id);
    if (!order || !order.finalVideoUrl) {
      return staticJsonResponse(400, { ok: false, error: 'Salve o link final antes de confirmar.' });
    }
    order.whatsappDeliveryStatus = 'confirmed';
    order.whatsappConfirmedAt = new Date().toISOString();
    order.whatsappConfirmedBy = currentUser.displayName;
    saveStaticDb(db);
    return staticJsonResponse(200, {
      ok: true,
      order,
      events: db.events.filter((ev) => ev.orderId === id),
    });
  }

  if (pathname === '/api/admin/settings' && method === 'GET') {
    const payload: AdminSettingsPayload = {
      recipientTeamName: db.recipientTeamName,
      logoUrl: computeStaticLogoUrl(db),
      logoFilename: db.logoFilename,
      notificationEmailEnabled: db.notificationEmailEnabled,
      notificationEmailTo: db.notificationEmailTo,
      smtpHost: db.smtpHost,
      smtpPort: db.smtpPort,
      smtpUser: db.smtpUser,
      smtpFrom: db.smtpFrom,
      smtpSecure: db.smtpSecure,
      hasSmtpPassword: false,
      members: db.members.map(({ passwordPlain: _pw, ...pub }) => pub),
    };
    return staticJsonResponse(200, payload);
  }

  if (pathname === '/api/admin/settings' && method === 'PUT') {
    db.recipientTeamName = String(bodyObj.recipientTeamName || db.recipientTeamName).trim();
    db.notificationEmailEnabled = Boolean(bodyObj.notificationEmailEnabled);
    db.notificationEmailTo = String(bodyObj.notificationEmailTo || '').trim();
    saveStaticDb(db);
    return handleStaticApi('/api/admin/settings', urlObj, { method: 'GET' });
  }

  if (pathname === '/api/admin/logo' && method === 'POST') {
    const mode = String(bodyObj.mode || 'bundled') as 'uploaded' | 'bundled' | 'pending';
    if (mode === 'uploaded' && typeof bodyObj.base64 === 'string') {
      db.logoMode = 'uploaded';
      db.logoDataUrl = bodyObj.base64;
      db.logoFilename = String(bodyObj.filename || 'logo-imtv');
    } else if (mode === 'pending') {
      db.logoMode = 'pending';
      db.logoDataUrl = null;
      db.logoFilename = null;
    } else {
      db.logoMode = 'bundled';
      db.logoDataUrl = null;
      db.logoFilename = 'imtv-logo-oficial.png';
    }
    saveStaticDb(db);
    const publicConfig: PublicPortalConfig = {
      recipientTeamName: db.recipientTeamName,
      logoUrl: computeStaticLogoUrl(db),
    };
    return staticJsonResponse(200, {
      ok: true,
      publicConfig,
      settings: {
        recipientTeamName: db.recipientTeamName,
        logoUrl: publicConfig.logoUrl,
        logoFilename: db.logoFilename,
        notificationEmailEnabled: db.notificationEmailEnabled,
        notificationEmailTo: db.notificationEmailTo,
        smtpHost: db.smtpHost,
        smtpPort: db.smtpPort,
        smtpUser: db.smtpUser,
        smtpFrom: db.smtpFrom,
        smtpSecure: db.smtpSecure,
        hasSmtpPassword: false,
        members: db.members.map(({ passwordPlain: _pw, ...pub }) => pub),
      },
    });
  }

  if (pathname === '/api/admin/members' && method === 'POST') {
    const username = String(bodyObj.username || '').trim().toLowerCase();
    const existing = db.members.find((m) => m.username === username);
    if (existing) {
      existing.displayName = String(bodyObj.displayName || existing.displayName);
      existing.email = String(bodyObj.email || existing.email);
      existing.role = (bodyObj.role as 'admin' | 'member') || existing.role;
      existing.queueColumn = (bodyObj.queueColumn as QueueOwner | null) ?? null;
      if (bodyObj.password) existing.passwordPlain = String(bodyObj.password);
    } else {
      db.members.push({
        id: `usr_${Date.now()}`,
        username,
        displayName: String(bodyObj.displayName || username),
        email: String(bodyObj.email || ''),
        role: (bodyObj.role as 'admin' | 'member') || 'member',
        queueColumn: (bodyObj.queueColumn as QueueOwner | null) ?? null,
        active: true,
        passwordPlain: String(bodyObj.password || 'imtv2027'),
      });
    }
    saveStaticDb(db);
    return staticJsonResponse(200, {
      ok: true,
      members: db.members.map(({ passwordPlain: _pw, ...pub }) => pub),
    });
  }

  return staticJsonResponse(404, { ok: false, error: 'Rota não encontrada.' });
}

let staticModeDetected: boolean | null = null;

export async function portalFetch(apiPath: string, init?: RequestInit): Promise<Response> {
  const configuredApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const fullUrl = configuredApiBase ? `${configuredApiBase}${apiPath}` : apiPath;

  const isGitHubPagesHost =
    typeof window !== 'undefined' &&
    !configuredApiBase &&
    window.location.hostname.endsWith('.github.io');

  if (isGitHubPagesHost || staticModeDetected === true) {
    staticModeDetected = true;
    const parsed = new URL(apiPath, window.location.origin);
    return handleStaticApi(parsed.pathname, parsed, init);
  }

  try {
    const resp = await fetch(fullUrl, init);
    const contentType = resp.headers.get('content-type') || '';
    // Se um host estático devolveu HTML 404 para /api/*, cai de forma transparente para o motor local
    if (
      !configuredApiBase &&
      window.location.hostname !== '127.0.0.1' &&
      window.location.hostname !== 'localhost' &&
      (resp.status === 404 || resp.status === 405) &&
      !contentType.includes('application/json')
    ) {
      staticModeDetected = true;
      const parsed = new URL(apiPath, window.location.origin);
      return handleStaticApi(parsed.pathname, parsed, init);
    }
    return resp;
  } catch (err) {
    throw err;
  }
}
