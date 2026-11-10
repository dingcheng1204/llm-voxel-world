// A* over the voxel grid for character bodies (about 1 block tall).
// A node is a standing cell (x, y, z): y is the feet cell, the block below must be solid ground.
// Moves: 8 horizontal neighbours (diagonals only when both sides are clear), step up 1 block
// (needs headroom), drop down up to 3 blocks. Water, lava and the open sea are avoided.

import { B, IS_SOLID } from '../world/blocks';
import { SEA_LEVEL } from '../world/coords';

export interface PathWorld {
  getBlock(x: number, y: number, z: number): number;
}

export type Cell = [number, number, number];

export interface PathOptions {
  /** Expansion limit (performance guard). */
  maxNodes?: number;
  /** Stop when within this many blocks (horizontal) of the goal — e.g. 1.5 to stand next to a block. */
  near?: number;
  /** Return the path to the closest reachable cell if the goal cannot be reached. */
  allowPartial?: boolean;
}

export interface PathResult {
  path: Cell[];
  /** true if the path ends at (or near) the goal; false for a partial path. */
  complete: boolean;
  expanded: number;
}

const MAX_DROP = 3;
const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const solid = (w: PathWorld, x: number, y: number, z: number) => y < 0 || IS_SOLID[w.getBlock(x, y, z)] === 1;

/** Cells a body may occupy: not solid, not liquid, not fire, not under the open sea surface. */
function passable(w: PathWorld, x: number, y: number, z: number): boolean {
  if (y < 0 || y > 63) return false;
  const id = w.getBlock(x, y, z);
  if (IS_SOLID[id] === 1) return false;
  return id !== B.water && id !== B.lava && id !== B.fire;
}

/** Can a body stand with its feet in (x, y, z)? */
export function standable(w: PathWorld, x: number, y: number, z: number): boolean {
  if (y <= SEA_LEVEL) return false; // the sea surface sits at SEA_LEVEL + 0.82 → feet would be under water
  if (!passable(w, x, y, z) || !passable(w, x, y + 1, z)) return false; // body + a little headroom
  const below = w.getBlock(x, y - 1, z);
  return solid(w, x, y - 1, z) && below !== B.lava;
}

/** Highest standable cell in column (x, z) at or below `fromY`, or null. */
export function groundCell(w: PathWorld, x: number, z: number, fromY: number): Cell | null {
  for (let y = Math.min(62, fromY); y > SEA_LEVEL; y--) if (standable(w, x, y, z)) return [x, y, z];
  return null;
}

const key = (x: number, y: number, z: number) => ((x + 512) * 64 + y) * 1024 + (z + 512);

class MinHeap {
  private items: { k: number; f: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(k: number, f: number) {
    const a = this.items;
    a.push({ k, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.f <= a[i]!.f) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!.k;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.f < a[m]!.f) m = l;
        if (r < a.length && a[r]!.f < a[m]!.f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

export function findPath(w: PathWorld, start: Cell, goal: Cell, opts: PathOptions = {}): PathResult | null {
  const maxNodes = opts.maxNodes ?? 6000;
  const near = opts.near ?? 0;
  const h = (x: number, y: number, z: number) => {
    const dx = Math.abs(x - goal[0]);
    const dz = Math.abs(z - goal[2]);
    return Math.max(dx, dz) + 0.41 * Math.min(dx, dz) + Math.abs(y - goal[1]) * 0.5;
  };
  const isGoal = (x: number, y: number, z: number) =>
    near > 0
      ? Math.hypot(x - goal[0], z - goal[2]) <= near && Math.abs(y - goal[1]) <= 2
      : x === goal[0] && y === goal[1] && z === goal[2];

  const cells = new Map<number, Cell>();
  const g = new Map<number, number>();
  const parent = new Map<number, number>();
  const open = new MinHeap();
  const closed = new Set<number>();
  const sk = key(...start);
  cells.set(sk, start);
  g.set(sk, 0);
  open.push(sk, h(...start));
  let best = sk;
  let bestH = h(...start);
  let expanded = 0;

  const rebuild = (end: number): Cell[] => {
    const out: Cell[] = [];
    for (let k: number | undefined = end; k !== undefined; k = parent.get(k)) out.push(cells.get(k)!);
    return out.reverse();
  };

  while (open.size > 0 && expanded < maxNodes) {
    const k = open.pop();
    if (closed.has(k)) continue;
    closed.add(k);
    expanded++;
    const [x, y, z] = cells.get(k)!;
    if (isGoal(x, y, z)) return { path: rebuild(k), complete: true, expanded };
    const hk = h(x, y, z);
    if (hk < bestH) {
      bestH = hk;
      best = k;
    }
    const gk = g.get(k)!;

    for (const [dx, dz] of DIRS) {
      const nx = x + dx;
      const nz = z + dz;
      const diagonal = dx !== 0 && dz !== 0;
      // Diagonals must not cut corners.
      if (
        diagonal &&
        (!passable(w, x + dx, y, z) ||
          !passable(w, x, y, z + dz) ||
          !passable(w, x + dx, y + 1, z) ||
          !passable(w, x, y + 1, z + dz))
      )
        continue;
      let ny: number | null = null;
      if (standable(w, nx, y, nz)) ny = y;
      else if (!diagonal && standable(w, nx, y + 1, nz) && passable(w, x, y + 2, z))
        ny = y + 1; // step / jump up
      else if (passable(w, nx, y, nz) && passable(w, nx, y + 1, nz)) {
        for (let d = 1; d <= MAX_DROP; d++) {
          if (standable(w, nx, y - d, nz)) {
            ny = y - d;
            break;
          }
          if (!passable(w, nx, y - d, nz)) break;
        }
      }
      if (ny === null) continue;
      const nk = key(nx, ny, nz);
      if (closed.has(nk)) continue;
      const cost = gk + (diagonal ? 1.414 : 1) + (ny > y ? 0.6 : ny < y ? 0.2 : 0);
      if (cost < (g.get(nk) ?? Infinity)) {
        g.set(nk, cost);
        parent.set(nk, k);
        cells.set(nk, [nx, ny, nz]);
        open.push(nk, cost + h(nx, ny, nz));
      }
    }
  }
  if (opts.allowPartial && best !== sk) return { path: rebuild(best), complete: false, expanded };
  return null;
}
