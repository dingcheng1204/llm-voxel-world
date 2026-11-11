// LLM brain: sends the perception to /api/agent/think (server holds the API key, budget and rate limit)
// and returns the model's raw JSON. The Agent validates it with the same zod schema as any brain.
// If the API is unavailable (local dev, key missing, errors) it falls back to a scripted brain so the
// character keeps living; if the shared daily budget is used up the character "goes to sleep".

import type { AgentResponse } from '../actions';
import type { Perception } from '../perceive';
import type { Brain } from './demo';

export interface LlmStats {
  calls: number;
  errors: number;
  cost: number;
  spentToday: number;
  budget: number;
  lastMs: number;
  mode: 'llm' | 'sleeping' | 'fallback';
  lastError: string | null;
}

const FALLBACK_SECONDS = 60;

export class LlmBrain implements Brain {
  readonly showsThoughts = true;
  readonly stats: LlmStats = {
    calls: 0,
    errors: 0,
    cost: 0,
    spentToday: 0,
    budget: 0,
    lastMs: 0,
    mode: 'llm',
    lastError: null,
  };
  private pauseUntil = 0;

  constructor(
    private readonly agentId: string,
    private readonly fallback: Brain,
    private readonly endpoint = '/api/agent/think',
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async think(p: Perception, retryError?: string): Promise<unknown> {
    if (this.now() < this.pauseUntil) {
      return this.stats.mode === 'sleeping' ? SLEEP : this.fallback.think(p, retryError);
    }
    try {
      const res = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: this.agentId, perception: p, retryError }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        raw?: unknown;
        cost?: number;
        spentToday?: number;
        budget?: number;
        ms?: number;
        error?: string;
        retryAfter?: number;
      };
      if (res.status === 429) {
        // Out of budget (until midnight) or rate-limited (a few seconds): sleep, don't spend.
        this.stats.mode = 'sleeping';
        this.stats.lastError = data.error ?? 'busy';
        this.pauseUntil = this.now() + Math.min(data.retryAfter ?? 30, 900) * 1000;
        return SLEEP;
      }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      this.stats.calls++;
      this.stats.cost += data.cost ?? 0;
      this.stats.spentToday = data.spentToday ?? this.stats.spentToday;
      this.stats.budget = data.budget ?? this.stats.budget;
      this.stats.lastMs = data.ms ?? 0;
      this.stats.mode = 'llm';
      this.stats.lastError = null;
      return data.raw;
    } catch (err) {
      // API missing (local dev) or failing: keep the character alive with the scripted brain for a while.
      this.stats.errors++;
      this.stats.mode = 'fallback';
      this.stats.lastError = (err as Error).message;
      this.pauseUntil = this.now() + FALLBACK_SECONDS * 1000;
      return this.fallback.think(p, retryError);
    }
  }
}

const SLEEP: AgentResponse = { thought: 'Zzz…', say: null, actions: [{ type: 'wait', seconds: 30 }] };
