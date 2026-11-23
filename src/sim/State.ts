import { GRID_H, GRID_W, ROOMS, UNITS, type TileType, type Team, type UnitKind, type WeaponId } from '../data/defs';
import { Grid } from '../grid/Grid';

export interface Intent {
  weapon: WeaponId;
  tx: number;
  ty: number;
}

export interface FactorBreakdown {
  damage: number;
  kill: number;
  flank: number;
  synergy: number;
  exposure: number;
  friendlyFire: number;
  advance: number;
}

export interface Candidate {
  mx: number;
  my: number;
  weapon: WeaponId | null;
  tx: number;
  ty: number;
  score: number;
  /** Raw (pre-weight) factor values. */
  factors: FactorBreakdown;
  /** Weighted contributions that sum to `score`. */
  weighted: FactorBreakdown;
}

export interface PlanDebug {
  chosen: Candidate | null;
  top: Candidate[];
  /** Best candidate score per tile (NaN = unreachable), for the heatmap. */
  tileScores: number[];
}

export interface Unit {
  id: number;
  kind: UnitKind;
  team: Team;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  moved: boolean;
  acted: boolean;
  /** Turns of "suppressed" remaining (-2 move). */
  suppressed: number;
  intent: Intent | null;
  plan: PlanDebug | null;
}

export type Phase = 'player' | 'enemy' | 'cleared' | 'won' | 'lost';

export interface GameState {
  grid: Grid;
  units: Unit[];
  turn: number;
  phase: Phase;
  room: number;
  nextId: number;
  /** Bumps on every mutation so derived data (previews) can be cached. */
  version: number;
}

export function makeUnit(state: GameState, kind: UnitKind, x: number, y: number): Unit {
  const d = UNITS[kind];
  const u: Unit = { id: state.nextId++, kind, team: d.team, x, y, hp: d.hp, maxHp: d.hp, alive: true, moved: false, acted: false, suppressed: 0, intent: null, plan: null };
  state.units.push(u);
  return u;
}

const LAYOUT_TILE: Record<string, TileType> = { '.': 'floor', '#': 'wall', h: 'half', F: 'full', B: 'barrel', '~': 'hazard' };
const LAYOUT_UNIT: Record<string, UnitKind> = { V: 'vanguard', R: 'recon', E: 'engineer', g: 'grunt', s: 'suppressor', b: 'breacher' };

/** Build a fresh room. `carry` brings the surviving squad's HP over from the previous room. */
export function buildRoom(room: number, carry?: Map<UnitKind, number>): GameState {
  const def = ROOMS[room];
  const state: GameState = { grid: new Grid(), units: [], turn: 1, phase: 'player', room, nextId: 1, version: 0 };
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const c = def.layout[y][x];
      state.grid.set(x, y, LAYOUT_TILE[c] ?? 'floor');
      const k = LAYOUT_UNIT[c];
      if (k) {
        const u = makeUnit(state, k, x, y);
        const hp = carry?.get(k);
        if (hp !== undefined && u.team === 'player') u.hp = Math.min(u.maxHp, hp);
      }
    }
  }
  return state;
}

export function cloneState(s: GameState): GameState {
  return {
    grid: s.grid.clone(),
    units: s.units.map((u) => ({ ...u, intent: u.intent ? { ...u.intent } : null, plan: null })),
    turn: s.turn,
    phase: s.phase,
    room: s.room,
    nextId: s.nextId,
    version: s.version,
  };
}

export const unitAt = (s: GameState, x: number, y: number): Unit | undefined => s.units.find((u) => u.alive && u.x === x && u.y === y);
export const livingUnits = (s: GameState, team: Team): Unit[] => s.units.filter((u) => u.alive && u.team === team);

/** Memento used by commands for exact undo. Plans are debug-only and not restored. */
export interface Snapshot {
  tiles: TileType[];
  units: Unit[];
  nextId: number;
}

export function takeSnapshot(s: GameState): Snapshot {
  return { tiles: s.grid.tiles.slice(), units: s.units.map((u) => ({ ...u, intent: u.intent ? { ...u.intent } : null })), nextId: s.nextId };
}

export function restoreSnapshot(s: GameState, snap: Snapshot): void {
  s.grid.tiles = snap.tiles.slice();
  s.units = snap.units.map((u) => ({ ...u, intent: u.intent ? { ...u.intent } : null }));
  s.nextId = snap.nextId;
  s.version++;
}
