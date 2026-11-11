// Core of POST /api/agent/think — framework-free so it can be unit-tested with a fake fetch.
//
// Cost safety (enforced here, on the server, for ALL visitors together):
//   1. Only agents listed in AGENT_LLM_AGENTS may use an LLM (default: clio).
//   2. Daily budget in USD (AGENT_DAILY_BUDGET_USD, default 0.5), counted in Supabase `usage`.
//   3. Global rate limit (AGENT_MAX_CALLS_PER_MIN, default 20).
//   4. Fails closed: without the DB secret (budget can't be checked) no LLM call is made.

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../src/config/supabase.js';
import { PERSONAS } from '../../src/agents/personas.js';
import { buildMessages } from '../../src/agents/prompt.js';
import type { Perception } from '../../src/agents/perceive.js';

export interface ThinkDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  now?: () => number;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });

const MAX_BODY = 24_000;

function config(env: Record<string, string | undefined>) {
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

async function rpc<T>(
  deps: ThinkDeps,
  cfg: ReturnType<typeof config>,
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

export async function handleThink(req: Request, deps: ThinkDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const cfg = config(deps.env);
  const now = deps.now ?? Date.now;

  // --- validate input ---
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'request too large' }, 413);
  let body: { agentId?: unknown; perception?: unknown; retryError?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const agentId = typeof body.agentId === 'string' ? body.agentId : '';
  const persona = PERSONAS[agentId];
  if (!persona || !cfg.agents.includes(agentId)) return json({ error: `no LLM brain for "${agentId}"` }, 403);
  const perception = body.perception as Perception | undefined;
  if (!perception || typeof perception !== 'object' || !perception.self)
    return json({ error: 'missing perception' }, 400);
  const retryError = typeof body.retryError === 'string' ? body.retryError.slice(0, 500) : undefined;

  // --- fail closed without keys ---
  if (!cfg.apiKey) return json({ error: 'LLM key not configured' }, 503);
  if (!cfg.dbSecret) return json({ error: 'budget guard not configured (AGENT_DB_SECRET)' }, 503);

  // --- budget + rate limit (shared by every visitor) ---
  let budget: { spent_today: number; calls_last_minute: number };
  try {
    budget = await rpc(deps, cfg, 'agent_budget', { p_secret: cfg.dbSecret });
  } catch {
    return json({ error: 'budget check unavailable' }, 503);
  }
  if (Number(budget.spent_today) >= cfg.dailyBudget) {
    const wait = secondsUntilTaipeiMidnight(now());
    return json({ error: 'daily budget reached', retryAfter: wait }, 429, { 'Retry-After': String(wait) });
  }
  if (budget.calls_last_minute >= cfg.maxPerMinute) {
    return json({ error: 'too many thinks right now', retryAfter: 20 }, 429, { 'Retry-After': '20' });
  }

  // --- call the model ---
  const others = Object.values(PERSONAS)
    .filter((p) => p.id !== agentId)
    .map((p) => `${p.id} (${p.species})`);
  const messages = buildMessages(persona, others, perception, retryError);
  let content: string;
  let usage = { prompt_tokens: 0, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } };
  const started = now();
  try {
    const res = await deps.fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        reasoning_effort: cfg.effort,
        max_completion_tokens: 1500,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      usage?: typeof usage;
      error?: { message?: string };
      base_resp?: { status_code?: number; status_msg?: string };
    };
    if (!res.ok || data.base_resp?.status_code) {
      const msg = data.error?.message ?? data.base_resp?.status_msg ?? `status ${res.status}`;
      return json({ error: `model error: ${msg}` }, 502);
    }
    content = data.choices?.[0]?.message?.content ?? '';
    if (data.usage) usage = { ...usage, ...data.usage };
  } catch (err) {
    return json({ error: `model unreachable: ${(err as Error).name}` }, 504);
  }

  // --- account + log ---
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const cost =
    ((usage.prompt_tokens - cached) * cfg.priceIn +
      cached * cfg.priceCached +
      usage.completion_tokens * cfg.priceOut) /
    1e6;
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
        clock: perception.time?.clock,
        ms: now() - started,
        valid: parsed !== null,
      },
    });
  } catch (err) {
    console.error('logging failed', err);
  }

  return json({
    raw: parsed ?? content,
    usage: { input: usage.prompt_tokens, cached, output: usage.completion_tokens },
    cost,
    spentToday: Number(budget.spent_today) + cost,
    budget: cfg.dailyBudget,
    ms: now() - started,
  });
}
