// Coordinate helpers. See .claude/skills/voxel-engine/SKILL.md §1–2.
// All index math lives here — never inline it elsewhere.

export const CHUNK_X = 16;
export const CHUNK_Z = 16;
export const CHUNK_Y = 64;
export const CHUNK_VOLUME = CHUNK_X * CHUNK_Z * CHUNK_Y;
export const SEA_LEVEL = 20;

/** Padded volume used for meshing: one extra block on each horizontal side. */
export const PAD_X = CHUNK_X + 2;
export const PAD_Z = CHUNK_Z + 2;
export const PAD_VOLUME = PAD_X * PAD_Z * CHUNK_Y;

export type ChunkKey = string;

export function worldToChunk(x: number, z: number): [cx: number, cz: number] {
  return [Math.floor(x / CHUNK_X), Math.floor(z / CHUNK_Z)];
}

/** Local coord in [0, size) for any integer world coord, including negatives. */
export function worldToLocal(v: number, size: number): number {
  return ((v % size) + size) % size;
}

/** Index into a chunk's Uint8Array. Y-major: a horizontal slice is contiguous. */
export function localIndex(lx: number, ly: number, lz: number): number {
  return lx + lz * CHUNK_X + ly * CHUNK_X * CHUNK_Z;
}

/** Index into a padded (18×64×18) meshing volume; lx/lz may be -1 or 16. */
export function paddedIndex(lx: number, ly: number, lz: number): number {
  return lx + 1 + (lz + 1) * PAD_X + ly * PAD_X * PAD_Z;
}

export function chunkKey(cx: number, cz: number): ChunkKey {
  return `${cx},${cz}`;
}

export function parseChunkKey(key: ChunkKey): [cx: number, cz: number] {
  const [a, b] = key.split(',');
  return [Number(a), Number(b)];
}
