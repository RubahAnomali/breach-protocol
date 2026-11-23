import type { EventBus } from '../core/EventBus';
import type { Effect } from '../sim/Combat';
import type { SimEvents } from '../sim/Session';
import { PAL } from './Palette';
import { BX, BY, TILE } from './Layout';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
}

interface Tag {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
}

interface Dying {
  kind: string;
  team: 'player' | 'enemy';
  x: number;
  y: number;
  t: number;
}

interface Flash {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
}

export const tileCenter = (x: number, y: number): { x: number; y: number } => ({ x: BX + x * TILE + TILE / 2, y: BY + y * TILE + TILE / 2 });

/** Presentation-only effects, fed entirely by simulation events. */
export class Fx {
  particles: Particle[] = [];
  tags: Tag[] = [];
  dying: Dying[] = [];
  flashes: Flash[] = [];
  /** Unit id -> seconds of white hit-flash remaining. */
  hitFlash = new Map<number, number>();
  trauma = 0;
  shakeX = 0;
  shakeY = 0;
  private t = 0;

  constructor(bus: EventBus<SimEvents>) {
    bus.on('EFFECT', (e) => this.onEffect(e));
    bus.on('UNDO', () => this.clearTransient());
  }

  clearTransient(): void {
    this.dying = [];
    this.hitFlash.clear();
  }

  clear(): void {
    this.particles = [];
    this.tags = [];
    this.flashes = [];
    this.trauma = 0;
    this.clearTransient();
  }

  private burst(px: number, py: number, n: number, speed: number, color: string, life: number, size: number, gravity = 0): void {
    for (let i = 0; i < n && this.particles.length < 600; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.4), max: life, size: size * (0.6 + Math.random() * 0.8), color, gravity });
    }
  }

  private tag(px: number, py: number, text: string, color: string, size = 20, life = 1.1): void {
    this.tags.push({ x: px, y: py, text, color, life, max: life, size });
  }

  private onEffect(e: Effect): void {
    switch (e.t) {
      case 'shot': {
        const a = tileCenter(e.fromX, e.fromY);
        const b = tileCenter(e.toX, e.toY);
        this.burst(a.x, a.y, 8, 220, PAL.mustard, 0.25, 4);
        this.flashes.push({ x: a.x, y: a.y, r: 22, life: 0.1, max: 0.1, color: PAL.paper });
        this.burst(b.x, b.y, 6, 160, PAL.paper, 0.2, 3);
        this.trauma = Math.min(1, this.trauma + (e.weapon === 'shotgun' ? 0.35 : 0.12));
        break;
      }
      case 'damage': {
        const p = tileCenter(e.x, e.y);
        this.hitFlash.set(e.unitId, 0.18);
        this.burst(p.x, p.y, e.killed ? 24 : 10, e.killed ? 340 : 220, e.team === 'enemy' ? PAL.brick : PAL.mustard, 0.6, 4, 400);
        this.tag(p.x, p.y - 26, `-${e.amount}`, e.team === 'enemy' ? PAL.ink : PAL.brick, 24);
        if (e.cover) this.tag(p.x, p.y - 4, 'COVER', PAL.olive, 13, 0.9);
        if (e.killed) {
          this.dying.push({ kind: e.kind, team: e.team, x: e.x, y: e.y, t: 0.5 });
          this.tag(p.x, p.y - 52, e.team === 'enemy' ? 'DOWN' : 'LOST', PAL.brick, 16, 1.2);
          this.flashes.push({ x: p.x, y: p.y, r: 38, life: 0.25, max: 0.25, color: PAL.paper });
        }
        break;
      }
      case 'collision': {
        const p = tileCenter(e.x, e.y);
        this.burst(p.x, p.y, 16, 300, PAL.ink, 0.4, 4, 300);
        this.tag(p.x, p.y - 34, 'SLAM +1', PAL.brick, 18);
        this.trauma = Math.min(1, this.trauma + 0.5);
        break;
      }
      case 'explosion': {
        const p = tileCenter(e.x, e.y);
        this.burst(p.x, p.y, 50, 520, PAL.orange, 0.8, 6, 120);
        this.burst(p.x, p.y, 28, 300, PAL.ink, 1.0, 8, -60);
        this.flashes.push({ x: p.x, y: p.y, r: TILE * 1.7, life: 0.3, max: 0.3, color: PAL.mustard });
        this.trauma = Math.min(1, this.trauma + 0.8);
        break;
      }
      case 'cover': {
        const p = tileCenter(e.x, e.y);
        this.burst(p.x, p.y, 20, 260, PAL.crate, 0.7, 5, 500);
        break;
      }
      case 'status': {
        const p = tileCenter(e.x, e.y);
        this.tag(p.x, p.y - 44, 'PINNED -2 MOVE', PAL.plum, 14, 1.4);
        break;
      }
      case 'deploy': {
        const p = tileCenter(e.x, e.y);
        this.burst(p.x, p.y, 12, 180, PAL.paper, 0.4, 3);
        this.tag(p.x, p.y - 30, 'SENTRY ONLINE', PAL.olive, 14, 1.4);
        break;
      }
      case 'miss': {
        const p = tileCenter(e.x, e.y);
        this.burst(p.x, p.y, 8, 140, PAL.kraftDark, 0.4, 3);
        this.tag(p.x, p.y - 8, 'MISS', PAL.ink, 14, 0.8);
        break;
      }
      case 'disrupted': {
        const p = tileCenter(e.x, e.y);
        this.tag(p.x, p.y - 36, 'DISRUPTED', PAL.olive, 16, 1.4);
        break;
      }
      case 'push':
      case 'move':
        break;
    }
  }

  update(dt: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma * 10;
    this.shakeX = Math.sin(this.t * 61) * s;
    this.shakeY = Math.cos(this.t * 73) * s;
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.vx *= Math.exp(-2.2 * dt);
      p.vy *= Math.exp(-1.2 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const g of this.tags) {
      g.life -= dt;
      g.y -= 26 * dt;
    }
    this.tags = this.tags.filter((g) => g.life > 0);
    for (const d of this.dying) d.t -= dt;
    this.dying = this.dying.filter((d) => d.t > 0);
    for (const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter((f) => f.life > 0);
    for (const [id, v] of this.hitFlash) {
      if (v - dt <= 0) this.hitFlash.delete(id);
      else this.hitFlash.set(id, v - dt);
    }
  }
}
