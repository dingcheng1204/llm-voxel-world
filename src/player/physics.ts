// AABB-vs-voxel physics shared by the player and (later) every agent body.
// Fixed-step; resolves one axis at a time (Y, then X, then Z) as the voxel-engine skill specifies.

export interface Body {
  /** Feet centre. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** AABB half-width (x and z) and full height. */
  halfWidth: number;
  height: number;
  onGround: boolean;
}

export type SolidFn = (x: number, y: number, z: number) => boolean;

const EPS = 1e-4;

export const PLAYER = {
  halfWidth: 0.3,
  height: 1.8,
  eye: 1.62,
  gravity: 28,
  jump: 9,
  walk: 4.3,
  sprint: 5.6,
  maxFall: 50,
} as const;

export function createBody(
  x: number,
  y: number,
  z: number,
  halfWidth: number = PLAYER.halfWidth,
  height: number = PLAYER.height,
): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, halfWidth, height, onGround: false };
}

/** True if the body's AABB at its current position overlaps any solid block. */
export function overlapsSolid(b: Body, solid: SolidFn): boolean {
  const x0 = Math.floor(b.x - b.halfWidth + EPS);
  const x1 = Math.floor(b.x + b.halfWidth - EPS);
  const y0 = Math.floor(b.y + EPS);
  const y1 = Math.floor(b.y + b.height - EPS);
  const z0 = Math.floor(b.z - b.halfWidth + EPS);
  const z1 = Math.floor(b.z + b.halfWidth - EPS);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (solid(x, y, z)) return true;
  return false;
}

/** Does a block cell intersect the body's AABB? (used to forbid placing a block inside someone) */
export function blockIntersectsBody(bx: number, by: number, bz: number, b: Body): boolean {
  return (
    bx + 1 > b.x - b.halfWidth && bx < b.x + b.halfWidth &&
    by + 1 > b.y && by < b.y + b.height &&
    bz + 1 > b.z - b.halfWidth && bz < b.z + b.halfWidth
  );
}

/** Move along one axis by `delta`, stopping flush against the first solid block. Returns true if blocked. */
function moveAxis(b: Body, axis: 'x' | 'y' | 'z', delta: number, solid: SolidFn): boolean {
  if (delta === 0) return false;
  b[axis] += delta;
  if (!overlapsSolid(b, solid)) return false;
  // Snap back to the boundary of the block we ran into.
  if (axis === 'y') {
    b.y = delta > 0 ? Math.floor(b.y + b.height) - b.height - EPS : Math.floor(b.y) + 1 + EPS;
  } else {
    const p = b[axis];
    b[axis] = delta > 0 ? Math.floor(p + b.halfWidth) - b.halfWidth - EPS : Math.floor(p - b.halfWidth) + 1 + b.halfWidth + EPS;
  }
  // If snapping still overlaps (e.g. spawned inside a block), undo the move entirely.
  if (overlapsSolid(b, solid)) b[axis] -= delta;
  return true;
}

/**
 * Integrate velocity for one fixed step and resolve collisions.
 * Steps larger than half a block are split so fast falls never tunnel through floors.
 */
export function stepBody(b: Body, dt: number, solid: SolidFn): void {
  const maxMove = 0.45;
  const travel = Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt;
  const n = Math.max(1, Math.ceil(travel / maxMove));
  const h = dt / n;
  b.onGround = false;
  for (let i = 0; i < n; i++) {
    if (moveAxis(b, 'y', b.vy * h, solid)) {
      if (b.vy < 0) b.onGround = true;
      b.vy = 0;
    }
    if (moveAxis(b, 'x', b.vx * h, solid)) b.vx = 0;
    if (moveAxis(b, 'z', b.vz * h, solid)) b.vz = 0;
  }
  // Standing still on the ground still counts as grounded.
  if (!b.onGround && b.vy <= 0) {
    b.y -= 2 * EPS;
    b.onGround = overlapsSolid(b, solid);
    b.y += 2 * EPS;
  }
}
