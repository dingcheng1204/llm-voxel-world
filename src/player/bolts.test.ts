import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { World } from '../world/world';
import { Bolts } from './bolts';
import type { Hittable } from './controller';

describe('Bolts', () => {
  const world = new World({ seed: 20261110, renderDistance: 6, genBudgetMs: 4, headless: true });
  world.loadAll();
  const { x, z } = world.terrain.plaza;
  const y = world.groundY(x, z) + 1;

  it('hit the first target in their path', () => {
    const bolts = new Bolts();
    const hits: number[] = [];
    const target: Hittable = { id: 't', x: x + 6, y: y - 0.5, z, hit: (d) => hits.push(d) };
    bolts.fire(new THREE.Vector3(x, y, z), new THREE.Vector3(1, 0, 0), 14, 2, true);
    for (let i = 0; i < 60; i++) bolts.tick(1 / 60, world, () => [target]);
    expect(hits).toEqual([2]);
    expect(bolts.list).toHaveLength(0);
  });

  it('stop at blocks and at their range; remote bolts never hit', () => {
    const bolts = new Bolts();
    const hits: number[] = [];
    const target: Hittable = { id: 't', x: x + 6, y: y - 0.5, z, hit: (d) => hits.push(d) };
    bolts.fire(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0), 14, 2, true); // into the ground
    bolts.fire(new THREE.Vector3(x, y, z), new THREE.Vector3(1, 0, 0), 14, 2, false); // someone else's
    bolts.fire(new THREE.Vector3(x, y + 6, z), new THREE.Vector3(0, 1, 0), 3, 2, true); // short range, into the sky
    for (let i = 0; i < 120; i++) bolts.tick(1 / 60, world, () => [target]);
    expect(hits).toEqual([]);
    expect(bolts.list).toHaveLength(0);
  });
});
