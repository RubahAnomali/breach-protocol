import type { GameState, Unit } from '../sim/State';
import type { Pt } from './Grid';

export interface Reach {
  /** Movement cost to each tile (Infinity = unreachable). */
  cost: number[];
  prev: number[];
}

const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Dijkstra over the grid. Four-way movement; walls, cover, barrels and other living units
 * block. Hazard tiles cost 2 to enter. The mover's own tile is the origin at cost 0.
 */
export function reachable(state: GameState, unit: Unit, maxCost: number, from?: Pt): Reach {
  const g = state.grid;
  const n = g.w * g.h;
  const cost = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const sx = from?.x ?? unit.x;
  const sy = from?.y ?? unit.y;
  const occupied = new Set<number>();
  for (const u of state.units) if (u.alive && u !== unit) occupied.add(g.idx(u.x, u.y));
  const open: number[] = [g.idx(sx, sy)];
  cost[open[0]] = 0;
  while (open.length > 0) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (cost[open[i]] < cost[open[bi]]) bi = i;
    const cur = open.splice(bi, 1)[0];
    const cx = cur % g.w;
    const cy = Math.floor(cur / g.w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!g.inBounds(nx, ny) || g.blocksMove(nx, ny)) continue;
      const ni = g.idx(nx, ny);
      if (occupied.has(ni)) continue;
      const c = cost[cur] + g.moveCost(nx, ny);
      if (c > maxCost || c >= cost[ni]) continue;
      cost[ni] = c;
      prev[ni] = cur;
      open.push(ni);
    }
  }
  return { cost, prev };
}

export function pathTo(state: GameState, reach: Reach, x: number, y: number): Pt[] | null {
  const g = state.grid;
  let i = g.idx(x, y);
  if (!Number.isFinite(reach.cost[i])) return null;
  const out: Pt[] = [];
  while (i !== -1) {
    out.push({ x: i % g.w, y: Math.floor(i / g.w) });
    i = reach.prev[i];
  }
  return out.reverse();
}
