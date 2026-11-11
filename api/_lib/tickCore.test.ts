import { describe, expect, it } from 'vitest';
import { createSim, parseAgentResponse } from '../../src/server/sim';
import { handleState } from './stateCore';
import { handleTick } from './tickCore';

const env = { MINIMAX_API_KEY_1: 'k', AGENT_DB_SECRET: 's' };
const sim = { createSim, parseAgentResponse };

/** Fake Supabase + MiniMax/Gemini with in-memory agent_state rows and leases. */
function backend(
  opts: {
    driver?: string | null;
    reply?: string;
    spent?: number;
    gemCalls?: number;
    gemDriver?: string | null;
  } = {},
) {
  const rows: Record<string, { state: unknown; driver: string | null }> = {
    clio: { state: {}, driver: opts.driver ?? null },
    gem: { state: {}, driver: opts.gemDriver ?? null },
  };
  const row = rows.clio!;
  const calls: { url: string; body: unknown }[] = [];
  const savedEdits: unknown[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    if (url.endsWith('/rpc/agent_state_sync')) {
      const r = rows[body.p_agent]!;
      const mine = r.driver === null || r.driver === body.p_driver;
      if (mine) {
        r.driver = body.p_release ? null : body.p_driver;
        if (body.p_state) r.state = body.p_state;
      }
      return new Response(JSON.stringify({ driver: mine, state: r.state, updated_at: 'now' }));
    }
    if (url.includes('/rest/v1/agent_state'))
      return new Response(
        JSON.stringify(Object.entries(rows).map(([agent_id, r]) => ({ agent_id, state: r.state }))),
      );
    if (url.includes('/rest/v1/messages')) return new Response('[]');
    if (url.endsWith('/rpc/agent_context'))
      return new Response(
        JSON.stringify({
          spent_today: opts.spent ?? 0,
          calls_last_minute: 0,
          agent_calls_pt_day: body.p_agent === 'gem' ? (opts.gemCalls ?? 0) : 0,
        }),
      );
    if (url.endsWith('/rpc/agent_log_think')) return new Response('');
    if (url.includes('/rest/v1/world_edits')) return new Response('[]');
    if (url.endsWith('/functions/v1/world-edits')) {
      savedEdits.push(...body.edits);
      return new Response('{"ok":true}');
    }
    if (url.endsWith('/chat/completions') && url.includes('googleapis')) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"thought":"去看看 Clio","say":"Clio！我發現一個好地方！","actions":[{"type":"idle"}]}',
              },
            },
          ],
          usage: { prompt_tokens: 1000, completion_tokens: 80 },
        }),
      );
    }
    if (url.endsWith('/chat/completions')) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  opts.reply ??
                  '{"thought":"去海邊走走","say":"散步囉","actions":[{"type":"name_place","name":"午後小站"}]}',
              },
            },
          ],
          usage: { prompt_tokens: 1200, completion_tokens: 120 },
        }),
      );
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls, row, rows, savedEdits };
}

const tickReq = (secret = 's') =>
  new Request('http://x/api/agent/tick', { method: 'POST', headers: { 'x-agent-secret': secret } });

describe('handleTick', () => {
  it('rejects calls without the secret', async () => {
    const { f, calls } = backend();
    expect((await handleTick(tickReq('nope'), { fetch: f, env, sim })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('thinks once, simulates a minute, saves state and releases the lease', async () => {
    const b = backend();
    const res = await handleTick(tickReq(), { fetch: b.f, env, sim });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reports[0]).toMatchObject({ agentId: 'clio', say: '散步囉' });
    expect(b.calls.filter((c) => c.url.endsWith('/chat/completions'))).toHaveLength(1);
    expect(b.row.driver).toBeNull();
    const state = b.row.state as { landmarks: { name: string }[]; say: string; pos: number[] };
    expect(state.say).toBe('散步囉');
    expect(state.landmarks.map((l) => l.name)).toContain('午後小站');

    // The next minute continues from the saved state.
    const again = await handleTick(tickReq(), { fetch: b.f, env, sim });
    expect((await again.json()).reports[0].error).toBeUndefined();
    expect((b.row.state as { landmarks: unknown[] }).landmarks).toHaveLength(1);
  }, 30_000);

  it('skips (no model call) while a browser tab drives', async () => {
    const b = backend({ driver: 'tab-12345678' });
    const data = await (await handleTick(tickReq(), { fetch: b.f, env, sim })).json();
    expect(data.reports[0].skipped).toBeTruthy();
    expect(b.calls.some((c) => c.url.endsWith('/chat/completions'))).toBe(false);
  });

  it('rests (still saves, no model call) when the daily budget is used up', async () => {
    const b = backend({ spent: 9 });
    const data = await (await handleTick(tickReq(), { fetch: b.f, env, sim })).json();
    expect(data.reports[0].error).toBe('daily budget reached');
    expect(b.calls.some((c) => c.url.endsWith('/chat/completions'))).toBe(false);
    expect((b.row.state as { pos: number[] }).pos).toHaveLength(3);
    expect(b.row.driver).toBeNull();
  }, 30_000);
});

describe('handleState', () => {
  const post = (body: unknown) =>
    new Request('http://x/api/agent/state', { method: 'POST', body: JSON.stringify(body) });
  const snap = { pos: [1.5, 23, 30.5], inventory: { log: 2 } };

  it('lets the first tab drive and save; a second tab mirrors', async () => {
    const b = backend();
    const a = await (
      await handleState(post({ agentId: 'clio', clientId: 'tab-aaaaaaaa', state: snap }), { fetch: b.f, env })
    ).json();
    expect(a.driver).toBe(true);
    expect(a.state.inventory.log).toBe(2);
    const c = await (
      await handleState(post({ agentId: 'clio', clientId: 'tab-bbbbbbbb', state: { pos: [0, 30, 0] } }), {
        fetch: b.f,
        env,
      })
    ).json();
    expect(c.driver).toBe(false);
    expect(c.state.pos).toEqual([1.5, 23, 30.5]); // second tab's state was ignored

    // First tab hides → releases → second tab takes over.
    await handleState(post({ agentId: 'clio', clientId: 'tab-aaaaaaaa', release: true }), {
      fetch: b.f,
      env,
    });
    const d = await (
      await handleState(post({ agentId: 'clio', clientId: 'tab-bbbbbbbb' }), { fetch: b.f, env })
    ).json();
    expect(d.driver).toBe(true);
  });

  it('validates input', async () => {
    const b = backend();
    const bad = [
      { agentId: 'gem', clientId: 'tab-aaaaaaaa' },
      { agentId: 'clio', clientId: 'server' },
      { agentId: 'clio', clientId: 'tab-aaaaaaaa', state: { pos: [9999, 0, 0] } },
    ];
    for (const body of bad)
      expect((await handleState(post(body), { fetch: b.f, env })).status).toBeGreaterThanOrEqual(400);
  });
});

describe('handleTick with two brains', () => {
  const env2 = { ...env, GEMINI_API_KEY_1: 'g' };
  const at = (minute: number) => () => minute * 60_000 + 5_000;
  const due = 29_573_400; // divisible by 4 → Gem is due too

  it('runs Clio and Gem in one world, each with its own provider, and saves both', async () => {
    const b = backend();
    const data = await (await handleTick(tickReq(), { fetch: b.f, env: env2, sim, now: at(due) })).json();
    const byId = Object.fromEntries(data.reports.map((r: { agentId: string }) => [r.agentId, r]));
    expect(byId.clio.say).toBe('散步囉');
    expect(byId.gem.say).toBe('Clio！我發現一個好地方！');
    const models = b.calls.filter((c) => c.url.endsWith('/chat/completions'));
    expect(models.map((c) => (c.body as { model: string }).model).sort()).toEqual([
      'MiniMax-M3.1-Flash',
      'gemini-3.1-flash-lite',
    ]);
    const gemBody = models.find((c) => c.url.includes('googleapis'))!.body as Record<string, unknown>;
    expect(gemBody.max_tokens).toBe(2000);
    expect(gemBody.max_completion_tokens).toBeUndefined();
    expect((b.rows.gem!.state as { say: string }).say).toBe('Clio！我發現一個好地方！');
    expect(b.rows.gem!.driver).toBeNull();
  }, 30_000);

  it('thinks for Gem only every 4 minutes, and not over its daily quota', async () => {
    const b = backend();
    const off = await (await handleTick(tickReq(), { fetch: b.f, env: env2, sim, now: at(due + 1) })).json();
    expect(off.reports.find((r: { agentId: string }) => r.agentId === 'gem').skipped).toMatch(/every 4 min/);
    expect(b.calls.some((c) => c.url.includes('googleapis'))).toBe(false);

    const capped = backend({ gemCalls: 470 });
    const data = await (
      await handleTick(tickReq(), { fetch: capped.f, env: env2, sim, now: at(due) })
    ).json();
    expect(data.reports.find((r: { agentId: string }) => r.agentId === 'gem').error).toBe(
      'daily quota reached',
    );
    expect(capped.calls.some((c) => c.url.includes('googleapis'))).toBe(false);
  }, 30_000);

  it('leaves Gem off (no model call) without its key', async () => {
    const b = backend();
    const data = await (await handleTick(tickReq(), { fetch: b.f, env, sim, now: at(due) })).json();
    expect(data.reports.map((r: { agentId: string }) => r.agentId)).toEqual(['clio']);
  }, 30_000);
});
