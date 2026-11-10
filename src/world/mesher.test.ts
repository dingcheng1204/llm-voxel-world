import { describe, expect, it } from 'vitest';
import { B } from './blocks';
import { PAD_VOLUME, paddedIndex } from './coords';
import { FACES, meshChunk } from './mesher';

function volume(blocks: [number, number, number, number][]): Uint8Array {
  const v = new Uint8Array(PAD_VOLUME);
  for (const [x, y, z, id] of blocks) v[paddedIndex(x, y, z)] = id;
  return v;
}

describe('FACES', () => {
  it('every face is wound counter-clockwise when seen from outside', () => {
    for (const f of FACES) {
      const [a, b, c] = f.corners as [number, number, number][];
      const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
      const w = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
      const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      expect(n.map((v) => v + 0)).toEqual([f.dx, f.dy, f.dz]);
    }
  });
});

describe('meshChunk', () => {
  it('a lone block in the air has 6 faces', () => {
    const m = meshChunk(volume([[5, 10, 5, B.stone]]));
    expect(m.opaque.vertexCount).toBe(24);
    expect(m.opaque.indices.length).toBe(36);
    expect(m.water.vertexCount).toBe(0);
  });

  it('culls the shared face between two adjacent blocks', () => {
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

  it('puts water in its own mesh and hides water/water faces', () => {
    const m = meshChunk(volume([[3, 5, 3, B.water], [4, 5, 3, B.water]]));
    expect(m.water.vertexCount).toBe(10 * 4);
    expect(m.opaque.vertexCount).toBe(0);
  });

  it('switches to 32-bit indices only when needed', () => {
    expect(meshChunk(volume([[1, 1, 1, B.stone]])).opaque.indices).toBeInstanceOf(Uint16Array);
  });
});
