import { AI_WEIGHTS, UNITS, WEAPONS, type WeaponId } from '../../data/defs';
import { chebyshev } from '../../grid/Grid';
import { reachable } from '../../grid/Pathing';
import { intentValid, resolveAttack, type Effect } from '../Combat';
import { cloneState, livingUnits, type Candidate, type FactorBreakdown, type GameState, type PlanDebug, type Unit } from '../State';

type EnemyKind = 'grunt' | 'suppressor' | 'breacher';

const zero = (): FactorBreakdown => ({ damage: 0, kill: 0, flank: 0, synergy: 0, exposure: 0, friendlyFire: 0, advance: 0 });

/** How exposed is a tile: player units that could shoot it, plus a penalty for hazard floor. */
function exposureAt(state: GameState, x: number, y: number): number {
  let n = 0;
  for (const p of livingUnits(state, 'player')) {
    const range = WEAPONS[UNITS[p.kind].weapons[0]].range + 1;
    if (chebyshev(p.x, p.y, x, y) <= range && state.grid.los(p.x, p.y, x, y)) n += p.kind === 'turret' ? 0.5 : 1;
  }
  let e = Math.min(1, n / 3);
  if (state.grid.get(x, y) === 'hazard') e = Math.min(1.5, e + 0.6);
  return e;
}

function advanceAt(state: GameState, x: number, y: number): number {
  let best = 12;
  for (const p of livingUnits(state, 'player')) best = Math.min(best, chebyshev(p.x, p.y, x, y));
  return 1 - best / 12;
}

/** Evaluate one (tile, weapon, target) option by running the real resolver on a clone. */
function evaluate(state: GameState, e: Unit, mx: number, my: number, weaponId: WeaponId, tx: number, ty: number): FactorBreakdown {
  const w = WEAPONS[weaponId];
  const scratch = cloneState(state);
  const a = scratch.units.find((u) => u.id === e.id) as Unit;
  a.x = mx;
  a.y = my;
  const fx: Effect[] = [];
  resolveAttack(scratch, a, w, tx, ty, fx);
  const f = zero();
  let shotHits = 0;
  let uncovered = 0;
  for (const ev of fx) {
    if (ev.t === 'status') f.damage += 0.35;
    if (ev.t !== 'damage') continue;
    const weight = ev.kind === 'turret' ? 0.5 : 1;
    if (ev.team === 'player') {
      f.damage += (ev.amount / 3) * weight;
      if (ev.killed) f.kill += weight;
      if (ev.source === 'explosion' || ev.source === 'collision') f.synergy += (ev.amount / 3) * weight;
      if (ev.source === 'shot') {
        shotHits++;
        if (!ev.cover) uncovered++;
      }
    } else {
      f.friendlyFire += ev.amount / 3 + (ev.killed ? 1.5 : 0);
    }
  }
  f.flank = shotHits > 0 ? uncovered / shotHits : 0;
  f.damage = Math.min(2, f.damage);
  f.synergy = Math.min(2, f.synergy);
  f.exposure = exposureAt(state, mx, my);
  f.advance = advanceAt(state, mx, my);
  return f;
}

function weigh(w: (typeof AI_WEIGHTS)[EnemyKind], f: FactorBreakdown): FactorBreakdown {
  return {
    damage: f.damage * w.damage,
    kill: f.kill * w.kill,
    flank: f.flank * w.flank,
    synergy: f.synergy * w.synergy,
    exposure: -f.exposure * w.exposure,
    friendlyFire: -f.friendlyFire * w.friendlyFire,
    advance: f.advance * w.advance,
  };
}

const sum = (f: FactorBreakdown): number => f.damage + f.kill + f.flank + f.synergy + f.exposure + f.friendlyFire + f.advance;

/**
 * Utility / action-scoring planner. Scores every (move tile, weapon, target tile) option with
 * transparent weighted factors (damage, kill, flank, synergy, exposure, friendly fire, advance)
 * and returns the winner plus the runner-ups and a per-tile heatmap for the F1 inspector.
 * Fully deterministic: ties break on cost, then tile index.
 */
export function planFor(state: GameState, e: Unit): PlanDebug {
  const def = UNITS[e.kind];
  const W = AI_WEIGHTS[e.kind as EnemyKind];
  const weaponId = def.weapons[0];
  const weapon = WEAPONS[weaponId];
  const move = Math.max(1, def.move - (e.suppressed > 0 ? 2 : 0));
  const reach = reachable(state, e, move);
  const g = state.grid;
  const all: { c: Candidate; cost: number; order: number }[] = [];
  const tileScores = new Array<number>(g.w * g.h).fill(NaN);
  let order = 0;

  for (let i = 0; i < reach.cost.length; i++) {
    const cost = reach.cost[i];
    if (!Number.isFinite(cost)) continue;
    const mx = i % g.w;
    const my = Math.floor(i / g.w);

    // option A: just reposition
    const base = zero();
    base.exposure = exposureAt(state, mx, my);
    base.advance = advanceAt(state, mx, my);
    const bw = weigh(W, base);
    all.push({ c: { mx, my, weapon: null, tx: -1, ty: -1, score: sum(bw) - cost * 0.001, factors: base, weighted: bw }, cost, order: order++ });

    // option B: attack from this tile
    for (let ty = 0; ty < g.h; ty++) {
      for (let tx = 0; tx < g.w; tx++) {
        if (tx === mx && ty === my) continue;
        const d = chebyshev(mx, my, tx, ty);
        if (d < weapon.minRange || d > weapon.range) continue;
        const occupant = state.units.find((u) => u.alive && u.x === tx && u.y === ty && u.id !== e.id);
        if (!occupant && g.get(tx, ty) !== 'barrel') continue;
        if (!g.los(mx, my, tx, ty)) continue;
        const f = evaluate(state, e, mx, my, weaponId, tx, ty);
        const wt = weigh(W, f);
        all.push({ c: { mx, my, weapon: weaponId, tx, ty, score: sum(wt) - cost * 0.001, factors: f, weighted: wt }, cost, order: order++ });
      }
    }
  }

  all.sort((a, b) => b.c.score - a.c.score || a.cost - b.cost || a.order - b.order);
  for (const { c } of all) {
    const ti = g.idx(c.mx, c.my);
    if (Number.isNaN(tileScores[ti]) || c.score > tileScores[ti]) tileScores[ti] = c.score;
  }
  const top = all.slice(0, 8).map((x) => x.c);
  return { chosen: top[0] ?? null, top, tileScores };
}

export function stillValid(state: GameState, e: Unit): boolean {
  return !!e.intent && intentValid(state, e, WEAPONS[e.intent.weapon], e.intent.tx, e.intent.ty);
}
