import React, { useEffect, useRef, useState } from 'react';

interface HeroGenerativeIntroProps {
  skipImmediate?: boolean;
  fastFinish?: boolean;
}

interface TargetBox {
  id: string;
  label: string;
  spec: string;
  x: number;
  y: number;
  w: number;
  h: number;
  startAt: number;
  endAt: number;
}

interface BitDrop {
  colX: number;
  y: number;
  speed: number;
  chars: string[];
  accent: 'amber' | 'green' | 'mono';
}

interface FlyingBit {
  sx: number;
  sy: number;
  txRatio: number;
  tyRatio: number;
  born: number;
  dur: number;
  bit: string;
  accent: boolean;
}

const INTRO_DURATION_MS = 2850;

const CODE_LINES_DESKTOP = [
  '// IMTV_STUDIO_2027.tsx · WebGL2 r187',
  'const stage = mountBroadcastHero({ fps: 60 });',
  'stage.spawn("camera-tripe-hd", { z: +1.18, fov: 38 });',
  'stage.attachTV50("yt://iTKp3kyNw4c", { loopDb: -10 });',
  'stage.lightWallSign("im\'tv Brasil", { tally: "NO AR" });',
  'cursor.bind("claquete-imtv.svg"); // [ PRONTO ]',
];

const CODE_LINES_MOBILE = [
  '// IMTV_2027 · MOBILE_3D',
  'stage.centerTV50("yt://iTKp3kyNw4c");',
  'audio.loop({ gainStepDb: -10 });',
  'tally.set("NO_AR"); // [ PRONTO ]',
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeOutCubic(t: number): number {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}

function easeInOutCubic(t: number): number {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

function drawDottedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  progress: number,
  flowOffset: number,
  color: string,
  dotRadius = 1.4,
  spacing = 7
): void {
  const p = clamp01(progress);
  if (p <= 0 || w <= 2 || h <= 2) return;

  const perim = 2 * (w + h);
  const maxDist = perim * p;

  ctx.fillStyle = color;
  for (let d = (flowOffset % spacing); d <= maxDist; d += spacing) {
    let px = x;
    let py = y;
    if (d <= w) {
      px = x + d;
      py = y;
    } else if (d <= w + h) {
      px = x + w;
      py = y + (d - w);
    } else if (d <= 2 * w + h) {
      px = x + w - (d - (w + h));
      py = y + h;
    } else {
      px = x;
      py = y + h - (d - (2 * w + h));
    }
    ctx.beginPath();
    ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCornerHandles(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number,
  highlight = false
): void {
  if (alpha <= 0.01) return;
  const sz = 6;
  const corners = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1.3;
  ctx.fillStyle = '#050608';
  ctx.strokeStyle = highlight ? '#f59e0b' : '#d8e0ea';

  // Linhas guias passando levemente além dos cantos (estilo CAD / transitions-ui-generation)
  const ext = 10;
  ctx.beginPath();
  ctx.moveTo(x - ext, y);
  ctx.lineTo(x + ext, y);
  ctx.moveTo(x, y - ext);
  ctx.lineTo(x, y + ext);

  ctx.moveTo(x + w - ext, y);
  ctx.lineTo(x + w + ext, y);
  ctx.moveTo(x + w, y - ext);
  ctx.lineTo(x + w, y + ext);

  ctx.moveTo(x + w - ext, y + h);
  ctx.lineTo(x + w + ext, y + h);
  ctx.moveTo(x + w, y + h - ext);
  ctx.lineTo(x + w, y + h + ext);

  ctx.moveTo(x - ext, y + h);
  ctx.lineTo(x + ext, y + h);
  ctx.moveTo(x, y + h - ext);
  ctx.lineTo(x, y + h + ext);
  ctx.strokeStyle = 'rgba(154, 164, 178, 0.35)';
  ctx.stroke();

  ctx.strokeStyle = highlight ? '#f59e0b' : '#e2e8f0';
  for (const [cx, cy] of corners) {
    ctx.fillRect(cx - sz / 2, cy - sz / 2, sz, sz);
    ctx.strokeRect(cx - sz / 2, cy - sz / 2, sz, sz);
  }
  ctx.restore();
}

function drawPointerCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  vw: number,
  tag: string,
  accentColor: string,
  clicking: boolean,
  isClaqueteStyle = false
): void {
  ctx.save();
  ctx.translate(x, y);

  if (clicking) {
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.strokeStyle = accentColor;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const scale = clicking ? 0.88 : 1.0;
  ctx.scale(scale, scale);

  if (isClaqueteStyle) {
    // Mini claquete vetorial com ponta âmbar em (0,0)
    ctx.fillStyle = '#f8efdc';
    ctx.strokeStyle = '#0a0d10';
    ctx.lineWidth = 1.5;

    // Corpo da claquete
    ctx.beginPath();
    ctx.roundRect(3, 9, 17, 11, 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1d2328';
    ctx.fillRect(4.5, 12.5, 14, 6.2);

    // Haste superior (fecha ao clicar)
    ctx.save();
    ctx.translate(19, 9);
    ctx.rotate(clicking ? 0 : -0.26);
    ctx.fillStyle = '#f8efdc';
    ctx.fillRect(-17, -4, 18, 4);
    ctx.fillStyle = '#14181b';
    ctx.fillRect(-13, -4, 3.5, 4);
    ctx.fillRect(-6, -4, 3.5, 4);
    ctx.restore();

    // Ponta âmbar no ponto exato
    ctx.beginPath();
    ctx.arc(2, 3, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();
  } else {
    // Seta de cursor construtor de alta precisão
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 17);
    ctx.lineTo(4.8, 13.2);
    ctx.lineTo(8.4, 20);
    ctx.lineTo(11.1, 18.6);
    ctx.lineTo(7.4, 11.8);
    ctx.lineTo(13.2, 11.8);
    ctx.closePath();
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#050709';
    ctx.stroke();
  }

  ctx.scale(1 / scale, 1 / scale);

  // Etiqueta com nome do agente/cursor + coordenada ao vivo (vira para a esquerda perto da borda direita)
  const coordText = `${tag} · ${Math.round(x)},${Math.round(y)}`;
  ctx.font = '600 10.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  const tw = ctx.measureText(coordText).width;
  const pillW = tw + 12;
  const bx = x + 18 + pillW > vw - 8 ? -(pillW + 8) : 15;
  const by = 16;

  ctx.fillStyle = 'rgba(10, 13, 18, 0.92)';
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, pillW, 19, 5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f3f5f8';
  ctx.fillText(coordText, bx + 6, by + 13);

  ctx.restore();
}

function drawReticleCursor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = '#3ddc68';
  ctx.lineWidth = 1.2;

  const r = 11;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-r - 5, 0);
  ctx.lineTo(-4, 0);
  ctx.moveTo(4, 0);
  ctx.lineTo(r + 5, 0);
  ctx.moveTo(0, -r - 5);
  ctx.lineTo(0, -4);
  ctx.moveTo(0, 4);
  ctx.lineTo(0, r + 5);
  ctx.stroke();

  ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = '#3ddc68';
  ctx.fillText(label, 15, -6);
  ctx.restore();
}

export function HeroGenerativeIntro({
  skipImmediate = false,
  fastFinish = false,
}: HeroGenerativeIntroProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [completed, setCompleted] = useState<boolean>(() => {
    if (skipImmediate) return true;
    if (typeof window === 'undefined') return true;
    return Boolean(
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );
  });

  const fastFinishRef = useRef(fastFinish);
  fastFinishRef.current = fastFinish;

  useEffect(() => {
    if (skipImmediate) {
      setCompleted(true);
    }
  }, [skipImmediate]);

  useEffect(() => {
    if (completed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCompleted(true);
      return;
    }

    let rafId = 0;
    let disposed = false;
    const startTime = performance.now();
    let accelStart: number | null = null;

    // Inicializa colunas de chuva de bits (0 / 1 / bytes hex IMTV)
    const hexPool = ['0', '1', '1', '0', '01', '10', '49', '4D', '54', '56', '27'];
    let drops: BitDrop[] = [];
    let flyingBits: FlyingBit[] = [];
    let seededWidth = 0;

    const seedParticles = (vw: number, vh: number) => {
      seededWidth = vw;
      const colStep = vw < 700 ? 34 : 42;
      const cols = Math.ceil(vw / colStep);
      drops = [];
      for (let i = 0; i < cols; i++) {
        const len = 5 + (i % 6);
        const chars: string[] = [];
        for (let k = 0; k < len; k++) {
          chars.push(hexPool[(i * 7 + k * 3) % hexPool.length]);
        }
        drops.push({
          colX: i * colStep + 14,
          y: -((i * 97) % Math.max(200, vh)),
          speed: 0.22 + ((i * 19) % 10) * 0.032,
          chars,
          accent: i % 5 === 0 ? 'amber' : i % 4 === 0 ? 'green' : 'mono',
        });
      }

      flyingBits = [];
      const totalFlying = vw < 700 ? 28 : 48;
      for (let i = 0; i < totalFlying; i++) {
        const angle = (i / totalFlying) * Math.PI * 2;
        const dist = Math.max(vw, vh) * (0.42 + (i % 5) * 0.08);
        flyingBits.push({
          sx: vw * 0.5 + Math.cos(angle) * dist,
          sy: vh * 0.5 + Math.sin(angle) * dist,
          txRatio: 0.12 + ((i * 37) % 76) / 100,
          tyRatio: 0.16 + ((i * 53) % 68) / 100,
          born: (i % 12) * 0.035,
          dur: 0.34 + (i % 5) * 0.06,
          bit: i % 3 === 0 ? '0x1B' : i % 2 === 0 ? '1' : '0',
          accent: i % 4 === 0,
        });
      }
    };

    const computeStudioBoxes = (vw: number, vh: number): TargetBox[] => {
      const isMob = vw < 860 || vw / Math.max(1, vh) < 1.05;
      const tvDom = document.querySelector('.tv-screen-dom') as HTMLElement | null;
      const hudDom = document.querySelector('.studio-hud-pillbar') as HTMLElement | null;

      const tvRect = tvDom?.getBoundingClientRect();
      const hudRect = hudDom?.getBoundingClientRect();

      const tvX = tvRect && tvRect.width > 20 ? tvRect.left : isMob ? vw * 0.25 : vw * 0.56;
      const tvY = tvRect && tvRect.height > 20 ? tvRect.top : isMob ? vh * 0.39 : vh * 0.28;
      const tvW = tvRect && tvRect.width > 20 ? tvRect.width : isMob ? vw * 0.53 : vw * 0.30;
      const tvH = tvRect && tvRect.height > 20 ? tvRect.height : isMob ? vh * 0.15 : vh * 0.31;

      const cabX = tvX - tvW * 0.075;
      const cabY = tvY - tvH * 0.13;
      const cabW = tvW * 1.15;
      const cabH = tvH * 1.66;

      const hudX = hudRect && hudRect.width > 20 ? hudRect.left : vw * 0.5 - 155;
      const hudY = hudRect && hudRect.height > 10 ? hudRect.top : 16;
      const hudW = hudRect && hudRect.width > 20 ? hudRect.width : 310;
      const hudH = hudRect && hudRect.height > 10 ? hudRect.height : 44;

      const logoW = isMob ? tvW * 0.78 : tvW * 0.64;
      const logoH = isMob ? tvH * 0.42 : tvH * 0.38;
      const logoX = tvX + (tvW - logoW) * 0.52;
      const logoY = cabY - logoH - (isMob ? 18 : 22);

      const camBox: TargetBox = isMob
        ? {
            id: 'CAM_01',
            label: 'CAM_BROADCAST_3D',
            spec: 'Z:+1.18m · LENS_HD',
            x: 6,
            y: vh * 0.46,
            w: Math.max(76, cabX - 14),
            h: vh * 0.48,
            startAt: 0.08,
            endAt: 0.42,
          }
        : {
            id: 'CAM_01',
            label: 'CAM_BROADCAST_3D',
            spec: 'Z:+1.18m · FOV 38°',
            x: vw * 0.012,
            y: vh * 0.32,
            w: vw * 0.21,
            h: vh * 0.65,
            startAt: 0.08,
            endAt: 0.40,
          };

      const noArBox: TargetBox = isMob
        ? {
            id: 'NO_AR',
            label: 'TALLY_NO_AR',
            spec: 'LIVE · ON',
            x: Math.min(vw - 54, cabX + cabW + 8),
            y: tvY + tvH * 0.36,
            w: Math.max(46, vw - (cabX + cabW + 12)),
            h: 42,
            startAt: 0.34,
            endAt: 0.60,
          }
        : {
            id: 'NO_AR',
            label: 'TALLY_NO_AR',
            spec: 'RED_NEON · ON',
            x: vw * 0.915,
            y: vh * 0.47,
            w: vw * 0.078,
            h: vh * 0.075,
            startAt: 0.34,
            endAt: 0.60,
          };

      return [
        {
          id: 'HUD',
          label: 'HUD_CONTROLS',
          spec: `${Math.round(hudW)}×${Math.round(hudH)}px`,
          x: hudX,
          y: hudY,
          w: hudW,
          h: hudH,
          startAt: 0.05,
          endAt: 0.32,
        },
        camBox,
        {
          id: 'IMTV_SIGN',
          label: 'BRAND_IMTV_BRASIL',
          spec: 'WALL_SIGN · OFICIAL',
          x: logoX,
          y: Math.max(68, logoY),
          w: logoW,
          h: logoH,
          startAt: 0.16,
          endAt: 0.46,
        },
        {
          id: 'TV_CABINET',
          label: 'TV_50_RETROPROJ',
          spec: `${Math.round(cabW)}×${Math.round(cabH)}px`,
          x: cabX,
          y: cabY,
          w: cabW,
          h: cabH,
          startAt: 0.20,
          endAt: 0.56,
        },
        {
          id: 'TV_SCREEN',
          label: 'YT_STREAM_16x9',
          spec: 'iTKp3kyNw4c · -10dB/LOOP',
          x: tvX,
          y: tvY,
          w: tvW,
          h: tvH,
          startAt: 0.28,
          endAt: 0.64,
        },
        noArBox,
      ];
    };

    const onEarlyScroll = () => {
      if (window.scrollY > 18 && accelStart === null) {
        accelStart = performance.now();
      }
    };
    window.addEventListener('scroll', onEarlyScroll, { passive: true });

    const renderFrame = (now: number) => {
      if (disposed) return;

      if (fastFinishRef.current && accelStart === null) {
        accelStart = now;
      }

      let tNorm = (now - startTime) / INTRO_DURATION_MS;
      if (accelStart !== null) {
        const fastElapsed = (now - accelStart) / 200;
        tNorm = Math.max(tNorm, 0.62 + fastElapsed * 0.42);
      }

      if (tNorm >= 1.0) {
        setCompleted(true);
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vw = canvas.parentElement?.clientWidth || window.innerWidth;
      const vh = canvas.parentElement?.clientHeight || window.innerHeight;

      if (
        canvas.width !== Math.round(vw * dpr) ||
        canvas.height !== Math.round(vh * dpr)
      ) {
        canvas.width = Math.round(vw * dpr);
        canvas.height = Math.round(vh * dpr);
      }

      if (Math.abs(vw - seededWidth) > 40 || drops.length === 0) {
        seedParticles(vw, vh);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);

      // Fase de varredura de cima para baixo (0.58 -> 0.99): acima de scanY o estúdio 3D real aparece limpo!
      const revealP = easeInOutCubic((tNorm - 0.58) / 0.40);
      const scanY = revealP * vh;

      ctx.save();
      if (scanY > 0.5) {
        ctx.beginPath();
        ctx.rect(0, scanY, vw, Math.max(0, vh - scanY));
        ctx.clip();
      }

      // Fundo preto-carvão digital da camada de construção
      ctx.fillStyle = '#050609';
      ctx.fillRect(0, 0, vw, vh);

      const boxes = computeStudioBoxes(vw, vh);
      const tvBox = boxes[4];
      const originX = tvBox.x + tvBox.w * 0.5;
      const originY = tvBox.y + tvBox.h * 0.5;

      // 1. Campo de pontos (Dot Field) expandindo a partir do centro da TV + feixe de sondagem (Probe)
      const rippleRadius = easeOutCubic(tNorm / 0.34) * Math.hypot(vw, vh);
      const probeX = easeOutCubic((tNorm - 0.02) / 0.28) * vw;
      const gridStep = vw < 700 ? 26 : 32;

      for (let gx = 16; gx < vw; gx += gridStep) {
        for (let gy = 16; gy < vh; gy += gridStep) {
          const dist = Math.hypot(gx - originX, gy - originY);
          if (dist > rippleRadius) continue;
          const nearProbe = Math.abs(gx - probeX) < 28 && tNorm < 0.34;
          ctx.fillStyle = nearProbe
            ? 'rgba(245, 158, 11, 0.72)'
            : 'rgba(148, 163, 184, 0.16)';
          const r = nearProbe ? 1.8 : 1.05;
          ctx.fillRect(gx - r * 0.5, gy - r * 0.5, r, r);
        }
      }

      // 2. Colunas de BITS (0 / 1 / bytes hexadecimais)
      ctx.font = '500 10.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      const elapsedMs = now - startTime;
      for (const drop of drops) {
        const headY = ((drop.y + elapsedMs * drop.speed) % (vh + 160)) - 60;
        for (let i = 0; i < drop.chars.length; i++) {
          const cy = headY - i * 14;
          if (cy < -14 || cy > vh + 14) continue;
          const fade = (1 - i / drop.chars.length) * 0.36;
          if (i === 0 && drop.accent === 'amber') {
            ctx.fillStyle = `rgba(245, 158, 11, ${fade * 1.9})`;
          } else if (i === 0 && drop.accent === 'green') {
            ctx.fillStyle = `rgba(61, 220, 104, ${fade * 1.8})`;
          } else {
            ctx.fillStyle = `rgba(148, 163, 184, ${fade})`;
          }
          ctx.fillText(drop.chars[i], drop.colX, cy);
        }
      }

      // Pacotes de bits convergindo para os objetos do estúdio
      for (const fb of flyingBits) {
        const localP = (tNorm - fb.born) / fb.dur;
        if (localP <= 0 || localP >= 1) continue;
        const ep = easeOutCubic(localP);
        const px = fb.sx + (vw * fb.txRatio - fb.sx) * ep;
        const py = fb.sy + (vh * fb.tyRatio - fb.sy) * ep;
        ctx.fillStyle = fb.accent
          ? `rgba(245, 158, 11, ${(1 - ep * 0.5) * 0.85})`
          : `rgba(203, 213, 225, ${(1 - ep * 0.5) * 0.55})`;
        ctx.fillText(fb.bit, px, py);
      }

      // 3. Wireframes pontilhados dos elementos reais do estúdio 3D
      const flowOffset = elapsedMs * 0.045;
      for (const b of boxes) {
        const bp = easeOutCubic((tNorm - b.startAt) / (b.endAt - b.startAt));
        if (bp <= 0) continue;

        const isPrimary = b.id === 'TV_SCREEN' || b.id === 'IMTV_SIGN';
        drawDottedRect(
          ctx,
          b.x,
          b.y,
          b.w,
          b.h,
          bp,
          flowOffset,
          isPrimary ? 'rgba(245, 158, 11, 0.86)' : 'rgba(203, 213, 225, 0.72)',
          isPrimary ? 1.55 : 1.25,
          7
        );

        drawCornerHandles(ctx, b.x, b.y, b.w, b.h, Math.min(1, bp * 1.4), isPrimary);

        // Detalhes internos da TV 50" (grade de som, botões físicos e mira 16:9) e do tripé
        if (b.id === 'TV_CABINET' && bp > 0.35) {
          const consoleTop = b.y + b.h * 0.69;
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.34)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.strokeRect(b.x + 8, consoleTop, b.w - 16, b.h * 0.25);
          // Grade de alto-falantes + botões
          for (let s = 1; s <= 3; s++) {
            const ly = consoleTop + (b.h * 0.22 * s) / 4;
            ctx.beginPath();
            ctx.moveTo(b.x + 14, ly);
            ctx.lineTo(b.x + b.w - 14, ly);
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }

        if (b.id === 'TV_SCREEN' && bp > 0.4) {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.22)';
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x + b.w, b.y + b.h);
          ctx.moveTo(b.x + b.w, b.y);
          ctx.lineTo(b.x, b.y + b.h);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (b.id === 'CAM_01' && bp > 0.35) {
          // Desenha silhueta geométrica da lente + 3 pernas do tripé
          const headX = b.x + b.w * 0.42;
          const headY = b.y + b.h * 0.42;
          ctx.strokeStyle = 'rgba(203, 213, 225, 0.42)';
          ctx.setLineDash([3, 4]);
          ctx.strokeRect(b.x + 6, b.y + 8, b.w * 0.68, b.h * 0.30);
          ctx.beginPath();
          ctx.moveTo(headX, headY);
          ctx.lineTo(b.x + 6, b.y + b.h);
          ctx.moveTo(headX, headY);
          ctx.lineTo(b.x + b.w * 0.46, b.y + b.h);
          ctx.moveTo(headX, headY);
          ctx.lineTo(b.x + b.w * 0.94, b.y + b.h);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Rótulo técnico de cada peça do estúdio
        if (bp > 0.25) {
          ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
          ctx.fillStyle = isPrimary ? '#f59e0b' : '#94a3b8';
          const tagStr = `${b.label} // ${b.spec}`;
          ctx.fillText(tagStr, b.x + 4, Math.max(14, b.y - 6));
        }
      }

      // 4. Painel de CÓDIGOS transmitindo a construção do estúdio em tempo real
      const isMob = vw < 860 || vw / Math.max(1, vh) < 1.05;
      const lines = isMob ? CODE_LINES_MOBILE : CODE_LINES_DESKTOP;
      const codeProgress = clamp01((tNorm - 0.04) / 0.62);
      const totalChars = lines.reduce((acc, l) => acc + l.length, 0);
      let remainingChars = Math.floor(totalChars * easeOutCubic(codeProgress));

      const panelX = isMob ? 14 : 24;
      const panelY = isMob ? 68 : 74;
      const panelW = isMob ? Math.min(vw - 28, 336) : 418;
      const lineH = isMob ? 16 : 18;
      const panelH = lines.length * lineH + 38;

      ctx.fillStyle = 'rgba(9, 12, 17, 0.86)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(panelX, panelY, panelW, panelH, 8);
      ctx.fill();
      ctx.stroke();

      // Cabeçalho do terminal de código
      ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.fillStyle = '#3ddc68';
      ctx.fillText(
        `● IMTV.CODE // ${Math.min(100, Math.round(codeProgress * 100))}% BUILD`,
        panelX + 12,
        panelY + 17
      );

      ctx.font = `${isMob ? '10.5px' : '11.5px'} ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      let caretX = panelX + 12;
      let caretY = panelY + 34;

      for (let idx = 0; idx < lines.length; idx++) {
        if (remainingChars <= 0) break;
        const full = lines[idx];
        const take = Math.min(full.length, remainingChars);
        const slice = full.slice(0, take);
        remainingChars -= take;

        const ly = panelY + 35 + idx * lineH;
        ctx.fillStyle = idx === 0 ? '#64748b' : slice.includes('PRONTO') ? '#3ddc68' : '#e2e8f0';
        ctx.fillText(slice, panelX + 12, ly);

        caretX = panelX + 12 + ctx.measureText(slice).width + 2;
        caretY = ly;
      }

      if (Math.floor(now / 140) % 2 === 0) {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(caretX, caretY - 10, 6, 12);
      }

      // Painel inferior direito de módulos (AGENT.LOG) em telas desktop
      if (!isMob) {
        const logW = 286;
        const logH = 128;
        const logX = vw - logW - 24;
        const logY = vh - logH - 24;

        ctx.fillStyle = 'rgba(9, 12, 17, 0.86)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        ctx.roundRect(logX, logY, logW, logH, 8);
        ctx.fill();
        ctx.stroke();

        ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('STUDIO.MODULES // BITS -> 3D', logX + 12, logY + 18);

        const modItems = [
          { name: '01 CAM_TRIPE_3D', at: 0.25 },
          { name: '02 LOGO_IMTV_WALL', at: 0.38 },
          { name: '03 TV_50_YOUTUBE', at: 0.50 },
          { name: '04 LOOP_AUDIO_-10DB', at: 0.60 },
          { name: '05 CURSOR_CLAQUETE', at: 0.68 },
        ];
        ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        modItems.forEach((m, i) => {
          const done = tNorm >= m.at;
          const my = logY + 38 + i * 17;
          ctx.fillStyle = done ? '#cbd5e1' : '#475569';
          ctx.fillText(m.name, logX + 12, my);
          ctx.fillStyle = done ? '#3ddc68' : '#f59e0b';
          ctx.fillText(done ? '[ OK ]' : '[ .. ]', logX + logW - 54, my);
        });
      }

      // 5. Esquadrão de CURSORES autônomos montando as peças
      const waypointsA = [
        { x: vw * 0.12, y: vh * 0.78 },
        { x: boxes[1].x + boxes[1].w * 0.65, y: boxes[1].y + 18 },
        { x: boxes[2].x + boxes[2].w * 0.5, y: boxes[2].y + boxes[2].h * 0.5 },
        { x: tvBox.x + tvBox.w * 0.15, y: tvBox.y + 12 },
        { x: tvBox.x + tvBox.w - 8, y: tvBox.y + tvBox.h - 8 },
      ];
      const segA = Math.min(waypointsA.length - 2, Math.floor(clamp01(tNorm / 0.78) * (waypointsA.length - 1)));
      const localA = easeInOutCubic(
        clamp01(tNorm / 0.78) * (waypointsA.length - 1) - segA
      );
      const curAx =
        waypointsA[segA].x + (waypointsA[segA + 1].x - waypointsA[segA].x) * localA;
      const curAy =
        waypointsA[segA].y + (waypointsA[segA + 1].y - waypointsA[segA].y) * localA;
      const clickA = localA > 0.84 || localA < 0.08;

      const waypointsB = [
        { x: vw * 0.85, y: vh * 0.14 },
        { x: boxes[0].x + boxes[0].w - 12, y: boxes[0].y + boxes[0].h * 0.5 },
        { x: boxes[3].x + boxes[3].w, y: boxes[3].y + 10 },
        { x: boxes[5].x + boxes[5].w * 0.5, y: boxes[5].y + boxes[5].h * 0.5 },
        { x: boxes[3].x + boxes[3].w * 0.5, y: boxes[3].y + boxes[3].h * 0.82 },
      ];
      const segB = Math.min(waypointsB.length - 2, Math.floor(clamp01(tNorm / 0.76) * (waypointsB.length - 1)));
      const localB = easeInOutCubic(
        clamp01(tNorm / 0.76) * (waypointsB.length - 1) - segB
      );
      const curBx =
        waypointsB[segB].x + (waypointsB[segB + 1].x - waypointsB[segB].x) * localB;
      const curBy =
        waypointsB[segB].y + (waypointsB[segB + 1].y - waypointsB[segB].y) * localB;
      const clickB = localB > 0.85 || localB < 0.08;

      // Mira de calibração na tela da TV
      const retAngle = elapsedMs * 0.0038;
      const retX = originX + Math.cos(retAngle) * (tvBox.w * 0.32);
      const retY = originY + Math.sin(retAngle * 1.4) * (tvBox.h * 0.28);
      drawReticleCursor(ctx, retX, retY, `SYNC_BITS // ${Math.round(tNorm * 1024)} KB`);

      drawPointerCursor(ctx, curBx, curBy, vw, 'Código.ts', '#3ddc68', clickB, false);
      drawPointerCursor(ctx, curAx, curAy, vw, 'Claquete.3D', '#f59e0b', clickA, true);

      ctx.restore();

      // 6. Feixe luminoso de varredura (Scanline) revelando o estúdio fotorrealista acima dele
      if (revealP > 0.005 && revealP < 0.998) {
        const grad = ctx.createLinearGradient(0, scanY - 26, 0, scanY + 18);
        grad.addColorStop(0, 'rgba(245, 158, 11, 0)');
        grad.addColorStop(0.58, 'rgba(245, 158, 11, 0.34)');
        grad.addColorStop(0.75, 'rgba(255, 237, 213, 0.95)');
        grad.addColorStop(1, 'rgba(61, 220, 104, 0)');

        ctx.fillStyle = grad;
        ctx.fillRect(0, scanY - 26, vw, 44);

        ctx.fillStyle = '#fff7ed';
        ctx.fillRect(0, scanY - 1, vw, 2);
      }

      rafId = window.requestAnimationFrame(renderFrame);
    };

    rafId = window.requestAnimationFrame(renderFrame);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onEarlyScroll);
    };
  }, [completed]);

  if (completed) return null;

  return (
    <canvas
      ref={canvasRef}
      className="hero-gen-intro-canvas"
      aria-hidden="true"
      data-testid="hero-generative-intro"
    />
  );
}
