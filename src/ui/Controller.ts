import { UNITS, WEAPONS, type WeaponDef } from '../data/defs';
import type { Pt } from '../grid/Grid';
import { pathTo, reachable, type Reach } from '../grid/Pathing';
import { previewAttack, previewIntent, validTargets, type AttackPreview } from '../sim/Combat';
import type { Session } from '../sim/Session';
import { livingUnits, unitAt, type Unit } from '../sim/State';
import { squadMove } from '../sim/Turn';

export type Mode = { kind: 'move' } | { kind: 'weapon'; index: number };

/**
 * Selection / targeting state and the derived data the renderer shows: reachable tiles, the
 * hover path, valid targets, exact hit previews and the previewed outcome of enemy intents.
 */
export class Controller {
  selectedId: number | null = null;
  mode: Mode = { kind: 'move' };
  hover: Pt | null = null;
  reach: Reach | null = null;
  path: Pt[] | null = null;
  targets: Pt[] = [];
  preview: AttackPreview | null = null;
  intentPreviews = new Map<number, AttackPreview>();
  message = '';
  private key = '';

  constructor(private readonly session: Session) {}

  get selected(): Unit | undefined {
    return this.selectedId === null ? undefined : this.session.state.units.find((u) => u.id === this.selectedId && u.alive);
  }

  get weapon(): WeaponDef | null {
    const u = this.selected;
    if (!u || this.mode.kind !== 'weapon') return null;
    const id = UNITS[u.kind].weapons[this.mode.index];
    return id ? WEAPONS[id] : null;
  }

  /** Enemy under the cursor or selected, for the AI inspector. */
  inspected(): Unit | undefined {
    const s = this.session.state;
    if (this.hover) {
      const u = unitAt(s, this.hover.x, this.hover.y);
      if (u && u.team === 'enemy') return u;
    }
    return this.selected?.team === 'enemy' ? this.selected : undefined;
  }

  reset(): void {
    this.selectedId = null;
    this.mode = { kind: 'move' };
    this.key = '';
    this.message = '';
  }

  select(id: number | null): void {
    this.selectedId = id;
    const u = this.selected;
    if (!u) {
      this.mode = { kind: 'move' };
      return;
    }
    this.mode = !u.moved && !u.acted ? { kind: 'move' } : { kind: 'weapon', index: 0 };
    if (u.acted) this.mode = { kind: 'move' };
  }

  cycle(): void {
    const ready = livingUnits(this.session.state, 'player').filter((u) => u.kind !== 'turret' && !u.acted);
    if (ready.length === 0) return;
    const i = ready.findIndex((u) => u.id === this.selectedId);
    this.select(ready[(i + 1) % ready.length].id);
  }

  setWeapon(index: number): void {
    const u = this.selected;
    if (!u || u.acted || u.team !== 'player') return;
    if (index < UNITS[u.kind].weapons.length) this.mode = { kind: 'weapon', index };
  }

  setMove(): void {
    const u = this.selected;
    if (u && !u.moved && !u.acted) this.mode = { kind: 'move' };
  }

  cancel(): void {
    this.selectedId = null;
    this.mode = { kind: 'move' };
  }

  /** Returns true when the click did something (so the UI can play a sound). */
  click(tile: Pt): boolean {
    const s = this.session.state;
    if (s.phase !== 'player') return false;
    const occ = unitAt(s, tile.x, tile.y);
    const u = this.selected;

    if (u && this.mode.kind === 'weapon') {
      const w = this.weapon;
      if (w && this.targets.some((t) => t.x === tile.x && t.y === tile.y)) {
        this.session.attack(u.id, w.id, tile.x, tile.y);
        this.cancel();
        return true;
      }
    }
    if (u && this.mode.kind === 'move' && !u.moved && !u.acted && this.reach) {
      const cost = this.reach.cost[s.grid.idx(tile.x, tile.y)];
      if (Number.isFinite(cost) && cost > 0) {
        this.session.move(u.id, tile.x, tile.y, cost);
        const me = this.selected;
        this.mode = me && !me.acted ? { kind: 'weapon', index: 0 } : { kind: 'move' };
        return true;
      }
    }
    if (occ && occ.team === 'player' && occ.kind !== 'turret') {
      if (occ.acted) {
        this.message = `${UNITS[occ.kind].name} has already acted.`;
        return false;
      }
      this.select(occ.id);
      return true;
    }
    if (occ && occ.team === 'enemy') {
      this.selectedId = occ.id;
      this.mode = { kind: 'move' };
      return true;
    }
    return false;
  }

  /** Recompute derived data only when something it depends on has changed. */
  refresh(): void {
    const s = this.session.state;
    const k = `${s.version}|${this.selectedId}|${this.mode.kind === 'weapon' ? this.mode.index : 'm'}|${this.hover?.x},${this.hover?.y}|${s.phase}`;
    if (k === this.key) return;
    this.key = k;

    // keep the selection valid after undo / deaths
    if (this.selectedId !== null && !this.selected) this.selectedId = null;
    const u = this.selected;
    this.reach = null;
    this.path = null;
    this.targets = [];
    this.preview = null;

    if (u && u.team === 'player' && s.phase === 'player') {
      if (this.mode.kind === 'move' && !u.moved && !u.acted) {
        this.reach = reachable(s, u, squadMove(u));
        if (this.hover) this.path = pathTo(s, this.reach, this.hover.x, this.hover.y);
      } else if (this.mode.kind === 'weapon' && !u.acted) {
        const w = this.weapon;
        if (w) {
          this.targets = validTargets(s, u, w);
          if (this.hover && this.targets.some((t) => t.x === this.hover?.x && t.y === this.hover?.y)) {
            this.preview = previewAttack(s, u, w, this.hover.x, this.hover.y);
          }
        }
      }
    }

    this.intentPreviews.clear();
    for (const e of livingUnits(s, 'enemy')) {
      if (e.intent) this.intentPreviews.set(e.id, previewIntent(s, e, e.intent.weapon, e.intent.tx, e.intent.ty));
    }
  }
}
