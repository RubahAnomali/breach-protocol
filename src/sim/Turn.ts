import { UNITS, WEAPONS } from '../data/defs';
import { chebyshev } from '../grid/Grid';
import { reachable } from '../grid/Pathing';
import { planFor } from './ai/Planner';
import { applyHazard, intentValid, resolveAttack, type Effect } from './Combat';
import { livingUnits, type GameState, type Unit } from './State';

/** Win / lose detection. Sentries do not count as part of the squad. */
export function checkOutcome(state: GameState): void {
  if (state.phase === 'cleared' || state.phase === 'won' || state.phase === 'lost') return;
  const squad = livingUnits(state, 'player').filter((u) => u.kind !== 'turret');
  if (squad.length === 0) state.phase = 'lost';
  else if (livingUnits(state, 'enemy').length === 0) state.phase = 'cleared';
}

/** Sentries fire at the nearest visible enemy; suppression wears off; the enemy phase begins. */
export function endPlayerTurn(state: GameState, fx: Effect[]): void {
  for (const t of livingUnits(state, 'player').filter((u) => u.kind === 'turret')) {
    const w = WEAPONS.turretGun;
    let best: Unit | null = null;
    let bd = Infinity;
    for (const e of livingUnits(state, 'enemy')) {
      if (!intentValid(state, t, w, e.x, e.y)) continue;
      const d = chebyshev(t.x, t.y, e.x, e.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best) resolveAttack(state, t, w, best.x, best.y, fx);
  }
  for (const u of livingUnits(state, 'player')) if (u.suppressed > 0) u.suppressed--;
  state.phase = 'enemy';
  state.version++;
  checkOutcome(state);
}

/** Plan and move an enemy, locking in its telegraphed intent. Does not attack. */
export function planEnemy(state: GameState, e: Unit, fx: Effect[]): void {
  const plan = planFor(state, e);
  e.plan = plan;
  const c = plan.chosen;
  if (!c) {
    e.intent = null;
    return;
  }
  if (c.mx !== e.x || c.my !== e.y) {
    const reach = reachable(state, e, 99);
    const steps = reach.cost[state.grid.idx(c.mx, c.my)];
    fx.push({ t: 'move', unitId: e.id, fromX: e.x, fromY: e.y, toX: c.mx, toY: c.my, steps: Number.isFinite(steps) ? steps : 1 });
    e.x = c.mx;
    e.y = c.my;
    applyHazard(state, e, fx);
  }
  e.intent = e.alive && c.weapon ? { weapon: c.weapon, tx: c.tx, ty: c.ty } : null;
  state.version++;
}

/** Room start: every enemy plans once so the first player turn already shows telegraphs. */
export function planAllEnemies(state: GameState, fx: Effect[]): void {
  for (const e of livingUnits(state, 'enemy')) planEnemy(state, e, fx);
}

/**
 * Runs the enemy phase one actor at a time so the presentation can pace it.
 * For each enemy: (1) carry out last round's locked intent, if still valid;
 * (2) plan the next move + attack and lock it in as the new telegraph.
 */
export class EnemyDirector {
  private queue: number[] = [];

  begin(state: GameState): void {
    this.queue = livingUnits(state, 'enemy').map((e) => e.id);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Processes the next enemy. Returns false once the phase is complete. */
  step(state: GameState, fx: Effect[]): boolean {
    while (this.queue.length > 0) {
      const id = this.queue.shift() as number;
      const e = state.units.find((u) => u.id === id);
      if (!e || !e.alive) continue;
      if (e.intent) {
        const w = WEAPONS[e.intent.weapon];
        if (intentValid(state, e, w, e.intent.tx, e.intent.ty)) resolveAttack(state, e, w, e.intent.tx, e.intent.ty, fx);
        else fx.push({ t: 'disrupted', unitId: e.id, x: e.x, y: e.y });
        e.intent = null;
        checkOutcome(state);
        if (state.phase === 'lost' || state.phase === 'cleared') return false;
      }
      if (e.alive) planEnemy(state, e, fx);
      checkOutcome(state);
      return this.queue.length > 0 || false;
    }
    return false;
  }

  /** Hand control back to the player: new turn, fresh actions. */
  finish(state: GameState): void {
    if (state.phase !== 'enemy') return;
    state.turn++;
    state.phase = 'player';
    for (const u of livingUnits(state, 'player')) {
      u.moved = false;
      u.acted = false;
    }
    state.version++;
  }
}

export const squadMove = (u: Unit): number => Math.max(1, UNITS[u.kind].move - (u.suppressed > 0 ? 2 : 0));
