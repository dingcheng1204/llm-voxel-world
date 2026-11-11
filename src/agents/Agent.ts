import { IDLE_RESPONSE, parseAgentResponse, type AgentResponse } from './actions';
import { AgentBody, type AgentWorld } from './AgentBody';
import type { Brain } from './brains/demo';
import type { CastMember } from './cast';
import { ActionExecutor, type ExecutorContext } from './executor';
import { perceive, type PerceiveContext, type Perception } from './perceive';

export interface AgentEvent {
  t: number;
  kind: 'think' | 'action' | 'say';
  data: unknown;
}

export interface AgentContext {
  world: AgentWorld;
  exec: ExecutorContext;
  perceive: PerceiveContext;
}

/** Minimum seconds between two thinks (agent-persona skill §5 uses 6 s for LLM brains). */
export const DEFAULT_THINK_GAP = 6;

/**
 * One character: body (physics) + executor (actions) + brain (decides).
 * Thinks when its action queue runs dry, validates the brain's JSON, and keeps a small event log
 * (later stored in Supabase `events` and used for diaries).
 */
export class Agent {
  readonly body: AgentBody;
  readonly executor: ActionExecutor;
  thought = '';
  /** When the current thought was formed (ms epoch) — for the thought bubble. */
  thoughtAt = 0;
  /** Last line said aloud and when (ms epoch) — for the speech bubble. */
  lastSay: { text: string; at: number } | null = null;
  lastPerception: Perception | null = null;
  readonly events: AgentEvent[] = [];
  private cooldown = 0;
  private thinking = false;
  private lastHeard = 0;
  /** Counters for tests / debug. */
  thinks = 0;
  invalid = 0;

  constructor(
    readonly member: CastMember,
    spawn: { x: number; y: number; z: number },
    public brain: Brain,
    private readonly ctx: AgentContext,
    /** Seconds between thinks (LLM brains are slower and cost money; scripts can think often). */
    public thinkGap = DEFAULT_THINK_GAP,
  ) {
    this.body = new AgentBody(member, spawn);
    this.executor = new ActionExecutor(this.body, ctx.exec);
    this.executor.onResult = (r, a) => this.log('action', { ...r, params: a });
  }

  get id(): string {
    return this.member.id;
  }

  tick(dt: number, simTime: number): void {
    // Nothing to perceive or walk on until the terrain here exists.
    if (!this.ctx.world.isLoaded(this.body.pos.x, this.body.pos.z)) return;
    this.cooldown -= dt;
    if (!this.executor.busy && !this.thinking && this.cooldown <= 0) this.think(simTime);
    this.executor.tick(dt);
    this.body.tick(dt, this.ctx.world);
  }

  /** Think now. Synchronous brains (scripts) are handled in the same tick; LLM brains asynchronously. */
  private think(simTime: number): void {
    this.thinking = true;
    this.cooldown = this.thinkGap;
    this.thinks++;
    const ctx = { ...this.ctx.perceive, now: simTime };
    const p = perceive(this.body, this.executor.inventory, this.executor.lastResult, this.lastHeard, ctx);
    this.lastHeard = simTime;
    this.lastPerception = p;

    const done = (value: AgentResponse) => {
      this.apply(value, simTime);
      this.thinking = false;
    };
    const fail = (err: unknown) => {
      console.warn(`${this.id} failed to think`, err);
      done(IDLE_RESPONSE);
    };
    const attempt = (raw: unknown, retry: boolean) => {
      const res = parseAgentResponse(raw);
      if (res.ok) return done(res.value);
      this.invalid++;
      if (!retry) return done(IDLE_RESPONSE);
      // One retry with the validation error appended (skill §4).
      try {
        const again = this.brain.think(p, res.error);
        if (again instanceof Promise) again.then((r) => attempt(r, false), fail);
        else attempt(again, false);
      } catch (err) {
        fail(err);
      }
    };
    try {
      const raw = this.brain.think(p);
      if (raw instanceof Promise) raw.then((r) => attempt(r, true), fail);
      else attempt(raw, true);
    } catch (err) {
      fail(err);
    }
  }

  private apply(value: AgentResponse, simTime: number): void {
    // A mirrored/resting character repeats its thought — keep the original bubble time then.
    if (value.thought && value.thought !== this.thought) {
      this.thought = value.thought;
      this.thoughtAt = Date.now();
    }
    this.log('think', { thought: value.thought, actions: value.actions });
    if (value.say) {
      const [x, y, z] = this.body.cell;
      this.ctx.perceive.chat.say({
        from: this.id,
        text: value.say,
        pos: [x, y, z],
        t: simTime,
        clock: this.ctx.perceive.clock.clock,
      });
      this.log('say', value.say);
      this.lastSay = { text: value.say, at: Date.now() };
    }
    this.executor.enqueue(value.actions);
  }

  private log(kind: AgentEvent['kind'], data: unknown): void {
    this.events.push({ t: Date.now(), kind, data });
    if (this.events.length > 300) this.events.shift();
  }
}
