import React, { useState, useEffect, useRef } from 'react';
import {
  BRAZIL_UFS,
  type OrderSubmissionInput,
  parseAndValidateWhatsApp,
  validateHttpsUrl,
} from '../../shared/domain.ts';
import { assetUrl, portalFetch } from '../api/clientApi.ts';
import { ImtvLogo } from './ImtvLogo.tsx';

const DRAFT_STORAGE_KEY = 'imtv_portal_2027_draft_v2';

const CHANNEL_OPTIONS = [
  'Instagram (Reels / Stories / Feed)',
  'YouTube',
  'Tráfego Pago (Meta Ads / Google Ads)',
  'TV Interna da Unidade / Recepção',
  'WhatsApp Comercial / Matrículas',
  'Evento Local / Convenção',
  'Múltiplos canais',
];

const FORMAT_OPTIONS = [
  'Vertical 9:16 (Reels / Shorts / Stories)',
  'Horizontal 16:9 (YouTube / TV / Institucional)',
  'Vertical 4:5 (Feed / Tráfego Pago)',
  'Versão dupla (16:9 + 9:16)',
  'Preciso de orientação',
];

function makeIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `idem_${crypto.randomUUID()}`;
  }
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

interface FormDraftState {
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
  materialsNotes: string;
}

function createEmptyDraft(): FormDraftState {
  const defaultDate = new Date(Date.now() + 10 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    idempotencyKey: makeIdempotencyKey(),
    unitName: '',
    city: '',
    uf: 'SC',
    requesterName: '',
    requesterEmail: '',
    whatsappCountryCode: '+55',
    whatsappDdd: '',
    whatsappNumber: '',
    title: '',
    objective: '',
    targetAudience: '',
    distributionChannel: CHANNEL_OPTIONS[0],
    videoFormat: FORMAT_OPTIONS[0],
    needsFormatGuidance: false,
    desiredDate: defaultDate,
    mainMessage: '',
    mandatoryInfo: '',
    materialsDriveUrl: '',
    materialsPending: false,
    materialsNotes: '',
  };
}

function loadSavedDraft(): FormDraftState {
  if (typeof window === 'undefined') return createEmptyDraft();
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return createEmptyDraft();
    const parsed = JSON.parse(raw) as Partial<FormDraftState>;
    return {
      ...createEmptyDraft(),
      ...parsed,
      idempotencyKey: parsed.idempotencyKey || makeIdempotencyKey(),
    };
  } catch {
    return createEmptyDraft();
  }
}

function formatDatePtBr(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

interface SubmissionSuccessData {
  protocol: string;
  recipientTeamName: string;
  createdAt: string;
  whatsappDisplay: string;
  emailStatus: 'disabled' | 'sent' | 'failed';
  emailErrorMessage: string | null;
  retryToken: string | null;
}

interface PublicBriefingFormProps {
  logoUrl: string | null;
  recipientTeamName: string;
  soundEnabled: boolean;
  onToggleSound: () => void;
  with3dHandoff: boolean;
  isRevealed: boolean;
  onNavigateBoard: () => void;
}

export function PublicBriefingForm({
  logoUrl,
  recipientTeamName,
  soundEnabled,
  onToggleSound,
  with3dHandoff,
  isRevealed,
  onNavigateBoard,
}: PublicBriefingFormProps) {
  const [activeSection, setActiveSection] = useState<1 | 2 | 3>(1);
  const [draft, setDraft] = useState<FormDraftState>(() => loadSavedDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  const [confirmed, setConfirmed] = useState<SubmissionSuccessData | null>(null);
  const [retryingEmail, setRetryingEmail] = useState(false);
  const [retryFeedback, setRetryFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (confirmed) return;
    try {
      window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // ignore
    }
  }, [draft, confirmed]);

  const updateField = <K extends keyof FormDraftState>(
    key: K,
    value: FormDraftState[K]
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key as string]) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  };

  const whatsappCheck = parseAndValidateWhatsApp({
    countryCode: draft.whatsappCountryCode,
    ddd: draft.whatsappDdd,
    number: draft.whatsappNumber,
  });

  const validateAll = (): boolean => {
    const nextErr: Record<string, string> = {};
    if (draft.unitName.trim().length < 2) {
      nextErr.unitName = 'Informe a unidade do Instituto Mix.';
    }
    if (draft.city.trim().length < 2) {
      nextErr.city = 'Informe a cidade da unidade.';
    }
    if (!(BRAZIL_UFS as readonly string[]).includes(draft.uf)) {
      nextErr.uf = 'Selecione a UF.';
    }
    if (draft.requesterName.trim().length < 2) {
      nextErr.requesterName = 'Informe seu nome.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.requesterEmail.trim())) {
      nextErr.requesterEmail = 'Informe um e-mail válido.';
    }
    if (!whatsappCheck.valid) {
      nextErr.whatsappNumber =
        whatsappCheck.error || 'Confira o código do país, o DDD e o WhatsApp.';
    }
    if (draft.title.trim().length < 3) {
      nextErr.title = 'Informe o título do pedido.';
    }
    if (draft.objective.trim().length < 3) {
      nextErr.objective = 'Informe o objetivo do vídeo.';
    }
    if (draft.targetAudience.trim().length < 2) {
      nextErr.targetAudience = 'Informe o público do vídeo.';
    }
    if (draft.distributionChannel.trim().length < 2) {
      nextErr.distributionChannel = 'Selecione o canal de divulgação.';
    }
    const wantsGuidance =
      draft.needsFormatGuidance || draft.videoFormat === 'Preciso de orientação';
    if (!wantsGuidance && draft.videoFormat.trim().length < 2) {
      nextErr.videoFormat = 'Selecione o formato ou escolha "Preciso de orientação".';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.desiredDate)) {
      nextErr.desiredDate = 'Informe a data desejada.';
    }
    if (draft.mainMessage.trim().length < 5) {
      nextErr.mainMessage = 'Descreva a mensagem principal do vídeo.';
    }

    const trimmedUrl = draft.materialsDriveUrl.trim();
    if (trimmedUrl) {
      const check = validateHttpsUrl(trimmedUrl);
      if (!check.valid) {
        nextErr.materialsDriveUrl =
          check.error || 'Informe um link HTTPS válido do Google Drive.';
      }
    } else if (!draft.materialsPending) {
      nextErr.materialsDriveUrl =
        'Cole o link do Google Drive ou marque que os materiais ainda não estão prontos.';
    }

    setErrors(nextErr);
    return Object.keys(nextErr).length === 0;
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || isSubmitting) return;
    if (!validateAll()) return;

    submitLockRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);

    const wantsGuidance =
      draft.needsFormatGuidance || draft.videoFormat === 'Preciso de orientação';

    const payload: OrderSubmissionInput = {
      idempotencyKey: draft.idempotencyKey,
      unitName: draft.unitName.trim(),
      city: draft.city.trim(),
      uf: draft.uf,
      requesterName: draft.requesterName.trim(),
      requesterEmail: draft.requesterEmail.trim(),
      whatsappCountryCode: whatsappCheck.countryCode,
      whatsappDdd: whatsappCheck.ddd,
      whatsappNumber: draft.whatsappNumber.trim(),
      title: draft.title.trim(),
      objective: draft.objective.trim(),
      targetAudience: draft.targetAudience.trim(),
      distributionChannel: draft.distributionChannel.trim(),
      videoFormat: wantsGuidance
        ? 'Preciso de orientação da IMTV'
        : draft.videoFormat.trim(),
      needsFormatGuidance: wantsGuidance,
      desiredDate: draft.desiredDate,
      mainMessage: draft.mainMessage.trim(),
      mandatoryInfo: draft.mandatoryInfo.trim(),
      materialsDriveUrl: draft.materialsDriveUrl.trim(),
      materialsPending: draft.materialsPending,
      materialsNotes: draft.materialsNotes.trim(),
    };

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      const failFlag = (window as unknown as { __IMTV_SIMULATE_WRITE_FAIL__?: boolean })
        .__IMTV_SIMULATE_WRITE_FAIL__;
      if (failFlag) {
        headers['x-test-fail-db-write'] = '1';
      }

      const resp = await portalFetch('/api/public/orders', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data || !data.ok) {
        if (data?.fields && typeof data.fields === 'object') {
          setErrors(data.fields as Record<string, string>);
        }
        setSubmitError(
          data?.error ||
            'Não foi possível gravar o pedido agora. Seus dados continuam na tela para nova tentativa.'
        );
        return;
      }

      try {
        window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // ignore
      }

      setConfirmed({
        protocol: String(data.protocol),
        recipientTeamName: String(data.recipientTeamName || recipientTeamName),
        createdAt: String(data.createdAt),
        whatsappDisplay: whatsappCheck.display,
        emailStatus: data.emailNotification?.status || 'disabled',
        emailErrorMessage: data.emailNotification?.errorMessage || null,
        retryToken: data.emailNotification?.retryToken || null,
      });
    } catch {
      setSubmitError(
        'Sem conexão com o servidor no momento. Seus dados continuam preenchidos na tela para nova tentativa.'
      );
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleRetryEmailOnly = async () => {
    if (!confirmed || !confirmed.retryToken || retryingEmail) return;
    setRetryingEmail(true);
    setRetryFeedback(null);

    try {
      const resp = await portalFetch(
        `/api/public/orders/${encodeURIComponent(confirmed.protocol)}/retry-notification`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ retryToken: confirmed.retryToken }),
        }
      );
      const data = await resp.json().catch(() => null);
      if (resp.ok && data?.ok && data.emailNotification?.status === 'sent') {
        setConfirmed((prev) =>
          prev
            ? {
                ...prev,
                emailStatus: 'sent',
                emailErrorMessage: null,
              }
            : prev
        );
        setRetryFeedback('Notificação por e-mail enviada com sucesso.');
      } else {
        setRetryFeedback(
          data?.emailNotification?.errorMessage ||
            data?.error ||
            'A notificação por e-mail ainda falhou. O cartão do pedido segue registrado.'
        );
      }
    } catch {
      setRetryFeedback('Não foi possível repetir a notificação agora.');
    } finally {
      setRetryingEmail(false);
    }
  };

  const handleStartAnotherOrder = () => {
    setConfirmed(null);
    setRetryFeedback(null);
    setSubmitError(null);
    setErrors({});
    setActiveSection(1);
    setDraft(createEmptyDraft());
  };

  const sectionClasses = [
    'form-portal-section',
    with3dHandoff ? 'with-3d-handoff' : '',
    with3dHandoff ? (isRevealed ? 'is-revealed' : 'is-waiting-tv') : '',
  ]
    .filter(Boolean)
    .join(' ');

  const hasSummaryPreview = Boolean(
    draft.unitName.trim() || draft.requesterName.trim() || draft.title.trim() || whatsappCheck.valid
  );

  return (
    <section
      id="pedido"
      className={sectionClasses}
      aria-labelledby="pedido-main-heading"
    >
      {/* Faixa Superior Iluminada do Estúdio: Logo IMTV | Portal de pedidos */}
      <header
        className="studio-top-banner"
        style={{
          backgroundImage: `url("${assetUrl('/studio/studio-header-banner.jpg')}")`,
        }}
      >
        <div className="studio-top-banner-inner">
          <div className="studio-top-brand-group">
            <ImtvLogo logoUrl={logoUrl} href="#pedido" />
            <span className="studio-top-divider" aria-hidden="true" />
            <span className="studio-top-subtitle">Portal de pedidos</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onNavigateBoard}
            >
              Área da equipe
            </button>
          </div>
        </div>
      </header>

      <div className="form-shell">
        {confirmed ? (
          <div
            className="pipefy-sheet"
            role="status"
            aria-live="polite"
            data-testid="order-confirmation-box"
            style={{ marginTop: '24px' }}
          >
            <div className="alert-box alert-confirm" style={{ marginBottom: '20px' }}>
              <strong style={{ fontSize: '1.15rem', display: 'block', marginBottom: '4px' }}>
                Pedido recebido
              </strong>
              Seu briefing já está gravado na coluna &ldquo;Recebido&rdquo; da equipe.
            </div>

            <div className="fields-grid-2" style={{ marginBottom: '18px' }}>
              <div className="review-compact-box" style={{ marginTop: 0 }}>
                <span className="field-hint">Protocolo</span>
                <p
                  data-testid="confirmed-protocol"
                  style={{
                    margin: '4px 0 0',
                    fontFamily: 'var(--font-display)',
                    fontSize: '1.45rem',
                    fontWeight: 700,
                  }}
                >
                  {confirmed.protocol}
                </p>
              </div>

              <div className="review-compact-box" style={{ marginTop: 0 }}>
                <span className="field-hint">Equipe destinatária</span>
                <p
                  data-testid="confirmed-recipient"
                  style={{
                    margin: '4px 0 0',
                    fontFamily: 'var(--font-display)',
                    fontSize: '1.2rem',
                    fontWeight: 700,
                  }}
                >
                  {confirmed.recipientTeamName}
                </p>
              </div>
            </div>

            <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)' }}>
              A entrega será enviada para o WhatsApp{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{confirmed.whatsappDisplay}</strong>.
            </p>

            {confirmed.emailStatus === 'failed' && (
              <div
                className="alert-box alert-warn"
                style={{ marginBottom: '18px' }}
                data-testid="email-retry-banner"
              >
                <p style={{ margin: '0 0 10px' }}>
                  {confirmed.emailErrorMessage ||
                    'O pedido foi gravado, mas o aviso automático por e-mail falhou.'}
                </p>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={handleRetryEmailOnly}
                  disabled={retryingEmail}
                >
                  {retryingEmail
                    ? 'Repetindo notificação...'
                    : 'Repetir apenas a notificação por e-mail'}
                </button>
                {retryFeedback && (
                  <p style={{ margin: '8px 0 0', fontSize: '0.84rem' }}>{retryFeedback}</p>
                )}
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary btn-cta-wide"
              onClick={handleStartAnotherOrder}
            >
              Solicitar outro vídeo →
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmitOrder} noValidate>
            <h1 id="pedido-main-heading" className="form-hero-heading">
              Qual vídeo sua unidade precisa?
            </h1>

            {submitError && (
              <div
                className="alert-box alert-error"
                role="alert"
                style={{ marginBottom: '22px' }}
                data-testid="submit-error-banner"
              >
                {submitError}
              </div>
            )}

            {/* ==================== 01 IDENTIFICAÇÃO ==================== */}
            <div
              className={`numbered-section ${activeSection === 1 ? 'is-active' : ''}`}
              onFocusCapture={() => setActiveSection(1)}
              data-testid="form-step-1"
            >
              <div className="numbered-section-head">
                <span className="numbered-section-num">01</span>
                <h2 className="numbered-section-title">Identificação</h2>
                <span className="numbered-section-line" aria-hidden="true" />
                <span className="numbered-section-status">
                  {activeSection === 1 ? 'Etapa ativa' : 'Etapa 1 de 3'}
                </span>
              </div>

              <div className="pipefy-cards-pair">
                {/* Ficha esquerda: Quem solicita */}
                <div className="pipefy-sheet">
                  <h3 className="pipefy-sheet-title">Quem solicita</h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div className="field-group">
                      <label htmlFor="f-unitName" className="field-label">
                        Unidade do Instituto Mix
                      </label>
                      <input
                        id="f-unitName"
                        type="text"
                        className={`input-dark ${errors.unitName ? 'has-error' : ''}`}
                        value={draft.unitName}
                        onChange={(e) => updateField('unitName', e.target.value)}
                        autoComplete="organization"
                        required
                      />
                      {errors.unitName && (
                        <p className="field-error-msg" role="alert">
                          {errors.unitName}
                        </p>
                      )}
                    </div>

                    <div className="field-group">
                      <label htmlFor="f-city" className="field-label">
                        Cidade / UF
                      </label>
                      <div className={`unified-field-bar ${errors.city || errors.uf ? 'has-error' : ''}`}>
                        <input
                          id="f-city"
                          type="text"
                          style={{ flex: 1, minWidth: 0 }}
                          placeholder="Cidade"
                          value={draft.city}
                          onChange={(e) => updateField('city', e.target.value)}
                          autoComplete="address-level2"
                          required
                        />
                        <span className="unified-seg-divider" aria-hidden="true" />
                        <select
                          id="f-uf"
                          aria-label="UF"
                          style={{ width: '74px', flexShrink: 0 }}
                          value={draft.uf}
                          onChange={(e) => updateField('uf', e.target.value)}
                          required
                        >
                          {BRAZIL_UFS.map((ufCode) => (
                            <option key={ufCode} value={ufCode}>
                              {ufCode}
                            </option>
                          ))}
                        </select>
                      </div>
                      {errors.city && (
                        <p className="field-error-msg" role="alert">
                          {errors.city}
                        </p>
                      )}
                    </div>

                    <div className="fields-grid-2">
                      <div className="field-group">
                        <label htmlFor="f-requesterName" className="field-label">
                          Nome
                        </label>
                        <input
                          id="f-requesterName"
                          type="text"
                          className={`input-dark ${errors.requesterName ? 'has-error' : ''}`}
                          value={draft.requesterName}
                          onChange={(e) => updateField('requesterName', e.target.value)}
                          autoComplete="name"
                          required
                        />
                        {errors.requesterName && (
                          <p className="field-error-msg" role="alert">
                            {errors.requesterName}
                          </p>
                        )}
                      </div>

                      <div className="field-group">
                        <label htmlFor="f-requesterEmail" className="field-label">
                          E-mail
                        </label>
                        <input
                          id="f-requesterEmail"
                          type="email"
                          className={`input-dark ${errors.requesterEmail ? 'has-error' : ''}`}
                          value={draft.requesterEmail}
                          onChange={(e) => updateField('requesterEmail', e.target.value)}
                          autoComplete="email"
                          required
                        />
                        {errors.requesterEmail && (
                          <p className="field-error-msg" role="alert">
                            {errors.requesterEmail}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="field-group">
                      <label htmlFor="f-waNumber" className="field-label">
                        WhatsApp para receber o vídeo
                      </label>
                      <div className={`unified-field-bar ${errors.whatsappNumber ? 'has-error' : ''}`}>
                        <input
                          id="f-waCc"
                          type="text"
                          inputMode="tel"
                          aria-label="Código do país"
                          style={{ width: '62px', flexShrink: 0, textAlign: 'center' }}
                          value={draft.whatsappCountryCode}
                          onChange={(e) => updateField('whatsappCountryCode', e.target.value)}
                          required
                        />
                        <span className="unified-seg-divider" aria-hidden="true" />
                        <input
                          id="f-waDdd"
                          type="text"
                          inputMode="numeric"
                          aria-label="DDD"
                          placeholder="DDD"
                          maxLength={5}
                          style={{ width: '60px', flexShrink: 0, textAlign: 'center' }}
                          value={draft.whatsappDdd}
                          onChange={(e) => updateField('whatsappDdd', e.target.value)}
                          required
                        />
                        <span className="unified-seg-divider" aria-hidden="true" />
                        <input
                          id="f-waNumber"
                          type="tel"
                          aria-label="Seu WhatsApp para receber o vídeo"
                          placeholder="99988-7766"
                          style={{ flex: 1, minWidth: 0 }}
                          value={draft.whatsappNumber}
                          onChange={(e) => updateField('whatsappNumber', e.target.value)}
                          required
                        />
                      </div>
                      {errors.whatsappNumber && (
                        <p className="field-error-msg" role="alert">
                          {errors.whatsappNumber}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Ficha direita: Quem recebe (com Logo Oficial IMTV no centro!) */}
                <div
                  className="pipefy-sheet recipient-showcase-card"
                  data-testid="recipient-public-card"
                >
                  <h3 className="pipefy-sheet-title">Quem recebe</h3>

                  <div className="recipient-logo-center">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt="IMTV"
                        className="recipient-logo-img"
                      />
                    ) : (
                      <span
                        className="imtv-brand-fallback"
                        style={{ fontSize: '2.1rem' }}
                      >
                        IMTV
                      </span>
                    )}

                    <div
                      className="recipient-team-pill"
                      data-testid="public-recipient-name"
                    >
                      {recipientTeamName}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ==================== 02 BRIEFING ==================== */}
            <div
              className={`numbered-section ${activeSection === 2 ? 'is-active' : ''}`}
              onFocusCapture={() => setActiveSection(2)}
              data-testid="form-step-2"
            >
              <div className="numbered-section-head">
                <span className="numbered-section-num">02</span>
                <h2 className="numbered-section-title">Briefing</h2>
                <span className="numbered-section-line" aria-hidden="true" />
                <span className="numbered-section-status">
                  {activeSection === 2 ? 'Etapa ativa' : 'Etapa 2 de 3'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div className="field-group">
                  <label htmlFor="f-title" className="field-label">
                    Título do pedido
                  </label>
                  <input
                    id="f-title"
                    type="text"
                    className={`input-dark ${errors.title ? 'has-error' : ''}`}
                    value={draft.title}
                    onChange={(e) => updateField('title', e.target.value)}
                    required
                  />
                  {errors.title && (
                    <p className="field-error-msg" role="alert">
                      {errors.title}
                    </p>
                  )}
                </div>

                <div className="fields-grid-briefing-mid">
                  <div className="field-group">
                    <label htmlFor="f-objective" className="field-label">
                      Objetivo do vídeo
                    </label>
                    <input
                      id="f-objective"
                      type="text"
                      className={`input-dark ${errors.objective ? 'has-error' : ''}`}
                      value={draft.objective}
                      onChange={(e) => updateField('objective', e.target.value)}
                      required
                    />
                    {errors.objective && (
                      <p className="field-error-msg" role="alert">
                        {errors.objective}
                      </p>
                    )}
                  </div>

                  <div className="field-group">
                    <label htmlFor="f-audience" className="field-label">
                      Público
                    </label>
                    <input
                      id="f-audience"
                      type="text"
                      className={`input-dark ${errors.targetAudience ? 'has-error' : ''}`}
                      value={draft.targetAudience}
                      onChange={(e) => updateField('targetAudience', e.target.value)}
                      required
                    />
                    {errors.targetAudience && (
                      <p className="field-error-msg" role="alert">
                        {errors.targetAudience}
                      </p>
                    )}
                  </div>
                </div>

                <div className="fields-grid-3">
                  <div className="field-group">
                    <label htmlFor="f-channel" className="field-label">
                      Canal de divulgação
                    </label>
                    <select
                      id="f-channel"
                      className={`select-dark ${errors.distributionChannel ? 'has-error' : ''}`}
                      value={draft.distributionChannel}
                      onChange={(e) => updateField('distributionChannel', e.target.value)}
                    >
                      {CHANNEL_OPTIONS.map((ch) => (
                        <option key={ch} value={ch}>
                          {ch}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field-group">
                    <label htmlFor="f-format" className="field-label">
                      <span>Formato</span>
                    </label>
                    <select
                      id="f-format"
                      className={`select-dark ${errors.videoFormat ? 'has-error' : ''}`}
                      value={
                        draft.needsFormatGuidance
                          ? 'Preciso de orientação'
                          : draft.videoFormat
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'Preciso de orientação') {
                          updateField('needsFormatGuidance', true);
                          updateField('videoFormat', val);
                        } else {
                          updateField('needsFormatGuidance', false);
                          updateField('videoFormat', val);
                        }
                      }}
                    >
                      {FORMAT_OPTIONS.map((fmt) => (
                        <option key={fmt} value={fmt}>
                          {fmt}
                        </option>
                      ))}
                    </select>
                    <label className="checkbox-inline" style={{ marginTop: '2px' }}>
                      <input
                        type="checkbox"
                        checked={draft.needsFormatGuidance}
                        onChange={(e) =>
                          updateField('needsFormatGuidance', e.target.checked)
                        }
                      />
                      <span>Preciso de orientação</span>
                    </label>
                  </div>

                  <div className="field-group">
                    <label htmlFor="f-desiredDate" className="field-label">
                      Data desejada
                    </label>
                    <input
                      id="f-desiredDate"
                      type="date"
                      className={`input-dark ${errors.desiredDate ? 'has-error' : ''}`}
                      value={draft.desiredDate}
                      onChange={(e) => updateField('desiredDate', e.target.value)}
                      required
                    />
                    {errors.desiredDate && (
                      <p className="field-error-msg" role="alert">
                        {errors.desiredDate}
                      </p>
                    )}
                  </div>
                </div>

                <div className="field-group">
                  <label htmlFor="f-mainMessage" className="field-label">
                    Mensagem principal
                  </label>
                  <textarea
                    id="f-mainMessage"
                    className={`textarea-dark ${errors.mainMessage ? 'has-error' : ''}`}
                    value={draft.mainMessage}
                    onChange={(e) => updateField('mainMessage', e.target.value)}
                    required
                  />
                  {errors.mainMessage && (
                    <p className="field-error-msg" role="alert">
                      {errors.mainMessage}
                    </p>
                  )}
                </div>

                <div className="field-group">
                  <label htmlFor="f-mandatoryInfo" className="field-label">
                    <span>Informações obrigatórias da peça</span>
                    <span className="field-hint">Opcional</span>
                  </label>
                  <input
                    id="f-mandatoryInfo"
                    type="text"
                    className="input-dark"
                    placeholder="Endereço, telefone local, regras promocionais ou créditos obrigatórios"
                    value={draft.mandatoryInfo}
                    onChange={(e) => updateField('mandatoryInfo', e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* ==================== 03 MATERIAIS E REVISÃO ==================== */}
            <div
              className={`numbered-section ${activeSection === 3 ? 'is-active' : ''}`}
              onFocusCapture={() => setActiveSection(3)}
              data-testid="form-step-3"
            >
              <div className="numbered-section-head">
                <span className="numbered-section-num">03</span>
                <h2 className="numbered-section-title">Materiais e revisão</h2>
                <span className="numbered-section-line" aria-hidden="true" />
                <span className="numbered-section-status">
                  {activeSection === 3 ? 'Etapa ativa' : 'Etapa 3 de 3'}
                </span>
              </div>

              <div className="field-group">
                <label htmlFor="f-driveUrl" className="field-label">
                  Link do Google Drive com os materiais
                </label>
                <div className="drive-input-wrap">
                  <span className="drive-input-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  </span>
                  <input
                    id="f-driveUrl"
                    type="url"
                    className={`input-dark ${errors.materialsDriveUrl ? 'has-error' : ''}`}
                    placeholder="https://drive.google.com/drive/folders/..."
                    value={draft.materialsDriveUrl}
                    onChange={(e) => updateField('materialsDriveUrl', e.target.value)}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                    marginTop: '4px',
                  }}
                >
                  <p className="field-hint">Compartilhe o acesso com a equipe IMTV.</p>
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={draft.materialsPending}
                      onChange={(e) => updateField('materialsPending', e.target.checked)}
                    />
                    <span>Materiais ainda não estão prontos</span>
                  </label>
                </div>

                {errors.materialsDriveUrl && (
                  <p className="field-error-msg" role="alert">
                    {errors.materialsDriveUrl}
                  </p>
                )}
              </div>

              {/* Resumo de conferência rápido (mostra o WhatsApp validado e dados principais antes do envio) */}
              {hasSummaryPreview && (
                <div className="review-compact-box">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      flexWrap: 'wrap',
                      fontSize: '0.86rem',
                    }}
                  >
                    <span style={{ color: 'var(--text-secondary)' }}>
                      Resumo: <strong style={{ color: 'var(--text-primary)' }}>{draft.unitName || 'Unidade'}</strong> · Destino:{' '}
                      <strong style={{ color: 'var(--text-primary)' }}>{recipientTeamName}</strong>
                      {draft.title ? ` · “${draft.title}” (${formatDatePtBr(draft.desiredDate)})` : ''}
                    </span>

                    <span style={{ color: 'var(--text-secondary)' }}>
                      WhatsApp:{' '}
                      <strong
                        data-testid="review-whatsapp-display"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {whatsappCheck.valid
                          ? whatsappCheck.display
                          : `${draft.whatsappCountryCode} (${draft.whatsappDdd || '--'}) ${draft.whatsappNumber || ''}`}
                      </strong>{' '}
                      <button
                        type="button"
                        onClick={() => document.getElementById('f-waNumber')?.focus()}
                        style={{
                          background: 'none',
                          border: 0,
                          color: 'var(--imtv-accent)',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          fontSize: '0.82rem',
                          padding: '0 4px',
                        }}
                      >
                        Corrigir
                      </button>
                    </span>
                  </div>
                </div>
              )}

              <div style={{ marginTop: '26px' }}>
                <button
                  type="submit"
                  className="btn btn-primary btn-cta-wide"
                  disabled={isSubmitting}
                  data-testid="submit-order-btn"
                >
                  <span>{isSubmitting ? 'Enviando pedido...' : 'Enviar pedido'}</span>
                  <span aria-hidden="true" style={{ fontSize: '1.3rem', lineHeight: 1 }}>
                    →
                  </span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
