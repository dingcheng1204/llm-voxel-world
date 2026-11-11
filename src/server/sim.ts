// Server-side simulation of one character for one tick of real time (default 60 s), using exactly the
// same World / AgentBody / executor / pathfinding code as the browser (headless, no rendering).
//
// Flow used by /api/agent/tick:
//   const sim = createSim({ seed, agentId, snapshot, edits });
//   const p = sim.perception();            // → LLM (one budgeted call, done by the caller)
//   const out = sim.run(response, 60);      // execute the plan with real physics for 60 s
//   save out.snapshot + out.edits
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

export interface SimInput {
  seed: number;
  agentId: string;
  snapshot: AgentSnapshot | null;
  /** Saved world edits to apply on top of the generated island: [x, y, z, id]. */
  edits: [number, number, number, number][];
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

export interface SimResult {
  snapshot: AgentSnapshot;
  /** Blocks this character changed during the run (to save in world_edits). */
  edits: SimEdit[];
  /** Finished actions, in order. */
  results: { action: string; ok: boolean; reason?: string }[];
  /** Metres walked (horizontal), for logs/tests. */
  walked: number;
}

export interface Sim {
  readonly agent: Agent;
  perception(): Perception;
  run(response: AgentResponse | null, seconds?: number): SimResult;
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
  const member = CAST.find((m) => m.id === input.agentId);
  if (!member) throw new Error(`unknown agent ${input.agentId}`);
  const now = input.now ?? Date.now;

  const world = new World({ seed: input.seed, renderDistance: 6, genBudgetMs: Infinity, headless: true });
  for (const [x, y, z, id] of input.edits) world.applyEdit(x, y, z, id);
  world.loadAll();

  const landmarks = new Landmarks();
  const chat = new ChatLog();
  const clock = new WorldClock(null, undefined, now);
  let simTime = 0;
  const brain = new PlannedBrain();
  const ctx: AgentContext = {
    world,
    exec: {
      world,
      landmarks,
      bodies: () => [{ id: agent.id, pos: agent.body.pos, halfWidth: 0.35, height: 0.95 }],
    },
    perceive: {
      world,
      landmarks,
      chat,
      clock,
      others: () => [],
      now: 0,
      areaAt: (x, z) => world.terrain.biomeAt(x, z),
    },
  };

  // Same default spawn as the browser (the cast's slot around the plaza).
  const slot = Math.max(0, CAST.indexOf(member));
  const spawn = world.terrain.spawnPoints(CAST.length)[slot]!;
  const agent = new Agent(member, spawn, brain, ctx);
  if (input.snapshot) restoreSnapshot(agent, input.snapshot, landmarks);
  // A saved position inside a block (someone built on it) → stand on top of the column instead.
  const [cx, cy, cz] = agent.body.cell;
  if (world.isSolid(cx, cy, cz))
    agent.body.teleport(agent.body.body.x, world.groundY(cx, cz), agent.body.body.z);

  const edits: SimEdit[] = [];
  world.onEdit = (e) => edits.push({ x: e.x, y: e.y, z: e.z, id: e.id, by: e.by });

  return {
    agent,
    perception() {
      return perceive(agent.body, agent.executor.inventory, agent.executor.lastResult, simTime, {
        ...ctx.perceive,
        now: simTime,
      });
    },
    run(response, seconds = 60) {
      const results: SimResult['results'] = [];
      agent.executor.onResult = (r) => results.push({ ...r });
      brain.plan = response;
      brain.restThought = response?.thought ?? agent.thought;
      const dt = 1 / 60;
      let walked = 0;
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        simTime += dt;
        agent.tick(dt, simTime);
        walked += Math.hypot(
          agent.body.pos.x - agent.body.prevPos.x,
          agent.body.pos.z - agent.body.prevPos.z,
        );
      }
      return { snapshot: takeSnapshot(agent, landmarks), edits, results, walked };
    },
  };
}

// Re-exported so the API functions can validate model output without importing src/ directly.
export { parseAgentResponse } from '../agents/actions';
