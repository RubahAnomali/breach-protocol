import { GRID_H, GRID_W, type TileType } from '../data/defs';

export interface Pt {
  x: number;
  y: number;
}

/** 10x10 tactical grid: terrain, line-of-sight raycasting and cover queries. */
export class Grid {
  readonly w = GRID_W;
  readonly h = GRID_H;
  tiles: TileType[];

  constructor(tiles?: TileType[]) {
    this.tiles = tiles ? tiles.slice() : new Array<TileType>(GRID_W * GRID_H).fill('floor');
  }

  clone(): Grid {
    return new Grid(this.tiles);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  get(x: number, y: number): TileType {
    return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : 'wall';
  }

  set(x: number, y: number, t: TileType): void {
    if (this.inBounds(x, y)) this.tiles[this.idx(x, y)] = t;
  }

  /** Terrain that cannot be walked through (units are checked separately). */
  blocksMove(x: number, y: number): boolean {
    const t = this.get(x, y);
    return t === 'wall' || t === 'half' || t === 'full' || t === 'barrel';
  }

  /** Terrain that blocks sight lines. Half cover and barrels do not. */
  blocksLOS(x: number, y: number): boolean {
    const t = this.get(x, y);
    return t === 'wall' || t === 'full';
  }

  moveCost(x: number, y: number): number {
    return this.get(x, y) === 'hazard' ? 2 : 1;
  }

  /** Bresenham line from a to b, inclusive of both endpoints. */
  line(ax: number, ay: number, bx: number, by: number): Pt[] {
    const out: Pt[] = [];
    let x = ax;
    let y = ay;
    const dx = Math.abs(bx - ax);
    const dy = Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      out.push({ x, y });
      if (x === bx && y === by) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return out;
  }

  /** Clear line of sight: no wall / full cover on any tile strictly between the endpoints. */
  los(ax: number, ay: number, bx: number, by: number): boolean {
    const l = this.line(ax, ay, bx, by);
    for (let i = 1; i < l.length - 1; i++) if (this.blocksLOS(l[i].x, l[i].y)) return false;
    return true;
  }

  /**
   * Does the target have half cover against a shot from (sx, sy)? Cover is a half-cover tile
   * adjacent to the target on the side facing the shooter.
   */
  hasCover(sx: number, sy: number, tx: number, ty: number): boolean {
    const dx = Math.sign(sx - tx);
    const dy = Math.sign(sy - ty);
    if (dx === 0 && dy === 0) return false;
    if (dx !== 0 && this.get(tx + dx, ty) === 'half') return true;
    if (dy !== 0 && this.get(tx, ty + dy) === 'half') return true;
    return dx !== 0 && dy !== 0 && this.get(tx + dx, ty + dy) === 'half';
  }
}

export const chebyshev = (ax: number, ay: number, bx: number, by: number): number => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
export const manhattan = (ax: number, ay: number, bx: number, by: number): number => Math.abs(ax - bx) + Math.abs(ay - by);

/** Push direction for a shot: dominant axis, or a diagonal when the offsets are equal. */
export function pushVector(fromX: number, fromY: number, toX: number, toY: number): Pt {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax > ay) return { x: Math.sign(dx), y: 0 };
  if (ay > ax) return { x: 0, y: Math.sign(dy) };
  return { x: Math.sign(dx), y: Math.sign(dy) };
}
