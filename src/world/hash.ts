// Tiny deterministic hashes (no dependencies, safe to import from workers).

/** Fast deterministic hash → [0, 1). */
export function hash2(x: number, z: number, seed: number): number {
  let h = (x * 374761393 + z * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash3(x: number, y: number, z: number): number {
  return hash2(x + y * 7919, z - y * 104729, 1337);
}
