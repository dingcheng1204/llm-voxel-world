import { describe, expect, it } from 'vitest';
import { B } from '../world/blocks';
import { findPath, standable } from './pathfinding';

/** Grass floor whose top block is at y = 30 (feet at 31), plus custom blocks. */
function makeWorld(extra: Record<string, number> = {}) {
  return {
    getBlock(x: number, y: number, z: number) {
      const k = `${x},${y},${z}`;
      if (k in extra) return extra[k]!;
      return y <= 30 ? B.grass : B.air;
    },
  };
}
const F = 31;

describe('findPath', () => {
  it('walks straight across flat ground', () => {
    const r = findPath(makeWorld(), [0, F, 0], [6, F, 0])!;
    expect(r.complete).toBe(true);
    expect(r.path.at(-1)).toEqual([6, F, 0]);
    expect(r.path.length).toBe(7);
  });

  it('goes around a wall', () => {
    const wall: Record<string, number> = {};
    for (let z = -3; z <= 3; z++) for (let y = F; y <= F + 2; y++) wall[`3,${y},${z}`] = B.stone;
    const r = findPath(makeWorld(wall), [0, F, 0], [6, F, 0])!;
    expect(r.complete).toBe(true);
    expect(r.path.every(([x, y, z]) => !(x === 3 && Math.abs(z) <= 3 && y >= F))).toBe(true);
  });

  it('steps up one block but not two', () => {
    const one = makeWorld({ '2,31,0': B.stone });
    const up = findPath(one, [0, F, 0], [2, F + 1, 0])!;
    expect(up.complete).toBe(true);
    const tower: Record<string, number> = {};
    for (let z = -20; z <= 20; z++)
      for (let x = 3; x <= 30; x++) {
        tower[`${x},31,${z}`] = B.stone;
        tower[`${x},32,${z}`] = B.stone;
      }
    expect(findPath(makeWorld(tower), [0, F, 0], [5, F + 2, 0], { maxNodes: 3000 })).toBeNull();
  });

  it('avoids water and lava', () => {
    const pool: Record<string, number> = {};
    for (let z = -1; z <= 1; z++) pool[`3,30,${z}`] = B.lava;
    pool['3,31,0'] = B.water;
    const r = findPath(makeWorld(pool), [0, F, 0], [6, F, 0])!;
    expect(r.path.some(([x, , z]) => x === 3 && Math.abs(z) <= 1)).toBe(false);
  });

  it('can stop next to a target block', () => {
    const r = findPath(makeWorld({ '5,31,0': B.log }), [0, F, 0], [5, F, 0], { near: 1.5 })!;
    expect(r.complete).toBe(true);
    const [x, , z] = r.path.at(-1)!;
    expect(Math.hypot(x - 5, z)).toBeLessThanOrEqual(1.5);
  });

  it('returns a partial path towards an unreachable goal when asked', () => {
    const box: Record<string, number> = {};
    for (let x = 8; x <= 12; x++)
      for (let z = -2; z <= 2; z++)
        for (let y = 31; y <= 33; y++)
          if (x === 8 || x === 12 || Math.abs(z) === 2) box[`${x},${y},${z}`] = B.stone;
    const r = findPath(makeWorld(box), [0, F, 0], [10, F, 0], { allowPartial: true, maxNodes: 2000 })!;
    expect(r.complete).toBe(false);
    expect(r.path.at(-1)![0]).toBeGreaterThan(4);
  });

  it('never stands under the sea surface', () => {
    const low = { getBlock: (_x: number, y: number) => (y <= 15 ? B.sand : B.air) };
    expect(standable(low, 0, 16, 0)).toBe(false);
  });
});
