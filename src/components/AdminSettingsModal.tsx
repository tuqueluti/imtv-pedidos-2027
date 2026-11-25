import React, { useEffect, useState } from 'react';
import {
  QUEUE_OWNERS,
  type AdminSettingsPayload,
  type PublicPortalConfig,
  type QueueOwner,
} from '../../shared/domain.ts';
import { normalizeLogoUrl, portalFetch } from '../api/clientApi.ts';

interface AdminSettingsModalProps {
  onClose: () => void;
  onPublicConfigChanged: (cfg: PublicPortalConfig) => void;
}

export function AdminSettingsModal({
  onClose,
  onPublicConfigChanged,
}: AdminSettingsModalProps) {
  const [settings, setSettings] = useState<AdminSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Campos de destinatário e notificações
  const [teamName, setTeamName] = useState('Equipe de Produção da IMTV');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Novo / Editar integrante autorizado
  const [mUser, setMUser] = useState('');
  const [mName, setMName] = useState('');
  const [mEmail, setMEmail] = useState('');
  const [mRole, setMRole] = useState<'admin' | 'member'>('member');
  const [mQueue, setMQueue] = useState<string>('');
  const [mPass, setMPass] = useState('');
  const [savingMember, setSavingMember] = useState(false);

  useEffect(() => {
    let active = true;
    void portalFetch('/api/admin/settings')
      .then((r) => r.json())
      .then((data: AdminSettingsPayload & { ok?: boolean; error?: string }) => {
        if (!active) return;
        if (data.error) {
          setError(data.error);
        } else {
          setSettings({
            ...data,
            logoUrl: normalizeLogoUrl(data.logoUrl),
          });
          setTeamName(data.recipientTeamName);
          setEmailEnabled(data.notificationEmailEnabled);
          setEmailTo(data.notificationEmailTo);
          setSmtpHost(data.smtpHost);
          setSmtpPort(data.smtpPort);
          setSmtpUser(data.smtpUser);
          setSmtpFrom(data.smtpFrom);
          setSmtpSecure(data.smtpSecure);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError('Não foi possível carregar as configurações internas.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGeneral(true);
    setError(null);
    setFeedback(null);

    try {
      const resp = await portalFetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientTeamName: teamName,
          notificationEmailEnabled: emailEnabled,
          notificationEmailTo: emailTo,
          smtpHost,
          smtpPort,
          smtpUser,
          smtpPass,
          smtpFrom,
          smtpSecure,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || (data.ok === false)) {
        setError(data.error || 'Erro ao salvar configurações.');
      } else {
        const nextSettings = (data.settings || data) as AdminSettingsPayload;
        const normalizedLogo = normalizeLogoUrl(nextSettings.logoUrl);
        setSettings({ ...nextSettings, logoUrl: normalizedLogo });
        setSmtpPass('');
        onPublicConfigChanged({
          recipientTeamName: nextSettings.recipientTeamName,
          logoUrl: normalizedLogo,
        });
        setFeedback('Configurações de destinatário e notificações salvas.');
      }
    } catch {
      setError('Falha de rede ao salvar configurações.');
    } finally {
      setSavingGeneral(false);
    }
  };

  const handleLogoUpload = async (file: File) => {
    setError(null);
    setFeedback(null);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = String(reader.result || '');
        const resp = await portalFetch('/api/admin/logo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'uploaded',
            mime: file.type,
            filename: file.name,
            base64,
          }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          setError(data.error || 'Não foi possível carregar o logo.');
        } else {
          const nextSet = data.settings as AdminSettingsPayload;
          const nextPub = data.publicConfig as PublicPortalConfig;
          setSettings({ ...nextSet, logoUrl: normalizeLogoUrl(nextSet.logoUrl) });
          onPublicConfigChanged({
            recipientTeamName: nextPub.recipientTeamName,
            logoUrl: normalizeLogoUrl(nextPub.logoUrl),
          });
          setFeedback('Logo oficial atualizado em todas as telas (estúdio 3D, formulário e painel).');
        }
      } catch {
        setError('Erro ao enviar arquivo do logo.');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSetLogoMode = async (mode: 'bundled' | 'pending') => {
    setError(null);
    setFeedback(null);
    try {
      const resp = await portalFetch('/api/admin/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setError(data.error || 'Erro ao alterar estado do logo.');
      } else {
        const nextSet = data.settings as AdminSettingsPayload;
        const nextPub = data.publicConfig as PublicPortalConfig;
        setSettings({ ...nextSet, logoUrl: normalizeLogoUrl(nextSet.logoUrl) });
        onPublicConfigChanged({
          recipientTeamName: nextPub.recipientTeamName,
          logoUrl: normalizeLogoUrl(nextPub.logoUrl),
        });
        setFeedback(
          mode === 'pending'
            ? 'Logo marcado como pendente ("IMTV" exibido em texto em todas as telas).'
            : 'Logo oficial padrão da IMTV restaurado em todas as telas.'
        );
      }
    } catch {
      setError('Falha ao atualizar o estado do logo.');
    }
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMember(true);
    setError(null);
    setFeedback(null);

    try {
      const resp = await portalFetch('/api/admin/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: mUser,
          displayName: mName,
          email: mEmail,
          role: mRole,
          queueColumn: mQueue ? (mQueue as QueueOwner) : null,
          password: mPass || undefined,
          active: true,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        setError(data.error || 'Não foi possível salvar integrante.');
      } else {
        setSettings((prev) =>
          prev ? { ...prev, members: data.members } : prev
        );
        setMUser('');
        setMName('');
        setMEmail('');
        setMPass('');
        setMQueue('');
        setFeedback('Integrante autorizado salvo com sucesso.');
      }
    } catch {
      setError('Falha ao salvar integrante.');
    } finally {
      setSavingMember(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-surface t-modal is-open" data-testid="admin-settings-modal">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            paddingBottom: '14px',
            marginBottom: '18px',
            borderBottom: '1px solid var(--border-graphite)',
          }}
        >
          <h2 id="admin-modal-title" style={{ margin: 0, fontFamily: 'var(--font-display)' }}>
            Configuração Interna · Equipe e Identidade IMTV
          </h2>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Fechar
          </button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-secondary)' }}>Carregando configurações...</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {error && (
              <div className="alert-box alert-error" role="alert">
                {error}
              </div>
            )}
            {feedback && (
              <div className="alert-box alert-confirm" role="status">
                {feedback}
              </div>
            )}

            {/* 1. Logo Oficial IMTV em Único Lugar */}
            <section className="review-block">
              <h3 style={{ margin: '0 0 6px', fontSize: '1rem' }}>
                Logo Oficial da IMTV (atualiza estúdio 3D, formulário e painel)
              </h3>
              <p className="field-hint" style={{ marginBottom: '12px' }}>
                Carregue o arquivo oficial (PNG, SVG, WebP ou JPG) em um único lugar. Se ficar pendente, todas as telas mostram &ldquo;IMTV&rdquo; em texto.
              </p>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{
                    padding: '12px 18px',
                    background: 'var(--surface-graphite-2)',
                    border: '1px solid var(--border-graphite-strong)',
                    borderRadius: 'var(--radius-sm)',
                    minHeight: '56px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {settings?.logoUrl ? (
                    <img
                      src={settings.logoUrl}
                      alt="Prévia do logo oficial IMTV"
                      style={{ height: '32px', width: 'auto', objectFit: 'contain' }}
                    />
                  ) : (
                    <span className="imtv-brand-fallback">IMTV (Texto pendente)</span>
                  )}
                </div>

                <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                  Carregar logo oficial
                  <input
                    type="file"
                    accept="image/png,image/svg+xml,image/webp,image/jpeg"
                    style={{ display: 'none' }}
                    data-testid="admin-logo-file-input"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleLogoUpload(f);
                      e.currentTarget.value = '';
                    }}
                  />
                </label>

                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void handleSetLogoMode('bundled')}
                >
                  Usar logo IMTV Brasil padrão
                </button>

                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid="admin-logo-pending-btn"
                  onClick={() => void handleSetLogoMode('pending')}
                >
                  Deixar pendente (mostrar texto IMTV)
                </button>
              </div>
            </section>

            {/* 2. Quem Recebe e Avisos Reais por E-mail */}
            <form onSubmit={handleSaveGeneral} className="review-block">
              <h3 style={{ margin: '0 0 12px', fontSize: '1rem' }}>
                Destinatário (&ldquo;Quem recebe&rdquo;) e Notificações por E-mail
              </h3>

              <div style={{ display: 'grid', gap: '14px' }}>
                <div className="field-group">
                  <label htmlFor="adm-teamName" className="field-label">
                    Nome da equipe destinatária exibido às unidades
                  </label>
                  <input
                    id="adm-teamName"
                    type="text"
                    className="input-dark"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    required
                  />
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={emailEnabled}
                    onChange={(e) => setEmailEnabled(e.target.checked)}
                  />
                  <div>
                    <strong style={{ display: 'block', fontSize: '0.9rem' }}>
                      Enviar aviso por e-mail ao receber um novo pedido
                    </strong>
                    <span className="field-hint">
                      Notifica o endereço real da equipe após gravar o pedido no banco.
                    </span>
                  </div>
                </label>

                {emailEnabled && (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    <div className="fields-grid-2">
                      <div className="field-group">
                        <label htmlFor="adm-emailTo" className="field-label">
                          Endereço real de notificação *
                        </label>
                        <input
                          id="adm-emailTo"
                          type="email"
                          className="input-dark"
                          placeholder="E-mail de destino"
                          value={emailTo}
                          onChange={(e) => setEmailTo(e.target.value)}
                          required={emailEnabled}
                        />
                      </div>
                      <div className="field-group">
                        <label htmlFor="adm-smtpFrom" className="field-label">
                          Remetente SMTP (From)
                        </label>
                        <input
                          id="adm-smtpFrom"
                          type="text"
                          className="input-dark"
                          placeholder="Nome e e-mail do remetente"
                          value={smtpFrom}
                          onChange={(e) => setSmtpFrom(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="fields-grid-2">
                      <div className="field-group">
                        <label htmlFor="adm-smtpHost" className="field-label">
                          Servidor SMTP (Host)
                        </label>
                        <input
                          id="adm-smtpHost"
                          type="text"
                          className="input-dark"
                          placeholder="Host do servidor SMTP"
                          value={smtpHost}
                          onChange={(e) => setSmtpHost(e.target.value)}
                        />
                      </div>
                      <div className="field-group">
                        <label htmlFor="adm-smtpPort" className="field-label">
                          Porta SMTP
                        </label>
                        <input
                          id="adm-smtpPort"
                          type="number"
                          className="input-dark"
                          value={smtpPort}
                          onChange={(e) => setSmtpPort(Number(e.target.value) || 587)}
                        />
                      </div>
                    </div>

                    <div className="fields-grid-2">
                      <div className="field-group">
                        <label htmlFor="adm-smtpUser" className="field-label">
                          Usuário SMTP
                        </label>
                        <input
                          id="adm-smtpUser"
                          type="text"
                          className="input-dark"
                          value={smtpUser}
                          onChange={(e) => setSmtpUser(e.target.value)}
                        />
                      </div>
                      <div className="field-group">
                        <label htmlFor="adm-smtpPass" className="field-label">
                          Senha SMTP {settings?.hasSmtpPassword ? '(já salva)' : ''}
                        </label>
                        <input
                          id="adm-smtpPass"
                          type="password"
                          className="input-dark"
                          placeholder={
                            settings?.hasSmtpPassword
                              ? 'Preencha apenas para substituir'
                              : 'Senha do servidor SMTP'
                          }
                          value={smtpPass}
                          onChange={(e) => setSmtpPass(e.target.value)}
                        />
                      </div>
                    </div>

                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={smtpSecure}
                        onChange={(e) => setSmtpSecure(e.target.checked)}
                      />
                      <span className="field-hint">Usar conexão TLS implícita (porta 465)</span>
                    </label>
                  </div>
                )}

                <div>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={savingGeneral}
                  >
                    {savingGeneral ? 'Salvando...' : 'Salvar equipe e notificações'}
                  </button>
                </div>
              </div>
            </form>

            {/* 3. Integrantes Autorizados da Equipe */}
            <section className="review-block">
              <h3 style={{ margin: '0 0 10px', fontSize: '1rem' }}>
                Integrantes Autorizados no Quadro
              </h3>
              <div style={{ display: 'grid', gap: '8px', marginBottom: '16px' }}>
                {settings?.members.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '8px 12px',
                      background: 'var(--surface-graphite-2)',
                      border: '1px solid var(--border-graphite)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.86rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <strong>{m.displayName}</strong>{' '}
                      <span style={{ color: 'var(--text-muted)' }}>(@{m.username})</span>
                      {m.email ? (
                        <span style={{ color: 'var(--text-secondary)' }}> · {m.email}</span>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {m.queueColumn && (
                        <span className="pipe-tag">Fila: {m.queueColumn}</span>
                      )}
                      <span className="pipe-tag">
                        {m.role === 'admin' ? 'Administrador' : 'Equipe'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={handleSaveMember} style={{ display: 'grid', gap: '10px' }}>
                <strong style={{ fontSize: '0.88rem' }}>
                  Adicionar ou atualizar integrante autorizado
                </strong>
                <div className="fields-grid-2">
                  <input
                    type="text"
                    className="input-dark"
                    placeholder="Login de acesso"
                    value={mUser}
                    onChange={(e) => setMUser(e.target.value)}
                    required
                  />
                  <input
                    type="text"
                    className="input-dark"
                    placeholder="Nome exibido"
                    value={mName}
                    onChange={(e) => setMName(e.target.value)}
                    required
                  />
                </div>
                <div className="fields-grid-2">
                  <input
                    type="email"
                    className="input-dark"
                    placeholder="E-mail interno"
                    value={mEmail}
                    onChange={(e) => setMEmail(e.target.value)}
                  />
                  <input
                    type="password"
                    className="input-dark"
                    placeholder="Senha (mínimo 6 caracteres)"
                    value={mPass}
                    onChange={(e) => setMPass(e.target.value)}
                  />
                </div>
                <div className="fields-grid-2">
                  <select
                    className="select-dark"
                    value={mRole}
                    onChange={(e) => setMRole(e.target.value as 'admin' | 'member')}
                  >
                    <option value="member">Integrante da Equipe</option>
                    <option value="admin">Administrador</option>
                  </select>
                  <select
                    className="select-dark"
                    value={mQueue}
                    onChange={(e) => setMQueue(e.target.value)}
                  >
                    <option value="">Sem fila individual fixa</option>
                    {QUEUE_OWNERS.map((q) => (
                      <option key={q} value={q}>
                        Fila {q}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <button
                    type="submit"
                    className="btn btn-sm"
                    disabled={savingMember}
                  >
                    {savingMember ? 'Salvando integrante...' : 'Salvar integrante'}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
