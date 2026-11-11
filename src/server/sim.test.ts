// Server simulation: the same engine as the browser, run headless for one tick of real time,
// with every server-run character in one shared world.
import { describe, expect, it } from 'vitest';
import { createSim } from './sim';

const SEED = 20261110;
const solo = (snapshot: Parameters<typeof createSim>[0]['agents'][number]['snapshot'] = null) =>
  createSim({ seed: SEED, agents: [{ agentId: 'clio', snapshot, active: true }], edits: [] });

describe('createSim', () => {
  it('spawns at the cast slot, executes an LLM plan for 60 s and returns a restorable snapshot', () => {
    const sim = solo();
    const p = sim.perception('clio');
    expect(p.self.pos).toHaveLength(3);
    expect(p.self.area).toBeTruthy();
    const [x, y, z] = p.self.pos;
    const out = sim.run(
      {
        clio: {
          thought: 'walk a bit',
          say: '出發！',
          actions: [
            { type: 'walk_to', target: [x + 6, y, z] },
            { type: 'name_place', name: 'test spot' },
          ],
        },
      },
      60,
    );
    const r = out.agents.clio!;
    expect(r.walked).toBeGreaterThan(3);
    expect(r.results[0]?.action).toBe('walk_to');
    expect(r.snapshot.say).toBe('出發！');
    expect(r.snapshot.thought).toBe('walk a bit');
    expect(r.snapshot.landmarks.map((l) => l.name)).toContain('test spot');

    // Next tick resumes from the snapshot (different World instance, like a new function call).
    const again = solo(r.snapshot);
    expect(again.perception('clio').self.pos).toEqual(sim.perception('clio').self.pos);
    expect(again.perception('clio').landmarks.some((l) => l.name === 'test spot')).toBe(true);
  }, 30_000);

  it('applies saved edits, reports its own edits and rests without a plan', () => {
    const [x, y, z] = solo().perception('clio').self.pos;
    const sim = createSim({
      seed: SEED,
      agents: [{ agentId: 'clio', snapshot: null, active: true }],
      edits: [[x + 2, y, z, 8]],
    });
    const out = sim.run(
      { clio: { thought: 'mine it', say: null, actions: [{ type: 'mine', target: [x + 2, y, z] }] } },
      10,
    );
    expect(out.agents.clio!.results[0]).toMatchObject({ action: 'mine', ok: true });
    expect(out.edits).toContainEqual({ x: x + 2, y, z, id: 0, by: 'clio' });
    expect(out.agents.clio!.snapshot.inventory.planks).toBe(1);

    const idle = solo().run({ clio: null }, 60);
    expect(idle.agents.clio!.walked).toBeLessThan(0.5);
    expect(idle.edits).toHaveLength(0);
  }, 30_000);

  it('puts every character in one world: others are perceived, puppets are not saved', () => {
    const base = solo().perception('clio').self.pos;
    const gemSnap = {
      pos: [base[0] + 3.5, base[1], base[2] + 0.5] as [number, number, number],
      heading: 0,
      inventory: {},
      landmarks: [],
      thought: '',
      thoughtAt: 0,
      lastThinkAt: 0,
      say: null,
      sayAt: null,
      lastResult: null,
    };
    const now = Date.now();
    const sim = createSim({
      seed: SEED,
      agents: [
        { agentId: 'clio', snapshot: null, active: true },
        { agentId: 'gem', snapshot: gemSnap, active: false },
      ],
      edits: [],
      chat: [
        {
          from: 'gem',
          text: '山頂好像有東西！',
          pos: gemSnap.pos.map(Math.floor) as [number, number, number],
          at: now - 30_000,
        },
      ],
      now: () => now,
    });
    const p = sim.perception('clio');
    expect(p.nearby_agents.map((a) => a.id)).toContain('gem');
    expect(p.heard.map((h) => h.text)).toContain('山頂好像有東西！');
    const out = sim.run(
      { clio: { thought: 'go see gem', say: null, actions: [{ type: 'walk_to', agent: 'gem' }] } },
      20,
    );
    expect(Object.keys(out.agents)).toEqual(['clio']); // gem is a puppet: nothing saved for it
    expect(out.agents.clio!.results[0]).toMatchObject({ action: 'walk_to', ok: true });
  }, 30_000);
});
