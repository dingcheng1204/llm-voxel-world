import alea from 'alea';
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { B } from './blocks';
import { CHUNK_X, CHUNK_Z, SEA_LEVEL, localIndex } from './coords';
import { Chunk } from './chunk';

const { grass, dirt, stone, sand, water, bedrock, log, leaves } = B;

/** Deterministic terrain: same seed ⇒ same world everywhere. */
export class TerrainGenerator {
  private readonly noise: NoiseFunction2D;

  constructor(readonly seed: number) {
    this.noise = createNoise2D(alea(seed));
  }

  heightAt(x: number, z: number): number {
    let amp = 1;
    let freq = 1 / 96;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < 4; o++) {
      sum += amp * this.noise(x * freq, z * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    const n = sum / norm; // [-1, 1]
    return Math.floor(12 + ((n + 1) / 2) * 28); // [12, 40]
  }

  generate(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    const b = chunk.blocks;
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const wx = cx * CHUNK_X + lx;
        const wz = cz * CHUNK_Z + lz;
        const h = this.heightAt(wx, wz);
        const beach = h <= SEA_LEVEL + 1;
        for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
          let id: number;
          if (y === 0) id = bedrock;
          else if (y > h) id = water;
          else if (y === h) id = beach ? sand : grass;
          else if (y >= h - 3) id = beach ? sand : dirt;
          else id = stone;
          b[localIndex(lx, y, lz)] = id;
        }
        // Trees: deterministic per-column hash, kept 2 blocks inside the chunk so leaves never cross borders.
        if (!beach && lx >= 2 && lx < CHUNK_X - 2 && lz >= 2 && lz < CHUNK_Z - 2 && hash2(wx, wz, this.seed) < 0.01) {
          plantTree(chunk, lx, h + 1, lz, 4 + Math.floor(hash2(wz, wx, this.seed) * 3));
        }
      }
    }
    return chunk;
  }
}

function plantTree(chunk: Chunk, lx: number, y: number, lz: number, trunk: number): void {
  for (let dy = -2; dy <= 1; dy++) {
    const r = dy >= 0 ? 1 : 2;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && dy !== -1) continue;
        if (chunk.get(lx + dx, y + trunk + dy, lz + dz) === 0) chunk.set(lx + dx, y + trunk + dy, lz + dz, leaves);
      }
    }
  }
  for (let i = 0; i < trunk; i++) chunk.set(lx, y + i, lz, log);
}

/** Fast deterministic hash → [0, 1). */
export function hash2(x: number, z: number, seed: number): number {
  let h = (x * 374761393 + z * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
