import { describe, expect, it } from 'vitest';
import { B } from './blocks';
import { CHUNK_Y, SEA_LEVEL } from './coords';
import { ISLAND_CHUNKS, TerrainGenerator } from './terrain';
import { spiral } from './world';

describe('TerrainGenerator (island)', () => {
  it('is deterministic for a seed', () => {
    const a = new TerrainGenerator(42);
    const b = new TerrainGenerator(42);
    expect(a.generate(-2, 1).blocks).toEqual(b.generate(-2, 1).blocks);
    expect(a.props).toEqual(b.props);
  });

  it('is land in the middle and sea at the edges', () => {
    const t = new TerrainGenerator(20261110);
    expect(t.heightAt(t.plazaCenter.x, t.plazaCenter.z)).toBeGreaterThan(SEA_LEVEL);
    const edge = (ISLAND_CHUNKS.maxX + 1) * 16 - 1;
    expect(t.heightAt(edge, edge)).toBeLessThan(SEA_LEVEL - 5);
  });

  it('keeps heights inside the chunk', () => {
    const t = new TerrainGenerator(7);
    for (let x = -48; x < 48; x += 5) {
      for (let z = -48; z < 48; z += 5) {
        const h = t.heightAt(x, z);
        expect(h).toBeGreaterThanOrEqual(1);
        expect(h).toBeLessThanOrEqual(CHUNK_Y - 2);
      }
    }
  });

  it('places a campfire (log + fire) in the plaza', () => {
    const t = new TerrainGenerator(20261110);
    const { x, z } = t.plazaCenter;
    const chunk = t.generate(Math.floor(x / 16), Math.floor(z / 16));
    const g = t.heightAt(x, z);
    const lx = ((x % 16) + 16) % 16;
    const lz = ((z % 16) + 16) % 16;
    expect(chunk.get(lx, g, lz)).toBe(B.log);
    expect(chunk.get(lx, g + 1, lz)).toBe(B.fire);
  });

  it('generates no water blocks (the ocean plane is the sea)', () => {
    const t = new TerrainGenerator(1);
    expect(t.generate(2, 2).blocks.includes(B.water)).toBe(false);
  });
});

describe('spiral', () => {
  it('returns nearest chunks first', () => {
    const s = spiral(0, 0, 2);
    expect(s.length).toBe(25);
    expect(s[0]).toEqual([0, 0]);
  });
});
