// Server-side simulation of the server-run characters for one tick of real time (default 60 s), using
// exactly the same World / AgentBody / executor / pathfinding code as the browser (headless, no rendering).
// All characters share ONE world, so they can see each other, follow each other and hear what was said.
//
// Flow used by /api/agent/tick:
//   const sim = createSim({ seed, agents: [{ agentId, snapshot, active }], edits, chat });
//   const p = sim.perception('clio');          // → LLM (one budgeted call per active character)
//   const out = sim.run({ clio: plan }, 60);   // execute the plans with real physics for 60 s
//   save out.snapshots[id] + out.edits for the active characters
// Inactive characters (driven by a browser right now, or not due this minute) stand where their saved
// state says, so the others still perceive them, but nothing about them is saved.
//
// This file is bundled into api/_gen/sim.js (scripts/build-sim.mjs) because the Vercel Node runtime
// cannot resolve the extensionless imports used throughout src/.

import { Agent, type AgentContext } from '../agents/Agent';
import type { AgentResponse } from '../agents/actions';
import type { Brain } from '../agents/brains/demo';
import { CAST } from '../agents/cast';
import { perceive, type Perception } from '../agents/perceive';
import { restoreSnapshot, takeSnapshot, type AgentSnapshot } from '../agents/snapshot';
import { ChatLog, Landmarks } from '../agents/worldState';
import { WorldClock } from '../scene/clock';
import { World } from '../world/world';

export interface SimAgentInput {
  agentId: string;
  snapshot: AgentSnapshot | null;
  /** Simulated (thinks + saves) this tick; otherwise a still "puppet" others can see. */
  active: boolean;
}

/** Something said recently (from the `messages` table). */
export interface SimChatLine {
  from: string;
  name?: string;
  to?: string;
  text: string;
  pos: [number, number, number];
  /** Epoch ms. */
  at: number;
}

export interface SimInput {
  seed: number;
  agents: SimAgentInput[];
  /** Saved world edits to apply on top of the generated island: [x, y, z, id]. */
  edits: [number, number, number, number][];
  chat?: SimChatLine[];
  /** Epoch ms (tests). */
  now?: () => number;
}

export interface SimEdit {
  x: number;
  y: number;
  z: number;
  id: number;
  by: string;
}

export interface SimAgentResult {
  snapshot: AgentSnapshot;
  /** Finished actions, in order. */
  results: { action: string; ok: boolean; reason?: string }[];
  /** Metres walked (horizontal). */
  walked: number;
}

export interface SimResult {
  /** One entry per ACTIVE character. */
  agents: Record<string, SimAgentResult>;
  /** Blocks the active characters changed during the run (to save in world_edits). */
  edits: SimEdit[];
}

export interface Sim {
  readonly agents: Map<string, Agent>;
  perception(agentId: string): Perception;
  run(plans: Record<string, AgentResponse | null>, seconds?: number): SimResult;
}

/** One tick with no LLM response: the character rests where it is. */
const REST: AgentResponse = { thought: '', say: null, actions: [{ type: 'wait', seconds: 30 }] };

/** Hands the Agent the pre-fetched LLM plan once, then "rest" until the next server tick. */
class PlannedBrain implements Brain {
  plan: AgentResponse | null = null;
  /** Keep the LLM's thought on the bubble while resting after the plan. */
  restThought = '';
  think(): AgentResponse {
    const p = this.plan;
    this.plan = null;
    return p ?? { ...REST, thought: this.restThought };
  }
}

export function createSim(input: SimInput): Sim {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const world = new World({ seed: input.seed, renderDistance: 6, genBudgetMs: Infinity, headless: true });
  for (const [x, y, z, id] of input.edits) world.applyEdit(x, y, z, id);
  world.loadAll();

  const landmarks = new Landmarks();
  const chat = new ChatLog();
  // Recent lines, timed relative to the start of this run (negative = before it).
  for (const l of [...(input.chat ?? [])].sort((a, b) => a.at - b.at)) {
    chat.say({
      from: l.from,
      name: l.name,
      to: l.to ?? null,
      text: l.text,
      pos: l.pos,
      t: (l.at - startedAt) / 1000,
      clock: '',
    });
  }
  const clock = new WorldClock(null, undefined, now);
  let simTime = 0;

  const agents = new Map<string, Agent>();
  const brains = new Map<string, PlannedBrain>();
  const active = new Set(input.agents.filter((a) => a.active).map((a) => a.agentId));
  const ctx: AgentContext = {
    world,
    exec: {
      world,
      landmarks,
      bodies: () =>
        [...agents.values()].map((a) => ({ id: a.id, pos: a.body.pos, halfWidth: 0.35, height: 0.95 })),
    },
    perceive: {
      world,
      landmarks,
      chat,
      clock,
      others: () => [...agents.values()].map((a) => ({ id: a.id, pos: a.body.pos, doing: a.executor.doing })),
      now: 0,
      areaAt: (x, z) => world.terrain.biomeAt(x, z),
    },
  };

  const spawns = world.terrain.spawnPoints(CAST.length);
  for (const a of input.agents) {
    const member = CAST.find((m) => m.id === a.agentId);
    if (!member) throw new Error(`unknown agent ${a.agentId}`);
    const brain = new PlannedBrain();
    // Same default spawn as the browser (the cast's slot around the plaza).
    const agent = new Agent(member, spawns[Math.max(0, CAST.indexOf(member))]!, brain, ctx);
    if (a.snapshot) restoreSnapshot(agent, a.snapshot, landmarks);
    // A saved position inside a block (someone built on it) → stand on top of the column instead.
    const [cx, cy, cz] = agent.body.cell;
    if (world.isSolid(cx, cy, cz))
      agent.body.teleport(agent.body.body.x, world.groundY(cx, cz), agent.body.body.z);
    agents.set(a.agentId, agent);
    brains.set(a.agentId, brain);
  }

  /** Lines said after this character's last think count as heard (seconds relative to the run). */
  const heardSince = (id: string) => {
    const snap = input.agents.find((a) => a.agentId === id)?.snapshot;
    return snap?.lastThinkAt ? (snap.lastThinkAt - startedAt) / 1000 : -600;
  };

  const edits: SimEdit[] = [];
  world.onEdit = (e) => {
    if (active.has(e.by)) edits.push({ x: e.x, y: e.y, z: e.z, id: e.id, by: e.by });
  };

  return {
    agents,
    perception(agentId) {
      const agent = agents.get(agentId);
      if (!agent) throw new Error(`no agent ${agentId}`);
      return perceive(agent.body, agent.executor.inventory, agent.executor.lastResult, heardSince(agentId), {
        ...ctx.perceive,
        now: simTime,
      });
    },
    run(plans, seconds = 60) {
      const results = new Map<string, SimAgentResult['results']>();
      const walked = new Map<string, number>();
      for (const [id, agent] of agents) {
        const brain = brains.get(id)!;
        const plan = active.has(id) ? (plans[id] ?? null) : null;
        brain.plan = plan;
        brain.restThought = plan?.thought ?? agent.thought;
        results.set(id, []);
        walked.set(id, 0);
        agent.executor.onResult = (r) => results.get(id)!.push({ ...r });
      }
      const dt = 1 / 60;
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        simTime += dt;
        for (const [id, agent] of agents) {
          agent.tick(dt, simTime);
          walked.set(
            id,
            walked.get(id)! +
              Math.hypot(agent.body.pos.x - agent.body.prevPos.x, agent.body.pos.z - agent.body.prevPos.z),
          );
        }
      }
      const out: SimResult = { agents: {}, edits };
      for (const id of active) {
        const agent = agents.get(id);
        if (!agent) continue;
        out.agents[id] = {
          snapshot: takeSnapshot(agent, landmarks, startedAt),
          results: results.get(id)!,
          walked: walked.get(id)!,
        };
      }
      return out;
    },
  };
}

// Re-exported so the API functions can validate model output without importing src/ directly.
export { parseAgentResponse } from '../agents/actions';
