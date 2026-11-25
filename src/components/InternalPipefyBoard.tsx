import React, { useEffect, useState, useCallback } from 'react';
import {
  BOARD_COLUMNS,
  QUEUE_OWNERS,
  type BoardColumn,
  type OrderEventItem,
  type PublicPortalConfig,
  type TeamMemberPublic,
  type VideoOrderCard,
  buildWhatsAppUrl,
  isValidValidPhoneE164,
  validateHttpsUrl,
} from '../../shared/domain.ts';
import { assetUrl, ORDERS_SYNC_CHANNEL, portalFetch } from '../api/clientApi.ts';
import { ImtvLogo } from './ImtvLogo.tsx';
import { AdminSettingsModal } from './AdminSettingsModal.tsx';

const MONTHS_SHORT_PT = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

function formatShortDayMonth(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [, m, d] = isoDate.split('-');
  const mIdx = Math.max(0, Math.min(11, Number(m) - 1));
  return `${d} ${MONTHS_SHORT_PT[mIdx]}`;
}

function formatDateTimePtBr(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

interface InternalPipefyBoardProps {
  logoUrl: string | null;
  recipientTeamName: string;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onPublicConfigChanged: (cfg: PublicPortalConfig) => void;
  onNavigatePublic: () => void;
}

export function InternalPipefyBoard({
  logoUrl,
  recipientTeamName,
  soundEnabled,
  onToggleSound,
  onPublicConfigChanged,
  onNavigatePublic,
}: InternalPipefyBoardProps) {
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState<TeamMemberPublic | null>(null);

  // Login
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // Quadro e filtros
  const [orders, setOrders] = useState<VideoOrderCard[]>([]);
  const [knownUnits, setKnownUnits] = useState<string[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  const [showFilters, setShowFilters] = useState(false);
  const [filterUnit, setFilterUnit] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [filterDeadline, setFilterDeadline] = useState('all');

  // Drag & Drop
  const [draggedOrderId, setDraggedOrderId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<BoardColumn | null>(null);

  // Cartão selecionado no painel duplo inferior
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [, setSelectedEvents] = useState<OrderEventItem[]>([]);
  const [waitingDraft, setWaitingDraft] = useState('');
  const [savingWaiting, setSavingWaiting] = useState(false);

  // Entrega ao solicitante (Link final + WhatsApp)
  const [finalLinkDraft, setFinalLinkDraft] = useState('');
  const [savingFinalLink, setSavingFinalLink] = useState(false);
  const [confirmingWa, setConfirmingWa] = useState(false);
  const [deliveryErr, setDeliveryErr] = useState<string | null>(null);

  // Admin modal & exclusão segura
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingOrder, setDeletingOrder] = useState(false);

  useEffect(() => {
    let active = true;
    void portalFetch('/api/auth/me')
      .then((r) => r.json())
      .then((data: { authenticated: boolean; user: TeamMemberPublic | null }) => {
        if (!active) return;
        setUser(data.authenticated ? data.user : null);
        setAuthChecking(false);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setAuthChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const fetchBoardOrders = useCallback(
    async (silent = false) => {
      if (!user) return;
      if (!silent) {
        setBoardLoading(true);
        setBoardError(null);
      }
      try {
        const qs = new URLSearchParams();
        if (filterUnit.trim()) qs.set('unit', filterUnit.trim());
        if (filterAssignee !== 'all') qs.set('assignee', filterAssignee);
        if (filterDeadline !== 'all') qs.set('deadline', filterDeadline);

        const resp = await portalFetch(`/api/board/orders?${qs.toString()}`);
        if (resp.status === 401) {
          setUser(null);
          return;
        }
        const data = await resp.json();
        if (!resp.ok) {
          if (!silent) setBoardError(data.error || 'Erro ao carregar o quadro.');
          return;
        }
        const list = (data.orders || []) as VideoOrderCard[];
        setOrders(list);
        setKnownUnits((data.units || []) as string[]);
        setSelectedOrderId((prev) => {
          if (prev && list.some((o) => o.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      } catch {
        if (!silent) setBoardError('Não foi possível atualizar os cartões.');
      } finally {
        if (!silent) setBoardLoading(false);
      }
    },
    [user, filterUnit, filterAssignee, filterDeadline]
  );

  useEffect(() => {
    if (!user) return;
    void fetchBoardOrders(false);

    const pollTimer = window.setInterval(() => {
      if (!document.hidden) {
        void fetchBoardOrders(true);
      }
    }, 12000);

    const onSync = () => void fetchBoardOrders(true);
    window.addEventListener('imtv:orders-changed', onSync);
    window.addEventListener('storage', onSync);

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel(ORDERS_SYNC_CHANNEL);
      bc.onmessage = onSync;
    }

    return () => {
      window.clearInterval(pollTimer);
      window.removeEventListener('imtv:orders-changed', onSync);
      window.removeEventListener('storage', onSync);
      bc?.close();
    };
  }, [user, fetchBoardOrders]);

  const selectedCard = orders.find((o) => o.id === selectedOrderId) || orders[0] || null;

  useEffect(() => {
    if (!selectedCard) {
      setWaitingDraft('');
      setFinalLinkDraft('');
      setDeliveryErr(null);
      return;
    }
    setWaitingDraft(selectedCard.waitingReason || '');
    setFinalLinkDraft(selectedCard.finalVideoUrl || '');
    setDeliveryErr(null);
  }, [selectedCard?.id, selectedCard?.waitingReason, selectedCard?.finalVideoUrl]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginErr(null);
    try {
      const resp = await portalFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setLoginErr(data.error || 'Credenciais inválidas.');
      } else {
        setUser(data.user as TeamMemberPublic);
        setLoginPass('');
      }
    } catch {
      setLoginErr('Erro de conexão ao autenticar.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await portalFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setOrders([]);
    setSelectedOrderId(null);
  };

  const syncUpdatedCard = useCallback(
    (updated: VideoOrderCard, events?: OrderEventItem[]) => {
      setOrders((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setSelectedOrderId(updated.id);
      if (events) setSelectedEvents(events);
    },
    []
  );

  const handleSelectCard = async (card: VideoOrderCard) => {
    setSelectedOrderId(card.id);
    try {
      const resp = await portalFetch(`/api/board/orders/${card.id}`);
      const data = await resp.json();
      if (resp.ok && data.order) {
        syncUpdatedCard(data.order as VideoOrderCard, data.events as OrderEventItem[]);
      }
    } catch {
      // ignore
    }
  };

  const handleMoveCard = async (
    orderId: number,
    targetColumn: BoardColumn,
    waitingReason?: string
  ) => {
    setBoardError(null);
    try {
      const resp = await portalFetch(`/api/board/orders/${orderId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetColumn, waitingReason }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setBoardError(data.error || 'Não foi possível mover o cartão.');
        return;
      }
      syncUpdatedCard(data.order as VideoOrderCard, data.events as OrderEventItem[]);
    } catch {
      setBoardError('Erro ao mover o cartão.');
    }
  };

  const handleSaveWaitingReason = async (orderId: number, reason: string) => {
    setSavingWaiting(true);
    try {
      const resp = await portalFetch(`/api/board/orders/${orderId}/waiting`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waitingReason: reason }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        syncUpdatedCard(data.order as VideoOrderCard, data.events as OrderEventItem[]);
      }
    } finally {
      setSavingWaiting(false);
    }
  };

  const handleSaveFinalLink = async (card: VideoOrderCard) => {
    setSavingFinalLink(true);
    setDeliveryErr(null);
    try {
      const resp = await portalFetch(`/api/board/orders/${card.id}/final-video`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalVideoUrl: finalLinkDraft.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setDeliveryErr(data.error || 'Informe uma URL HTTPS completa válida.');
      } else {
        syncUpdatedCard(data.order as VideoOrderCard, data.events as OrderEventItem[]);
      }
    } catch {
      setDeliveryErr('Falha ao salvar o link do vídeo final.');
    } finally {
      setSavingFinalLink(false);
    }
  };

  const handleOpenWhatsApp = (card: VideoOrderCard, videoUrlToPersist: string) => {
    // Registra em segundo plano (keepalive) sem bloquear nem atrasar a abertura nativa do WhatsApp App
    void (async () => {
      try {
        let latestCard = card;
        let latestEvents: OrderEventItem[] | undefined;

        if (videoUrlToPersist && videoUrlToPersist !== (card.finalVideoUrl || '').trim()) {
          const saveResp = await portalFetch(`/api/board/orders/${card.id}/final-video`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ finalVideoUrl: videoUrlToPersist }),
            keepalive: true,
          });
          const saveData = await saveResp.json().catch(() => null);
          if (saveResp.ok && saveData?.ok) {
            latestCard = saveData.order as VideoOrderCard;
            latestEvents = saveData.events as OrderEventItem[];
          }
        }

        if (latestCard.boardColumn !== 'Finalizados') {
          const moveResp = await portalFetch(`/api/board/orders/${card.id}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetColumn: 'Finalizados' }),
            keepalive: true,
          });
          const moveData = await moveResp.json().catch(() => null);
          if (moveResp.ok && moveData?.ok) {
            latestCard = moveData.order as VideoOrderCard;
            latestEvents = moveData.events as OrderEventItem[];
          }
        }

        const resp = await portalFetch(`/api/board/orders/${card.id}/whatsapp-opened`, {
          method: 'POST',
          keepalive: true,
        });
        const data = await resp.json().catch(() => null);
        if (resp.ok && data?.ok) {
          latestCard = data.order as VideoOrderCard;
          latestEvents = data.events as OrderEventItem[];
        }

        syncUpdatedCard(latestCard, latestEvents);
      } catch {
        // ignore
      }
    })();
  };

  const handleConfirmDelivery = async (card: VideoOrderCard, videoUrlToPersist: string) => {
    if ((!card.finalVideoUrl && !videoUrlToPersist) || confirmingWa) return;
    setConfirmingWa(true);
    setDeliveryErr(null);
    try {
      if (videoUrlToPersist && videoUrlToPersist !== (card.finalVideoUrl || '').trim()) {
        const saveResp = await portalFetch(`/api/board/orders/${card.id}/final-video`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ finalVideoUrl: videoUrlToPersist }),
        });
        const saveData = await saveResp.json();
        if (!saveResp.ok || !saveData.ok) {
          setDeliveryErr(saveData.error || 'Salve uma URL HTTPS válida antes de confirmar.');
          return;
        }
      }

      const resp = await portalFetch(`/api/board/orders/${card.id}/confirm-whatsapp`, {
        method: 'POST',
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setDeliveryErr(data.error || 'Erro ao confirmar envio.');
      } else {
        syncUpdatedCard(data.order as VideoOrderCard, data.events as OrderEventItem[]);
      }
    } catch {
      setDeliveryErr('Falha ao confirmar envio.');
    } finally {
      setConfirmingWa(false);
    }
  };

  const handleDeleteOrder = async (orderId: number) => {
    if (deletingOrder) return;
    setDeletingOrder(true);
    setBoardError(null);
    try {
      const resp = await portalFetch(`/api/board/orders/${orderId}`, {
        method: 'DELETE',
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setBoardError(data.error || 'Não foi possível excluir o pedido.');
      } else {
        setConfirmDeleteId(null);
        setOrders((prev) => {
          const remaining = prev.filter((o) => o.id !== orderId);
          setSelectedOrderId(remaining[0]?.id ?? null);
          return remaining;
        });
      }
    } catch {
      setBoardError('Falha ao excluir o pedido.');
    } finally {
      setDeletingOrder(false);
    }
  };

  if (authChecking) {
    return (
      <div className="board-layout" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Carregando área da equipe...</p>
      </div>
    );
  }

  // --- TELA DE ACESSO DA EQUIPE ---
  if (!user) {
    return (
      <div className="board-layout">
        <header
          className="studio-top-banner"
          style={{
            backgroundImage: `url("${assetUrl('/studio/studio-header-banner.jpg')}")`,
          }}
        >
          <div className="studio-top-banner-inner">
            <div className="studio-top-brand-group">
              <ImtvLogo
                logoUrl={logoUrl}
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigatePublic();
                }}
              />
              <span className="studio-top-divider" aria-hidden="true" />
              <span className="studio-top-subtitle">Área da equipe</span>
            </div>

            <button type="button" className="btn btn-ghost btn-sm" onClick={onNavigatePublic}>
              Portal de pedidos
            </button>
          </div>
        </header>

        <main
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 16px',
          }}
        >
          <form
            onSubmit={handleLogin}
            className="pipefy-sheet"
            style={{ width: '100%', maxWidth: '410px' }}
            data-testid="team-login-form"
          >
            <h1 className="pipefy-sheet-title" style={{ fontSize: '1.35rem', marginBottom: '6px' }}>
              Quadro de produção
            </h1>
            <p className="field-hint" style={{ marginBottom: '18px' }}>
              Acesso restrito a <strong>{recipientTeamName}</strong>.
            </p>

            {loginErr && (
              <div className="alert-box alert-error" role="alert" style={{ marginBottom: '14px' }}>
                {loginErr}
              </div>
            )}

            <div style={{ display: 'grid', gap: '14px' }}>
              <div className="field-group">
                <label htmlFor="login-username" className="field-label">
                  Usuário ou e-mail
                </label>
                <input
                  id="login-username"
                  type="text"
                  className="input-dark"
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>

              <div className="field-group">
                <label htmlFor="login-password" className="field-label">
                  Senha
                </label>
                <input
                  id="login-password"
                  type="password"
                  className="input-dark"
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ minHeight: '46px' }}
                disabled={loggingIn}
                data-testid="login-submit-btn"
              >
                {loggingIn ? 'Entrando...' : 'Entrar no quadro'}
              </button>
            </div>
          </form>
        </main>
      </div>
    );
  }

  // Cálculos de entrega para o cartão selecionado (habilita WhatsApp em qualquer coluna assim que houver link HTTPS válido)
  const hasValidPhone = selectedCard ? isValidValidPhoneE164(selectedCard.whatsappE164) : false;
  const draftUrlCheck = validateHttpsUrl(finalLinkDraft);
  const savedUrlCheck = selectedCard?.finalVideoUrl
    ? validateHttpsUrl(selectedCard.finalVideoUrl)
    : { valid: false, url: '' };
  const effectiveFinalVideoUrl = draftUrlCheck.valid
    ? draftUrlCheck.url
    : savedUrlCheck.valid
      ? savedUrlCheck.url
      : '';
  const isFinalLinkSaved = Boolean(
    selectedCard &&
      selectedCard.finalVideoUrl &&
      selectedCard.finalVideoUrl.trim() === finalLinkDraft.trim()
  );
  const canSendWhatsApp = Boolean(
    selectedCard && hasValidPhone && effectiveFinalVideoUrl
  );
  const whatsappHref =
    selectedCard && canSendWhatsApp
      ? buildWhatsAppUrl({
          whatsappE164: selectedCard.whatsappE164,
          requesterName: selectedCard.requesterName,
          title: selectedCard.title,
          unitName: selectedCard.unitName,
          finalVideoUrl: effectiveFinalVideoUrl,
          protocol: selectedCard.protocol,
        })
      : '';

  const hasActiveFilters =
    Boolean(filterUnit.trim()) || filterAssignee !== 'all' || filterDeadline !== 'all';

  return (
    <div className="board-layout" data-testid="pipefy-board-view">
      {/* Faixa Superior Iluminada do Estúdio: Logo IMTV | Área da equipe */}
      <header
        className="studio-top-banner"
        style={{
          backgroundImage: `url("${assetUrl('/studio/studio-header-banner.jpg')}")`,
        }}
      >
        <div className="studio-top-banner-inner">
          <div className="studio-top-brand-group">
            <ImtvLogo
              logoUrl={logoUrl}
              href="/quadro"
              onClick={(e) => e.preventDefault()}
            />
            <span className="studio-top-divider" aria-hidden="true" />
            <span className="studio-top-subtitle">Área da equipe</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span className="pipe-tag">{user.displayName}</span>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onToggleSound}
              aria-pressed={soundEnabled}
              data-imtv-cursor-nativo=""
              data-sound-toggle="true"
            >
              {soundEnabled ? 'Silenciar som' : 'Ativar som'}
            </button>

            {user.role === 'admin' && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAdminModal(true)}
                data-testid="open-admin-settings-btn"
              >
                Configurações
              </button>
            )}

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onNavigatePublic}
            >
              Portal de pedidos
            </button>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void handleLogout()}
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="board-main-container">
        {/* Linha de Título "Quadro de produção" + Botão "Filtrar" à direita */}
        <div className="board-title-row">
          <h1 className="board-page-heading">Quadro de produção</h1>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {boardLoading && (
              <span className="field-hint">Atualizando...</span>
            )}
            <button
              type="button"
              className="board-filter-trigger"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              data-testid="toggle-filters-btn"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              <span>Filtrar{hasActiveFilters ? ' •' : ''}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        </div>

        {/* Gaveta de Filtros (Unidade, Responsável, Prazo) */}
        {showFilters && (
          <section className="board-filter-drawer" aria-label="Filtros do quadro">
            <input
              id="flt-unit"
              type="search"
              aria-label="Filtrar por unidade"
              list="known-units-list"
              className="input-dark"
              placeholder="Unidade, cidade ou protocolo..."
              value={filterUnit}
              onChange={(e) => setFilterUnit(e.target.value)}
            />
            <datalist id="known-units-list">
              {knownUnits.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>

            <select
              id="flt-assignee"
              aria-label="Responsável interno"
              className="select-dark"
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
            >
              <option value="all">Responsável: Todos</option>
              <option value="unassigned">Sem responsável</option>
              {QUEUE_OWNERS.map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>

            <select
              id="flt-deadline"
              aria-label="Prazo desejado"
              className="select-dark"
              value={filterDeadline}
              onChange={(e) => setFilterDeadline(e.target.value)}
            >
              <option value="all">Prazo: Todos</option>
              <option value="overdue">Prazo vencido</option>
              <option value="next7">Próximos 7 dias</option>
            </select>

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setFilterUnit('');
                setFilterAssignee('all');
                setFilterDeadline('all');
              }}
            >
              Limpar
            </button>
          </section>
        )}

        {boardError && (
          <div className="alert-box alert-error" role="alert" style={{ marginBottom: '14px' }}>
            {boardError}
          </div>
        )}

        {/* ==================== AS 6 COLUNAS EXATAS ==================== */}
        <div className="board-columns-scroll">
          <div className="board-columns-grid">
            {BOARD_COLUMNS.map((columnName) => {
              const columnCards = orders.filter((o) => o.boardColumn === columnName);
              const isDragTarget = dragOverCol === columnName;

              return (
                <section
                  key={columnName}
                  aria-label={`Coluna ${columnName}`}
                  data-column={columnName}
                  data-testid={`board-col-${columnName}`}
                  className={`pipe-column ${isDragTarget ? 'is-drag-over' : ''}`.trim()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverCol !== columnName) setDragOverCol(columnName);
                  }}
                  onDragLeave={() => {
                    if (dragOverCol === columnName) setDragOverCol(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverCol(null);
                    const rawId =
                      e.dataTransfer.getData('text/plain') || String(draggedOrderId || '');
                    const orderId = Number(rawId);
                    setDraggedOrderId(null);
                    if (orderId > 0) {
                      void handleMoveCard(orderId, columnName);
                    }
                  }}
                >
                  <header className="pipe-column-head">
                    <div className="pipe-column-title-wrap">
                      <span className="pipe-green-dot" aria-hidden="true" />
                      <h2 className="pipe-column-title">{columnName}</h2>
                    </div>
                    <span
                      className="pipe-count-badge"
                      data-testid={`col-count-${columnName}`}
                    >
                      {columnCards.length}
                    </span>
                  </header>

                  <div className="pipe-column-body">
                    {columnCards.map((card) => {
                      const isSelected = selectedCard?.id === card.id;

                      let footText = `Prazo ${formatShortDayMonth(card.desiredDate)}`;
                      if (card.boardColumn === 'Aguardando') {
                        const who = card.assignee ? `Com ${card.assignee}` : 'Aguardando';
                        const what = card.waitingReason || 'falta material';
                        footText = `${who} · ${what}`;
                      } else if (card.boardColumn === 'Finalizados') {
                        footText = card.protocol;
                      }

                      return (
                        <article
                          key={card.id}
                          draggable
                          onClick={() => void handleSelectCard(card)}
                          onDragStart={(e) => {
                            setDraggedOrderId(card.id);
                            e.dataTransfer.setData('text/plain', String(card.id));
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => {
                            setDraggedOrderId(null);
                            setDragOverCol(null);
                          }}
                          className={`pipe-card ${isSelected ? 'is-selected' : ''}`.trim()}
                          data-testid={`order-card-${card.protocol}`}
                        >
                          <button
                            type="button"
                            className="pipe-card-title-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleSelectCard(card);
                            }}
                            data-testid={`open-card-btn-${card.protocol}`}
                          >
                            {card.title}
                          </button>

                          <div className="pipe-card-sub">{card.unitName}</div>
                          <div
                            className="pipe-card-foot"
                            data-testid={`card-assignee-${card.protocol}`}
                          >
                            {footText}
                            {card.assignee && card.boardColumn !== 'Aguardando' ? (
                              <span style={{ display: 'none' }}> · Responsável: {card.assignee}</span>
                            ) : null}
                          </div>

                          {/* Seletor compacto "Mover para" acessível em teclado e celular */}
                          <div
                            style={{ marginTop: '4px' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <select
                              aria-label={`Mover cartão ${card.title} para`}
                              className="select-dark"
                              style={{
                                minHeight: '30px',
                                padding: '3px 8px',
                                fontSize: '0.75rem',
                              }}
                              value={card.boardColumn}
                              data-testid={`move-select-${card.protocol}`}
                              onChange={(e) => {
                                const nextCol = e.target.value as BoardColumn;
                                if (nextCol !== card.boardColumn) {
                                  void handleMoveCard(card.id, nextCol);
                                }
                              }}
                            >
                              {BOARD_COLUMNS.map((col) => (
                                <option key={col} value={col}>
                                  Mover para: {col}
                                </option>
                              ))}
                            </select>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>

        {/* ==================== PAINEL DUPLO INFERIOR (MOCKUP 2) ==================== */}
        <hr className="board-workspace-divider" />

        {selectedCard ? (
          <div className="board-detail-split" data-testid="card-detail-modal">
            {/* Painel Esquerdo: Ficha Técnica do Pedido Selecionado */}
            <section className="board-detail-panel" aria-label="Detalhes do pedido selecionado">
              <div>
                <div className="detail-panel-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <h2 className="detail-panel-title">{selectedCard.title}</h2>

                    {selectedCard.whatsappDeliveryStatus === 'confirmed' ? (
                      <span
                        className="status-pill-confirmed"
                        data-testid={`delivery-status-${selectedCard.id}`}
                      >
                        Envio confirmado por {selectedCard.whatsappConfirmedBy} em{' '}
                        {formatDateTimePtBr(selectedCard.whatsappConfirmedAt || '')}
                      </span>
                    ) : (
                      <span
                        className="status-pill-pending"
                        data-testid={`delivery-status-${selectedCard.id}`}
                      >
                        Envio pendente
                      </span>
                    )}
                  </div>

                  <select
                    aria-label="Mover pedido selecionado para coluna"
                    className="select-dark"
                    style={{ width: 'auto', minHeight: '35px', fontSize: '0.82rem' }}
                    value={selectedCard.boardColumn}
                    onChange={(e) =>
                      void handleMoveCard(
                        selectedCard.id,
                        e.target.value as BoardColumn,
                        waitingDraft
                      )
                    }
                  >
                    {BOARD_COLUMNS.map((col) => (
                      <option key={col} value={col}>
                        Etapa: {col}
                      </option>
                    ))}
                  </select>
                </div>

                <dl className="detail-rows-table">
                  <div className="detail-row">
                    <dt>Protocolo</dt>
                    <dd>{selectedCard.protocol}</dd>
                  </div>
                  <div className="detail-row">
                    <dt>Unidade</dt>
                    <dd>
                      {selectedCard.unitName} ({selectedCard.city}/{selectedCard.uf})
                    </dd>
                  </div>
                  <div className="detail-row">
                    <dt>Responsável</dt>
                    <dd>{selectedCard.assignee || 'A definir na fila'}</dd>
                  </div>
                  <div className="detail-row">
                    <dt>Prazo</dt>
                    <dd>{formatShortDayMonth(selectedCard.desiredDate)}</dd>
                  </div>
                  <div className="detail-row">
                    <dt>Briefing</dt>
                    <dd>
                      {selectedCard.mainMessage}
                      {selectedCard.objective ? ` (${selectedCard.objective})` : ''}
                    </dd>
                  </div>
                </dl>

                {/* Campo rápido para registrar o que falta quando em Aguardando */}
                {selectedCard.boardColumn === 'Aguardando' && (
                  <div style={{ marginTop: '14px', display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="input-dark"
                      style={{ minHeight: '36px', fontSize: '0.84rem' }}
                      placeholder="Registrar o que falta (material, resposta ou aprovação)..."
                      value={waitingDraft}
                      onChange={(e) => setWaitingDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={savingWaiting}
                      onClick={() =>
                        void handleSaveWaitingReason(selectedCard.id, waitingDraft)
                      }
                    >
                      {savingWaiting ? 'Salvando...' : 'Salvar pendência'}
                    </button>
                  </div>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap',
                  marginTop: '14px',
                }}
              >
                <div>
                  {selectedCard.materialsDriveUrl ? (
                    <a
                      href={selectedCard.materialsDriveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="drive-link-row"
                      style={{ marginTop: 0 }}
                      data-testid="open-drive-materials-btn"
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                      <span>Abrir materiais no Drive</span>
                    </a>
                  ) : (
                    <p className="field-hint" style={{ margin: 0 }}>
                      Materiais ainda não enviados pela unidade.
                    </p>
                  )}
                </div>

                {user.role === 'admin' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {confirmDeleteId === selectedCard.id ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{
                            borderColor: '#ef4444',
                            color: '#fca5a5',
                            minHeight: '32px',
                          }}
                          disabled={deletingOrder}
                          onClick={() => void handleDeleteOrder(selectedCard.id)}
                          data-testid={`confirm-delete-order-${selectedCard.id}`}
                        >
                          {deletingOrder ? 'Excluindo...' : 'Confirmar exclusão'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ minHeight: '32px' }}
                          disabled={deletingOrder}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{
                          minHeight: '32px',
                          fontSize: '0.78rem',
                          color: 'var(--text-muted)',
                        }}
                        onClick={() => setConfirmDeleteId(selectedCard.id)}
                        data-testid={`delete-order-btn-${selectedCard.id}`}
                      >
                        Excluir pedido
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Painel Direito: Entrega ao solicitante (WhatsApp + Link do vídeo final separado do Drive) */}
            <section className="board-detail-panel" aria-label="Entrega ao solicitante">
              <div>
                <div className="detail-panel-head">
                  <h2 className="detail-panel-title" style={{ fontSize: '1.32rem' }}>
                    Entrega ao solicitante
                  </h2>
                  {selectedCard.finalVideoUrl && (
                    <a
                      href={selectedCard.finalVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}
                      data-testid={`preview-final-video-${selectedCard.id}`}
                    >
                      Conferir vídeo
                    </a>
                  )}
                </div>

                <dl className="detail-rows-table" style={{ marginBottom: '16px' }}>
                  <div className="detail-row">
                    <dt>Solicitante</dt>
                    <dd>{selectedCard.requesterName}</dd>
                  </div>
                  <div className="detail-row">
                    <dt>WhatsApp</dt>
                    <dd data-testid={`card-requester-wa-${selectedCard.id}`}>
                      {selectedCard.whatsappDisplay}
                    </dd>
                  </div>
                </dl>

                <div className="field-group">
                  <label
                    htmlFor={`final-link-card-${selectedCard.id}`}
                    className="field-label"
                  >
                    Link do vídeo final
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      id={`final-link-card-${selectedCard.id}`}
                      type="url"
                      className="input-dark"
                      placeholder="https://..."
                      value={finalLinkDraft}
                      onChange={(e) => setFinalLinkDraft(e.target.value)}
                    />
                    <button
                      type="button"
                      className={`btn ${isFinalLinkSaved ? 'btn-saved-pill' : ''}`.trim()}
                      disabled={savingFinalLink}
                      onClick={() => void handleSaveFinalLink(selectedCard)}
                      data-testid={`save-final-link-card-${selectedCard.id}`}
                    >
                      {savingFinalLink ? (
                        'Salvando...'
                      ) : isFinalLinkSaved ? (
                        <>
                          <span style={{ color: 'var(--studio-green)' }} aria-hidden="true">
                            ✓
                          </span>
                          <span>Salvo</span>
                        </>
                      ) : (
                        'Salvar link'
                      )}
                    </button>
                  </div>
                </div>

                {deliveryErr && (
                  <p className="field-error-msg" role="alert">
                    {deliveryErr}
                  </p>
                )}

                {!effectiveFinalVideoUrl && (
                  <p className="field-hint" style={{ marginTop: '10px' }}>
                    {finalLinkDraft.trim() && draftUrlCheck.error
                      ? draftUrlCheck.error
                      : 'Cole acima o link HTTPS do vídeo pronto para liberar o envio pelo WhatsApp.'}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '18px' }}>
                {canSendWhatsApp ? (
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary"
                    style={{ width: '100%', minHeight: '50px', fontSize: '1.05rem' }}
                    onClick={() => handleOpenWhatsApp(selectedCard, effectiveFinalVideoUrl)}
                    data-whatsapp-url={whatsappHref}
                    data-testid={`send-whatsapp-btn-card-${selectedCard.id}`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                    <span>Enviar pelo WhatsApp</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%', minHeight: '50px', fontSize: '1.05rem' }}
                    disabled
                    data-whatsapp-url=""
                    data-testid={`send-whatsapp-btn-card-${selectedCard.id}`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                    <span>Enviar pelo WhatsApp</span>
                  </button>
                )}

                <button
                  type="button"
                  className="confirm-send-link"
                  disabled={
                    confirmingWa ||
                    !effectiveFinalVideoUrl ||
                    selectedCard.whatsappDeliveryStatus === 'confirmed'
                  }
                  onClick={() => void handleConfirmDelivery(selectedCard, effectiveFinalVideoUrl)}
                  data-testid={`confirm-whatsapp-btn-card-${selectedCard.id}`}
                >
                  {selectedCard.whatsappDeliveryStatus === 'confirmed'
                    ? 'Envio confirmado'
                    : confirmingWa
                      ? 'Confirmando...'
                      : 'Confirmar envio'}
                </button>
              </div>
            </section>
          </div>
        ) : (
          <div className="pipefy-sheet" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
            Quadro pronto para operação. Assim que uma unidade enviar um pedido, o cartão entrará automaticamente na coluna Recebido.
          </div>
        )}
      </main>

      {showAdminModal && (
        <AdminSettingsModal
          onClose={() => setShowAdminModal(false)}
          onPublicConfigChanged={onPublicConfigChanged}
        />
      )}
    </div>
  );
}
