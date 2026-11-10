// Face-culling mesher. Pure function over a padded 18×64×18 volume so it can run in a worker.
// Output uses compact typed arrays (Uint8 positions/colours) and is transferable with zero copies.

import { B, FACE_RGB, IS_TRANSPARENT, RENDERS_AS_BLOCK } from './blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, PAD_X, PAD_Z, paddedIndex } from './coords';
import { hash3 } from './hash';

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
  /** 0 = top, 1 = side, 2 = bottom (selects the block's face colour). */
  kind: number;
}

export const FACES: readonly FaceDef[] = [
  { dx: 1, dy: 0, dz: 0, kind: 1, shade: 0.86, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { dx: -1, dy: 0, dz: 0, kind: 1, shade: 0.76, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { dx: 0, dy: 1, dz: 0, kind: 0, shade: 1.0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dx: 0, dy: -1, dz: 0, kind: 2, shade: 0.55, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dx: 0, dy: 0, dz: 1, kind: 1, shade: 0.8, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dx: 0, dy: 0, dz: -1, kind: 1, shade: 0.68, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
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

/**
 * @param cx,cz chunk coords — only used to give every block a stable, slightly different
 * brightness (the hand-painted, faceted toy look).
 */
export function meshChunk(padded: Uint8Array, cx = 0, cz = 0): ChunkMeshData {
  // Pass 1: count faces so every buffer is allocated exactly once.
  let opaqueFaces = 0;
  let waterFaces = 0;
  for (let y = 0; y < CHUNK_Y; y++) {
    for (let z = 0; z < CHUNK_Z; z++) {
      for (let x = 0; x < CHUNK_X; x++) {
        const i = paddedIndex(x, y, z);
        const id = padded[i] ?? 0;
        if (RENDERS_AS_BLOCK[id] === 0) continue;
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
        if (RENDERS_AS_BLOCK[id] === 0) continue;
        const tint = 0.93 + hash3(cx * CHUNK_X + x, y, cz * CHUNK_Z + z) * 0.14;
        for (const f of FACES) {
          if (!visible(id, neighbor(padded, i, y, f))) continue;
          if (id === B.water) writeFace(water, wF++, x, y, z, id, f, tint);
          else writeFace(opaque, oF++, x, y, z, id, f, tint);
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

function writeFace(
  part: MeshPart, face: number, x: number, y: number, z: number, id: number, f: FaceDef, tint: number,
): void {
  const v0 = face * 4;
  const c = (id * 3 + f.kind) * 3;
  const k = f.shade * tint;
  const r = Math.min(255, Math.round((FACE_RGB[c] ?? 0) * k));
  const g = Math.min(255, Math.round((FACE_RGB[c + 1] ?? 0) * k));
  const b = Math.min(255, Math.round((FACE_RGB[c + 2] ?? 0) * k));
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
  const n = face * 6;
  part.indices[n] = v0;
  part.indices[n + 1] = v0 + 1;
  part.indices[n + 2] = v0 + 2;
  part.indices[n + 3] = v0;
  part.indices[n + 4] = v0 + 2;
  part.indices[n + 5] = v0 + 3;
}

/** Buffers to pass as the transfer list of postMessage. */
export function transferables(data: ChunkMeshData): ArrayBuffer[] {
  return [data.opaque, data.water].flatMap((p) => [
    p.positions.buffer as ArrayBuffer,
    p.colors.buffer as ArrayBuffer,
    p.indices.buffer as ArrayBuffer,
  ]);
}
