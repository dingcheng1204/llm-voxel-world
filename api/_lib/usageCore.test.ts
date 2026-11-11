import { describe, expect, it } from 'vitest';
import { handleUsage, type UsageReply } from './usageCore';

const env = {
  AGENT_DB_SECRET: 's3cret',
  MINIMAX_API_KEY_1: 'mm',
  GEMINI_API_KEY_1: 'gg',
  AGENT_DAILY_BUDGET_USD: '1.5',
};

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? 'null')) });
    return new Response(JSON.stringify(body), { status });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe('handleUsage', () => {
  it('merges usage rows with the limits from the env', async () => {
    const f = fakeFetch({
      spent_today: '0.2146',
      agents: [
        {
          agent_id: 'clio',
          calls_today: 541,
          cost_today: '0.2146',
          thinks_today: 530,
          calls_pt_day: 57,
          last_call_at: 'x',
        },
        {
          agent_id: 'gem',
          calls_today: 121,
          cost_today: 0,
          thinks_today: 120,
          calls_pt_day: 20,
          last_call_at: 'y',
        },
      ],
    });
    // 2026-11-11 16:31 Taipei = 08:31 UTC = 00:31 Pacific (PST).
    const res = await handleUsage({ fetch: f.fetch, env, now: () => Date.UTC(2026, 10, 11, 8, 31) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage');
    const r = (await res.json()) as UsageReply;
    expect(f.calls[0]!.url).toContain('/rpc/agent_usage');
    expect(f.calls[0]!.body).toEqual({ p_secret: 's3cret' });
    expect(r.spentToday).toBeCloseTo(0.2146);
    expect(r.dailyBudget).toBe(1.5);
    expect(r.budgetResetsIn).toBe((24 * 60 - (16 * 60 + 31)) * 60);
    const clio = r.agents.find((a) => a.id === 'clio')!;
    const gem = r.agents.find((a) => a.id === 'gem')!;
    expect(clio).toMatchObject({
      callsToday: 541,
      costToday: 0.2146,
      maxPerDay: null,
      capResetsIn: null,
      enabled: true,
    });
    expect(gem).toMatchObject({ callsPtDay: 20, maxPerDay: 470, enabled: true });
    expect(gem.capResetsIn).toBe((24 * 60 - 31) * 60);
    // Nothing secret in the reply.
    expect(JSON.stringify(r)).not.toMatch(/s3cret|"mm"|"gg"/);
  });

  it('fills zeros for characters without calls today', async () => {
    const f = fakeFetch({ spent_today: 0, agents: [] });
    const r = (await (await handleUsage({ fetch: f.fetch, env })).json()) as UsageReply;
    expect(r.agents.map((a) => a.callsToday)).toEqual([0, 0]);
  });

  it('fails closed without the secret and reports database errors', async () => {
    const f = fakeFetch({});
    expect((await handleUsage({ fetch: f.fetch, env: {} })).status).toBe(503);
    expect(f.calls).toHaveLength(0);
    const bad = fakeFetch({ message: 'nope' }, 500);
    expect((await handleUsage({ fetch: bad.fetch, env })).status).toBe(502);
  });
});
