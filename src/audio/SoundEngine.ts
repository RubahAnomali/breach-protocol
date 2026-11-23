import type { EventBus } from '../core/EventBus';
import type { SimEvents } from '../sim/Session';

/** Procedural WebAudio: oscillators, filtered noise, envelopes. No asset files. */
export class SoundEngine {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const c = new Ctor();
      this.ctx = c;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(c.createDynamicsCompressor()).connect(c.destination);
      const len = c.sampleRate;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  bind(bus: EventBus<SimEvents>): void {
    bus.on('EFFECT', (e) => {
      switch (e.t) {
        case 'shot':
          return this.shot(e.weapon);
        case 'damage':
          return e.killed ? this.kill() : this.hit(e.source);
        case 'push':
          return this.burst(0.12, 0.12, 'bandpass', 900, 300, 1);
        case 'collision':
          return this.slam();
        case 'explosion':
          return this.explosion();
        case 'cover':
          return this.burst(0.18, 0.25, 'highpass', 1500, 600, 0.7);
        case 'status':
          return this.tone(1200, 300, 0.25, 'sawtooth', 0.1, 0, 2500);
        case 'deploy':
          return this.deploy();
        case 'miss':
          return this.burst(0.1, 0.12, 'bandpass', 700, 400, 1);
        case 'move':
          return this.steps(e.steps);
        case 'disrupted':
          return this.tone(160, 90, 0.3, 'square', 0.1, 0, 600);
      }
    });
    bus.on('UNDO', () => this.tone(700, 260, 0.18, 'triangle', 0.14));
    bus.on('REDO', () => this.tone(260, 700, 0.18, 'triangle', 0.14));
    bus.on('TURN_END', () => {
      this.tone(330, 330, 0.12, 'square', 0.08, 0, 1500);
      this.tone(247, 247, 0.2, 'square', 0.08, 0.1, 1500);
    });
    bus.on('PLAYER_PHASE', () => this.tone(523.25, 659.25, 0.16, 'triangle', 0.12));
    bus.on('ENEMY_PHASE', () => this.tone(110, 90, 0.4, 'sawtooth', 0.1, 0, 500));
    bus.on('ROOM_CLEARED', () => [392, 523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, f, 0.3, 'triangle', 0.14, i * 0.1)));
    bus.on('CAMPAIGN_WON', () => [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone(f, f, 0.5, 'triangle', 0.14, i * 0.12)));
    bus.on('CAMPAIGN_LOST', () => {
      this.tone(220, 40, 1.2, 'sawtooth', 0.18, 0, 700);
      this.burst(0.8, 0.3, 'lowpass', 1800, 90, 0.8);
    });
  }

  click(): void {
    this.tone(660, 880, 0.05, 'square', 0.06, 0, 2400);
  }

  tick(): void {
    this.tone(1000, 1000, 0.03, 'square', 0.03, 0, 3000);
  }

  // ---- voices -----------------------------------------------------------------------------

  private shot(w: string): void {
    switch (w) {
      case 'shotgun':
        this.burst(0.28, 0.6, 'lowpass', 5000, 200, 0.8);
        this.tone(140, 45, 0.3, 'sawtooth', 0.22, 0, 600);
        break;
      case 'rail':
        this.burst(0.1, 0.35, 'highpass', 3000, 6000, 0.8);
        this.tone(2400, 180, 0.25, 'sawtooth', 0.12, 0, 5000);
        break;
      case 'concussive':
        this.tone(320, 60, 0.3, 'sine', 0.3);
        this.burst(0.15, 0.25, 'bandpass', 500, 200, 1.2);
        break;
      case 'bash':
        this.tone(100, 40, 0.35, 'square', 0.25, 0, 500);
        this.burst(0.2, 0.4, 'lowpass', 2500, 150, 0.8);
        break;
      case 'turretGun':
        this.tone(1500, 700, 0.08, 'square', 0.08, 0, 4000);
        break;
      default:
        this.burst(0.12, 0.3, 'bandpass', 2400, 800, 1.2);
        this.tone(700, 260, 0.1, 'square', 0.08, 0, 2500);
    }
  }

  private hit(src: string): void {
    this.tone(src === 'hazard' ? 300 : 220, 70, 0.12, 'square', 0.12, 0, 1500);
    this.burst(0.07, 0.2, 'bandpass', 1400, 500, 1);
  }

  private kill(): void {
    this.burst(0.25, 0.4, 'lowpass', 3500, 200, 0.8);
    this.tone(520, 120, 0.25, 'square', 0.12, 0, 1800);
  }

  private slam(): void {
    this.tone(80, 35, 0.3, 'sine', 0.45);
    this.burst(0.14, 0.4, 'lowpass', 1200, 120, 0.8);
  }

  private explosion(): void {
    this.burst(0.8, 0.7, 'lowpass', 2500, 70, 0.8);
    this.tone(90, 28, 0.7, 'sine', 0.5);
  }

  private deploy(): void {
    this.tone(180, 90, 0.2, 'square', 0.2, 0, 800);
    this.tone(900, 900, 0.06, 'triangle', 0.1, 0.12);
  }

  private steps(n: number): void {
    const count = Math.min(6, Math.max(1, Math.round(n)));
    for (let i = 0; i < count; i++) this.burst(0.05, 0.12, 'bandpass', 500 + (i % 2) * 150, 300, 1.5, i * 0.085);
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0, lowpass = 0): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (lowpass > 0) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node = o.connect(f);
    }
    node.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, q: number, delay = 0): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noise) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(40, f0), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }
}
