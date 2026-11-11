// GET /api/agent/usage — today's usage per character plus the limits from the env, for the diary page's
// cost panel. Public, aggregate-only, cached at the edge for 20 s.

import {
  config,
  rpc,
  secondsUntilPacificMidnight,
  secondsUntilTaipeiMidnight,
  type ThinkDeps,
} from './thinkCore.js';

interface UsageRow {
  agent_id: string;
  calls_today: number;
  cost_today: number | string;
  thinks_today: number;
  calls_pt_day: number;
  last_call_at: string | null;
}

export interface UsageReply {
  spentToday: number;
  dailyBudget: number;
  /** Seconds until the shared USD budget resets (00:00 Taipei). */
  budgetResetsIn: number;
  agents: {
    id: string;
    provider: string;
    model: string;
    enabled: boolean;
    callsToday: number;
    thinksToday: number;
    costToday: number;
    /** Calls since midnight Pacific (free-tier day); null limit = no per-day cap. */
    callsPtDay: number;
    maxPerDay: number | null;
    /** Seconds until the per-day cap resets (00:00 Pacific); null when there is no cap. */
    capResetsIn: number | null;
    lastCallAt: string | null;
  }[];
}

const json = (body: unknown, status = 200, cache = false) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache ? 'public, max-age=10, s-maxage=20, stale-while-revalidate=40' : 'no-store',
    },
  });

export async function handleUsage(deps: ThinkDeps): Promise<Response> {
  const cfg = config(deps.env);
  if (!cfg.dbSecret) return json({ error: 'usage is not configured' }, 503);
  const now = (deps.now ?? Date.now)();
  let data: { spent_today: number | string; agents: UsageRow[] };
  try {
    data = await rpc(deps, cfg, 'agent_usage', { p_secret: cfg.dbSecret });
  } catch (e) {
    return json({ error: `could not read usage (${(e as Error).message})` }, 502);
  }
  const rows = new Map((data.agents ?? []).map((r) => [r.agent_id, r]));
  const reply: UsageReply = {
    spentToday: Number(data.spent_today) || 0,
    dailyBudget: cfg.dailyBudget,
    budgetResetsIn: secondsUntilTaipeiMidnight(now),
    agents: Object.entries(cfg.brains).map(([id, b]) => {
      const r = rows.get(id);
      return {
        id,
        provider: b.provider,
        model: b.model,
        enabled: cfg.agents.includes(id),
        callsToday: Number(r?.calls_today ?? 0),
        thinksToday: Number(r?.thinks_today ?? 0),
        costToday: Number(r?.cost_today ?? 0),
        callsPtDay: Number(r?.calls_pt_day ?? 0),
        maxPerDay: b.maxPerDay,
        capResetsIn: b.maxPerDay === null ? null : secondsUntilPacificMidnight(now),
        lastCallAt: r?.last_call_at ?? null,
      };
    }),
  };
  return json(reply, 200, true);
}
