// Greedy mesher. Pure function over a padded 18×64×18 volume so it runs in a worker.
// Adjacent visible faces of the same block and direction are merged into one big quad, which cuts
// triangles several-fold on flat ground, sea floor and cliff walls. The per-block brightness
// variation (faceted toy look) is applied per block cell in the fragment shader (see world.ts),
// so merging does not lose it. Output uses compact transferable typed arrays.

import { B, FACE_RGB, IS_TRANSPARENT, RENDERS_AS_BLOCK } from './blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, PAD_X, PAD_Z, paddedIndex } from './coords';

export interface MeshPart {
  /** Local chunk coords, 3 per vertex (0..64 fits in Uint8). */
  positions: Uint8Array;
  /** RGB per vertex, normalised in the shader (directional shade baked in). */
  colors: Uint8Array;
  indices: Uint16Array | Uint32Array;
  vertexCount: number;
}

export interface ChunkMeshData {
  opaque: MeshPart;
  water: MeshPart;
}

interface Direction {
  /** Axis the face normal points along: 0 = x, 1 = y, 2 = z. */
  d: number;
  /** +1 or -1. */
  s: number;
  /** Baked directional light, Minecraft-style. */
  shade: number;
  /** 0 = top, 1 = side, 2 = bottom (selects the block's face colour). */
  kind: number;
}

export const DIRECTIONS: readonly Direction[] = [
  { d: 0, s: 1, shade: 0.86, kind: 1 },
  { d: 0, s: -1, shade: 0.76, kind: 1 },
  { d: 1, s: 1, shade: 1.0, kind: 0 },
  { d: 1, s: -1, shade: 0.55, kind: 2 },
  { d: 2, s: 1, shade: 0.8, kind: 1 },
  { d: 2, s: -1, shade: 0.68, kind: 1 },
];

const DIMS: readonly number[] = [CHUNK_X, CHUNK_Y, CHUNK_Z];
const STRIDE: readonly number[] = [1, PAD_X * PAD_Z, PAD_X]; // padded index step per axis (x, y, z)

/** Growable scratch buffers, reused across calls inside one worker. */
class Builder {
  pos = new Uint8Array(4096 * 12);
  col = new Uint8Array(4096 * 12);
  quads = 0;

  reset(): void {
    this.quads = 0;
  }

  quad(corners: number[], r: number, g: number, b: number): void {
    if ((this.quads + 1) * 12 > this.pos.length) {
      const grow = (a: Uint8Array) => {
        const n = new Uint8Array(a.length * 2);
        n.set(a);
        return n;
      };
      this.pos = grow(this.pos);
      this.col = grow(this.col);
    }
    const o = this.quads * 12;
    for (let i = 0; i < 12; i++) this.pos[o + i] = corners[i]!;
    for (let v = 0; v < 4; v++) {
      this.col[o + v * 3] = r;
      this.col[o + v * 3 + 1] = g;
      this.col[o + v * 3 + 2] = b;
    }
    this.quads++;
  }

  build(): MeshPart {
    const vertexCount = this.quads * 4;
    const indices = vertexCount > 0xffff ? new Uint32Array(this.quads * 6) : new Uint16Array(this.quads * 6);
    for (let q = 0; q < this.quads; q++) {
      const v = q * 4;
      const n = q * 6;
      indices[n] = v;
      indices[n + 1] = v + 1;
      indices[n + 2] = v + 2;
      indices[n + 3] = v;
      indices[n + 4] = v + 2;
      indices[n + 5] = v + 3;
    }
    return {
      positions: this.pos.slice(0, vertexCount * 3),
      colors: this.col.slice(0, vertexCount * 3),
      indices,
      vertexCount,
    };
  }
}

const opaqueB = new Builder();
const waterB = new Builder();
const mask = new Int16Array(CHUNK_Y * CHUNK_Y); // big enough for any slice (max 64×16)
const corners = new Array<number>(12).fill(0);

function visible(id: number, n: number): boolean {
  // Emit a face if the neighbour is see-through and not the same block (water/water, glass/glass hidden).
  return IS_TRANSPARENT[n] === 1 && n !== id;
}

export function meshChunk(padded: Uint8Array): ChunkMeshData {
  opaqueB.reset();
  waterB.reset();
  const c = [0, 0, 0];

  for (const dir of DIRECTIONS) {
    const { d, s } = dir;
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const du = DIMS[u]!;
    const dv = DIMS[v]!;
    const nStep = STRIDE[d]! * s;

    for (let p = 0; p < DIMS[d]!; p++) {
      // 1. Mask of visible faces in this slice.
      c[d] = p;
      let k = 0;
      for (let j = 0; j < dv; j++) {
        c[v] = j;
        for (let i = 0; i < du; i++, k++) {
          c[u] = i;
          const idx = paddedIndex(c[0]!, c[1]!, c[2]!);
          const id = padded[idx] ?? 0;
          if (RENDERS_AS_BLOCK[id] === 0) {
            mask[k] = 0;
            continue;
          }
          let n: number;
          if (d === 1 && p + s < 0) n = B.bedrock;
          else if (d === 1 && p + s >= CHUNK_Y) n = B.air;
          else n = padded[idx + nStep] ?? 0;
          mask[k] = visible(id, n) ? id : 0;
        }
      }

      // 2. Greedy rectangles over the mask.
      for (let j = 0; j < dv; j++) {
        for (let i = 0; i < du; ) {
          const at = j * du + i;
          const cur = mask[at]!;
          if (cur === 0) {
            i++;
            continue;
          }
          let w = 1;
          while (i + w < du && mask[at + w] === cur) w++;
          let h = 1;
          grow: while (j + h < dv) {
            const row = (j + h) * du + i;
            for (let q = 0; q < w; q++) if (mask[row + q] !== cur) break grow;
            h++;
          }
          emit(dir, u, v, p, i, j, w, h, cur);
          for (let y2 = 0; y2 < h; y2++) mask.fill(0, (j + y2) * du + i, (j + y2) * du + i + w);
          i += w;
        }
      }
    }
  }
  return { opaque: opaqueB.build(), water: waterB.build() };
}

function emit(dir: Direction, u: number, v: number, p: number, i: number, j: number, w: number, h: number, id: number) {
  const plane = dir.s > 0 ? p + 1 : p;
  // base, base+du, base+du+dv, base+dv — CCW around +d (e_u × e_v = e_d); reversed for -d.
  const set = (slot: number, du: number, dv: number) => {
    const o = slot * 3;
    corners[o + dir.d] = plane;
    corners[o + u] = i + du;
    corners[o + v] = j + dv;
  };
  if (dir.s > 0) {
    set(0, 0, 0);
    set(1, w, 0);
    set(2, w, h);
    set(3, 0, h);
  } else {
    set(0, 0, 0);
    set(1, 0, h);
    set(2, w, h);
    set(3, w, 0);
  }
  const ci = (id * 3 + dir.kind) * 3;
  const r = Math.round((FACE_RGB[ci] ?? 0) * dir.shade);
  const g = Math.round((FACE_RGB[ci + 1] ?? 0) * dir.shade);
  const b = Math.round((FACE_RGB[ci + 2] ?? 0) * dir.shade);
  (id === B.water ? waterB : opaqueB).quad(corners, r, g, b);
}

/** Buffers to pass as the transfer list of postMessage. */
export function transferables(data: ChunkMeshData): ArrayBuffer[] {
  return [data.opaque, data.water].flatMap((p) => [
    p.positions.buffer as ArrayBuffer,
    p.colors.buffer as ArrayBuffer,
    p.indices.buffer as ArrayBuffer,
  ]);
}
