// Face-culling mesher. Pure function over a padded 18×64×18 volume so it can run in a worker.
// Output uses compact typed arrays (Uint8 positions/colours) and is transferable with zero copies.

import { BLOCK_RGB, B, IS_TRANSPARENT } from './blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, PAD_X, PAD_Z, paddedIndex } from './coords';

export interface MeshPart {
  /** Local chunk coords, 3 per vertex (0..64 fits in Uint8). */
  positions: Uint8Array;
  /** RGB per vertex, normalised in the shader (shading baked in). */
  colors: Uint8Array;
  indices: Uint16Array | Uint32Array;
  vertexCount: number;
}

export interface ChunkMeshData {
  opaque: MeshPart;
  water: MeshPart;
}

interface FaceDef {
  dx: number;
  dy: number;
  dz: number;
  /** 4 corners, CCW seen from outside (verified in mesher.test.ts). */
  corners: readonly (readonly [number, number, number])[];
  /** Baked directional light, Minecraft-style. */
  shade: number;
}

export const FACES: readonly FaceDef[] = [
  { dx: 1, dy: 0, dz: 0, shade: 0.8, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { dx: -1, dy: 0, dz: 0, shade: 0.8, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { dx: 0, dy: 1, dz: 0, shade: 1.0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dx: 0, dy: -1, dz: 0, shade: 0.5, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dx: 0, dy: 0, dz: 1, shade: 0.65, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dx: 0, dy: 0, dz: -1, shade: 0.65, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

const STRIDE_Y = PAD_X * PAD_Z;

function neighbor(padded: Uint8Array, i: number, y: number, f: FaceDef): number {
  const ny = y + f.dy;
  if (ny < 0) return B.bedrock;
  if (ny >= CHUNK_Y) return B.air;
  return padded[i + f.dx + f.dz * PAD_X + f.dy * STRIDE_Y] ?? B.air;
}

function visible(id: number, n: number): boolean {
  // Emit a face if the neighbour is see-through and not the same block (water/water, glass/glass hidden).
  return IS_TRANSPARENT[n] === 1 && n !== id;
}

export function meshChunk(padded: Uint8Array): ChunkMeshData {
  // Pass 1: count faces so every buffer is allocated exactly once.
  let opaqueFaces = 0;
  let waterFaces = 0;
  for (let y = 0; y < CHUNK_Y; y++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const i = paddedIndex(x, y, z);
        const id = padded[i] ?? 0;
        if (id === B.air) continue;
        for (const f of FACES) {
          if (visible(id, neighbor(padded, i, y, f))) {
            if (id === B.water) waterFaces++;
            else opaqueFaces++;
          }
        }
      }
    }
  }

  const opaque = allocPart(opaqueFaces);
  const water = allocPart(waterFaces);
  let oF = 0;
  let wF = 0;

  // Pass 2: fill.
  for (let y = 0; y < CHUNK_Y; y++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const i = paddedIndex(x, y, z);
        const id = padded[i] ?? 0;
        if (id === B.air) continue;
        for (const f of FACES) {
          if (!visible(id, neighbor(padded, i, y, f))) continue;
          if (id === B.water) writeFace(water, wF++, x, y, z, id, f);
          else writeFace(opaque, oF++, x, y, z, id, f);
        }
      }
    }
  }
  return { opaque, water };
}

function allocPart(faces: number): MeshPart {
  const vertexCount = faces * 4;
  return {
    positions: new Uint8Array(vertexCount * 3),
    colors: new Uint8Array(vertexCount * 3),
    indices: vertexCount > 0xffff ? new Uint32Array(faces * 6) : new Uint16Array(faces * 6),
    vertexCount,
  };
}

function writeFace(part: MeshPart, face: number, x: number, y: number, z: number, id: number, f: FaceDef): void {
  const v0 = face * 4;
  const r = Math.round((BLOCK_RGB[id * 3] ?? 0) * f.shade);
  const g = Math.round((BLOCK_RGB[id * 3 + 1] ?? 0) * f.shade);
  const b = Math.round((BLOCK_RGB[id * 3 + 2] ?? 0) * f.shade);
  for (let c = 0; c < 4; c++) {
    const corner = f.corners[c]!;
    const p = (v0 + c) * 3;
    part.positions[p] = x + corner[0];
    part.positions[p + 1] = y + corner[1];
    part.positions[p + 2] = z + corner[2];
    part.colors[p] = r;
    part.colors[p + 1] = g;
    part.colors[p + 2] = b;
  }
  const k = face * 6;
  part.indices[k] = v0;
  part.indices[k + 1] = v0 + 1;
  part.indices[k + 2] = v0 + 2;
  part.indices[k + 3] = v0;
  part.indices[k + 4] = v0 + 2;
  part.indices[k + 5] = v0 + 3;
}

/** Buffers to pass as the transfer list of postMessage. */
export function transferables(data: ChunkMeshData): ArrayBuffer[] {
  return [data.opaque, data.water].flatMap((p) => [
    p.positions.buffer as ArrayBuffer,
    p.colors.buffer as ArrayBuffer,
    p.indices.buffer as ArrayBuffer,
  ]);
}
