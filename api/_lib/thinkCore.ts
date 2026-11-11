// Core of POST /api/agent/think — framework-free so it can be unit-tested with a fake fetch.
//
// Cost safety (enforced here, on the server, for ALL visitors together):
//   1. Only agents listed in AGENT_LLM_AGENTS may use an LLM (default: clio).
//   2. Daily budget in USD (AGENT_DAILY_BUDGET_USD, default 0.5), counted in Supabase `usage`.
//   3. Global rate limit (AGENT_MAX_CALLS_PER_MIN, default 20).
//   4. Fails closed: without the DB secret (budget can't be checked) no LLM call is made.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../src/config/supabase.js';
import { PERSONAS } from '../../src/agents/personas.js';
import { buildMessages, type ChatMessage } from '../../src/agents/prompt.js';
import {
  formatDiaries,
  formatRecent,
  RECENT_EVENTS,
  type DiaryMemory,
  type MemoryEvent,
} from '../../src/agents/memory.js';
import type { Perception } from '../../src/agents/perceive.js';

export interface ThinkDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now?: () => number;
}

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });

const MAX_BODY = 24_000;

export function config(env: Record<string, string | undefined>) {
  const num = (v: string | undefined, d: number) =>
    v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d;
  return {
    apiKey: env.MINIMAX_API_KEY_1 ?? env.MINIMAX_API_KEY,
    baseUrl: (env.AGENT_BASE_URL ?? 'https://api.minimax.io/v1').replace(/\/$/, ''),
    model: env.AGENT_MODEL ?? 'MiniMax-M3.1-Flash',
    effort: env.AGENT_REASONING_EFFORT ?? 'low',
    dbSecret: env.AGENT_DB_SECRET,
    dailyBudget: num(env.AGENT_DAILY_BUDGET_USD, 0.5),
    maxPerMinute: num(env.AGENT_MAX_CALLS_PER_MIN, 20),
    agents: (env.AGENT_LLM_AGENTS ?? 'clio')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // USD per 1M tokens (MiniMax M3.1 Flash list price).
    priceIn: num(env.AGENT_PRICE_IN, 0.15),
    priceCached: num(env.AGENT_PRICE_CACHED, 0.015),
    priceOut: num(env.AGENT_PRICE_OUT, 0.6),
    supabaseUrl: env.SUPABASE_URL ?? SUPABASE_URL,
    supabaseKey: env.SUPABASE_ANON_KEY ?? SUPABASE_ANON_KEY,
  };
}

export type Config = ReturnType<typeof config>;

export async function rpc<T>(
  deps: ThinkDeps,
  cfg: Config,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await deps.fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabaseKey,
      Authorization: `Bearer ${cfg.supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn} ${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Seconds until the next midnight in Asia/Taipei (UTC+8, no DST). */
export function secondsUntilTaipeiMidnight(nowMs: number): number {
  const taipei = nowMs + 8 * 3600_000;
  const next = Math.floor(taipei / 86_400_000 + 1) * 86_400_000;
  return Math.ceil((next - taipei) / 1000);
}

/** Pull the JSON object out of a model reply (handles ```json fences and stray text). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(cleaned);
  const candidate = fenced ? fenced[1]! : cleaned;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

/** USD for one call at the configured per-1M-token prices. */
export function costOf(cfg: Config, usage: Usage): number {
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return (
    ((usage.prompt_tokens - cached) * cfg.priceIn +
      cached * cfg.priceCached +
      usage.completion_tokens * cfg.priceOut) /
    1e6
  );
}

/** One OpenAI-compatible chat completion (MiniMax). Never throws. */
export async function chatCompletion(
  deps: ThinkDeps,
  cfg: Config,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs = 25_000,
): Promise<{ ok: true; content: string; usage: Usage } | { ok: false; status: number; error: string }> {
  let usage: Usage = { prompt_tokens: 0, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } };
  try {
    const res = await deps.fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        reasoning_effort: cfg.effort,
        max_completion_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      usage?: Usage;
      error?: { message?: string };
      base_resp?: { status_code?: number; status_msg?: string };
    };
    if (!res.ok || data.base_resp?.status_code) {
      const msg = data.error?.message ?? data.base_resp?.status_msg ?? `status ${res.status}`;
      return { ok: false, status: 502, error: `model error: ${msg}` };
    }
    if (data.usage) usage = { ...usage, ...data.usage };
    return { ok: true, content: data.choices?.[0]?.message?.content ?? '', usage };
  } catch (err) {
    return { ok: false, status: 504, error: `model unreachable: ${(err as Error).name}` };
  }
}

export type ThinkResult =
  | {
      ok: true;
      raw: unknown;
      usage: { input: number; cached: number; output: number };
      cost: number;
      spentToday: number;
      budget: number;
      ms: number;
    }
  | { ok: false; status: number; error: string; retryAfter?: number };

/**
 * One budgeted, logged model call for `agentId` with this perception. Used by /api/agent/think
 * (browser-driven) and /api/agent/tick (server-driven). Never throws.
 */
export async function runThink(
  deps: ThinkDeps,
  cfg: Config,
  agentId: string,
  perception: Perception,
  retryError?: string,
): Promise<ThinkResult> {
  const now = deps.now ?? Date.now;
  const persona = PERSONAS[agentId];
  if (!persona || !cfg.agents.includes(agentId))
    return { ok: false, status: 403, error: `no LLM brain for "${agentId}"` };

  // --- fail closed without keys ---
  if (!cfg.apiKey) return { ok: false, status: 503, error: 'LLM key not configured' };
  if (!cfg.dbSecret)
    return { ok: false, status: 503, error: 'budget guard not configured (AGENT_DB_SECRET)' };

  // --- budget + rate limit (shared by every visitor and the server tick) ---
  // One round trip: spend so far, calls in the last minute and what the character remembers.
  let budget: {
    spent_today: number;
    calls_last_minute: number;
    recent?: MemoryEvent[];
    diaries?: DiaryMemory[];
  };
  try {
    budget = await rpc(deps, cfg, 'agent_context', {
      p_secret: cfg.dbSecret,
      p_agent: agentId,
      p_recent: RECENT_EVENTS,
    });
  } catch {
    return { ok: false, status: 503, error: 'budget check unavailable' };
  }
  if (Number(budget.spent_today) >= cfg.dailyBudget) {
    return {
      ok: false,
      status: 429,
      error: 'daily budget reached',
      retryAfter: secondsUntilTaipeiMidnight(now()),
    };
  }
  if (budget.calls_last_minute >= cfg.maxPerMinute) {
    return { ok: false, status: 429, error: 'too many thinks right now', retryAfter: 20 };
  }

  // --- call the model ---
  const others = Object.values(PERSONAS)
    .filter((p) => p.id !== agentId)
    .map((p) => `${p.id} (${p.species})`);
  const memory = {
    diaries: formatDiaries(budget.diaries ?? []),
    recent: formatRecent(budget.recent ?? [], now()),
  };
  const messages = buildMessages(persona, others, perception, retryError, memory);
  const started = now();
  const reply = await chatCompletion(deps, cfg, messages, 1500);
  if (!reply.ok) return reply;
  const { content, usage } = reply;

  // --- account + log ---
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const cost = costOf(cfg, usage);
  const parsed = extractJson(content) as {
    thought?: string;
    say?: string | null;
    actions?: unknown[];
  } | null;
  try {
    await rpc(deps, cfg, 'agent_log_think', {
      p_secret: cfg.dbSecret,
      p_agent: agentId,
      p_model: cfg.model,
      p_input_tokens: usage.prompt_tokens,
      p_output_tokens: usage.completion_tokens,
      p_cost: Number(cost.toFixed(6)),
      p_game_day: Number(perception.time?.day) || 0,
      p_payload: {
        thought: parsed?.thought ?? null,
        say: parsed?.say ?? null,
        actions: parsed?.actions ?? null,
        last_result: perception.last_action_result ?? null,
        pos: perception.self.pos,
        area: perception.self.area ?? null,
        clock: perception.time?.clock,
        ms: now() - started,
        valid: parsed !== null,
      },
    });
  } catch (err) {
    console.error('logging failed', err);
  }

  return {
    ok: true,
    raw: parsed ?? content,
    usage: { input: usage.prompt_tokens, cached, output: usage.completion_tokens },
    cost,
    spentToday: Number(budget.spent_today) + cost,
    budget: cfg.dailyBudget,
    ms: now() - started,
  };
}

/** Lease length for a browser driver; renewed by every think and every /api/agent/state heartbeat. */
export const BROWSER_LEASE_SECONDS = 30;

export async function handleThink(req: Request, deps: ThinkDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const cfg = config(deps.env);

  // --- validate input ---
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'request too large' }, 413);
  let body: { agentId?: unknown; clientId?: unknown; perception?: unknown; retryError?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const agentId = typeof body.agentId === 'string' ? body.agentId : '';
  if (!PERSONAS[agentId] || !cfg.agents.includes(agentId))
    return json({ error: `no LLM brain for "${agentId}"` }, 403);
  const perception = body.perception as Perception | undefined;
  if (!perception || typeof perception !== 'object' || !perception.self)
    return json({ error: 'missing perception' }, 400);
  const clientId = typeof body.clientId === 'string' ? body.clientId : '';
  if (!/^[\w-]{8,64}$/.test(clientId)) return json({ error: 'missing clientId' }, 400);
  const retryError = typeof body.retryError === 'string' ? body.retryError.slice(0, 500) : undefined;
  if (!cfg.apiKey) return json({ error: 'LLM key not configured' }, 503);
  if (!cfg.dbSecret) return json({ error: 'budget guard not configured (AGENT_DB_SECRET)' }, 503);

  // --- only the tab that holds the lease may think for this character ---
  try {
    const lease = await rpc<{ driver: boolean }>(deps, cfg, 'agent_state_sync', {
      p_secret: cfg.dbSecret,
      p_agent: agentId,
      p_driver: clientId,
      p_state: null,
      p_lease_seconds: BROWSER_LEASE_SECONDS,
      p_release: false,
    });
    if (!lease.driver) return json({ error: 'another simulator is driving this character' }, 409);
  } catch {
    return json({ error: 'state service unavailable' }, 503);
  }

  const r = await runThink(deps, cfg, agentId, perception, retryError);
  if (!r.ok) {
    const extra: Record<string, string> = r.retryAfter ? { 'Retry-After': String(r.retryAfter) } : {};
    return json({ error: r.error, ...(r.retryAfter ? { retryAfter: r.retryAfter } : {}) }, r.status, extra);
  }
  const { ok: _ok, ...rest } = r;
  return json(rest);
}
