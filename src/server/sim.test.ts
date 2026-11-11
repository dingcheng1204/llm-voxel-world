// Server simulation: the same engine as the browser, run headless for one tick of real time.
import { describe, expect, it } from 'vitest';
import { createSim } from './sim';

const SEED = 20261110;

describe('createSim', () => {
  it('spawns at the cast slot, executes an LLM plan for 60 s and returns a restorable snapshot', () => {
    const sim = createSim({ seed: SEED, agentId: 'clio', snapshot: null, edits: [] });
    const p = sim.perception();
    expect(p.self.pos).toHaveLength(3);
    const [x, y, z] = p.self.pos;
    const out = sim.run(
      {
        thought: 'walk a bit',
        say: '出發！',
        actions: [
          { type: 'walk_to', target: [x + 6, y, z] },
          { type: 'name_place', name: 'test spot' },
        ],
      },
      60,
    );
    expect(out.walked).toBeGreaterThan(3);
    expect(out.results[0]?.action).toBe('walk_to');
    expect(out.snapshot.say).toBe('出發！');
    expect(out.snapshot.thought).toBe('walk a bit');
    expect(out.snapshot.landmarks.map((l) => l.name)).toContain('test spot');

    // Next tick resumes from the snapshot (different World instance, like a new function call).
    const again = createSim({ seed: SEED, agentId: 'clio', snapshot: out.snapshot, edits: [] });
    const p2 = again.perception();
    expect(p2.self.pos).toEqual(sim.perception().self.pos);
    expect(p2.landmarks.some((l) => l.name === 'test spot')).toBe(true);
  }, 30_000);

  it('applies saved edits, reports its own edits and rests without a plan', () => {
    const sim = createSim({ seed: SEED, agentId: 'clio', snapshot: null, edits: [] });
    const [x, y, z] = sim.perception().self.pos;
    // A block placed by a player next to Clio exists in the server world.
    const withEdit = createSim({ seed: SEED, agentId: 'clio', snapshot: null, edits: [[x + 2, y, z, 8]] });
    expect(withEdit.agent.executor).toBeDefined();
    const place = withEdit.run(
      { thought: 'mine it', say: null, actions: [{ type: 'mine', target: [x + 2, y, z] }] },
      10,
    );
    expect(place.results[0]).toMatchObject({ action: 'mine', ok: true });
    expect(place.edits).toContainEqual({ x: x + 2, y, z, id: 0, by: 'clio' });
    expect(place.snapshot.inventory.planks).toBe(1);

    const idle = sim.run(null, 60);
    expect(idle.walked).toBeLessThan(0.5);
    expect(idle.edits).toHaveLength(0);
  }, 30_000);
});
