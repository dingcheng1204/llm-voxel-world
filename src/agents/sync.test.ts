import { describe, expect, it } from 'vitest';
import { createSim } from '../server/sim';
import type { Brain } from './brains/demo';
import { AgentSync } from './sync';
import { Landmarks } from './worldState';

const driverBrain: Brain = { think: () => ({ thought: 'drive', say: null, actions: [] }) };

function setup(reply: () => Response | Promise<Response>, visible = true) {
  const sim = createSim({ seed: 20261110, agentId: 'clio', snapshot: null, edits: [] });
  const sent: Record<string, unknown>[] = [];
  const f = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return reply();
  }) as unknown as typeof fetch;
  const sync = new AgentSync(sim.agent, new Landmarks(), driverBrain, 'tab-12345678', '/s', f, () => visible);
  return { sim, sync, sent };
}

const ok = (body: unknown) => new Response(JSON.stringify(body));

describe('AgentSync', () => {
  it('resumes from the saved state and mirrors when someone else drives', async () => {
    const saved = { pos: [20.5, 30, -40.5], say: '我在山腳下', sayAt: Date.now(), landmarks: [] };
    const { sim, sync } = setup(() => ok({ driver: false, state: saved }));
    expect(sim.agent.brain).not.toBe(driverBrain); // no thinking before the first answer
    await sync.beat();
    expect(sync.role).toBe('mirror');
    expect(sim.agent.body.pos.x).toBeCloseTo(20.5);
    expect(sim.agent.lastSay?.text).toBe('我在山腳下');
    expect(sim.agent.brain).not.toBe(driverBrain);
  }, 20_000);

  it('drives when granted the lease, uploads snapshots, and releases when hidden', async () => {
    let visible = true;
    const { sim, sync, sent } = setup(() => ok({ driver: visible, state: null }));
    (sync as unknown as { active: () => boolean }).active = () => visible;
    await sync.beat();
    expect(sync.role).toBe('driver');
    expect(sim.agent.brain).toBe(driverBrain);
    await sync.beat();
    expect((sent[1]!.state as { pos: number[] }).pos).toHaveLength(3);
    visible = false;
    await sync.beat();
    expect(sent[2]!.release).toBe(true);
    expect(sent[2]!.state).not.toBeNull(); // last snapshot saved on the way out
    expect(sync.role).toBe('mirror');
  }, 20_000);

  it('falls back to running locally when there is no API', async () => {
    const { sim, sync } = setup(() => new Response('nope', { status: 404 }));
    await sync.beat();
    expect(sync.role).toBe('local');
    expect(sim.agent.brain).toBe(driverBrain);
  }, 20_000);
});
