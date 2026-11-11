// Phase 3 acceptance: 4 scripted characters run for 10 simulated minutes on the real island
// (headless world, same code as the browser) without getting stuck, falling into the sea or
// ending up inside blocks — and the gatherers complete "tree → 3 logs → home" cycles.
import { describe, expect, it } from 'vitest';
import { overlapsSolid } from '../player/physics';
import { SEA_LEVEL } from '../world/coords';
import { World } from '../world/world';
import { Agent } from './Agent';
import { DemoBrain } from './brains/demo';
import { CAST, type CastMember } from './cast';
import { ChatLog, Landmarks } from './worldState';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// The game runs 2 characters; the engine is budgeted for up to 4, so the soak test uses 4 bodies.
const SOAK_CAST: CastMember[] = [
  ...CAST,
  { id: 'test3', name: 'T3', species: 'wolf', brain: 'script', tagColor: '#10a37f' },
  { id: 'test4', name: 'T4', species: 'snake', brain: 'script', tagColor: '#6b7280' },
];

describe('soak: 4 agents × 10 simulated minutes', () => {
  it('keeps everyone moving, safe and productive', () => {
    const world = new World({ seed: 20261110, renderDistance: 6, genBudgetMs: 4, headless: true });
    world.loadAll();
    const landmarks = new Landmarks();
    const chat = new ChatLog();
    const spawns = world.terrain.spawnPoints(4);
    const agents: Agent[] = [];
    const ctx = {
      world,
      exec: {
        world,
        landmarks,
        bodies: () => agents.map((a) => ({ id: a.id, pos: a.body.pos, halfWidth: 0.35, height: 0.95 })),
      },
      perceive: {
        world,
        landmarks,
        chat,
        clock: { day: 1, clock: '10:00', t: 0.42 },
        others: () => agents.map((a) => ({ id: a.id, pos: a.body.pos, doing: a.executor.doing })),
        now: 0,
      },
    };
    const brains: DemoBrain[] = [];
    SOAK_CAST.forEach((m, i) => {
      const s = spawns[i]!;
      const brain = new DemoBrain(
        i % 2 === 0 ? 'gather' : 'explore',
        [Math.floor(s.x), Math.floor(s.y), Math.floor(s.z)],
        seeded(i + 1),
      );
      brains.push(brain);
      agents.push(new Agent(m, s, brain, ctx, 1.5));
    });

    const dt = 1 / 60;
    const ticks = 10 * 60 * 60;
    const stillFor = agents.map(() => 0);
    const maxStill = agents.map(() => 0);
    const last = agents.map((a) => a.body.pos.clone());
    let minY = Infinity;
    let insideSolid = 0;
    for (let t = 0; t < ticks; t++) {
      for (const a of agents) a.tick(dt, t * dt);
      agents.forEach((a, i) => {
        const walking = a.executor.current?.type === 'walk_to' || a.executor.current?.type === 'follow';
        if (walking && a.body.pos.distanceTo(last[i]!) < 0.02) stillFor[i]! += dt;
        else stillFor[i] = 0;
        maxStill[i] = Math.max(maxStill[i]!, stillFor[i]!);
        last[i]!.copy(a.body.pos);
        minY = Math.min(minY, a.body.pos.y);
        if (t % 60 === 0 && overlapsSolid(a.body.body, (x, y, z) => world.isSolid(x, y, z))) insideSolid++;
      });
    }

    const report = agents.map((a, i) => ({
      id: a.id,
      thinks: a.thinks,
      invalid: a.invalid,
      maxStill: +maxStill[i]!.toFixed(1),
      cycles: brains[i]!.cycles,
      fails: a.events.filter((e) => e.kind === 'action' && !(e.data as { ok: boolean }).ok).length,
    }));
    console.log(JSON.stringify(report));

    expect(insideSolid).toBe(0);
    expect(minY).toBeGreaterThan(SEA_LEVEL);
    for (const r of report) {
      expect(r.invalid).toBe(0);
      expect(r.maxStill).toBeLessThan(4); // a walking body never stands still for long (stall → repath/fail)
      expect(r.thinks).toBeGreaterThan(20);
    }
    // Gatherers finished "tree → mine 3 logs → home" at least twice in 10 minutes.
    expect(report[0]!.cycles).toBeGreaterThanOrEqual(2);
    expect(report[2]!.cycles).toBeGreaterThanOrEqual(2);
    expect(landmarks.list.length).toBeGreaterThanOrEqual(4);
  }, 120_000);
});
