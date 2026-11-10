// Scripted stand-in brains until the LLM loop lands (ROADMAP phase 4).
// They use exactly the same interface an LLM brain will: Perception in → JSON response out
// (validated by the same zod schema). Swapping in Claude/Gemini/… changes only this file.

import type { AgentResponse } from '../actions';
import type { Perception } from '../perceive';

export interface Brain {
  /** May return a raw string/object (LLM) — the Agent validates it. `retryError` is set on the retry. */
  think(p: Perception, retryError?: string): unknown | Promise<unknown>;
}

export type DemoMode = 'gather' | 'explore';

type Rand = () => number;

const DROP_SPOTS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [2, 0],
  [0, 2],
];

/**
 * gather:  "walk to a tree → mine 3 logs → go home → put them down" (the phase-3 acceptance script)
 * explore: wander further, name nice places, sometimes visit a friend
 */
export class DemoBrain implements Brain {
  /** Completed gather cycles (for tests / debug). */
  cycles = 0;
  private homeBound = false;
  private explored = 0;
  private lastTarget: string | null = null;
  private dropTry = 0;
  /** Targets that failed — a script can't reason about why, so it just avoids them. */
  private readonly avoid = new Map<string, number>();

  constructor(
    readonly mode: DemoMode,
    private readonly home: [number, number, number],
    private readonly rand: Rand = Math.random,
    /** Rest after each gather cycle (s, ≤ 30 per the action schema) — keeps the forest from vanishing. */
    private readonly rest = 3,
  ) {}

  think(p: Perception): AgentResponse {
    if (!p.landmarks.some((l) => l.name === `${p.self.id} home`)) {
      return {
        thought: '這裡是我的家，先記下來。',
        say: null,
        actions: [
          { type: 'walk_to', target: this.home },
          { type: 'name_place', name: `${p.self.id} home` },
        ],
      };
    }
    return this.mode === 'gather' ? this.gather(p) : this.explore(p);
  }

  private gather(p: Perception): AgentResponse {
    const logs = p.self.inventory.log ?? 0;
    const atHome = Math.hypot(p.self.pos[0] - this.home[0], p.self.pos[2] - this.home[2]) <= 2;

    if (this.homeBound) {
      if (!atHome) {
        return {
          thought: '木頭夠了，回家。',
          say: null,
          actions: [{ type: 'walk_to', landmark: `${p.self.id} home` }],
        };
      }
      if (logs > 0 && this.dropTry < DROP_SPOTS.length) {
        // Put the logs down around home; a failed spot (occupied, no support…) moves on to the next one.
        if (p.last_action_result?.action === 'place' && !p.last_action_result.ok) this.dropTry++;
        const off = DROP_SPOTS[this.dropTry % DROP_SPOTS.length]!;
        const [x, y, z] = p.self.pos;
        const spot: [number, number, number] = [x + off[0], y, z + off[1]];
        return {
          thought: '把木頭放在家旁邊。',
          say: null,
          actions: [{ type: 'place', target: spot, block: 'log' }],
        };
      }
      this.dropTry = 0;
      this.homeBound = false;
      this.cycles++;
      return {
        thought: '休息一下。',
        say: null,
        actions: [{ type: 'wait', seconds: Math.min(30, this.rest * (0.7 + this.rand() * 0.6)) }],
      };
    }

    if (logs >= 3) {
      this.homeBound = true;
      return {
        thought: '三塊原木到手！',
        say: null,
        actions: [{ type: 'walk_to', landmark: `${p.self.id} home` }],
      };
    }
    const r = p.last_action_result;
    const lastTarget = this.lastTarget;
    if (r && !r.ok && lastTarget) this.avoid.set(lastTarget, (this.avoid.get(lastTarget) ?? 0) + 1);
    this.lastTarget = null;
    const log = p.nearest.log;
    if (log && (this.avoid.get(log.pos.join(',')) ?? 0) < 2) {
      this.lastTarget = log.pos.join(',');
      if (log.dist <= 3.5)
        return { thought: '這塊木頭可以挖。', say: null, actions: [{ type: 'mine', target: log.pos }] };
      return { thought: '那邊有樹。', say: null, actions: [{ type: 'walk_to', target: log.pos }] };
    }
    // No tree in sight: explore a bit.
    return { thought: '附近沒有樹，去別處看看。', say: null, actions: [this.randomWalk(p, 14)] };
  }

  private explore(p: Perception): AgentResponse {
    this.explored++;
    if (this.explored % 5 === 0) {
      const name = `${p.self.id} spot ${this.explored / 5}`;
      return {
        thought: '這裡景色不錯，取個名字。',
        say: null,
        actions: [
          { type: 'name_place', name },
          { type: 'look_at', target: [p.self.pos[0] + 3, p.self.pos[1], p.self.pos[2]] },
        ],
      };
    }
    const friend = p.nearby_agents[0];
    if (friend && this.rand() < 0.25) {
      return {
        thought: `去看看 ${friend.id} 在做什麼。`,
        say: null,
        actions: [
          { type: 'walk_to', agent: friend.id },
          { type: 'wait', seconds: 2 },
        ],
      };
    }
    return {
      thought: '到處走走。',
      say: null,
      actions: [this.randomWalk(p, 18), { type: 'wait', seconds: 1 + this.rand() * 2 }],
    };
  }

  private randomWalk(p: Perception, r: number): AgentResponse['actions'][number] {
    // Stay roughly around home so the characters don't wander off the island.
    const a = this.rand() * Math.PI * 2;
    const d = 4 + this.rand() * r;
    const cx = (p.self.pos[0] + this.home[0]) / 2;
    const cz = (p.self.pos[2] + this.home[2]) / 2;
    return {
      type: 'walk_to',
      target: [Math.round(cx + Math.cos(a) * d), p.self.pos[1], Math.round(cz + Math.sin(a) * d)],
    };
  }
}
