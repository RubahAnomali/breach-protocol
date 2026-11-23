import { UNITS, WEAPONS, type Team, type UnitKind, type WeaponDef } from '../data/defs';
import { chebyshev, pushVector, type Pt } from '../grid/Grid';
import { cloneState, makeUnit, unitAt, type GameState, type Unit } from './State';

export type Effect =
  | { t: 'shot'; fromX: number; fromY: number; toX: number; toY: number; weapon: string }
  | { t: 'damage'; x: number; y: number; unitId: number; amount: number; killed: boolean; team: Team; kind: UnitKind; cover: boolean; source: 'shot' | 'collision' | 'explosion' | 'hazard' }
  | { t: 'push'; unitId: number; fromX: number; fromY: number; toX: number; toY: number }
  | { t: 'collision'; x: number; y: number; unitId: number; what: 'wall' | 'unit' | 'barrel' | 'cover' | 'edge' }
  | { t: 'explosion'; x: number; y: number }
  | { t: 'cover'; x: number; y: number }
  | { t: 'status'; unitId: number; x: number; y: number }
  | { t: 'deploy'; unitId: number; x: number; y: number }
  | { t: 'move'; unitId: number; fromX: number; fromY: number; toX: number; toY: number; steps: number }
  | { t: 'miss'; x: number; y: number }
  | { t: 'disrupted'; unitId: number; x: number; y: number };

export const COLLISION_DAMAGE = 1;
export const EXPLOSION_DAMAGE = 3;
export const HAZARD_DAMAGE = 1;

export function weaponDamage(w: WeaponDef, dist: number): number {
  return w.damage[Math.min(dist - 1, w.damage.length - 1)] ?? 0;
}

/** Why a target tile is invalid for a weapon, or null when it is fine. */
export function targetError(state: GameState, attacker: Unit, w: WeaponDef, tx: number, ty: number): string | null {
  const g = state.grid;
  if (!g.inBounds(tx, ty)) return 'Out of bounds';
  const d = chebyshev(attacker.x, attacker.y, tx, ty);
  if (d < w.minRange || d > w.range) return 'Out of range';
  if (w.kind === 'deploy') {
    if (g.get(tx, ty) !== 'floor' || unitAt(state, tx, ty)) return 'Tile must be empty floor';
    if (state.units.some((u) => u.alive && u.kind === 'turret')) return 'A sentry is already deployed';
    return null;
  }
  if (!g.los(attacker.x, attacker.y, tx, ty)) return 'No line of sight';
  const occupant = unitAt(state, tx, ty);
  if (!occupant && g.get(tx, ty) !== 'barrel') return 'Nothing to hit';
  return null;
}

export function validTargets(state: GameState, attacker: Unit, w: WeaponDef): Pt[] {
  const out: Pt[] = [];
  for (let y = 0; y < state.grid.h; y++) {
    for (let x = 0; x < state.grid.w; x++) {
      if (targetError(state, attacker, w, x, y) === null) out.push({ x, y });
    }
  }
  return out;
}

/** Can the attacker (at its current tile) still carry out this stored intent? */
export function intentValid(state: GameState, attacker: Unit, w: WeaponDef, tx: number, ty: number): boolean {
  const d = chebyshev(attacker.x, attacker.y, tx, ty);
  return d >= w.minRange && d <= w.range && state.grid.los(attacker.x, attacker.y, tx, ty);
}

function applyDamage(state: GameState, u: Unit, amount: number, source: 'shot' | 'collision' | 'explosion' | 'hazard', cover: boolean, fx: Effect[]): void {
  if (!u.alive || amount <= 0) return;
  u.hp -= amount;
  const killed = u.hp <= 0;
  if (killed) {
    u.hp = 0;
    u.alive = false;
  }
  fx.push({ t: 'damage', x: u.x, y: u.y, unitId: u.id, amount, killed, team: u.team, kind: u.kind, cover, source });
  state.version++;
}

function explode(state: GameState, x: number, y: number, fx: Effect[]): void {
  const g = state.grid;
  g.set(x, y, 'floor');
  fx.push({ t: 'explosion', x, y });
  const chain: Pt[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!g.inBounds(tx, ty)) continue;
      const u = unitAt(state, tx, ty);
      if (u) applyDamage(state, u, EXPLOSION_DAMAGE, 'explosion', false, fx);
      const t = g.get(tx, ty);
      if (t === 'half' || t === 'full') {
        g.set(tx, ty, 'floor');
        fx.push({ t: 'cover', x: tx, y: ty });
      } else if (t === 'barrel' && (dx !== 0 || dy !== 0)) chain.push({ x: tx, y: ty });
    }
  }
  for (const c of chain) if (state.grid.get(c.x, c.y) === 'barrel') explode(state, c.x, c.y, fx);
  state.version++;
}

/** Knockback along (dx, dy). Blocked pushes cost the pushed unit collision damage. */
function pushUnit(state: GameState, u: Unit, dx: number, dy: number, dist: number, fx: Effect[]): void {
  const g = state.grid;
  let moved = false;
  for (let i = 0; i < dist && u.alive; i++) {
    const nx = u.x + dx;
    const ny = u.y + dy;
    if (!g.inBounds(nx, ny)) {
      fx.push({ t: 'collision', x: u.x, y: u.y, unitId: u.id, what: 'edge' });
      applyDamage(state, u, COLLISION_DAMAGE, 'collision', false, fx);
      return;
    }
    const t = g.get(nx, ny);
    if (t === 'wall' || t === 'half' || t === 'full') {
      fx.push({ t: 'collision', x: nx, y: ny, unitId: u.id, what: t === 'wall' ? 'wall' : 'cover' });
      applyDamage(state, u, COLLISION_DAMAGE, 'collision', false, fx);
      return;
    }
    if (t === 'barrel') {
      fx.push({ t: 'collision', x: nx, y: ny, unitId: u.id, what: 'barrel' });
      applyDamage(state, u, COLLISION_DAMAGE, 'collision', false, fx);
      explode(state, nx, ny, fx);
      return;
    }
    const other = unitAt(state, nx, ny);
    if (other) {
      fx.push({ t: 'collision', x: nx, y: ny, unitId: u.id, what: 'unit' });
      applyDamage(state, u, COLLISION_DAMAGE, 'collision', false, fx);
      applyDamage(state, other, COLLISION_DAMAGE, 'collision', false, fx);
      return;
    }
    fx.push({ t: 'push', unitId: u.id, fromX: u.x, fromY: u.y, toX: nx, toY: ny });
    u.x = nx;
    u.y = ny;
    moved = true;
    state.version++;
  }
  if (moved && u.alive && g.get(u.x, u.y) === 'hazard') applyDamage(state, u, HAZARD_DAMAGE, 'hazard', false, fx);
}

/** Landing on a hazard tile by walking hurts too. */
export function applyHazard(state: GameState, u: Unit, fx: Effect[]): void {
  if (u.alive && state.grid.get(u.x, u.y) === 'hazard') applyDamage(state, u, HAZARD_DAMAGE, 'hazard', false, fx);
}

function hit(state: GameState, attacker: Unit, w: WeaponDef, target: Unit, dmg: number, fx: Effect[]): void {
  const covered = !w.ignoresCover && state.grid.hasCover(attacker.x, attacker.y, target.x, target.y);
  const amount = covered ? Math.max(1, dmg - 1) : dmg;
  const px = pushVector(attacker.x, attacker.y, target.x, target.y);
  applyDamage(state, target, amount, 'shot', covered, fx);
  if (!target.alive) return;
  if (w.suppress) {
    target.suppressed = 1;
    fx.push({ t: 'status', unitId: target.id, x: target.x, y: target.y });
  }
  if (w.push > 0) pushUnit(state, target, px.x, px.y, w.push, fx);
}

/**
 * Resolve a weapon use. Mutates `state` and appends effects. The same function drives live
 * play, enemy execution, turret fire and (on a clone) hover previews, so they cannot disagree.
 */
export function resolveAttack(state: GameState, attacker: Unit, w: WeaponDef, tx: number, ty: number, fx: Effect[]): void {
  if (w.kind === 'deploy') {
    const t = makeUnit(state, 'turret', tx, ty);
    t.acted = true;
    fx.push({ t: 'deploy', unitId: t.id, x: tx, y: ty });
    state.version++;
    return;
  }
  const g = state.grid;
  const dist = chebyshev(attacker.x, attacker.y, tx, ty);
  fx.push({ t: 'shot', fromX: attacker.x, fromY: attacker.y, toX: tx, toY: ty, weapon: w.id });
  const base = weaponDamage(w, dist);
  const target = unitAt(state, tx, ty);
  if (!target) {
    if (g.get(tx, ty) === 'barrel') explode(state, tx, ty, fx);
    else fx.push({ t: 'miss', x: tx, y: ty });
    return;
  }
  // collect pierce victims before anything moves
  const behind: Unit[] = [];
  if (w.pierce > 0) {
    const k = w.range / Math.max(1, dist);
    const ex = Math.max(0, Math.min(g.w - 1, Math.round(attacker.x + (tx - attacker.x) * k)));
    const ey = Math.max(0, Math.min(g.h - 1, Math.round(attacker.y + (ty - attacker.y) * k)));
    const line = g.line(attacker.x, attacker.y, ex, ey);
    const at = line.findIndex((p) => p.x === tx && p.y === ty);
    for (let i = at + 1; i < line.length && behind.length < w.pierce; i++) {
      if (g.blocksLOS(line[i].x, line[i].y)) break;
      const u = unitAt(state, line[i].x, line[i].y);
      if (u) behind.push(u);
    }
  }
  hit(state, attacker, w, target, base, fx);
  for (const u of behind) hit(state, attacker, w, u, Math.max(1, base - 1), fx);
}

export interface PreviewHit {
  unitId: number;
  x: number;
  y: number;
  team: Team;
  damage: number;
  kill: boolean;
  cover: boolean;
}

export interface AttackPreview {
  error: string | null;
  fx: Effect[];
  hits: PreviewHit[];
  pushes: Extract<Effect, { t: 'push' }>[];
  explosions: Pt[];
  collisions: Extract<Effect, { t: 'collision' }>[];
}

export function summarize(fx: Effect[]): Omit<AttackPreview, 'error'> {
  const hits = new Map<number, PreviewHit>();
  const pushes: Extract<Effect, { t: 'push' }>[] = [];
  const explosions: Pt[] = [];
  const collisions: Extract<Effect, { t: 'collision' }>[] = [];
  for (const e of fx) {
    if (e.t === 'damage') {
      const h = hits.get(e.unitId) ?? { unitId: e.unitId, x: e.x, y: e.y, team: e.team, damage: 0, kill: false, cover: false };
      h.damage += e.amount;
      h.kill = h.kill || e.killed;
      h.cover = h.cover || e.cover;
      hits.set(e.unitId, h);
    } else if (e.t === 'push') pushes.push(e);
    else if (e.t === 'explosion') explosions.push({ x: e.x, y: e.y });
    else if (e.t === 'collision') collisions.push(e);
  }
  return { fx, hits: [...hits.values()], pushes, explosions, collisions };
}

/** Exact outcome of an attack, computed by running the real resolver on a throwaway clone. */
export function previewAttack(state: GameState, attacker: Unit, w: WeaponDef, tx: number, ty: number): AttackPreview {
  const error = targetError(state, attacker, w, tx, ty);
  if (error) return { error, fx: [], hits: [], pushes: [], explosions: [], collisions: [] };
  const scratch = cloneState(state);
  const a = scratch.units.find((u) => u.id === attacker.id) as Unit;
  const fx: Effect[] = [];
  resolveAttack(scratch, a, w, tx, ty, fx);
  return { error: null, ...summarize(fx) };
}

/** Same as `previewAttack` but without range / validity checks (used for enemy intents). */
export function previewIntent(state: GameState, attacker: Unit, weaponId: keyof typeof WEAPONS, tx: number, ty: number): AttackPreview {
  const w = WEAPONS[weaponId];
  if (!intentValid(state, attacker, w, tx, ty)) return { error: 'Disrupted', fx: [], hits: [], pushes: [], explosions: [], collisions: [] };
  const scratch = cloneState(state);
  const a = scratch.units.find((u) => u.id === attacker.id) as Unit;
  const fx: Effect[] = [];
  resolveAttack(scratch, a, w, tx, ty, fx);
  return { error: null, ...summarize(fx) };
}

export function unitName(kind: UnitKind): string {
  return UNITS[kind].name;
}
