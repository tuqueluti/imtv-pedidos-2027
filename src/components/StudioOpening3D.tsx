import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { StudioOpeningAudio } from '../audio/studioAudio.ts';
import { assetUrl } from '../api/clientApi.ts';
import { computeMusicLoopVolume } from '../../shared/domain.ts';
import { HeroGenerativeIntro } from './HeroGenerativeIntro.tsx';

const YOUTUBE_VIDEO_ID = 'iTKp3kyNw4c';
const YOUTUBE_WATCH_URL = `https://www.youtube.com/watch?v=${YOUTUBE_VIDEO_ID}`;

interface StageSpec {
  mode: 'desktop' | 'mobile';
  planeW: number;
  planeH: number;
  bgPlaneH: number;
  fgPlaneH: number;
  tvX: number;
  tvY: number;
  tvScreenW: number;
  tvScreenH: number;
  cabinetW: number;
  cabinetH: number;
  logoX: number;
  logoY: number;
  logoW: number;
  logoH: number;
  bgUrl: string;
  tvUrl: string;
  fgUrl: string;
}

const PLANE_H = 2.0;

/**
 * Geometria 16:9 (1024 x 576) do estúdio horizontal para computadores:
 * - Vidro interno da TV 50": px [577..883], py [162..339]
 * - Identificação física IMTV na parede preta: px [646..814], py [58..116]
 */
const DESKTOP_W = (PLANE_H * 16) / 9; // 3.555556m
const DESKTOP_STAGE: StageSpec = {
  mode: 'desktop',
  planeW: DESKTOP_W,
  planeH: PLANE_H,
  bgPlaneH: PLANE_H,
  fgPlaneH: PLANE_H,
  tvX: (730.0 / 1024.0 - 0.5) * DESKTOP_W,
  tvY: (0.5 - 250.5 / 576.0) * PLANE_H,
  tvScreenW: (306.0 / 1024.0) * DESKTOP_W,
  tvScreenH: (177.0 / 576.0) * PLANE_H,
  cabinetW: 1.04,
  cabinetH: 0.84,
  logoX: (730.0 / 1024.0 - 0.5) * DESKTOP_W,
  logoY: (0.5 - 88.0 / 576.0) * PLANE_H,
  logoW: (196.0 / 1024.0) * DESKTOP_W,
  logoH: (70.0 / 576.0) * PLANE_H,
  bgUrl: '/studio/studio-bg-stage.jpg',
  tvUrl: '/studio/studio-mid-tv.webp',
  fgUrl: '/studio/studio-fg-tripod.webp',
};

/**
 * Geometria 9:16 (576 x 1024) do estúdio vertical para smartphones e telas menores:
 * - TV 50" centralizada: gabinete px [170..499], vidro interno px [191..476], py [386..554]
 * - Identificação física IMTV acima da TV: px [246..464], py [267..335]
 */
const MOBILE_W = (PLANE_H * 9) / 16; // 1.125m
const MOBILE_STAGE: StageSpec = {
  mode: 'mobile',
  planeW: MOBILE_W,
  planeH: PLANE_H,
  bgPlaneH: PLANE_H * (1248.0 / 1024.0),
  fgPlaneH: PLANE_H * (1248.0 / 1024.0),
  tvX: (333.5 / 576.0 - 0.5) * MOBILE_W,
  tvY: (0.5 - 470.0 / 1024.0) * PLANE_H,
  tvScreenW: (285.0 / 576.0) * MOBILE_W,
  tvScreenH: (168.0 / 1024.0) * PLANE_H,
  cabinetW: 0.62,
  cabinetH: 0.52,
  logoX: (355.0 / 576.0 - 0.5) * MOBILE_W,
  logoY: (0.5 - 301.0 / 1024.0) * PLANE_H,
  logoW: (224.0 / 576.0) * MOBILE_W,
  logoH: (74.0 / 1024.0) * PLANE_H,
  bgUrl: '/studio/studio-mobile-bg.jpg',
  tvUrl: '/studio/studio-mobile-mid-tv.webp',
  fgUrl: '/studio/studio-mobile-fg-tripod.webp',
};

const BASE_FOV = 38;
const TAN_HALF_BASE_FOV = Math.tan(THREE.MathUtils.degToRad(BASE_FOV * 0.5));
const Z_REF = PLANE_H / (2 * TAN_HALF_BASE_FOV); // ~2.9042m

const Z_BG = -0.95;
const Z_LOGO = -0.12;
const Z_FG_TRIPOD = 1.18;

const DOM_SCREEN_PX_W = 960;

function detectIsMobileStage(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window.innerWidth || 1024;
  const h = Math.max(1, window.innerHeight || 768);
  return w < 860 || w / h < 1.05;
}

interface YTPlayerInstance {
  playVideo?: () => void;
  pauseVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
  mute?: () => void;
  unMute?: () => void;
  isMuted?: () => boolean;
  setVolume?: (v: number) => void;
  getVolume?: () => number;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  getPlayerState?: () => number;
  destroy?: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: Record<string, unknown>
      ) => YTPlayerInstance;
      PlayerState?: Record<string, number>;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<boolean> | null = null;
function loadYouTubeIframeApi(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.YT && window.YT.Player) return Promise.resolve(true);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const timeout = window.setTimeout(() => finish(false), 6500);
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      if (prevCallback) prevCallback();
      finish(true);
    };

    const existingScript = document.querySelector(
      'script[src*="youtube.com/iframe_api"]'
    );
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.onerror = () => {
        window.clearTimeout(timeout);
        finish(false);
      };
      document.head.appendChild(tag);
    }
  });

  return ytApiPromise;
}

function renderWallSignCanvas(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement | null
): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = -3;
  ctx.shadowOffsetY = 5;

  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const maxW = w * 0.84;
    const maxH = h * 0.78;
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;
    const dx = (w - drawW) / 2;
    const dy = (h - drawH) / 2;
    ctx.globalAlpha = 0.94;
    ctx.drawImage(img, dx, dy, drawW, drawH);
  } else {
    ctx.fillStyle = '#e8e2d8';
    ctx.font = '700 120px "Space Grotesk", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('IMTV', w / 2, h / 2 + 4);
  }
  ctx.restore();
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface StudioOpening3DProps {
  logoUrl: string | null;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onFormRevealedChange: (revealed: boolean) => void;
  onJumpToOrder: () => void;
  onNavigateBoard: () => void;
}

export function StudioOpening3D({
  logoUrl,
  soundEnabled,
  onToggleSound,
  onFormRevealedChange,
  onJumpToOrder,
  onNavigateBoard,
}: StudioOpening3DProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const screenDomRef = useRef<HTMLDivElement | null>(null);
  const webglLayerRef = useRef<HTMLDivElement | null>(null);
  const ytMountRef = useRef<HTMLDivElement | null>(null);

  const audioRef = useRef<StudioOpeningAudio | null>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const wallLogoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wallLogoTexRef = useRef<THREE.CanvasTexture | null>(null);
  const requestRenderRef = useRef<(() => void) | null>(null);

  const soundEnabledRef = useRef(soundEnabled);
  const awaitingGestureUnmuteRef = useRef(false);
  const loopCountRef = useRef(0);
  const lastLoopAdvanceAtRef = useRef(0);
  const maxSeenTimeRef = useRef(0);

  const [musicLoopCount, setMusicLoopCount] = useState(0);
  const [musicVolumePct, setMusicVolumePct] = useState(100);
  const [isMobileStage, setIsMobileStage] = useState<boolean>(() =>
    detectIsMobileStage()
  );
  const [ytUnavailable, setYtUnavailable] = useState(false);
  const [ytNeedsTap, setYtNeedsTap] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const handedOffRef = useRef(false);
  const [introFastFinish, setIntroFastFinish] = useState(false);
  const [tuningFlash, setTuningFlash] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);

  // Monitora troca entre orientação vertical/celular e horizontal/desktop
  useEffect(() => {
    const checkStageMode = () => {
      const mobile = detectIsMobileStage();
      setIsMobileStage((prev) => (prev === mobile ? prev : mobile));
    };
    window.addEventListener('resize', checkStageMode);
    return () => window.removeEventListener('resize', checkStageMode);
  }, []);

  // Inicializa o motor de áudio Web Audio já habilitado se soundEnabled estiver ativo na entrada
  useEffect(() => {
    const audio = new StudioOpeningAudio();
    audioRef.current = audio;
    if (soundEnabledRef.current && !handedOffRef.current) {
      audio.enableSound(true);
    }
    return () => {
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  // Sincroniza o estado de som com o player do YouTube (mantendo a música em loop no formulário) e ambiência do estúdio
  useEffect(() => {
    const prev = soundEnabledRef.current;
    soundEnabledRef.current = soundEnabled;

    if (soundEnabled) {
      if (!handedOffRef.current) {
        audioRef.current?.enableSound(!prev);
      }
      try {
        const targetVol = computeMusicLoopVolume(loopCountRef.current);
        ytPlayerRef.current?.setVolume?.(targetVol);
        ytPlayerRef.current?.unMute?.();
        ytPlayerRef.current?.playVideo?.();
        setYtNeedsTap(false);
      } catch {
        // ignore
      }
    } else {
      awaitingGestureUnmuteRef.current = false;
      audioRef.current?.disableSound();
      try {
        ytPlayerRef.current?.mute?.();
      } catch {
        // ignore
      }
    }
  }, [soundEnabled]);

  // Se o navegador suspender áudio na abertura fria do link, destrava no primeiro gesto (no estúdio ou já no formulário)
  useEffect(() => {
    const unlockAudioOnFirstGesture = (ev: Event) => {
      if (!soundEnabledRef.current) return;
      if (
        ev.target instanceof Element &&
        ev.target.closest('[data-sound-toggle="true"]')
      ) {
        return;
      }

      if (!handedOffRef.current) {
        audioRef.current?.resumeOnUserGestureIfEnabled();
      }

      if (awaitingGestureUnmuteRef.current) {
        awaitingGestureUnmuteRef.current = false;
        try {
          const targetVol = computeMusicLoopVolume(loopCountRef.current);
          ytPlayerRef.current?.setVolume?.(targetVol);
          ytPlayerRef.current?.unMute?.();
          ytPlayerRef.current?.playVideo?.();
          setYtNeedsTap(false);
        } catch {
          // ignore
        }
      }
    };

    const opts: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener('pointerdown', unlockAudioOnFirstGesture, opts);
    window.addEventListener('touchstart', unlockAudioOnFirstGesture, opts);
    window.addEventListener('keydown', unlockAudioOnFirstGesture, opts);
    window.addEventListener('wheel', unlockAudioOnFirstGesture, opts);

    return () => {
      window.removeEventListener('pointerdown', unlockAudioOnFirstGesture, opts);
      window.removeEventListener('touchstart', unlockAudioOnFirstGesture, opts);
      window.removeEventListener('keydown', unlockAudioOnFirstGesture, opts);
      window.removeEventListener('wheel', unlockAudioOnFirstGesture, opts);
    };
  }, []);

  // Atualiza dinamicamente o letreiro físico da IMTV na parede preta do estúdio
  useEffect(() => {
    const canvas = wallLogoCanvasRef.current;
    const tex = wallLogoTexRef.current;
    if (!canvas || !tex) return;

    if (!logoUrl) {
      renderWallSignCanvas(canvas, null);
      tex.needsUpdate = true;
      requestRenderRef.current?.();
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      renderWallSignCanvas(canvas, img);
      tex.needsUpdate = true;
      requestRenderRef.current?.();
    };
    img.onerror = () => {
      if (cancelled) return;
      renderWallSignCanvas(canvas, null);
      tex.needsUpdate = true;
      requestRenderRef.current?.();
    };
    img.src = logoUrl;

    return () => {
      cancelled = true;
    };
  }, [logoUrl, isMobileStage]);

  const advanceMusicLoop = useCallback(
    (
      player: YTPlayerInstance | null,
      restartPlayback: boolean,
      bypassDebounce = false
    ) => {
      const now = performance.now();
      if (!bypassDebounce && now - lastLoopAdvanceAtRef.current < 2500) {
        return;
      }
      lastLoopAdvanceAtRef.current = now;
      maxSeenTimeRef.current = 0;

      const nextLoop = loopCountRef.current + 1;
      loopCountRef.current = nextLoop;
      const nextVol = computeMusicLoopVolume(nextLoop);
      setMusicLoopCount(nextLoop);
      setMusicVolumePct(nextVol);

      if (!player) return;
      try {
        player.setVolume?.(nextVol);
        if (soundEnabledRef.current) {
          player.unMute?.();
        } else {
          player.mute?.();
        }
        if (restartPlayback) {
          player.seekTo?.(0, true);
          player.playVideo?.();
        }
      } catch {
        // ignore
      }
    },
    []
  );

  // Hook determinístico para verificação E2E da curva de -10 dB a cada loop
  useEffect(() => {
    const win = window as unknown as {
      __IMTV_SIMULATE_LOOP_END__?: () => { loop: number; volume: number };
    };
    win.__IMTV_SIMULATE_LOOP_END__ = () => {
      advanceMusicLoop(ytPlayerRef.current, true, true);
      return {
        loop: loopCountRef.current,
        volume: computeMusicLoopVolume(loopCountRef.current),
      };
    };
    return () => {
      delete win.__IMTV_SIMULATE_LOOP_END__;
    };
  }, [advanceMusicLoop]);

  const handleSkipToForm = useCallback(() => {
    setIntroFastFinish(true);
    awaitingGestureUnmuteRef.current = false;
    try {
      const targetVol = computeMusicLoopVolume(loopCountRef.current);
      ytPlayerRef.current?.setVolume?.(targetVol);
      if (soundEnabledRef.current) {
        ytPlayerRef.current?.unMute?.();
        ytPlayerRef.current?.playVideo?.();
      }
    } catch {
      // ignore
    }
    audioRef.current?.stopAllImmediately();
    onJumpToOrder();
  }, [onJumpToOrder]);

  const handlePlayDirectOnTv = useCallback(() => {
    setYtNeedsTap(false);
    awaitingGestureUnmuteRef.current = false;
    try {
      const targetVol = computeMusicLoopVolume(loopCountRef.current);
      ytPlayerRef.current?.setVolume?.(targetVol);
      if (soundEnabledRef.current) {
        ytPlayerRef.current?.unMute?.();
      }
      ytPlayerRef.current?.playVideo?.();
    } catch {
      // ignore
    }
  }, []);

  // Monta o player oficial do YouTube com som ativo na entrada e loop contínuo (-10 dB por repetição)
  useEffect(() => {
    const mountParent = ytMountRef.current;
    if (!mountParent) return;

    let disposed = false;
    let unmutedCheckTimer: number | null = null;
    let mutedFallbackTimer: number | null = null;
    let loopMonitorTimer: number | null = null;
    setYtUnavailable(false);
    setYtNeedsTap(false);

    const playerHost = document.createElement('div');
    playerHost.style.width = '100%';
    playerHost.style.height = '100%';
    mountParent.innerHTML = '';
    mountParent.appendChild(playerHost);

    void loadYouTubeIframeApi().then((loaded) => {
      if (disposed) return;
      if (!loaded || !window.YT || !window.YT.Player) {
        setYtUnavailable(true);
        return;
      }

      const wantSoundAtStart = soundEnabledRef.current;

      try {
        const player = new window.YT.Player(playerHost, {
          videoId: YOUTUBE_VIDEO_ID,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            mute: wantSoundAtStart ? 0 : 1,
            controls: 1,
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
            loop: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (ev: { target: YTPlayerInstance }) => {
              if (disposed) return;
              const initialVol = computeMusicLoopVolume(loopCountRef.current);
              setMusicVolumePct(initialVol);

              if (soundEnabledRef.current) {
                ev.target.setVolume?.(initialVol);
                ev.target.unMute?.();
                ev.target.playVideo?.();

                unmutedCheckTimer = window.setTimeout(() => {
                  if (disposed) return;
                  const st = ev.target.getPlayerState?.();
                  if (st === 1 || st === 3) {
                    awaitingGestureUnmuteRef.current = false;
                    setYtNeedsTap(false);
                    return;
                  }
                  awaitingGestureUnmuteRef.current = true;
                  ev.target.mute?.();
                  ev.target.playVideo?.();

                  mutedFallbackTimer = window.setTimeout(() => {
                    if (disposed) return;
                    const st2 = ev.target.getPlayerState?.();
                    if (st2 !== 1 && st2 !== 3 && !handedOffRef.current) {
                      setYtNeedsTap(true);
                    }
                  }, 1100);
                }, 850);
              } else {
                ev.target.setVolume?.(initialVol);
                ev.target.mute?.();
                ev.target.playVideo?.();
                mutedFallbackTimer = window.setTimeout(() => {
                  if (disposed) return;
                  const st = ev.target.getPlayerState?.();
                  if (st !== 1 && st !== 3 && !handedOffRef.current) {
                    setYtNeedsTap(true);
                  }
                }, 1400);
              }

              // Monitora fim ou retorno ao início do vídeo para garantir loop contínuo com -10 dB a cada repetição
              loopMonitorTimer = window.setInterval(() => {
                if (disposed) return;
                try {
                  const st = ev.target.getPlayerState?.();
                  if (st === 0) {
                    advanceMusicLoop(ev.target, true);
                    return;
                  }
                  const cur = ev.target.getCurrentTime?.();
                  const dur = ev.target.getDuration?.();
                  if (
                    typeof cur === 'number' &&
                    typeof dur === 'number' &&
                    dur > 5
                  ) {
                    if (maxSeenTimeRef.current > dur - 2.5 && cur < 1.5) {
                      advanceMusicLoop(ev.target, false);
                      maxSeenTimeRef.current = cur;
                    } else if (cur > maxSeenTimeRef.current) {
                      maxSeenTimeRef.current = cur;
                    }
                  }
                } catch {
                  // ignore
                }
              }, 400);
            },
            onStateChange: (ev: { data: number; target: YTPlayerInstance }) => {
              if (disposed) return;
              if (ev.data === 1 || ev.data === 3) {
                setYtNeedsTap(false);
              } else if (ev.data === 0) {
                advanceMusicLoop(ev.target, true);
              }
            },
            onError: () => {
              if (disposed) return;
              setYtUnavailable(true);
            },
          },
        });
        ytPlayerRef.current = player;
      } catch {
        setYtUnavailable(true);
      }
    });

    return () => {
      disposed = true;
      if (unmutedCheckTimer) window.clearTimeout(unmutedCheckTimer);
      if (mutedFallbackTimer) window.clearTimeout(mutedFallbackTimer);
      if (loopMonitorTimer) window.clearInterval(loopMonitorTimer);
      try {
        ytPlayerRef.current?.destroy?.();
      } catch {
        // ignore
      }
      ytPlayerRef.current = null;
    };
  }, [advanceMusicLoop]);

  // Cena 3D Multi-Plano Fotorrealista em Three.js r187 (com projeção DOM equivalente se o navegador estiver sem WebGL)
  useEffect(() => {
    const webglHost = webglLayerRef.current;
    if (!webglHost) return;

    const stage: StageSpec = isMobileStage ? MOBILE_STAGE : DESKTOP_STAGE;

    const disposables: Array<{ dispose: () => void }> = [];
    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      disposables.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      disposables.push(m);
      return m;
    };
    const trackTex = <T extends THREE.Texture>(t: T): T => {
      disposables.push(t);
      return t;
    };

    const scene = new THREE.Scene();

    const initRect = webglHost.getBoundingClientRect();
    let lastRendererW = Math.max(1, Math.round(initRect.width || window.innerWidth));
    let lastRendererH = Math.max(1, Math.round(initRect.height || window.innerHeight));

    const camera = new THREE.PerspectiveCamera(
      BASE_FOV,
      lastRendererW / lastRendererH,
      0.05,
      25
    );

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true });
      } catch {
        renderer = null;
      }
    }

    webglHost.innerHTML = '';
    webglHost.style.clipPath = '';

    const scaleBg = (Z_REF - Z_BG) / Z_REF;
    const scaleLogo = (Z_REF - Z_LOGO) / Z_REF;
    const scaleFg = (Z_REF - Z_FG_TRIPOD) / Z_REF;

    const wallLogoCanvas = document.createElement('canvas');
    wallLogoCanvas.width = 768;
    wallLogoCanvas.height = 274;
    wallLogoCanvasRef.current = wallLogoCanvas;
    renderWallSignCanvas(wallLogoCanvas, null);

    let domBgImg: HTMLImageElement | null = null;
    let domTvImg: HTMLImageElement | null = null;
    let domFgImg: HTMLImageElement | null = null;

    if (renderer) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(lastRendererW, lastRendererH);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setClearColor(0x050608, 1);
      webglHost.appendChild(renderer.domElement);

      const activeRenderer = renderer;
      const loader = new THREE.TextureLoader();
      const onTexLoaded = (tex: THREE.Texture) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, activeRenderer.capabilities.getMaxAnisotropy());
        updateSceneForScroll();
      };

      // Camada 1: Estúdio ao fundo (z = -0.95m, desloca mais devagar na rolagem)
      const bgTex = trackTex(loader.load(assetUrl(stage.bgUrl), onTexLoaded));
      bgTex.colorSpace = THREE.SRGBColorSpace;
      const bgMat = trackMat(
        new THREE.MeshBasicMaterial({
          map: bgTex,
          depthWrite: true,
        })
      );
      const bgMesh = new THREE.Mesh(
        trackGeo(new THREE.PlaneGeometry(stage.planeW * scaleBg, stage.bgPlaneH * scaleBg)),
        bgMat
      );
      bgMesh.position.set(0, 0, Z_BG);
      bgMesh.renderOrder = 1;
      scene.add(bgMesh);

      // Camada 2: Identificação física dinâmica da IMTV na parede preta (z = -0.12m)
      const wallLogoTex = trackTex(new THREE.CanvasTexture(wallLogoCanvas));
      wallLogoTex.colorSpace = THREE.SRGBColorSpace;
      wallLogoTexRef.current = wallLogoTex;

      const wallLogoMat = trackMat(
        new THREE.MeshBasicMaterial({
          map: wallLogoTex,
          transparent: true,
          depthWrite: false,
        })
      );
      const wallLogoMesh = new THREE.Mesh(
        trackGeo(new THREE.PlaneGeometry(stage.logoW * scaleLogo, stage.logoH * scaleLogo)),
        wallLogoMat
      );
      wallLogoMesh.position.set(stage.logoX * scaleLogo, stage.logoY * scaleLogo, Z_LOGO);
      wallLogoMesh.renderOrder = 2;
      scene.add(wallLogoMesh);

      // Camada 3: Gabinete profundo 3D + frente da TV de retroprojeção 50" (z = 0.00m)
      const deepCabinetMat = trackMat(
        new THREE.MeshBasicMaterial({
          color: 0x0b0b0d,
        })
      );
      const deepCabinetBox = new THREE.Mesh(
        trackGeo(new THREE.BoxGeometry(stage.cabinetW, stage.cabinetH, 0.32)),
        deepCabinetMat
      );
      deepCabinetBox.position.set(stage.tvX, stage.tvY - 0.1, -0.17);
      deepCabinetBox.renderOrder = 2;
      scene.add(deepCabinetBox);

      // Abertura Alpha=0 exata no vidro da TV (revela o player oficial do YouTube em perspectiva)
      const punchMat = trackMat(
        new THREE.MeshBasicMaterial({
          color: 0x000000,
          opacity: 0,
          transparent: false,
          blending: THREE.CustomBlending,
          blendEquation: THREE.AddEquation,
          blendSrc: THREE.ZeroFactor,
          blendDst: THREE.ZeroFactor,
        })
      );
      const screenAperture = new THREE.Mesh(
        trackGeo(new THREE.PlaneGeometry(stage.tvScreenW, stage.tvScreenH)),
        punchMat
      );
      screenAperture.position.set(stage.tvX, stage.tvY, -0.001);
      screenAperture.renderOrder = 3;
      scene.add(screenAperture);

      const tvTex = trackTex(loader.load(assetUrl(stage.tvUrl), onTexLoaded));
      tvTex.colorSpace = THREE.SRGBColorSpace;
      const tvMat = trackMat(
        new THREE.MeshBasicMaterial({
          map: tvTex,
          transparent: true,
          alphaTest: 0.02,
          depthWrite: true,
        })
      );
      const tvMesh = new THREE.Mesh(
        trackGeo(new THREE.PlaneGeometry(stage.planeW, stage.planeH)),
        tvMat
      );
      tvMesh.position.set(0, 0, 0);
      tvMesh.renderOrder = 4;
      scene.add(tvMesh);

      // Camada 4: Câmera de estúdio sobre tripé próxima ao visitante (z = +1.18m)
      const fgTex = trackTex(loader.load(assetUrl(stage.fgUrl), onTexLoaded));
      fgTex.colorSpace = THREE.SRGBColorSpace;
      const fgMat = trackMat(
        new THREE.MeshBasicMaterial({
          map: fgTex,
          transparent: true,
          alphaTest: 0.02,
          depthWrite: true,
        })
      );
      const fgTripodMesh = new THREE.Mesh(
        trackGeo(new THREE.PlaneGeometry(stage.planeW * scaleFg, stage.fgPlaneH * scaleFg)),
        fgMat
      );
      fgTripodMesh.position.set(0, 0, Z_FG_TRIPOD);
      fgTripodMesh.renderOrder = 5;
      scene.add(fgTripodMesh);
    } else {
      // Fallback multi-plano em DOM com a mesma câmera 3D se a aceleração WebGL estiver desligada no navegador
      wallLogoTexRef.current = null;
      const makePlaneImg = (src: string, zIdx: number) => {
        const img = document.createElement('img');
        img.src = assetUrl(src);
        img.alt = '';
        img.decoding = 'async';
        Object.assign(img.style, {
          position: 'absolute',
          pointerEvents: 'none',
          userSelect: 'none',
          maxWidth: 'none',
          zIndex: String(zIdx),
        });
        webglHost.appendChild(img);
        return img;
      };
      domBgImg = makePlaneImg(stage.bgUrl, 1);
      Object.assign(wallLogoCanvas.style, {
        position: 'absolute',
        pointerEvents: 'none',
        zIndex: '2',
      });
      webglHost.appendChild(wallLogoCanvas);
      domTvImg = makePlaneImg(stage.tvUrl, 3);
      domFgImg = makePlaneImg(stage.fgUrl, 4);
    }

    if (logoUrl) {
      const initImg = new Image();
      initImg.crossOrigin = 'anonymous';
      initImg.onload = () => {
        renderWallSignCanvas(wallLogoCanvas, initImg);
        if (wallLogoTexRef.current) {
          wallLogoTexRef.current.needsUpdate = true;
        }
        updateSceneForScroll();
      };
      initImg.src = logoUrl;
    }

    const cornerTL = new THREE.Vector3();
    const cornerTR = new THREE.Vector3();
    const cornerBL = new THREE.Vector3();
    const cornerBR = new THREE.Vector3();
    let flashTimer: number | null = null;

    function updateSceneForScroll() {
      const hostEl = webglLayerRef.current;
      if (!hostEl) return;
      const hostRect = hostEl.getBoundingClientRect();
      const vw = Math.max(1, hostRect.width || hostEl.clientWidth || window.innerWidth);
      const vh = Math.max(1, hostRect.height || hostEl.clientHeight || window.innerHeight);

      if (
        Math.abs(vw - lastRendererW) > 0.5 ||
        Math.abs(vh - lastRendererH) > 0.5
      ) {
        lastRendererW = vw;
        lastRendererH = vh;
        renderer?.setSize(vw, vh);
      }

      const aspect = vw / Math.max(1, vh);
      const stageAspect = stage.planeW / stage.planeH;

      // Calcula FOV e ponto inicial para preencher 100% da tela e manter a TV centralizada em formatos menores
      let targetFov = BASE_FOV;
      let startX = 0.0;
      let startY = 0.0;

      if (stage.mode === 'mobile') {
        if (aspect > stageAspect) {
          // Telas verticais mais largas ou janelas quadradas (< 860px): preenche 100% da largura sem bordas
          const neededTan = stage.planeW / (2 * Z_REF * aspect);
          targetFov = THREE.MathUtils.radToDeg(2 * Math.atan(neededTan));
          startX = stage.tvX * smoothstep(stageAspect, 1.0, aspect) * 0.45;
          startY = stage.tvY * smoothstep(stageAspect, 1.0, aspect) * 0.45;
        } else {
          // Smartphones verticais (ex: 390x844, 360x800, 412x915): exibe câmera à esquerda, TV centralizada e NO AR à direita
          const neededTan = (stage.planeW * 0.94) / (2 * Z_REF * aspect);
          targetFov = THREE.MathUtils.radToDeg(2 * Math.atan(neededTan));
          startX = stage.tvX * 0.52;
          startY = 0.0;
        }
      } else {
        if (aspect > stageAspect) {
          // Monitores ultrawide (> 16:9)
          const neededTan = stage.planeW / (2 * Z_REF * aspect);
          targetFov = THREE.MathUtils.radToDeg(2 * Math.atan(neededTan));
          startX = 0.0;
        } else {
          // Janelas intermediárias entre 1.05 e 16:9: desloca suavemente para manter a TV inteira e centralizada
          targetFov = BASE_FOV;
          startX = THREE.MathUtils.lerp(
            stage.tvX * 0.92,
            0.0,
            smoothstep(1.05, stageAspect, aspect)
          );
        }
      }

      if (
        Math.abs(camera.fov - targetFov) > 0.01 ||
        Math.abs(camera.aspect - aspect) > 0.001
      ) {
        camera.fov = targetFov;
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }

      const trackEl = trackRef.current;
      const scrollSpan = trackEl
        ? Math.max(1, trackEl.offsetHeight - vh)
        : Math.max(1, vh * 2);

      const rawProgress = Math.max(0, Math.min(1, window.scrollY / scrollSpan));
      setScrollPct(Math.round(rawProgress * 100));

      // Distância crítica exata onde os 4 cantos internos do vidro da TV saem pelas 4 bordas da janela
      const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
      const zExitVert = (stage.tvScreenH * 0.5) / tanHalfFov;
      const zExitHoriz = (stage.tvScreenW * 0.5) / (tanHalfFov * aspect);
      const zFourBorderExit = Math.min(zExitVert, zExitHoriz);
      const zEnd = zFourBorderExit * 0.84;

      const startZ = Z_REF;
      const midZ = Math.max(
        stage.mode === 'mobile' ? 0.92 : 1.28,
        zFourBorderExit * 1.62
      );

      let camX: number;
      let camY: number;
      let camZ: number;

      if (rawProgress <= 0.56) {
        const tAlign = smoothstep(0, 0.56, rawProgress);
        camX = THREE.MathUtils.lerp(startX, stage.tvX, tAlign);
        camY = THREE.MathUtils.lerp(startY, stage.tvY, tAlign);
        camZ = THREE.MathUtils.lerp(startZ, midZ, tAlign);
      } else {
        const tPush = smoothstep(0.56, 0.95, rawProgress);
        camX = stage.tvX;
        camY = stage.tvY;
        camZ = THREE.MathUtils.lerp(midZ, zEnd, tPush);
      }

      camera.position.set(camX, camY, camZ);
      camera.lookAt(camX, camY, 0);
      camera.updateMatrixWorld();

      // Checagem geométrica real dos 4 cantos da moldura interna da TV
      const halfW = stage.tvScreenW * 0.5;
      const halfH = stage.tvScreenH * 0.5;
      cornerTL.set(stage.tvX - halfW, stage.tvY + halfH, 0).project(camera);
      cornerTR.set(stage.tvX + halfW, stage.tvY + halfH, 0).project(camera);
      cornerBL.set(stage.tvX - halfW, stage.tvY - halfH, 0).project(camera);
      cornerBR.set(stage.tvX + halfW, stage.tvY - halfH, 0).project(camera);

      const minX = Math.min(cornerTL.x, cornerBL.x);
      const maxX = Math.max(cornerTR.x, cornerBR.x);
      const minY = Math.min(cornerBL.y, cornerBR.y);
      const maxY = Math.max(cornerTL.y, cornerTR.y);

      // Posiciona diretamente a caixa DOM do player nas coordenadas exatas da abertura WebGL da TV (zero matrix3d/preserve-3d)
      const leftPx = (cornerTL.x * 0.5 + 0.5) * vw;
      const rightPx = (cornerBR.x * 0.5 + 0.5) * vw;
      const topPx = (-cornerTL.y * 0.5 + 0.5) * vh;
      const bottomPx = (-cornerBR.y * 0.5 + 0.5) * vh;
      const boxW = Math.max(1, rightPx - leftPx);
      const boxH = Math.max(1, bottomPx - topPx);

      const screenEl = screenDomRef.current;
      if (screenEl) {
        screenEl.style.left = `${leftPx.toFixed(2)}px`;
        screenEl.style.top = `${topPx.toFixed(2)}px`;
        screenEl.style.width = `${boxW.toFixed(2)}px`;
        screenEl.style.height = `${boxH.toFixed(2)}px`;
      }

      const frameExitedAllFour =
        minX < -1.0 && maxX > 1.0 && minY < -1.0 && maxY > 1.0;

      if (frameExitedAllFour && !handedOffRef.current) {
        handedOffRef.current = true;
        setHandedOff(true);
        onFormRevealedChange(true);

        // Encerra apenas a ambiência sintetizada da sala 3D; a música da TV continua tocando em loop no formulário
        audioRef.current?.playTuningTransitionAndTerminate();
        setTuningFlash(true);
        if (flashTimer) window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => setTuningFlash(false), 180);
      } else if (!frameExitedAllFour && handedOffRef.current) {
        handedOffRef.current = false;
        setHandedOff(false);
        onFormRevealedChange(false);
        audioRef.current?.reviveIfUserReturnsToStudio(soundEnabledRef.current);
      }

      if (!frameExitedAllFour) {
        audioRef.current?.setScrollAdvance(rawProgress);
      }

      if (!handedOffRef.current || rawProgress < 1) {
        if (renderer) {
          renderer.render(scene, camera);
        } else {
          // Projeta as 4 camadas em perspectiva 3D usando a mesma câmera mesmo sem WebGL
          const placeDomPlane = (
            el: HTMLElement | null,
            cx: number,
            cy: number,
            z: number,
            w: number,
            h: number
          ) => {
            if (!el) return;
            if (camZ <= z + 0.06) {
              el.style.display = 'none';
              return;
            }
            el.style.display = 'block';
            const pTL = new THREE.Vector3(cx - w * 0.5, cy + h * 0.5, z).project(camera);
            const pBR = new THREE.Vector3(cx + w * 0.5, cy - h * 0.5, z).project(camera);
            const pl = (pTL.x * 0.5 + 0.5) * vw;
            const pr = (pBR.x * 0.5 + 0.5) * vw;
            const pt = (-pTL.y * 0.5 + 0.5) * vh;
            const pb = (-pBR.y * 0.5 + 0.5) * vh;
            el.style.left = `${pl.toFixed(2)}px`;
            el.style.top = `${pt.toFixed(2)}px`;
            el.style.width = `${Math.max(1, pr - pl).toFixed(2)}px`;
            el.style.height = `${Math.max(1, pb - pt).toFixed(2)}px`;
          };

          placeDomPlane(domBgImg, 0, 0, Z_BG, stage.planeW * scaleBg, stage.bgPlaneH * scaleBg);
          placeDomPlane(
            wallLogoCanvas,
            stage.logoX * scaleLogo,
            stage.logoY * scaleLogo,
            Z_LOGO,
            stage.logoW * scaleLogo,
            stage.logoH * scaleLogo
          );
          placeDomPlane(domTvImg, 0, 0, 0, stage.planeW, stage.planeH);
          placeDomPlane(
            domFgImg,
            0,
            0,
            Z_FG_TRIPOD,
            stage.planeW * scaleFg,
            stage.fgPlaneH * scaleFg
          );

          const cl = Math.max(0, leftPx).toFixed(1);
          const cr = Math.min(vw, rightPx).toFixed(1);
          const ct = Math.max(0, topPx).toFixed(1);
          const cb = Math.min(vh, bottomPx).toFixed(1);
          hostEl.style.clipPath = `polygon(0px 0px, 0px 100%, ${cl}px 100%, ${cl}px ${ct}px, ${cr}px ${ct}px, ${cr}px ${cb}px, ${cl}px ${cb}px, ${cl}px 100%, 100% 100%, 100% 0px)`;
        }
      }
    }

    const handleResize = () => {
      updateSceneForScroll();
    };

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateSceneForScroll();
      });
      resizeObserver.observe(webglHost);
    }

    let rafPending = false;
    const onScroll = () => {
      if (rafPending) return;
      rafPending = true;
      window.requestAnimationFrame(() => {
        rafPending = false;
        updateSceneForScroll();
      });
    };

    requestRenderRef.current = updateSceneForScroll;

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('scroll', onScroll);
    updateSceneForScroll();

    return () => {
      requestRenderRef.current = null;
      resizeObserver?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('scroll', onScroll);
      if (flashTimer) window.clearTimeout(flashTimer);
      for (const item of disposables) {
        item.dispose();
      }
      renderer?.dispose();
    };
  }, [isMobileStage, onFormRevealedChange]);

  // --- Estúdio 3D Fotorrealista Vinculado à Rolagem Nativa ---
  return (
    <div
      ref={trackRef}
      className="studio-scroll-track"
      data-scroll-pct={scrollPct}
      data-stage-mode={isMobileStage ? 'mobile' : 'desktop'}
      data-handed-off={handedOff ? 'true' : 'false'}
      data-music-loop={musicLoopCount}
      data-music-volume={musicVolumePct}
    >
      <div
        className={`studio-sticky-stage ${handedOff ? 'is-handed-off' : ''}`}
        aria-label="Abertura Estúdio de Gravação IMTV 3D"
      >
        <div className="studio-css3d-layer">
          <div ref={screenDomRef} className="tv-screen-dom">
            <div className="tv-aspect-inner">
              {ytUnavailable ? (
                <div className="tv-fallback-cover">
                  <p style={{ margin: 0, maxWidth: '38ch', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                    Reprodução incorporada indisponível neste navegador.
                  </p>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <a
                      href={YOUTUBE_WATCH_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm"
                    >
                      Assistir no YouTube
                    </a>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={handleSkipToForm}
                    >
                      Ir direto ao pedido
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div ref={ytMountRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
                  {ytNeedsTap && (
                    <button
                      type="button"
                      className="tv-tap-play-overlay"
                      onClick={handlePlayDirectOnTv}
                      aria-label="Dar play na própria TV"
                    >
                      <span className="tv-poster-play-pill">▶ Reproduzir</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div ref={webglLayerRef} className="studio-webgl-layer" />

        <div className={`tv-tuning-flash ${tuningFlash ? 'is-active' : ''}`} aria-hidden="true" />

        <div className="studio-hud">
          <div className="studio-hud-top">
            <div className="studio-hud-pillbar">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onToggleSound}
                aria-pressed={soundEnabled}
                data-imtv-cursor-nativo=""
                data-sound-toggle="true"
                data-testid="toggle-sound-btn"
              >
                {soundEnabled ? 'Silenciar som' : 'Ativar som'}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleSkipToForm}
              >
                Ir direto ao pedido
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onNavigateBoard}
              >
                Quadro IMTV
              </button>
            </div>
          </div>
        </div>

        <HeroGenerativeIntro
          skipImmediate={false}
          fastFinish={handedOff || introFastFinish}
        />
      </div>
    </div>
  );
}
