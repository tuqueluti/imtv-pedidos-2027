(() => {
  "use strict";

  // Carregar como script clássico com defer; os arquivos ficam juntos.
  const script = document.currentScript;
  if (!script?.src || !window.PointerEvent) return;
  const marker = "data-imtv-claquete";
  const setup = Symbol.for("imtv.cursor.claquete");
  if (window[setup]) return;
  window[setup] = true;

  const audioUrl = new URL("./claquete.wav", script.src);
  const desktop = matchMedia("(hover: hover) and (pointer: fine)");
  const normalCursors = new Set(["auto", "default", "pointer"]);
  const nativeControls = [
    "input:not([type=button]):not([type=submit]):not([type=reset])",
    "textarea", "select", "[contenteditable]:not([contenteditable=false])",
    ":disabled", "[aria-disabled=true]", "[draggable=true]", "[role=slider]",
    "iframe", "video[controls]", "audio[controls]", "[data-imtv-cursor-nativo]"
  ].join(",");
  const minClosedMs = 80;
  let hovered = null;
  let decorated = null;
  let pressedId = null;
  let closedSince = 0;
  let reopenTimer = 0;
  let soundEnabled = false;
  let sound = null;
  let cursorPreloaded = false;

  function preloadCursors() {
    if (cursorPreloaded || !desktop.matches) return;
    cursorPreloaded = true;
    for (const name of ["claquete-aberta.svg", "claquete-fechada.svg"]) {
      const image = new Image();
      image.src = new URL(name, script.src).href;
    }
  }

  function getSound() {
    if (!sound) {
      sound = new Audio(audioUrl.href);
      sound.preload = "auto";
      sound.volume = 0.38;
    }
    return sound;
  }

  function paint() {
    decorated?.setAttribute(marker, pressedId !== null || reopenTimer ? "fechada" : "aberta");
  }

  function setTarget(target, recheck = false) {
    if (!recheck && hovered === target) return;
    decorated?.removeAttribute(marker);
    decorated = null;
    hovered = target;
    if (!target || target.closest(nativeControls)) return;
    if (!normalCursors.has(getComputedStyle(target).cursor)) return;
    decorated = target;
    paint();
  }

  function reset() {
    clearTimeout(reopenTimer);
    reopenTimer = 0;
    pressedId = null;
    setTarget(null);
  }

  function release(event) {
    if (pressedId === null || event.pointerId !== pressedId) return;
    pressedId = null;
    const remaining = minClosedMs - (performance.now() - closedSince);
    if (remaining <= 0) {
      paint();
      return;
    }
    reopenTimer = setTimeout(() => {
      reopenTimer = 0;
      paint();
    }, remaining);
  }

  function track(event, recheck = false) {
    if (!desktop.matches || event.pointerType !== "mouse") {
      reset();
      return;
    }
    if (pressedId !== null && !(event.buttons & 1)) release(event);
    const target = event.composedPath().find(node => node instanceof Element);
    setTarget(target || null, recheck);
  }

  function start(event) {
    if (!event.isPrimary || event.button !== 0) return;
    track(event, true);
    if (!decorated || pressedId !== null) return;
    clearTimeout(reopenTimer);
    reopenTimer = 0;
    closedSince = performance.now();
    pressedId = event.pointerId;
    paint();
    if (soundEnabled) {
      const clap = getSound();
      clap.currentTime = 0;
      clap.play().catch(() => {});
    }
  }

  window.addEventListener("imtv:som", event => {
    if (typeof event.detail?.ativo !== "boolean") return;
    soundEnabled = event.detail.ativo;
    if (soundEnabled && desktop.matches) getSound();
    if (!soundEnabled) sound?.pause();
  });

  const observe = { capture: true, passive: true };
  document.addEventListener("pointerover", event => track(event), observe);
  document.addEventListener("pointermove", event => track(event), observe);
  document.addEventListener("pointerdown", start, observe);
  window.addEventListener("pointerup", release, observe);
  window.addEventListener("pointercancel", reset, observe);
  document.addEventListener("pointerout", event => {
    if (!event.relatedTarget) reset();
  }, observe);
  document.addEventListener("dragstart", reset, observe);
  window.addEventListener("blur", reset);
  window.addEventListener("pagehide", reset);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) reset();
  });
  desktop.addEventListener("change", () => {
    reset();
    preloadCursors();
  });
  preloadCursors();
})();
