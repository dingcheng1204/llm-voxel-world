import { describe, expect, it } from 'vitest';
import { TerrainGenerator } from './terrain';
import { spiral } from './world';

describe('TerrainGenerator', () => {
  it('is deterministic for a seed', () => {
    const a = new TerrainGenerator(42).generate(-2, 3);
    const b = new TerrainGenerator(42).generate(-2, 3);
    expect(a.blocks).toEqual(b.blocks);
  });

  it('keeps heights in range', () => {
    const t = new TerrainGenerator(7);
    for (let i = -500; i < 500; i += 37) {
      const h = t.heightAt(i, -i * 3);
      expect(h).toBeGreaterThanOrEqual(12);
      expect(h).toBeLessThanOrEqual(40);
    }
  });
});

describe('spiral', () => {
  it('returns nearest chunks first', () => {
    const s = spiral(0, 0, 2);
    expect(s.length).toBe(25);
    expect(s[0]).toEqual([0, 0]);
  });
});
