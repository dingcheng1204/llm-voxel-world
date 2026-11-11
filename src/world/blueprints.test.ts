import { describe, expect, it } from 'vitest';
import { BLOCKS } from './blocks';
import { SEA_LEVEL } from './coords';
import {
  blueprint,
  blueprintCatalog,
  BLUEPRINTS,
  FACINGS,
  footprint,
  layoutSite,
  materialsOf,
  rotate,
  type SiteTerrain,
} from './blueprints';
import { TerrainGenerator } from './terrain';

const flat = (h = 24): SiteTerrain => ({ heightAt: () => h, seaLevel: SEA_LEVEL });

describe('blueprints', () => {
  it('only use blocks the characters can gather, inside their footprint, no duplicates', () => {
    const names = new Set(BLOCKS.map((b) => b.name));
    expect(BLUEPRINTS.map((b) => b.id)).toEqual(['hut', 'watchtower', 'dock', 'garden']);
    for (const bp of BLUEPRINTS) {
      const seen = new Set<string>();
      for (const [x, y, z, m] of bp.blocks) {
        expect(names.has(m), `${bp.id}: ${m}`).toBe(true);
        expect(['log', 'leaves', 'stone', 'flower_grass']).toContain(m);
        expect(x >= 0 && x < bp.w && z >= 0 && z < bp.d && y >= 0, `${bp.id} ${x},${y},${z}`).toBe(true);
        const k = `${x},${y},${z}`;
        expect(seen.has(k), `${bp.id} duplicate ${k}`).toBe(false);
        seen.add(k);
      }
    }
  });

  it('are small enough to gather for (each under 100 blocks)', () => {
    for (const bp of BLUEPRINTS) {
      const total = Object.values(materialsOf(bp)).reduce((a, b) => a + b, 0);
      expect(total).toBeLessThan(100);
    }
    expect(materialsOf(blueprint('hut')!)).toEqual({ log: 44, leaves: 35 });
  });

  it('the hut has a door: two empty blocks in the middle of the front wall', () => {
    const hut = blueprint('hut')!;
    const at = (x: number, y: number, z: number) =>
      hut.blocks.some((b) => b[0] === x && b[1] === y && b[2] === z);
    expect(at(2, 0, 4) || at(2, 1, 4)).toBe(false);
    expect(at(2, 2, 4)).toBe(true);
  });

  it('rotation keeps the footprint and turns the front to the facing side', () => {
    for (const bp of BLUEPRINTS) {
      for (const f of FACINGS) {
        const [fw, fd] = footprint(bp, f);
        const cells = new Set<string>();
        for (let x = 0; x < bp.w; x++) {
          for (let z = 0; z < bp.d; z++) {
            const [ox, oz] = rotate(x, z, bp, f);
            expect(ox >= 0 && ox < fw && oz >= 0 && oz < fd).toBe(true);
            cells.add(`${ox},${oz}`);
          }
        }
        expect(cells.size).toBe(bp.w * bp.d);
        // The front row (z = d-1) ends up on the facing side of the footprint.
        const [fx, fz] = rotate(0, bp.d - 1, bp, f);
        if (f === 'south') expect(fz).toBe(fd - 1);
        if (f === 'north') expect(fz).toBe(0);
        if (f === 'west') expect(fx).toBe(0);
        if (f === 'east') expect(fx).toBe(fw - 1);
      }
    }
  });

  it('lists every blueprint for the prompt', () => {
    const text = blueprintCatalog();
    for (const bp of BLUEPRINTS) expect(text).toContain(`"${bp.id}"`);
    expect(text).toContain('44 log');
  });
});

describe('layoutSite', () => {
  it('puts a land building on top of flat ground', () => {
    const r = layoutSite(blueprint('garden')!, 10, -5, 'south', flat(24));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.origin).toEqual([10, 25, -5]);
    expect(r.blocks).toHaveLength(blueprint('garden')!.blocks.length);
    expect(Math.min(...r.blocks.map((b) => b[1]))).toBe(25);
  });

  it('fills one-block dips with stone and refuses slopes and water', () => {
    const bumpy: SiteTerrain = { heightAt: (x) => (x === 10 ? 23 : 24), seaLevel: SEA_LEVEL };
    const r = layoutSite(blueprint('hut')!, 10, 0, 'south', bumpy);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.blocks.filter((b) => b[1] === 24 && b[3] === 'stone')).toHaveLength(5);
    const steep: SiteTerrain = { heightAt: (x) => 20 + x, seaLevel: SEA_LEVEL };
    expect(layoutSite(blueprint('hut')!, 0, 0, 'south', steep)).toMatchObject({ ok: false });
    const wet: SiteTerrain = { heightAt: () => SEA_LEVEL - 2, seaLevel: SEA_LEVEL };
    expect(layoutSite(blueprint('hut')!, 0, 0, 'south', wet)).toMatchObject({ ok: false });
  });

  it('lays a dock from the beach over the sea, with posts down to the sea floor', () => {
    // Beach for z < 2, sea (floor at 14) beyond.
    const shore: SiteTerrain = { heightAt: (_x, z) => (z < 2 ? SEA_LEVEL : 14), seaLevel: SEA_LEVEL };
    const r = layoutSite(blueprint('dock')!, 0, 0, 'south', shore);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.origin[1]).toBe(SEA_LEVEL + 1);
    const posts = r.blocks.filter((b) => b[3] === 'stone');
    expect(posts.length).toBeGreaterThan(0);
    expect(Math.min(...posts.map((p) => p[1]))).toBe(15);
    // Facing the wrong way (front on the beach) is refused with a hint.
    const wrong = layoutSite(blueprint('dock')!, 0, -6, 'north', shore);
    expect(wrong).toMatchObject({ ok: false });
  });

  it('finds room for each blueprint on the real island', () => {
    const terrain = new TerrainGenerator(20261110);
    const t: SiteTerrain = { heightAt: (x, z) => terrain.heightAt(x, z), seaLevel: SEA_LEVEL };
    for (const bp of BLUEPRINTS) {
      let found = 0;
      for (let x = -90; x < 85 && found < 3; x += 3) {
        for (let z = -140; z < 135 && found < 3; z += 3) {
          for (const f of FACINGS) if (layoutSite(bp, x, z, f, t).ok) found++;
        }
      }
      expect(found, bp.id).toBeGreaterThan(0);
    }
  });
});
