import { describe, expect, it } from 'vitest';
import { World } from '../world/world';
import { SLIME, Slimes } from './slimes';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('Slimes', () => {
  const world = new World({ seed: 20261110, renderDistance: 6, genBudgetMs: 4, headless: true });
  world.loadAll();
  const plaza = world.terrain.plaza;
  // A spot well outside the plaza safe zone (forest side, west).
  const px = plaza.x - 40;
  const pz = plaza.z - 10;
  const player = { x: px + 0.5, y: world.groundY(px, pz), z: pz + 0.5, alive: true };

  it('spawn at night, chase and bite the player, and melt at dawn', () => {
    const slimes = new Slimes(world, plaza, seeded(3));
    let bites = 0;
    slimes.onBite = () => bites++;
    for (let i = 0; i < 60 * 60; i++) slimes.tick(1 / 60, 1, player);
    expect(slimes.list.length).toBeGreaterThan(0);
    expect(slimes.list.length).toBeLessThanOrEqual(SLIME.maxCount);
    expect(bites).toBeGreaterThan(0);
    for (let i = 0; i < 60 * 2; i++) slimes.tick(1 / 60, 0, player);
    expect(slimes.list).toHaveLength(0);
  });

  it('never spawn in the plaza safe zone, and die after enough hits', () => {
    const slimes = new Slimes(world, plaza, seeded(9));
    const safePlayer = { x: plaza.x, y: world.groundY(plaza.x, plaza.z), z: plaza.z, alive: true };
    for (let i = 0; i < 60 * 30; i++) slimes.tick(1 / 60, 1, safePlayer);
    for (const s of slimes.list) expect(slimes.safe(s.x, s.z)).toBe(false);
    const s2 = new Slimes(world, plaza, seeded(5));
    let kills = 0;
    s2.onKill = () => kills++;
    for (let i = 0; i < 60 * 10 && s2.list.length === 0; i++) s2.tick(1 / 60, 1, player);
    const s = s2.list[0]!;
    s.hit(4, player.x, player.z);
    expect(s.alive).toBe(true);
    s.hit(4, player.x, player.z);
    expect(s.alive).toBe(false);
    expect(kills).toBe(1);
  });
});
