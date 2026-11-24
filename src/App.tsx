import React, { useEffect, useState, useCallback } from 'react';
import type { PublicPortalConfig } from '../shared/domain.ts';
import { assetUrl, normalizeLogoUrl, portalFetch } from './api/clientApi.ts';
import { StudioOpening3D } from './components/StudioOpening3D.tsx';
import { PublicBriefingForm } from './components/PublicBriefingForm.tsx';
import { InternalPipefyBoard } from './components/InternalPipefyBoard.tsx';

function detectShouldUseLiteStudio(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return true;
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 2) {
    return true;
  }
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2) {
    return true;
  }
  try {
    const testCanvas = document.createElement('canvas');
    const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
    if (!gl) return true;
  } catch {
    return true;
  }
  return false;
}

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

export function App() {
  const [route, setRoute] = useState<'public' | 'board'>(() => readCurrentRoute());

  const [publicConfig, setPublicConfig] = useState<PublicPortalConfig>({
    recipientTeamName: 'Equipe de Produção da IMTV',
    logoUrl: assetUrl('/branding/imtv-logo-oficial.png'),
  });

  const [useLiteStudio, setUseLiteStudio] = useState<boolean>(() =>
    detectShouldUseLiteStudio()
  );
  const [formRevealedByScroll, setFormRevealedByScroll] = useState<boolean>(() =>
    detectShouldUseLiteStudio()
  );

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
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = () => {
      const lite = detectShouldUseLiteStudio();
      setUseLiteStudio(lite);
      if (lite) setFormRevealedByScroll(true);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
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
    if (useLiteStudio) {
      setFormRevealedByScroll(true);
      const el = document.getElementById('pedido');
      el?.scrollIntoView({ behavior: 'auto' });
      return;
    }
    const targetY = Math.ceil(window.innerHeight * 2.02);
    window.scrollTo({ top: targetY, behavior: 'smooth' });
  }, [useLiteStudio]);

  if (route === 'board') {
    return (
      <InternalPipefyBoard
        logoUrl={publicConfig.logoUrl}
        recipientTeamName={publicConfig.recipientTeamName}
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
        useLiteMode={useLiteStudio}
        onFormRevealedChange={setFormRevealedByScroll}
        onJumpToOrder={handleJumpToOrder}
        onNavigateBoard={() => navigateTo('board')}
      />
      <PublicBriefingForm
        logoUrl={publicConfig.logoUrl}
        recipientTeamName={publicConfig.recipientTeamName}
        with3dHandoff={!useLiteStudio}
        isRevealed={useLiteStudio || formRevealedByScroll}
        onNavigateBoard={() => navigateTo('board')}
      />
    </main>
  );
}
