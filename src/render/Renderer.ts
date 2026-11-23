import { UNITS } from '../data/defs';
import type { Pt } from '../grid/Grid';
import type { AttackPreview } from '../sim/Combat';
import type { Session } from '../sim/Session';
import type { Unit } from '../sim/State';
import type { Controller } from '../ui/Controller';
import { BX, BY, H, TILE, W } from './Layout';
import { BODY, HEAD, PAL, UNIT_COLOR } from './Palette';
import { tileCenter, type Fx } from './Fx';


const px = (x: number): number => BX + x * TILE;
const py = (y: number): number => BY + y * TILE;

export interface RenderFlags {
  debug: boolean;
  time: number;
  /** Highlight units that can still act. */
  playerTurn: boolean;
}

/** Canvas renderer for the board: terrain, overlays, intents, units and effects. */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private dpr = 1;
  private readonly disp = new Map<number, { x: number; y: number }>();
  private readonly felt: HTMLCanvasElement;
  private readonly onResize = (): void => this.resize();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const c = canvas.getContext('2d');
    if (!c) throw new Error('2D canvas is not supported');
    this.ctx = c;
    this.felt = this.buildFelt();
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.scale = Math.min(w / W, h / H);
    this.ox = (w - W * this.scale) / 2;
    this.oy = (h - H * this.scale) / 2;
  }

  /** Screen pixel -> logical canvas coordinates. */
  toLogical(cx: number, cy: number): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: (cx - r.left - this.ox) / this.scale, y: (cy - r.top - this.oy) / this.scale };
  }

  static tileAt(p: Pt): Pt | null {
    const x = Math.floor((p.x - BX) / TILE);
    const y = Math.floor((p.y - BY) / TILE);
    return x >= 0 && y >= 0 && x < 10 && y < 10 ? { x, y } : null;
  }

  /** Begin a frame: clears, applies letterboxing and returns the context in logical space. */
  begin(): CanvasRenderingContext2D {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = '#1c2119';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const k = this.scale * this.dpr;
    c.setTransform(k, 0, 0, k, this.ox * this.dpr, this.oy * this.dpr);
    c.save();
    c.beginPath();
    c.rect(0, 0, W, H);
    c.clip();
    c.drawImage(this.felt, 0, 0, W, H);
    return c;
  }

  end(): void {
    this.ctx.restore();
  }

  private buildFelt(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (!g) throw new Error('2D canvas is not supported');
    g.fillStyle = PAL.felt;
    g.fillRect(0, 0, W, H);
    let s = 9;
    const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.04)';
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1);
    }
    return c;
  }

  // ---- scene ------------------------------------------------------------------------------

  draw(session: Session, ctl: Controller, fx: Fx, f: RenderFlags, dt: number): void {
    const c = this.ctx;
    const s = session.state;
    this.stepDisplay(session, dt);

    c.save();
    c.translate(fx.shakeX, fx.shakeY);
    this.drawBoard(c);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) this.drawTile(c, s.grid.get(x, y), x, y, f.time);
    if (f.debug) this.drawHeat(c, ctl);
    this.drawRangeOverlays(c, ctl, f.time);
    this.drawIntents(c, session, ctl, f.time);
    this.drawUnits(c, session, ctl, fx, f);
    this.drawPreview(c, ctl, f.time);
    this.drawHover(c, ctl);
    this.drawFx(c, fx);
    c.restore();
  }

  private stepDisplay(session: Session, dt: number): void {
    const alive = new Set<number>();
    for (const u of session.state.units) {
      alive.add(u.id);
      let d = this.disp.get(u.id);
      if (!d) {
        d = { x: u.x, y: u.y };
        this.disp.set(u.id, d);
      }
      const dx = u.x - d.x;
      const dy = u.y - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 12) {
        d.x = u.x;
        d.y = u.y;
      } else if (dist > 0.001) {
        const step = Math.min(dist, 9 * dt);
        d.x += (dx / dist) * step;
        d.y += (dy / dist) * step;
      }
    }
    for (const id of this.disp.keys()) if (!alive.has(id)) this.disp.delete(id);
  }

  private drawBoard(c: CanvasRenderingContext2D): void {
    const x = BX - 14;
    const y = BY - 14;
    const w = TILE * 10 + 28;
    c.fillStyle = PAL.shadow;
    c.fillRect(x + 8, y + 10, w, w);
    c.fillStyle = '#6b5a3a';
    c.fillRect(x, y, w, w);
    c.strokeStyle = PAL.ink;
    c.lineWidth = 4;
    c.strokeRect(x, y, w, w);
    for (let ty = 0; ty < 10; ty++) {
      for (let tx = 0; tx < 10; tx++) {
        c.fillStyle = (tx + ty) % 2 ? PAL.kraftAlt : PAL.kraft;
        c.fillRect(px(tx), py(ty), TILE, TILE);
      }
    }
    c.strokeStyle = 'rgba(35,32,27,0.22)';
    c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 0; i <= 10; i++) {
      c.moveTo(BX + i * TILE, BY);
      c.lineTo(BX + i * TILE, BY + TILE * 10);
      c.moveTo(BX, BY + i * TILE);
      c.lineTo(BX + TILE * 10, BY + i * TILE);
    }
    c.stroke();
    c.fillStyle = PAL.paper;
    c.font = `700 11px ${BODY}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < 10; i++) {
      c.fillText(String.fromCharCode(65 + i), BX + i * TILE + TILE / 2, BY - 7);
      c.fillText(String(i + 1), BX - 7, BY + i * TILE + TILE / 2);
    }
  }

  private drawTile(c: CanvasRenderingContext2D, t: string, x: number, y: number, time: number): void {
    const X = px(x);
    const Y = py(y);
    c.lineJoin = 'round';
    switch (t) {
      case 'wall': {
        c.fillStyle = PAL.shadow;
        c.fillRect(X + 7, Y + 8, TILE - 4, TILE - 4);
        c.fillStyle = PAL.wall;
        c.fillRect(X + 2, Y + 2, TILE - 4, TILE - 4);
        c.strokeStyle = PAL.ink;
        c.lineWidth = 3;
        c.strokeRect(X + 2, Y + 2, TILE - 4, TILE - 4);
        c.strokeStyle = 'rgba(241,232,208,0.18)';
        c.lineWidth = 2;
        c.beginPath();
        for (let i = -TILE; i < TILE; i += 14) {
          c.moveTo(X + 4 + i, Y + TILE - 4);
          c.lineTo(X + 4 + i + TILE - 8, Y + 4);
        }
        c.save();
        c.beginPath();
        c.rect(X + 4, Y + 4, TILE - 8, TILE - 8);
        c.clip();
        c.stroke();
        c.restore();
        break;
      }
      case 'half': {
        c.fillStyle = PAL.shadow;
        c.fillRect(X + 11, Y + 31, 46, 22);
        c.fillStyle = PAL.olive;
        c.strokeStyle = PAL.ink;
        c.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          c.beginPath();
          c.roundRect(X + 7 + i * 17, Y + 28, 17, 22, 6);
          c.fill();
          c.stroke();
        }
        c.fillStyle = PAL.paper;
        c.font = `900 9px ${HEAD}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('COVER', X + TILE / 2, Y + 14);
        break;
      }
      case 'full': {
        c.fillStyle = PAL.shadow;
        c.fillRect(X + 11, Y + 12, 48, 48);
        c.fillStyle = PAL.crate;
        c.strokeStyle = PAL.ink;
        c.lineWidth = 3;
        c.fillRect(X + 7, Y + 7, 48, 48);
        c.strokeRect(X + 7, Y + 7, 48, 48);
        c.beginPath();
        c.moveTo(X + 7, Y + 7);
        c.lineTo(X + 55, Y + 55);
        c.moveTo(X + 55, Y + 7);
        c.lineTo(X + 7, Y + 55);
        c.moveTo(X + 7, Y + 23);
        c.lineTo(X + 55, Y + 23);
        c.moveTo(X + 7, Y + 39);
        c.lineTo(X + 55, Y + 39);
        c.stroke();
        break;
      }
      case 'barrel': {
        c.fillStyle = PAL.shadow;
        c.beginPath();
        c.ellipse(X + 36, Y + 38, 20, 20, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = PAL.brick;
        c.strokeStyle = PAL.ink;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(X + TILE / 2, Y + TILE / 2, 20, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.fillStyle = PAL.mustard;
        c.fillRect(X + 12, Y + 27, 40, 10);
        c.fillStyle = PAL.ink;
        c.font = `900 10px ${HEAD}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('!', X + TILE / 2, Y + 33);
        const p = 0.5 + 0.5 * Math.sin(time * 3 + x);
        c.strokeStyle = `rgba(232,121,31,${0.25 + 0.3 * p})`;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(X + TILE / 2, Y + TILE / 2, 24, 0, Math.PI * 2);
        c.stroke();
        break;
      }
      case 'hazard': {
        c.save();
        c.beginPath();
        c.rect(X + 3, Y + 3, TILE - 6, TILE - 6);
        c.clip();
        c.fillStyle = PAL.mustard;
        c.fillRect(X, Y, TILE, TILE);
        c.fillStyle = PAL.ink;
        for (let i = -TILE; i < TILE * 2; i += 20) {
          c.beginPath();
          c.moveTo(X + i, Y + TILE);
          c.lineTo(X + i + 10, Y + TILE);
          c.lineTo(X + i + 10 + TILE, Y);
          c.lineTo(X + i + TILE, Y);
          c.fill();
        }
        c.restore();
        c.strokeStyle = PAL.ink;
        c.lineWidth = 3;
        c.strokeRect(X + 3, Y + 3, TILE - 6, TILE - 6);
        break;
      }
      default:
        break;
    }
  }

  private fillTile(c: CanvasRenderingContext2D, x: number, y: number, fill: string, stroke?: string, dash = false): void {
    c.fillStyle = fill;
    c.fillRect(px(x) + 2, py(y) + 2, TILE - 4, TILE - 4);
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 3;
      c.setLineDash(dash ? [8, 6] : []);
      c.strokeRect(px(x) + 3, py(y) + 3, TILE - 6, TILE - 6);
      c.setLineDash([]);
    }
  }

  private drawRangeOverlays(c: CanvasRenderingContext2D, ctl: Controller, time: number): void {
    if (ctl.reach) {
      const g = ctl.reach.cost;
      for (let i = 0; i < g.length; i++) {
        if (!Number.isFinite(g[i]) || g[i] === 0) continue;
        this.fillTile(c, i % 10, Math.floor(i / 10), 'rgba(47,143,138,0.28)', PAL.teal, true);
      }
      if (ctl.path && ctl.path.length > 1) {
        c.strokeStyle = PAL.ink;
        c.lineWidth = 5;
        c.lineCap = 'round';
        c.setLineDash([2, 10]);
        c.beginPath();
        ctl.path.forEach((p, i) => {
          const q = tileCenter(p.x, p.y);
          if (i === 0) c.moveTo(q.x, q.y);
          else c.lineTo(q.x, q.y);
        });
        c.stroke();
        c.setLineDash([]);
        const last = ctl.path[ctl.path.length - 1];
        const q = tileCenter(last.x, last.y);
        c.fillStyle = PAL.ink;
        c.beginPath();
        c.arc(q.x, q.y, 14, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = PAL.paper;
        c.font = `900 15px ${HEAD}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(String(ctl.path.length - 1), q.x, q.y + 1);
      }
    }
    if (ctl.targets.length) {
      const pulse = 0.55 + 0.25 * Math.sin(time * 6);
      for (const t of ctl.targets) this.fillTile(c, t.x, t.y, `rgba(194,65,45,${0.18 + 0.12 * pulse})`, PAL.brick);
    }
  }

  private drawHeat(c: CanvasRenderingContext2D, ctl: Controller): void {
    const e = ctl.inspected();
    const plan = e?.plan;
    if (!e || !plan) return;
    const vals = plan.tileScores.filter((v) => Number.isFinite(v));
    if (!vals.length) return;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    plan.tileScores.forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      const t = hi > lo ? (v - lo) / (hi - lo) : 1;
      const x = i % 10;
      const y = Math.floor(i / 10);
      c.fillStyle = `rgba(${Math.round(58 + t * 170)},${Math.round(99 - t * 20)},${Math.round(200 - t * 170)},0.42)`;
      c.fillRect(px(x) + 2, py(y) + 2, TILE - 4, TILE - 4);
      c.fillStyle = PAL.ink;
      c.font = `700 11px ${BODY}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(v.toFixed(2), px(x) + TILE / 2, py(y) + TILE - 10);
    });
    const ch = plan.chosen;
    if (ch) {
      c.strokeStyle = PAL.ink;
      c.lineWidth = 4;
      c.strokeRect(px(ch.mx) + 5, py(ch.my) + 5, TILE - 10, TILE - 10);
    }
  }

  private arrow(c: CanvasRenderingContext2D, a: Pt, b: Pt, color: string, width: number, dash: number[] = []): void {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = 12;
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.setLineDash(dash);
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x - Math.cos(ang) * head * 0.6, b.y - Math.sin(ang) * head * 0.6);
    c.stroke();
    c.setLineDash([]);
    c.beginPath();
    c.moveTo(b.x, b.y);
    c.lineTo(b.x - Math.cos(ang - 0.45) * head, b.y - Math.sin(ang - 0.45) * head);
    c.lineTo(b.x - Math.cos(ang + 0.45) * head, b.y - Math.sin(ang + 0.45) * head);
    c.closePath();
    c.fill();
  }

  private drawIntents(c: CanvasRenderingContext2D, session: Session, ctl: Controller, time: number): void {
    for (const e of session.state.units) {
      if (!e.alive || e.team !== 'enemy' || !e.intent) continue;
      const pv = ctl.intentPreviews.get(e.id);
      const d = this.disp.get(e.id) ?? { x: e.x, y: e.y };
      const from = tileCenter(d.x, d.y);
      const to = tileCenter(e.intent.tx, e.intent.ty);
      const dead = !pv || pv.error !== null;
      const col = dead ? 'rgba(35,32,27,0.35)' : PAL.brick;
      const dash = dead ? [4, 8] : [10, 7];
      this.arrow(c, from, to, col, 4, dash);
      if (!dead) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 7);
        this.fillTile(c, e.intent.tx, e.intent.ty, `rgba(194,65,45,${0.14 + 0.14 * pulse})`, PAL.brick);
        for (const h of pv.hits) {
          const q = tileCenter(h.x, h.y);
          this.badge(c, q.x + 20, q.y - 28, `-${h.damage}${h.kill ? ' KILL' : ''}`, h.team === 'player' ? PAL.brick : PAL.olive);
        }
        for (const p of pv.pushes) this.arrow(c, tileCenter(p.fromX, p.fromY), tileCenter(p.toX, p.toY), PAL.plum, 4);
      } else {
        c.fillStyle = PAL.ink;
        c.font = `900 12px ${HEAD}`;
        c.textAlign = 'center';
        c.fillText('DISRUPTED', from.x, from.y - 34);
      }
    }
  }

  private badge(c: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
    c.font = `900 15px ${HEAD}`;
    const w = c.measureText(text).width + 12;
    c.fillStyle = PAL.shadow;
    c.fillRect(x - w / 2 + 3, y - 10 + 3, w, 22);
    c.fillStyle = color;
    c.strokeStyle = PAL.ink;
    c.lineWidth = 2.5;
    c.fillRect(x - w / 2, y - 10, w, 22);
    c.strokeRect(x - w / 2, y - 10, w, 22);
    c.fillStyle = PAL.paper;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, x, y + 1);
  }

  private drawPreview(c: CanvasRenderingContext2D, ctl: Controller, time: number): void {
    const pv: AttackPreview | null = ctl.preview;
    const u = ctl.selected;
    if (!pv || pv.error || !u || !ctl.hover) return;
    for (const ex of pv.explosions) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = ex.x + dx;
          const y = ex.y + dy;
          if (x < 0 || y < 0 || x > 9 || y > 9) continue;
          this.fillTile(c, x, y, 'rgba(232,121,31,0.35)', PAL.orange, true);
        }
      }
    }
    for (const p of pv.pushes) this.arrow(c, tileCenter(p.fromX, p.fromY), tileCenter(p.toX, p.toY), PAL.cobalt, 5);
    for (const col of pv.collisions) {
      const q = tileCenter(col.x, col.y);
      this.badge(c, q.x, q.y, 'SLAM +1', PAL.brick);
    }
    for (const h of pv.hits) {
      const q = tileCenter(h.x, h.y);
      const friendly = h.team === u.team;
      this.badge(c, q.x, q.y - 40, `${friendly ? 'FRIENDLY ' : ''}-${h.damage}`, friendly ? PAL.plum : PAL.brick);
      if (h.kill) this.badge(c, q.x, q.y - 64 - Math.sin(time * 8) * 1.5, 'KILL', PAL.ink);
      if (h.cover) this.badge(c, q.x, q.y + 38, 'COVER -1', PAL.olive);
    }
    c.strokeStyle = PAL.ink;
    c.lineWidth = 2;
    const a = tileCenter(u.x, u.y);
    const b = tileCenter(ctl.hover.x, ctl.hover.y);
    c.setLineDash([3, 7]);
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.setLineDash([]);
  }

  private drawHover(c: CanvasRenderingContext2D, ctl: Controller): void {
    if (!ctl.hover) return;
    c.strokeStyle = PAL.ink;
    c.lineWidth = 3;
    c.strokeRect(px(ctl.hover.x) + 1.5, py(ctl.hover.y) + 1.5, TILE - 3, TILE - 3);
  }

  private drawUnits(c: CanvasRenderingContext2D, session: Session, ctl: Controller, fx: Fx, f: RenderFlags): void {
    const list = [...session.state.units].filter((u) => u.alive).sort((a, b) => (this.disp.get(a.id)?.y ?? a.y) - (this.disp.get(b.id)?.y ?? b.y));
    for (const u of list) {
      const d = this.disp.get(u.id) ?? { x: u.x, y: u.y };
      const p = tileCenter(d.x, d.y);
      this.drawToken(c, u.kind, u.team, p.x, p.y, {
        flash: fx.hitFlash.has(u.id),
        selected: ctl.selectedId === u.id,
        done: u.team === 'player' && u.kind !== 'turret' && u.acted,
        ready: f.playerTurn && u.team === 'player' && u.kind !== 'turret' && !u.acted,
        time: f.time,
      });
      this.drawHp(c, u, p.x, p.y);
      if (u.suppressed > 0) this.badge(c, p.x, p.y - 34, 'PINNED', PAL.plum);
    }
    for (const dy of fx.dying) {
      const p = tileCenter(dy.x, dy.y);
      c.globalAlpha = Math.max(0, dy.t / 0.5);
      this.drawToken(c, dy.kind, dy.team, p.x, p.y - (0.5 - dy.t) * 20, { flash: true, selected: false, done: false, ready: false, time: f.time });
      c.globalAlpha = 1;
    }
  }

  private drawToken(c: CanvasRenderingContext2D, kind: string, team: string, x: number, y: number, o: { flash: boolean; selected: boolean; done: boolean; ready: boolean; time: number }): void {
    const col = o.flash ? PAL.paper : UNIT_COLOR[kind];
    const letter = UNITS[kind as keyof typeof UNITS].letter;
    const r = kind === 'turret' ? 17 : 23;
    c.fillStyle = PAL.shadow;
    c.beginPath();
    if (team === 'player') c.arc(x + 4, y + 6, r, 0, Math.PI * 2);
    else c.roundRect(x - r + 4, y - r + 6, r * 2, r * 2, 8);
    c.fill();
    if (o.selected) {
      c.strokeStyle = PAL.ink;
      c.lineWidth = 4;
      c.setLineDash([6, 5]);
      c.beginPath();
      c.arc(x, y, r + 8 + Math.sin(o.time * 6), 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    } else if (o.ready) {
      c.strokeStyle = PAL.paper;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, r + 6, 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha *= o.done ? 0.55 : 1;
    c.fillStyle = col;
    c.strokeStyle = PAL.ink;
    c.lineWidth = 3.5;
    c.beginPath();
    if (team === 'player') c.arc(x, y, r, 0, Math.PI * 2);
    else c.roundRect(x - r, y - r, r * 2, r * 2, 8);
    c.fill();
    c.stroke();
    if (kind === 'turret') {
      c.fillStyle = PAL.ink;
      c.fillRect(x - 3, y - r - 6, 6, 14);
    }
    c.fillStyle = o.flash ? PAL.ink : PAL.paper;
    c.font = `900 ${kind === 'turret' ? 16 : 22}px ${HEAD}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(letter, x, y + 1);
    c.globalAlpha /= o.done ? 0.55 : 1;
  }

  private drawHp(c: CanvasRenderingContext2D, u: Unit, x: number, y: number): void {
    const w = 8;
    const total = u.maxHp * (w + 2) - 2;
    for (let i = 0; i < u.maxHp; i++) {
      c.fillStyle = i < u.hp ? PAL.paper : 'rgba(35,32,27,0.45)';
      c.strokeStyle = PAL.ink;
      c.lineWidth = 1.5;
      c.fillRect(x - total / 2 + i * (w + 2), y + 28, w, 6);
      c.strokeRect(x - total / 2 + i * (w + 2), y + 28, w, 6);
    }
  }

  private drawFx(c: CanvasRenderingContext2D, fx: Fx): void {
    for (const f of fx.flashes) {
      c.globalAlpha = Math.max(0, f.life / f.max) * 0.8;
      c.fillStyle = f.color;
      c.beginPath();
      c.arc(f.x, f.y, f.r * (1.2 - f.life / f.max * 0.5), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    for (const p of fx.particles) {
      c.globalAlpha = Math.min(1, (p.life / p.max) * 1.6);
      c.fillStyle = p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalAlpha = 1;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    for (const t of fx.tags) {
      c.globalAlpha = Math.min(1, (t.life / t.max) * 2);
      c.font = `900 ${t.size}px ${HEAD}`;
      c.lineWidth = 5;
      c.strokeStyle = PAL.paper;
      c.strokeText(t.text, t.x, t.y);
      c.fillStyle = t.color;
      c.fillText(t.text, t.x, t.y);
    }
    c.globalAlpha = 1;
  }
}
