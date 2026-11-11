import { describe, expect, it } from 'vitest';
import { extractJson, handleThink, secondsUntilTaipeiMidnight } from './thinkCore';

const perception = {
  time: { day: 3, clock: '10:00', phase: 'day' },
  self: { id: 'clio', pos: [0, 23, 30], facing: 'north', inventory: {} },
  looking_at: null,
  nearby_blocks: { sand: 10 },
  nearest: { log: { pos: [3, 23, 33], dist: 4.2 } },
  landmarks: [],
  nearby_agents: [],
  heard: [],
  last_action_result: null,
};

const env = { MINIMAX_API_KEY_1: 'k', AGENT_DB_SECRET: 's' };

export function fakeFetch(
  opts: {
    spent?: number;
    calls?: number;
    reply?: string;
    modelStatus?: number;
    leaseHeld?: boolean;
    recent?: unknown[];
    diaries?: unknown[];
    mind?: unknown;
    chat?: unknown[];
  } = {},
) {
  const calls: { url: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    if (url.endsWith('/rpc/agent_context')) {
      return new Response(
        JSON.stringify({
          spent_today: opts.spent ?? 0,
          calls_last_minute: opts.calls ?? 0,
          recent: opts.recent ?? [],
          diaries: opts.diaries ?? [],
          mind: opts.mind ?? null,
          chat: opts.chat ?? [],
        }),
      );
    }
    if (url.endsWith('/rpc/agent_log_think')) return new Response('');
    if (url.endsWith('/rpc/agent_learn')) return new Response('true');
    if (url.endsWith('/rpc/agent_state_sync')) {
      return new Response(JSON.stringify({ driver: !opts.leaseHeld, state: {}, updated_at: null }));
    }
    if (url.endsWith('/chat/completions')) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  opts.reply ??
                  '{"thought":"想看看那棵樹","say":"你好呀","actions":[{"type":"walk_to","target":[3,23,33]}]}',
              },
            },
          ],
          usage: {
            prompt_tokens: 2000,
            completion_tokens: 300,
            prompt_tokens_details: { cached_tokens: 1500 },
          },
        }),
        { status: opts.modelStatus ?? 200 },
      );
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const post = (body: unknown) =>
  new Request('http://x/api/agent/think', { method: 'POST', body: JSON.stringify(body) });

describe('handleThink', () => {
  it('calls the model, returns parsed JSON and logs usage with the right cost', async () => {
    const { f, calls } = fakeFetch();
    const res = await handleThink(post({ agentId: 'clio', clientId: 'tab-12345678', perception }), {
      fetch: f,
      env,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.raw.say).toBe('你好呀');
    // (500 × 0.15 + 1500 × 0.015 + 300 × 0.6) / 1e6
    expect(data.cost).toBeCloseTo((500 * 0.15 + 1500 * 0.015 + 300 * 0.6) / 1e6, 9);
    const model = calls.find((c) => c.url.endsWith('/chat/completions'))!.body as Record<string, unknown>;
    expect(model.model).toBe('MiniMax-M3.1-Flash');
    expect(model.reasoning_effort).toBe('low');
    expect(calls.some((c) => c.url.endsWith('/rpc/agent_log_think'))).toBe(true);
  });

  it('refuses agents without an LLM brain', async () => {
    const res = await handleThink(post({ agentId: 'gem', perception }), { fetch: fakeFetch().f, env });
    expect(res.status).toBe(403);
  });

  it('stops at the daily budget and does not call the model', async () => {
    const { f, calls } = fakeFetch({ spent: 0.5 });
    const res = await handleThink(post({ agentId: 'clio', clientId: 'tab-12345678', perception }), {
      fetch: f,
      env,
    });
    expect(res.status).toBe(429);
    expect(calls.some((c) => c.url.endsWith('/chat/completions'))).toBe(false);
  });

  it('applies the global rate limit', async () => {
    const res = await handleThink(post({ agentId: 'clio', clientId: 'tab-12345678', perception }), {
      fetch: fakeFetch({ calls: 20 }).f,
      env,
    });
    expect(res.status).toBe(429);
  });

  it('fails closed without the budget secret or the key', async () => {
    const { f, calls } = fakeFetch();
    expect(
      (
        await handleThink(post({ agentId: 'clio', clientId: 'tab-12345678', perception }), {
          fetch: f,
          env: { MINIMAX_API_KEY_1: 'k' },
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await handleThink(post({ agentId: 'clio', clientId: 'tab-12345678', perception }), {
          fetch: f,
          env: { AGENT_DB_SECRET: 's' },
        })
      ).status,
    ).toBe(403); // no key → the character isn't switched on at all
    expect(calls).toHaveLength(0);
  });

  it('reports model errors without leaking details', async () => {
    const res = await handleThink(post({ agentId: 'clio', clientId: 'tab-12345678', perception }), {
      fetch: fakeFetch({ modelStatus: 401 }).f,
      env,
    });
    expect(res.status).toBe(502);
  });

  it('rejects bad input', async () => {
    const { f } = fakeFetch();
    expect((await handleThink(new Request('http://x', { method: 'GET' }), { fetch: f, env })).status).toBe(
      405,
    );
    expect((await handleThink(post({ agentId: 'clio' }), { fetch: f, env })).status).toBe(400);
    expect(
      (
        await handleThink(post({ agentId: 'clio', perception: { ...perception, pad: 'x'.repeat(30000) } }), {
          fetch: f,
          env,
        })
      ).status,
    ).toBe(413);
  });
});

describe('helpers', () => {
  it('extracts JSON from fenced / chatty replies', () => {
    expect(extractJson('好的！\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('<think>hmm</think>{"b":2} done')).toEqual({ b: 2 });
    expect(extractJson('no json here')).toBeNull();
  });

  it('computes time until Taipei midnight', () => {
    // 2026-01-01T15:00:00Z = 23:00 in Taipei → 1 hour left
    expect(secondsUntilTaipeiMidnight(Date.UTC(2026, 0, 1, 15))).toBe(3600);
  });
});

describe('handleThink lease', () => {
  it('refuses a tab that does not hold the driver lease (no model call)', async () => {
    const { f, calls } = fakeFetch({ leaseHeld: true });
    const res = await handleThink(post({ agentId: 'clio', clientId: 'tab-87654321', perception }), {
      fetch: f,
      env,
    });
    expect(res.status).toBe(409);
    expect(calls.some((c) => c.url.endsWith('/chat/completions'))).toBe(false);
  });

  it('requires a clientId', async () => {
    const { f } = fakeFetch();
    expect((await handleThink(post({ agentId: 'clio', perception }), { fetch: f, env })).status).toBe(400);
  });
});

describe('memory in the prompt', () => {
  it('includes recent thinks (with outcomes) and diary one-liners', async () => {
    const now = Date.now();
    const { f, calls } = fakeFetch({
      recent: [
        {
          at: new Date(now - 60_000).toISOString(),
          thought: '看看藍色方塊',
          say: null,
          actions: [{ type: 'mine', target: [3, 23, 29] }],
          last_result: null,
          pos: [4, 23, 28],
          area: 'plaza',
        },
        {
          at: new Date(now - 120_000).toISOString(),
          thought: '走向玩具',
          say: '好可愛',
          actions: [{ type: 'walk_to', target: [3, 23, 29] }],
          last_result: { action: 'wait', ok: true },
          pos: [5, 23, 26],
          area: 'plaza',
        },
      ],
      diaries: [{ date: '2026-11-10', day: 1, summary: '第一次來到廣場，對玩具方塊很好奇。' }],
    });
    await handleThink(post({ agentId: 'clio', clientId: 'tab-12345678', perception }), { fetch: f, env });
    const body = calls.find((c) => c.url.endsWith('/chat/completions'))!.body as {
      messages: { role: string; content: string }[];
    };
    const [sys, user] = body.messages;
    expect(sys!.content).toContain('Day 1 (2026-11-10): 第一次來到廣場');
    expect(user!.content).toContain('What you did recently');
    // oldest first; the walk's outcome comes from the next think's last_result
    expect(user!.content.indexOf('走向玩具')).toBeLessThan(user!.content.indexOf('看看藍色方塊'));
    expect(user!.content).toContain('walk_to [3,23,29]');
    expect(user!.content).toContain('(plaza)');
  });
});

describe('mind', () => {
  it('shows notes, interests and goals in the prompt', async () => {
    const { f, calls } = fakeFetch({
      mind: {
        knowledge: [{ text: '火山口有岩漿，很燙', at: '2026-11-11T03:00:00Z' }],
        interests: ['玩具方塊的顏色'],
        goals: [
          { goal: '把藍色方塊小徑走到盡頭', status: 'in_progress' },
          { goal: '拜訪森林', status: 'new' },
        ],
      },
    });
    await handleThink(post({ agentId: 'clio', clientId: 'tab-12345678', perception }), { fetch: f, env });
    const sys = (
      calls.find((c) => c.url.endsWith('/chat/completions'))!.body as { messages: { content: string }[] }
    ).messages[0]!.content;
    expect(sys).toContain('- 火山口有岩漿，很燙');
    expect(sys).toContain('Lately you are into: 玩具方塊的顏色.');
    expect(sys.indexOf('[in progress] 把藍色方塊小徑')).toBeLessThan(sys.indexOf('[new] 拜訪森林'));
  });

  it('stores a learned note and logs it', async () => {
    const { f, calls } = fakeFetch({
      reply: '{"thought":"原來如此","say":null,"learn":"湖邊的沙子下面是礫石","actions":[{"type":"idle"}]}',
    });
    const res = await handleThink(post({ agentId: 'clio', clientId: 'tab-12345678', perception }), {
      fetch: f,
      env,
    });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.url.endsWith('/rpc/agent_learn'))!.body).toMatchObject({
      p_text: '湖邊的沙子下面是礫石',
    });
    const log = calls.find((c) => c.url.endsWith('/rpc/agent_log_think'))!.body as {
      p_payload: { learn?: string };
    };
    expect(log.p_payload.learn).toBe('湖邊的沙子下面是礫石');
  });

  it('does not call agent_learn when nothing was learned', async () => {
    const { f, calls } = fakeFetch();
    await handleThink(post({ agentId: 'clio', clientId: 'tab-12345678', perception }), { fetch: f, env });
    expect(calls.some((c) => c.url.endsWith('/rpc/agent_learn'))).toBe(false);
  });
});

describe('conversation rules', () => {
  const asked = (secondsAgo: number) => [
    {
      at: new Date(Date.now() - secondsAgo * 1000).toISOString(),
      speaker: 'clio',
      text: 'gem，你去哪？',
      heard_by: ['gem'],
    },
  ];

  it('mutes a character that is waiting for an answer, and tells the model why', async () => {
    const { f, calls } = fakeFetch({ chat: asked(30) });
    const res = await handleThink(post({ agentId: 'clio', clientId: 'tab-12345678', perception }), {
      fetch: f,
      env,
    });
    const data = await res.json();
    expect(data.raw.say).toBeNull(); // the model said "你好呀" but Clio must wait for Gem
    const user = (
      calls.find((c) => c.url.endsWith('/chat/completions'))!.body as { messages: { content: string }[] }
    ).messages[1]!.content;
    expect(user).toContain('"waiting_for_reply"');
    const log = calls.find((c) => c.url.endsWith('/rpc/agent_log_think'))!.body as {
      p_payload: Record<string, unknown>;
    };
    expect(log.p_payload.say).toBeNull();
    expect(log.p_payload.muted).toBe('你好呀');
  });

  it('lets a character talk once the wait is over', async () => {
    const { f } = fakeFetch({ chat: asked(400) });
    const data = await (
      await handleThink(post({ agentId: 'clio', clientId: 'tab-12345678', perception }), { fetch: f, env })
    ).json();
    expect(data.raw.say).toBe('你好呀');
  });
});
