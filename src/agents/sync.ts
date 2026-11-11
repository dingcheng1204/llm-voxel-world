// Keeps a server-run character (Clio) the same for everyone, and alive when nobody is watching.
//
// Every few seconds this tab calls /api/agent/state:
//   - "driver": this tab holds the lease → it simulates the character locally (LLM thinks every ~6 s)
//     and uploads a snapshot each beat;
//   - "mirror": someone else drives (another tab, or the once-a-minute server tick) → the character
//     walks to the latest saved position and shows the saved thought/speech bubbles.
// A hidden tab releases the lease (its game loop is paused), so the server tick takes over.
// Without the API (local `npm run dev`) sync turns itself off and the character runs locally as before.

import type { Agent } from './Agent';
import type { AgentResponse } from './actions';
import type { Brain } from './brains/demo';
import {
  parseSnapshot,
  restoreSnapshot,
  showSnapshotLines,
  takeSnapshot,
  type AgentSnapshot,
} from './snapshot';
import type { Landmarks } from './worldState';

export type SyncRole = 'starting' | 'driver' | 'mirror' | 'local';

const BEAT_MS = 4000;
/** Further than this from the saved position → jump there instead of walking. */
const TELEPORT_DIST = 12;

/** Brain for a mirrored character: never plans on its own (movement comes from the saved state). */
class MirrorBrain implements Brain {
  readonly showsThoughts = true;
  constructor(private readonly agent: Agent) {}
  think(): AgentResponse {
    return { thought: this.agent.thought, say: null, actions: [{ type: 'wait', seconds: 30 }] };
  }
}

export function newClientId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `tab-${Math.random().toString(36).slice(2, 14)}`;
}

export class AgentSync {
  role: SyncRole = 'starting';
  lastState: AgentSnapshot | null = null;
  lastError: string | null = null;
  private readonly mirrorBrain: Brain;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor(
    private readonly agent: Agent,
    private readonly landmarks: Landmarks,
    private readonly driverBrain: Brain,
    readonly clientId = newClientId(),
    private readonly endpoint = '/api/agent/state',
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly visible: () => boolean = () => globalThis.document?.visibilityState !== 'hidden',
  ) {
    this.mirrorBrain = new MirrorBrain(agent);
    // Don't think until we know where the character really is.
    agent.brain = this.mirrorBrain;
  }

  start(): void {
    void this.beat();
    this.timer = setInterval(() => void this.beat(), BEAT_MS);
    globalThis.document?.addEventListener('visibilitychange', () => void this.beat());
    globalThis.addEventListener?.('pagehide', () => this.release());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The think endpoint said another simulator holds the lease. */
  lostLease(): void {
    if (this.role === 'driver') this.becomeMirror(null);
  }

  async beat(): Promise<void> {
    if (this.role === 'local' || this.inFlight) return;
    this.inFlight = true;
    const visible = this.visible();
    try {
      const res = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: this.agent.id,
          clientId: this.clientId,
          state: this.role === 'driver' ? takeSnapshot(this.agent, this.landmarks) : null,
          release: !visible,
        }),
      });
      if (!res.ok) throw new Error(`state ${res.status}`);
      const data = (await res.json()) as { driver?: boolean; state?: unknown };
      const state = parseSnapshot(data.state);
      this.lastError = null;
      if (this.role === 'starting' && state) restoreSnapshot(this.agent, state, this.landmarks);
      if (data.driver && visible) this.becomeDriver(state);
      else this.becomeMirror(state);
    } catch (err) {
      this.lastError = (err as Error).message;
      // No API at all (local dev): run the character locally like before.
      if (this.role === 'starting') {
        this.role = 'local';
        this.agent.brain = this.driverBrain;
        this.stop();
      }
    } finally {
      this.inFlight = false;
    }
  }

  private becomeDriver(state: AgentSnapshot | null): void {
    if (this.role === 'driver') return;
    // Taking over from the server/another tab: start exactly where it left off.
    if (this.role === 'mirror' && state) restoreSnapshot(this.agent, state, this.landmarks);
    this.role = 'driver';
    this.agent.brain = this.driverBrain;
  }

  private becomeMirror(state: AgentSnapshot | null): void {
    if (this.role !== 'mirror') {
      this.role = 'mirror';
      this.agent.executor.clear();
      this.agent.brain = this.mirrorBrain;
    }
    if (!state) return;
    this.lastState = state;
    const b = this.agent.body.pos;
    const d = Math.hypot(state.pos[0] - b.x, state.pos[1] - b.y, state.pos[2] - b.z);
    if (d > TELEPORT_DIST) {
      restoreSnapshot(this.agent, state, this.landmarks);
    } else {
      if (d > 0.8) {
        this.agent.executor.clear();
        this.agent.executor.enqueue([
          {
            type: 'walk_to',
            target: [Math.floor(state.pos[0]), Math.floor(state.pos[1] + 0.01), Math.floor(state.pos[2])],
          },
        ]);
      }
      showSnapshotLines(this.agent, state);
      for (const l of state.landmarks) this.landmarks.add(l.name, l.pos, l.by);
      this.agent.executor.inventory.clear();
      for (const [k, v] of Object.entries(state.inventory)) this.agent.executor.inventory.set(k, v);
    }
  }

  /** Tab closing: save and hand the character to the server right away. */
  private release(): void {
    if (this.role !== 'driver') return;
    try {
      void this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: this.agent.id,
          clientId: this.clientId,
          state: takeSnapshot(this.agent, this.landmarks),
          release: true,
        }),
        keepalive: true,
      });
    } catch {
      /* best effort */
    }
  }
}
