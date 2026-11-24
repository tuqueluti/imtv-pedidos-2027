/**
 * Motor de Áudio do Estúdio de Abertura (Web Audio API)
 * Regras do pedido:
 * - Começa com o som desligado.
 * - Ao ativar o som: clique físico de chave de estúdio.
 * - Durante o avanço da rolagem: ambiência baixa de estúdio.
 * - Na transição para o formulário: ruído curto de sintonia RF/TV.
 * - Quando o formulário aparecer: encerra todos os sons da abertura.
 */

export class StudioOpeningAudio {
  private ctx: AudioContext | null = null;
  private ambienceGain: GainNode | null = null;
  private ambienceSource: AudioBufferSourceNode | null = null;
  private ambienceHum: OscillatorNode | null = null;
  private enabled = false;
  private terminated = false;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public isEnabled(): boolean {
    return this.enabled && !this.terminated;
  }

  public enableSound(silentClick = false): void {
    const ctx = this.ensureContext();
    this.terminated = false;
    this.enabled = true;
    if (!ctx) return;

    if (!silentClick && ctx.state === 'running') {
      this.playSwitchClick(ctx);
    }
    this.startLowStudioAmbience(ctx);
  }

  public resumeOnUserGestureIfEnabled(): void {
    if (!this.enabled || this.terminated) return;
    const ctx = this.ensureContext();
    if (ctx && !this.ambienceSource) {
      this.startLowStudioAmbience(ctx);
    }
  }

  public disableSound(): void {
    this.enabled = false;
    this.stopAmbienceNodes();
  }

  /**
   * Modula sutilmente a ambiência baixa de estúdio conforme o avanço da rolagem (0..1)
   */
  public setScrollAdvance(progress: number): void {
    if (!this.enabled || this.terminated || !this.ctx || !this.ambienceGain) return;
    const clamped = Math.max(0, Math.min(1, progress));
    // Ambiência baixa de estúdio (~ -30 dBFS em repouso até ~ -24 dBFS durante o avanço)
    const targetGain = 0.024 + clamped * 0.026;
    this.ambienceGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.08);
  }

  /**
   * Dispara um ruído curto de sintonia na transição e encerra imediatamente os sons da abertura
   */
  public playTuningTransitionAndTerminate(): void {
    const wasEnabled = this.enabled && !this.terminated;
    this.terminated = true;
    this.enabled = false;
    this.stopAmbienceNodes();

    if (!wasEnabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const duration = 0.21;

    const sampleCount = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      const env = Math.sin((i / sampleCount) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(950, now);
    bandpass.frequency.exponentialRampToValueAtTime(2600, now + duration * 0.6);
    bandpass.frequency.exponentialRampToValueAtTime(720, now + duration);
    bandpass.Q.value = 3.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.075, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + duration + 0.01);
  }

  /**
   * Ao recuar de volta para dentro da abertura caso o usuário volte ao topo
   */
  public reviveIfUserReturnsToStudio(wantEnabled: boolean): void {
    this.terminated = false;
    if (wantEnabled) {
      const ctx = this.ensureContext();
      this.enabled = true;
      if (ctx) {
        this.startLowStudioAmbience(ctx);
      }
    }
  }

  public stopAllImmediately(): void {
    this.terminated = true;
    this.enabled = false;
    this.stopAmbienceNodes();
  }

  public dispose(): void {
    this.stopAllImmediately();
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  private playSwitchClick(ctx: AudioContext): void {
    const now = ctx.currentTime;

    // Transiente mecânico curto de botão de mesa de corte/TV
    const clickLen = Math.floor(ctx.sampleRate * 0.038);
    const buf = ctx.createBuffer(1, clickLen, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < clickLen; i++) {
      const t = i / clickLen;
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 4);
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1850, now);
    filter.Q.value = 2.1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.038);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);

    // Detente grave sutil do gabinete
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'triangle';
    thump.frequency.setValueAtTime(190, now);
    thump.frequency.exponentialRampToValueAtTime(68, now + 0.032);
    thumpGain.gain.setValueAtTime(0.08, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    thump.connect(thumpGain);
    thumpGain.connect(ctx.destination);
    thump.start(now);
    thump.stop(now + 0.038);
  }

  private startLowStudioAmbience(ctx: AudioContext): void {
    this.stopAmbienceNodes();

    const now = ctx.currentTime;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      // Ruído marrom suave de ar-condicionado / sala acústica de estúdio
      lastOut = (lastOut + 0.02 * white) / 1.02;
      ch[i] = lastOut * 2.4;
    }

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buf;
    noiseSrc.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;

    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 60; // Tom sutil de transformador de estúdio 60 Hz
    const humGain = ctx.createGain();
    humGain.gain.value = 0.12;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(0.024, now + 0.25);

    noiseSrc.connect(lp);
    lp.connect(masterGain);
    hum.connect(humGain);
    humGain.connect(masterGain);
    masterGain.connect(ctx.destination);

    noiseSrc.start(now);
    hum.start(now);

    this.ambienceSource = noiseSrc;
    this.ambienceHum = hum;
    this.ambienceGain = masterGain;
  }

  private stopAmbienceNodes(): void {
    if (this.ambienceGain && this.ctx) {
      try {
        this.ambienceGain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.ambienceGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      } catch {
        // ignore
      }
    }
    if (this.ambienceSource) {
      try {
        this.ambienceSource.stop();
        this.ambienceSource.disconnect();
      } catch {
        // ignore
      }
      this.ambienceSource = null;
    }
    if (this.ambienceHum) {
      try {
        this.ambienceHum.stop();
        this.ambienceHum.disconnect();
      } catch {
        // ignore
      }
      this.ambienceHum = null;
    }
    this.ambienceGain = null;
  }
}
