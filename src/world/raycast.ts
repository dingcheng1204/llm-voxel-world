// Voxel DDA raycast (Amanatides & Woo). Steps exactly through the grid cells a ray crosses,
// so picking is exact and cheap. Used by the player and (later) by agents for "what am I looking at".

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface VoxelHit {
  /** The block that was hit. */
  block: [number, number, number];
  /** Face normal of the hit face; `block + normal` is where a placed block goes. */
  normal: [number, number, number];
  id: number;
  distance: number;
}

/**
 * @param getBlock world block lookup
 * @param hits which block ids count as hittable (e.g. everything except air and water)
 */
export function raycastVoxel(
  getBlock: (x: number, y: number, z: number) => number,
  hits: (id: number) => boolean,
  origin: Vec3Like,
  dir: Vec3Like,
  maxDist = 5,
): VoxelHit | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len === 0) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  const dz = dir.z / len;

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  const frac = (v: number, s: number) => (s > 0 ? Math.floor(v) + 1 - v : v - Math.floor(v));
  let tMaxX = dx !== 0 ? frac(origin.x, stepX) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? frac(origin.y, stepY) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? frac(origin.z, stepZ) * tDeltaZ : Infinity;
  let normal: [number, number, number] = [0, 0, 0];
  let t = 0;

  // The starting cell counts too (e.g. standing inside fire or leaves).
  while (t <= maxDist) {
    const id = getBlock(x, y, z);
    if (hits(id)) return { block: [x, y, z], normal, id, distance: t };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      normal = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      normal = [0, -stepY, 0];
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      normal = [0, 0, -stepZ];
    }
  }
  return null;
}
