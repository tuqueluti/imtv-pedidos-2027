import React, { useEffect, useState, useCallback } from 'react';
import type { PublicPortalConfig } from '../shared/domain.ts';
import { assetUrl, normalizeLogoUrl, portalFetch } from './api/clientApi.ts';
import { StudioOpening3D } from './components/StudioOpening3D.tsx';
import { PublicBriefingForm } from './components/PublicBriefingForm.tsx';
import { InternalPipefyBoard } from './components/InternalPipefyBoard.tsx';

function readCurrentRoute(): 'public' | 'board' {
  if (typeof window === 'undefined') return 'public';
  if (
    window.location.pathname.endsWith('/quadro') ||
    window.location.hash === '#/quadro' ||
    window.location.hash === '#quadro'
  ) {
    return 'board';
  }
  return 'public';
}

function dispatchClaqueteSoundState(ativo: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('imtv:som', { detail: { ativo } }));
}

export function App() {
  const [route, setRoute] = useState<'public' | 'board'>(() => readCurrentRoute());

  // O som já inicia ativado ao entrar no link, sincronizando vídeo, ambiência e claquete
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const [publicConfig, setPublicConfig] = useState<PublicPortalConfig>({
    recipientTeamName: 'Equipe de Produção da IMTV',
    logoUrl: assetUrl('/branding/imtv-logo-oficial.png'),
  });

  const [formRevealedByScroll, setFormRevealedByScroll] = useState<boolean>(false);

  // Sincroniza o estado de som com o script clássico defer da claquete (imtv:som)
  useEffect(() => {
    dispatchClaqueteSoundState(soundEnabled);
    const t1 = window.setTimeout(() => dispatchClaqueteSoundState(soundEnabled), 80);
    const onWindowLoad = () => dispatchClaqueteSoundState(soundEnabled);
    window.addEventListener('load', onWindowLoad);
    return () => {
      window.clearTimeout(t1);
      window.removeEventListener('load', onWindowLoad);
    };
  }, [soundEnabled]);

  const handleToggleSound = useCallback(() => {
    setSoundEnabled((prev) => !prev);
  }, []);

  useEffect(() => {
    let active = true;
    void portalFetch('/api/public/config')
      .then((r) => r.json())
      .then((cfg: PublicPortalConfig) => {
        if (!active || !cfg) return;
        setPublicConfig({
          recipientTeamName: cfg.recipientTeamName || 'Equipe de Produção da IMTV',
          logoUrl: normalizeLogoUrl(cfg.logoUrl),
        });
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onRouteSync = () => setRoute(readCurrentRoute());
    window.addEventListener('popstate', onRouteSync);
    window.addEventListener('hashchange', onRouteSync);
    return () => {
      window.removeEventListener('popstate', onRouteSync);
      window.removeEventListener('hashchange', onRouteSync);
    };
  }, []);

  const navigateTo = useCallback((next: 'public' | 'board') => {
    const isGitHubPages = window.location.hostname.endsWith('.github.io');
    if (isGitHubPages) {
      window.location.hash = next === 'board' ? '#/quadro' : '';
    } else {
      const path = next === 'board' ? '/quadro' : '/';
      if (window.location.pathname !== path) {
        window.history.pushState({}, '', path);
      }
    }
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const handleJumpToOrder = useCallback(() => {
    const track = document.querySelector('.studio-scroll-track') as HTMLElement | null;
    const stage = document.querySelector('.studio-sticky-stage') as HTMLElement | null;
    const targetY =
      track && stage
        ? Math.max(1, track.offsetHeight - stage.clientHeight + 8)
        : Math.ceil(window.innerHeight * 2.02);
    window.scrollTo({ top: targetY, behavior: 'smooth' });
  }, []);

  if (route === 'board') {
    return (
      <InternalPipefyBoard
        logoUrl={publicConfig.logoUrl}
        recipientTeamName={publicConfig.recipientTeamName}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onPublicConfigChanged={(cfg) =>
          setPublicConfig({
            recipientTeamName: cfg.recipientTeamName,
            logoUrl: normalizeLogoUrl(cfg.logoUrl),
          })
        }
        onNavigatePublic={() => navigateTo('public')}
      />
    );
  }

  return (
    <main>
      <StudioOpening3D
        logoUrl={publicConfig.logoUrl}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        onFormRevealedChange={setFormRevealedByScroll}
        onJumpToOrder={handleJumpToOrder}
        onNavigateBoard={() => navigateTo('board')}
      />
      <PublicBriefingForm
        logoUrl={publicConfig.logoUrl}
        recipientTeamName={publicConfig.recipientTeamName}
        soundEnabled={soundEnabled}
        onToggleSound={handleToggleSound}
        with3dHandoff={true}
        isRevealed={formRevealedByScroll}
        onNavigateBoard={() => navigateTo('board')}
      />
    </main>
  );
}
