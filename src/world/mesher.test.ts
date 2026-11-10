import { describe, expect, it } from 'vitest';
import { B } from './blocks';
import { PAD_VOLUME, paddedIndex } from './coords';
import { meshChunk, type MeshPart } from './mesher';

function volume(blocks: [number, number, number, number][]): Uint8Array {
  const v = new Uint8Array(PAD_VOLUME);
  for (const [x, y, z, id] of blocks) v[paddedIndex(x, y, z)] = id;
  return v;
}

function quadNormals(part: MeshPart): [number, number, number][] {
  const out: [number, number, number][] = [];
  const P = part.positions;
  for (let q = 0; q < part.vertexCount / 4; q++) {
    const o = q * 12;
    const a = [P[o]!, P[o + 1]!, P[o + 2]!];
    const u = [P[o + 3]! - a[0]!, P[o + 4]! - a[1]!, P[o + 5]! - a[2]!];
    const w = [P[o + 6]! - a[0]!, P[o + 7]! - a[1]!, P[o + 8]! - a[2]!];
    const n: [number, number, number] = [
      u[1]! * w[2]! - u[2]! * w[1]!,
      u[2]! * w[0]! - u[0]! * w[2]!,
      u[0]! * w[1]! - u[1]! * w[0]!,
    ];
    out.push(n.map((x) => Math.sign(x) + 0) as [number, number, number]);
  }
  return out;
}

describe('meshChunk (greedy)', () => {
  it('a lone block has 6 outward-facing quads', () => {
    const m = meshChunk(volume([[5, 10, 5, B.stone]]));
    expect(m.opaque.vertexCount).toBe(24);
    expect(m.opaque.indices.length).toBe(36);
    const normals = quadNormals(m.opaque).map((n) => n.join(','));
    expect(new Set(normals)).toEqual(new Set(['1,0,0', '-1,0,0', '0,1,0', '0,-1,0', '0,0,1', '0,0,-1']));
    // Every quad lies on the side of the block its normal points to (outward winding).
    const P = m.opaque.positions;
    quadNormals(m.opaque).forEach((n, q) => {
      const cx = (P[q * 12]! + P[q * 12 + 6]!) / 2 - 5.5;
      const cy = (P[q * 12 + 1]! + P[q * 12 + 7]!) / 2 - 10.5;
      const cz = (P[q * 12 + 2]! + P[q * 12 + 8]!) / 2 - 5.5;
      expect(cx * n[0] + cy * n[1] + cz * n[2]).toBeGreaterThan(0);
    });
  });

  it('merges a flat 16×16 floor into one top quad', () => {
    const blocks: [number, number, number, number][] = [];
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) blocks.push([x, 5, z, B.sand]);
    const m = meshChunk(volume(blocks));
    // top + bottom + 4 sides = 6 quads
    expect(m.opaque.vertexCount).toBe(6 * 4);
  });

  it('does not merge different blocks', () => {
    const m = meshChunk(volume([[5, 10, 5, B.stone], [6, 10, 5, B.dirt]]));
    expect(m.opaque.vertexCount).toBe(10 * 4);
  });

  it('does not emit a bottom face at y = 0 (bedrock below the world)', () => {
    const m = meshChunk(volume([[0, 0, 0, B.stone]]));
    expect(m.opaque.vertexCount).toBe(5 * 4);
  });

  it('respects neighbour blocks in the padding', () => {
    const m = meshChunk(volume([[0, 10, 0, B.stone], [-1, 10, 0, B.stone]]));
    expect(m.opaque.vertexCount).toBe(5 * 4);
  });

  it('puts water in its own mesh and merges water faces', () => {
    const m = meshChunk(volume([[3, 5, 3, B.water], [4, 5, 3, B.water]]));
    expect(m.water.vertexCount).toBe(6 * 4);
    expect(m.opaque.vertexCount).toBe(0);
  });

  it('does not mesh fire (drawn by FireSystem) and keeps neighbours visible', () => {
    const m = meshChunk(volume([[5, 10, 5, B.fire], [6, 10, 5, B.stone]]));
    expect(m.opaque.vertexCount).toBe(6 * 4);
  });

  it('uses the top colour on top faces', () => {
    const m = meshChunk(volume([[5, 10, 5, B.grass]]));
    for (let v = 0; v < m.opaque.vertexCount; v++) {
      if (m.opaque.positions[v * 3 + 1] === 11 && m.opaque.positions[v * 3 + 4 - 3] === 11) {
        const [r, g, b] = [0, 1, 2].map((k) => m.opaque.colors[v * 3 + k]!);
        expect(g).toBeGreaterThan(r!);
        expect(g).toBeGreaterThan(b!);
      }
    }
  });

  it('uses 16-bit indices for small meshes', () => {
    expect(meshChunk(volume([[1, 1, 1, B.stone]])).opaque.indices).toBeInstanceOf(Uint16Array);
  });
});
