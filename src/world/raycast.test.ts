import { describe, expect, it } from 'vitest';
import { raycastVoxel } from './raycast';

const solidAt = (cells: [number, number, number][]) => {
  const set = new Set(cells.map((c) => c.join(',')));
  return (x: number, y: number, z: number) => (set.has(`${x},${y},${z}`) ? 1 : 0);
};
const hit = (id: number) => id !== 0;

describe('raycastVoxel', () => {
  it('hits the first block along the ray and reports the face normal', () => {
    const h = raycastVoxel(solidAt([[3, 0, 0]]), hit, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 });
    expect(h?.block).toEqual([3, 0, 0]);
    expect(h?.normal).toEqual([-1, 0, 0]);
    expect(h?.distance).toBeCloseTo(2.5);
  });

  it('works with negative coordinates', () => {
    const h = raycastVoxel(solidAt([[-3, -1, -2]]), hit, { x: -2.5, y: 1.5, z: -1.5 }, { x: -0.5, y: -2, z: -0.5 });
    expect(h?.block).toEqual([-3, -1, -2]);
    expect(h?.normal).toEqual([0, 1, 0]);
  });

  it('returns null beyond max distance', () => {
    expect(raycastVoxel(solidAt([[10, 0, 0]]), hit, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 5)).toBeNull();
  });

  it('places on the hit face: block + normal is the free cell in front', () => {
    const h = raycastVoxel(solidAt([[0, 0, 0]]), hit, { x: 0.5, y: 3.5, z: 0.5 }, { x: 0, y: -1, z: 0 })!;
    const place = h.block.map((v, i) => v + h.normal[i]!);
    expect(place).toEqual([0, 1, 0]);
  });
});
