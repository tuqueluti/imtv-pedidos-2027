import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import {
  CSS3DRenderer,
  CSS3DObject,
} from 'three/addons/renderers/CSS3DRenderer.js';
import { StudioOpeningAudio } from '../audio/studioAudio.ts';
import { assetUrl } from '../api/clientApi.ts';
import { ImtvLogo } from './ImtvLogo.tsx';

const YOUTUBE_VIDEO_ID = 'iTKp3kyNw4c';
const YOUTUBE_WATCH_URL = `https://www.youtube.com/watch?v=${YOUTUBE_VIDEO_ID}`;

/**
 * Geometria exata medida na imagem de referência do estúdio (1024 x 576 = 16:9):
 * Plano de referência em z = 0 com altura PLANE_H = 2.0m e largura PLANE_W = 3.555556m.
 * - Vidro interno da TV 50": px [577..883], py [162..339]
 * - Logo oficial IMTV na parede preta acima da TV: px [646..814], py [58..116]
 * - Câmera em tripé em primeiro plano: z = +1.18m (passa pela borda esquerda ao rolar)
 * - Estúdio / chroma key / refletor / case NO AR ao fundo: z = -0.95m (desloca mais devagar)
 */
const PLANE_H = 2.0;
const PLANE_W = (PLANE_H * 16) / 9; // 3.555556m

const TV_X = ((730.0 / 1024.0) - 0.5) * PLANE_W;       // +0.75694m
const TV_Y = (0.5 - (250.5 / 576.0)) * PLANE_H;        // +0.13021m
const TV_SCREEN_W = (306.0 / 1024.0) * PLANE_W;        // 1.06250m
const TV_SCREEN_H = (177.0 / 576.0) * PLANE_H;         // 0.61458m

const LOGO_X = ((730.0 / 1024.0) - 0.5) * PLANE_W;     // +0.75694m (centralizado acima da TV)
const LOGO_Y = (0.5 - (88.0 / 576.0)) * PLANE_H;       // +0.69444m
const LOGO_W = (196.0 / 1024.0) * PLANE_W;             // 0.68056m
const LOGO_H = (70.0 / 576.0) * PLANE_H;               // 0.24306m

const BASE_FOV = 38;
const TAN_HALF_BASE_FOV = Math.tan(THREE.MathUtils.degToRad(BASE_FOV * 0.5));
// Distância de projeção onde um plano 16:9 de altura 2.0m preenche exatamente o campo vertical
const Z_REF = PLANE_H / (2 * TAN_HALF_BASE_FOV);       // ~2.9042m

const Z_BG = -0.95;
const Z_LOGO = -0.12;
const Z_FG_TRIPOD = 1.18;

const DOM_SCREEN_PX_W = 960;
const DOM_SCREEN_PX_H = Math.round(DOM_SCREEN_PX_W * (TV_SCREEN_H / TV_SCREEN_W)); // 555px

interface YTPlayerInstance {
  playVideo?: () => void;
  pauseVideo?: () => void;
  mute?: () => void;
  unMute?: () => void;
  setVolume?: (v: number) => void;
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

/**
 * Desenha a identificação física da IMTV diretamente sobre fundo transparente na parede preta
 * (preservando cores, proporções e área de respiro, com leve luz quente do refletor direito,
 * ou exibindo "IMTV" em texto caso o arquivo esteja pendente).
 */
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
    const maxW = w * 0.82;
    const maxH = h * 0.76;
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;
    const dx = (w - drawW) / 2;
    const dy = (h - drawH) / 2;
    ctx.globalAlpha = 0.92;
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
  useLiteMode: boolean;
  onFormRevealedChange: (revealed: boolean) => void;
  onJumpToOrder: () => void;
  onNavigateBoard: () => void;
}

export function StudioOpening3D({
  logoUrl,
  useLiteMode,
  onFormRevealedChange,
  onJumpToOrder,
  onNavigateBoard,
}: StudioOpening3DProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const cssLayerRef = useRef<HTMLDivElement | null>(null);
  const webglLayerRef = useRef<HTMLDivElement | null>(null);
  const ytMountRef = useRef<HTMLDivElement | null>(null);
  const liteYtMountRef = useRef<HTMLDivElement | null>(null);

  const audioRef = useRef<StudioOpeningAudio | null>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const wallLogoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wallLogoTexRef = useRef<THREE.CanvasTexture | null>(null);
  const requestRenderRef = useRef<(() => void) | null>(null);

  const [soundEnabled, setSoundEnabled] = useState(false);
  const soundEnabledRef = useRef(false);
  const [ytUnavailable, setYtUnavailable] = useState(false);
  const [ytNeedsTap, setYtNeedsTap] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const handedOffRef = useRef(false);
  const [tuningFlash, setTuningFlash] = useState(false);
  const [scrollPct, setScrollPct] = useState(0);
  const [portalScreenEl, setPortalScreenEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const audio = new StudioOpeningAudio();
    audioRef.current = audio;
    return () => {
      audio.dispose();
      audioRef.current = null;
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
  }, [logoUrl]);

  const handleToggleSound = useCallback(() => {
    const next = !soundEnabledRef.current;
    soundEnabledRef.current = next;
    setSoundEnabled(next);

    if (next) {
      audioRef.current?.enableSound();
      try {
        ytPlayerRef.current?.unMute?.();
        ytPlayerRef.current?.setVolume?.(70);
        ytPlayerRef.current?.playVideo?.();
        setYtNeedsTap(false);
      } catch {
        // ignore
      }
    } else {
      audioRef.current?.disableSound();
      try {
        ytPlayerRef.current?.mute?.();
      } catch {
        // ignore
      }
    }
  }, []);

  const handleSkipToForm = useCallback(() => {
    try {
      ytPlayerRef.current?.pauseVideo?.();
    } catch {
      // ignore
    }
    audioRef.current?.stopAllImmediately();
    soundEnabledRef.current = false;
    setSoundEnabled(false);
    onJumpToOrder();
  }, [onJumpToOrder]);

  const handlePlayDirectOnTv = useCallback(() => {
    setYtNeedsTap(false);
    try {
      ytPlayerRef.current?.playVideo?.();
    } catch {
      // ignore
    }
  }, []);

  // Monta o player oficial do YouTube preservando proporção 16:9 no vidro da TV
  useEffect(() => {
    const mountParent = useLiteMode ? liteYtMountRef.current : ytMountRef.current;
    if (!mountParent) return;

    let disposed = false;
    let autoplayCheckTimer: number | null = null;
    setYtUnavailable(false);
    setYtNeedsTap(useLiteMode);

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

      try {
        const player = new window.YT.Player(playerHost, {
          videoId: YOUTUBE_VIDEO_ID,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: useLiteMode ? 0 : 1,
            mute: 1,
            controls: 1,
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
            loop: 1,
            playlist: YOUTUBE_VIDEO_ID,
            origin: window.location.origin,
          },
          events: {
            onReady: (ev: { target: YTPlayerInstance }) => {
              if (disposed) return;
              ev.target.mute?.();
              if (!useLiteMode && !handedOffRef.current) {
                ev.target.playVideo?.();
                autoplayCheckTimer = window.setTimeout(() => {
                  if (disposed) return;
                  const st = ev.target.getPlayerState?.();
                  // 1 = PLAYING, 3 = BUFFERING
                  if (st !== 1 && st !== 3) {
                    setYtNeedsTap(true);
                  }
                }, 1600);
              }
            },
            onStateChange: (ev: { data: number }) => {
              if (disposed) return;
              if (ev.data === 1 || ev.data === 3) {
                setYtNeedsTap(false);
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
      if (autoplayCheckTimer) window.clearTimeout(autoplayCheckTimer);
      try {
        ytPlayerRef.current?.destroy?.();
      } catch {
        // ignore
      }
      ytPlayerRef.current = null;
    };
  }, [useLiteMode, portalScreenEl]);

  // Cena 3D Multi-Plano Fotorrealista em Three.js r187
  useEffect(() => {
    if (useLiteMode) {
      setPortalScreenEl(null);
      onFormRevealedChange(true);
      return;
    }

    const cssHost = cssLayerRef.current;
    const webglHost = webglLayerRef.current;
    if (!cssHost || !webglHost) return;

    const screenDom = document.createElement('div');
    screenDom.className = 'tv-screen-dom';
    screenDom.style.width = `${DOM_SCREEN_PX_W}px`;
    screenDom.style.height = `${DOM_SCREEN_PX_H}px`;
    setPortalScreenEl(screenDom);

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
    const cssScene = new THREE.Scene();

    const width = webglHost.clientWidth || window.innerWidth;
    const height = webglHost.clientHeight || window.innerHeight;

    const camera = new THREE.PerspectiveCamera(BASE_FOV, width / height, 0.06, 25);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x050608, 1);

    webglHost.innerHTML = '';
    webglHost.appendChild(renderer.domElement);

    const cssRenderer = new CSS3DRenderer();
    cssRenderer.setSize(width, height);
    cssHost.innerHTML = '';
    cssHost.appendChild(cssRenderer.domElement);

    const cssScreenObj = new CSS3DObject(screenDom);
    cssScreenObj.position.set(TV_X, TV_Y, 0);
    cssScreenObj.scale.setScalar(TV_SCREEN_W / DOM_SCREEN_PX_W);
    cssScene.add(cssScreenObj);

    const loader = new THREE.TextureLoader();
    const onTexLoaded = (tex: THREE.Texture) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      updateSceneForScroll();
    };

    // --- Camada 1: Estúdio ao Fundo (z = -0.95m, desloca mais devagar na rolagem) ---
    const scaleBg = (Z_REF - Z_BG) / Z_REF;
    const bgTex = trackTex(loader.load(assetUrl('/studio/studio-bg-stage.jpg'), onTexLoaded));
    bgTex.colorSpace = THREE.SRGBColorSpace;
    const bgMat = trackMat(
      new THREE.MeshBasicMaterial({
        map: bgTex,
        depthWrite: true,
      })
    );
    const bgMesh = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(PLANE_W * scaleBg, PLANE_H * scaleBg)),
      bgMat
    );
    bgMesh.position.set(0, 0, Z_BG);
    bgMesh.renderOrder = 1;
    scene.add(bgMesh);

    // --- Camada 2: Identificação Física Dinâmica da IMTV na Parede Preta (z = -0.12m) ---
    const scaleLogo = (Z_REF - Z_LOGO) / Z_REF;
    const wallLogoCanvas = document.createElement('canvas');
    wallLogoCanvas.width = 768;
    wallLogoCanvas.height = 274;
    wallLogoCanvasRef.current = wallLogoCanvas;
    renderWallSignCanvas(wallLogoCanvas, null);

    const wallLogoTex = trackTex(new THREE.CanvasTexture(wallLogoCanvas));
    wallLogoTex.colorSpace = THREE.SRGBColorSpace;
    wallLogoTexRef.current = wallLogoTex;

    if (logoUrl) {
      const initImg = new Image();
      initImg.crossOrigin = 'anonymous';
      initImg.onload = () => {
        renderWallSignCanvas(wallLogoCanvas, initImg);
        wallLogoTex.needsUpdate = true;
        updateSceneForScroll();
      };
      initImg.src = logoUrl;
    }

    const wallLogoMat = trackMat(
      new THREE.MeshBasicMaterial({
        map: wallLogoTex,
        transparent: true,
        depthWrite: false,
      })
    );
    const wallLogoMesh = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(LOGO_W * scaleLogo, LOGO_H * scaleLogo)),
      wallLogoMat
    );
    wallLogoMesh.position.set(LOGO_X * scaleLogo, LOGO_Y * scaleLogo, Z_LOGO);
    wallLogoMesh.renderOrder = 2;
    scene.add(wallLogoMesh);

    // --- Camada 3: Gabinete Profundo 3D + Frente da TV de Retroprojeção 50" (z = 0.00m) ---
    const deepCabinetMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x0b0b0d,
      })
    );
    const deepCabinetBox = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(1.04, 0.84, 0.34)),
      deepCabinetMat
    );
    deepCabinetBox.position.set(TV_X, TV_Y - 0.14, -0.18);
    deepCabinetBox.renderOrder = 2;
    scene.add(deepCabinetBox);

    // Janela Alpha=0 exata no vidro da TV (revela o player oficial do YouTube alinhado em perspectiva)
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
      trackGeo(new THREE.PlaneGeometry(TV_SCREEN_W, TV_SCREEN_H)),
      punchMat
    );
    screenAperture.position.set(TV_X, TV_Y, -0.001);
    screenAperture.renderOrder = 3;
    scene.add(screenAperture);

    const tvTex = trackTex(loader.load(assetUrl('/studio/studio-mid-tv.webp'), onTexLoaded));
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
      trackGeo(new THREE.PlaneGeometry(PLANE_W, PLANE_H)),
      tvMat
    );
    tvMesh.position.set(0, 0, 0);
    tvMesh.renderOrder = 4;
    scene.add(tvMesh);

    // --- Camada 4: Câmera de Estúdio sobre Tripé Próxima ao Visitante (z = +1.18m) ---
    const scaleFg = (Z_REF - Z_FG_TRIPOD) / Z_REF;
    const fgTex = trackTex(loader.load(assetUrl('/studio/studio-fg-tripod.webp'), onTexLoaded));
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
      trackGeo(new THREE.PlaneGeometry(PLANE_W * scaleFg, PLANE_H * scaleFg)),
      fgMat
    );
    fgTripodMesh.position.set(0, 0, Z_FG_TRIPOD);
    fgTripodMesh.renderOrder = 5;
    scene.add(fgTripodMesh);

    // --- Matemática determinística de câmera vinculada à rolagem nativa ---
    const cornerTL = new THREE.Vector3();
    const cornerTR = new THREE.Vector3();
    const cornerBL = new THREE.Vector3();
    const cornerBR = new THREE.Vector3();
    let flashTimer: number | null = null;

    function updateSceneForScroll() {
      const hostEl = webglLayerRef.current;
      if (!hostEl) return;
      const vw = hostEl.clientWidth || window.innerWidth;
      const vh = hostEl.clientHeight || window.innerHeight;
      const aspect = vw / Math.max(1, vh);
      const isPortrait = aspect < 1.0;

      // Ajusta FOV para que em qualquer monitor wide o quadro inicial seja 100% preenchido (sem barras)
      let targetFov = BASE_FOV;
      if (!isPortrait && aspect > 16 / 9) {
        // Para telas ultrawide (> 16:9), reduz FOV vertical para que a largura da cena cubra 100% da janela
        const neededTan = PLANE_W / (2 * Z_REF * aspect);
        targetFov = THREE.MathUtils.radToDeg(2 * Math.atan(neededTan));
      } else if (isPortrait) {
        targetFov = 46;
      }

      if (Math.abs(camera.fov - targetFov) > 0.01 || Math.abs(camera.aspect - aspect) > 0.001) {
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
      const zExitVert = (TV_SCREEN_H * 0.5) / tanHalfFov;
      const zExitHoriz = (TV_SCREEN_W * 0.5) / (tanHalfFov * aspect);
      const zFourBorderExit = Math.min(zExitVert, zExitHoriz);
      const zEnd = zFourBorderExit * 0.84;

      const startX = isPortrait ? 0.54 : 0.0;
      const startY = isPortrait ? 0.05 : 0.0;
      const startZ = isPortrait ? 2.90 : Z_REF;
      const midZ = Math.max(1.28, zFourBorderExit * 1.62);

      // Fase 1 (0 -> 0.56): Tripé passa pela borda esquerda, fundo desloca mais devagar,
      // câmera alinha perpendicularmente ao centro exato do vidro da TV (TV_X, TV_Y)
      let camX: number;
      let camY: number;
      let camZ: number;

      if (rawProgress <= 0.56) {
        const tAlign = smoothstep(0, 0.56, rawProgress);
        camX = THREE.MathUtils.lerp(startX, TV_X, tAlign);
        camY = THREE.MathUtils.lerp(startY, TV_Y, tAlign);
        camZ = THREE.MathUtils.lerp(startZ, midZ, tAlign);
      } else {
        // Fase 2 (0.56 -> 0.96): Avanço 100% perpendicular ao vidro até a moldura sair pelas 4 bordas
        const tPush = smoothstep(0.56, 0.95, rawProgress);
        camX = TV_X;
        camY = TV_Y;
        camZ = THREE.MathUtils.lerp(midZ, zEnd, tPush);
      }

      // Câmera sempre olha perpendicularmente ao plano z=0 (mantendo linhas verticais perfeitas e zero distorção)
      camera.position.set(camX, camY, camZ);
      camera.lookAt(camX, camY, 0);
      camera.updateMatrixWorld();

      // Checagem geométrica real dos 4 cantos da moldura interna da TV
      const halfW = TV_SCREEN_W * 0.5;
      const halfH = TV_SCREEN_H * 0.5;
      cornerTL.set(TV_X - halfW, TV_Y + halfH, 0).project(camera);
      cornerTR.set(TV_X + halfW, TV_Y + halfH, 0).project(camera);
      cornerBL.set(TV_X - halfW, TV_Y - halfH, 0).project(camera);
      cornerBR.set(TV_X + halfW, TV_Y - halfH, 0).project(camera);

      const minX = Math.min(cornerTL.x, cornerBL.x);
      const maxX = Math.max(cornerTR.x, cornerBR.x);
      const minY = Math.min(cornerBL.y, cornerBR.y);
      const maxY = Math.max(cornerTL.y, cornerTR.y);

      const frameExitedAllFour =
        minX < -1.0 && maxX > 1.0 && minY < -1.0 && maxY > 1.0;

      if (frameExitedAllFour && !handedOffRef.current) {
        handedOffRef.current = true;
        setHandedOff(true);
        onFormRevealedChange(true);

        try {
          ytPlayerRef.current?.pauseVideo?.();
        } catch {
          // ignore
        }

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
        renderer.render(scene, camera);
        cssRenderer.render(cssScene, camera);
      }
    }

    const handleResize = () => {
      const w = webglHost.clientWidth || window.innerWidth;
      const h = webglHost.clientHeight || window.innerHeight;
      renderer.setSize(w, h);
      cssRenderer.setSize(w, h);
      updateSceneForScroll();
    };

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
    updateSceneForScroll();

    return () => {
      requestRenderRef.current = null;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', handleResize);
      if (flashTimer) window.clearTimeout(flashTimer);
      setPortalScreenEl(null);
      for (const item of disposables) {
        item.dispose();
      }
      renderer.dispose();
    };
  }, [useLiteMode, onFormRevealedChange]);

  // --- Vista Leve da TV (Reduced Motion ou aparelhos de menor desempenho) ---
  if (useLiteMode) {
    return (
      <header
        className="studio-lite-hero"
        aria-label="Estúdio IMTV 2027"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(6, 8, 10, 0.52) 0%, #06080a 100%), url("${assetUrl('/studio/studio-bg-stage.jpg')}")`,
        }}
      >
        <div className="studio-lite-inner">
          <div className="studio-hud-top">
            <div className="studio-hud-pillbar">
              <ImtvLogo logoUrl={logoUrl} size="sm" />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleToggleSound}
                aria-pressed={soundEnabled}
              >
                {soundEnabled ? 'Desativar som' : 'Ativar som'}
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

          <div className="studio-lite-tv-cabinet">
            <div className="studio-lite-tv-glass">
              {ytUnavailable ? (
                <div className="tv-fallback-cover">
                  <p style={{ margin: 0, maxWidth: '40ch', color: 'var(--text-secondary)' }}>
                    Incorporação indisponível neste navegador.
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
                  <div ref={liteYtMountRef} style={{ width: '100%', height: '100%' }} />
                  {ytNeedsTap && (
                    <button
                      type="button"
                      className="tv-tap-play-overlay"
                      onClick={handlePlayDirectOnTv}
                      aria-label="Reproduzir vídeo da IMTV na TV"
                    >
                      <span className="tv-poster-play-pill">▶ Reproduzir na TV</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </header>
    );
  }

  // --- Estúdio 3D Fotorrealista Vinculado à Rolagem Nativa ---
  return (
    <div
      ref={trackRef}
      className="studio-scroll-track"
      data-scroll-pct={scrollPct}
      data-handed-off={handedOff ? 'true' : 'false'}
    >
      <div
        className={`studio-sticky-stage ${handedOff ? 'is-handed-off' : ''}`}
        aria-label="Abertura Estúdio de Gravação IMTV 3D"
      >
        {/* Camada CSS3D: Player oficial do YouTube encaixado no vidro da TV de 50" */}
        <div ref={cssLayerRef} className="studio-css3d-layer" />

        {portalScreenEl &&
          createPortal(
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
                  <div ref={ytMountRef} style={{ width: '100%', height: '100%' }} />
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
            </div>,
            portalScreenEl
          )}

        {/* Camada WebGL Three.js r187 (tripé em 1º plano, TV 50", logo IMTV dinâmico e estúdio chroma/NO AR) */}
        <div ref={webglLayerRef} className="studio-webgl-layer" />

        {/* Flash curto de sintonia na transição exata para o formulário */}
        <div className={`tv-tuning-flash ${tuningFlash ? 'is-active' : ''}`} aria-hidden="true" />

        {/* Barra superior centralizada e clean desde o primeiro quadro */}
        <div className="studio-hud">
          <div className="studio-hud-top">
            <div className="studio-hud-pillbar">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleToggleSound}
                aria-pressed={soundEnabled}
              >
                {soundEnabled ? 'Desativar som' : 'Ativar som'}
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
      </div>
    </div>
  );
}
