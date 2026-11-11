import { describe, expect, it } from 'vitest';
import { buildDigest, parseDiaryReply, type DiaryInput } from '../../src/agents/diary';
import { handleDiary, taipeiDate } from './diaryCore';

const env = { MINIMAX_API_KEY_1: 'k', AGENT_DB_SECRET: 's' };

const DIARY_MD = [
  '## 今天做了什麼',
  '在廣場看了藍色的玩具方塊，還把它挖起來放進背包。',
  '## 今天發現的事',
  '夜裡的玩具方塊顏色好像更亮。',
  '## 和誰聊了什麼',
  '今天沒有人跟我說話。',
  '## 我還想不通的問題',
  '為什麼方塊挖起來就變小了？',
  '## 心情',
  '安靜又好奇。',
  '## 明天想做',
  '去森林看看樹。',
].join('\n');

function events(n: number, startIso = '2026-11-11T02:00:00Z'): DiaryInput['events'] {
  const t0 = Date.parse(startIso);
  return Array.from({ length: n }, (_, i) => ({
    at: new Date(t0 + i * 60_000).toISOString(),
    thought: `想法 ${i}`,
    say: i % 50 === 0 ? `說話 ${i}` : null,
    actions:
      i === 3 ? [{ type: 'name_place', name: '藍色方塊小徑' }] : [{ type: 'walk_to', target: [i, 23, 0] }],
    last_result:
      i === 7 ? { action: 'mine', ok: false, reason: 'too far away' } : { action: 'walk_to', ok: true },
    pos: [i, 23, 0],
    area: i < n / 2 ? 'plaza' : 'forest',
  }));
}

describe('buildDigest', () => {
  it('stays small for a whole day of thinks and keeps the facts', () => {
    const d = buildDigest({ day: 1, previous: null, events: events(1440), messages: [] });
    expect(d.length).toBeLessThan(6000);
    expect(d).toContain('plaza → forest');
    expect(d).toContain('"藍色方塊小徑"');
    expect(d).toContain('too far away');
    expect(d).toContain('10:00'); // 02:00 UTC = 10:00 Taipei
  });
});

describe('parseDiaryReply', () => {
  it('adds the title and requires every heading', () => {
    const ok = parseDiaryReply({ diary: `# 標題\n${DIARY_MD}`, memory: '記得去森林' }, 2, '2026-11-11');
    expect(ok.ok && ok.diary.startsWith('# 第 2 天 · 2026-11-11\n')).toBe(true);
    expect(ok.ok && ok.diary.includes('# 標題')).toBe(false);
    const bad = parseDiaryReply(
      { diary: DIARY_MD.replace('## 心情', '## 感覺'), memory: 'x記得' },
      2,
      '2026-11-11',
    );
    expect(bad.ok).toBe(false);
  });
});

describe('handleDiary', () => {
  function backend(opts: { events?: DiaryInput['events']; replies?: string[] } = {}) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const replies = [
      ...(opts.replies ?? [JSON.stringify({ diary: DIARY_MD, memory: '藍色方塊夜裡會變亮？明天去森林。' })]),
    ];
    const f = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ url, body });
      if (url.endsWith('/rpc/agent_diary_input'))
        return new Response(
          JSON.stringify({ day: 2, previous: null, events: opts.events ?? events(30), messages: [] }),
        );
      if (url.endsWith('/rpc/agent_save_diary')) return new Response('');
      if (url.endsWith('/chat/completions'))
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: replies.shift() ?? '' } }],
            usage: { prompt_tokens: 2000, completion_tokens: 600 },
          }),
        );
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
    return { f, calls };
  }
  const req = (secret = 's', body: unknown = {}) =>
    new Request('http://x/api/agent/diary', {
      method: 'POST',
      headers: { 'x-agent-secret': secret },
      body: JSON.stringify(body),
    });

  it('writes and saves the diary with its one-line memory', async () => {
    const b = backend();
    const data = await (await handleDiary(req('s', { date: '2026-11-11' }), { fetch: b.f, env })).json();
    expect(data.reports[0]).toMatchObject({
      agentId: 'clio',
      day: 2,
      memory: '藍色方塊夜裡會變亮？明天去森林。',
    });
    const save = b.calls.find((c) => c.url.endsWith('/rpc/agent_save_diary'))!.body;
    expect(save.p_date).toBe('2026-11-11');
    expect(String(save.p_content)).toMatch(/^# 第 2 天 · 2026-11-11/);
  });

  it('retries once on an invalid diary', async () => {
    const b = backend({
      replies: ['{"diary":"太短","memory":"x"}', JSON.stringify({ diary: DIARY_MD, memory: '明天去森林' })],
    });
    const data = await (await handleDiary(req(), { fetch: b.f, env })).json();
    expect(data.reports[0].error).toBeUndefined();
    expect(b.calls.filter((c) => c.url.endsWith('/chat/completions'))).toHaveLength(2);
  });

  it('skips a day with no events and rejects a bad secret', async () => {
    const b = backend({ events: [] });
    const data = await (await handleDiary(req(), { fetch: b.f, env })).json();
    expect(data.reports[0].skipped).toBeTruthy();
    expect(b.calls.some((c) => c.url.endsWith('/chat/completions'))).toBe(false);
    expect((await handleDiary(req('nope'), { fetch: b.f, env })).status).toBe(403);
  });

  it('uses the Taipei date', () => {
    expect(taipeiDate(Date.parse('2026-11-11T15:30:00Z'))).toBe('2026-11-11'); // 23:30 Taipei
    expect(taipeiDate(Date.parse('2026-11-11T16:30:00Z'))).toBe('2026-11-12');
  });
});

describe('nightly mind update', () => {
  const req = () =>
    new Request('http://x/api/agent/diary', {
      method: 'POST',
      headers: { 'x-agent-secret': 's' },
      body: '{}',
    });
  function run(reply: unknown) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ url, body });
      if (url.endsWith('/rpc/agent_diary_input'))
        return new Response(
          JSON.stringify({
            day: 3,
            previous: null,
            events: events(20),
            messages: [],
            mind: {
              knowledge: [{ text: '營火在廣場', at: '2026-11-10T03:00:00Z' }],
              interests: [],
              goals: [],
            },
          }),
        );
      if (url.includes('/rpc/')) return new Response('');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(reply) } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
    }) as unknown as typeof fetch;
    return handleDiary(req(), { fetch: f, env }).then(async (r) => ({ data: await r.json(), calls }));
  }

  it('saves tidied notes (keeping when old notes were learned), interests and goals', async () => {
    const { data, calls } = await run({
      diary: DIARY_MD,
      memory: '明天去森林',
      mind: {
        knowledge: ['營火在廣場', '藍色方塊在夜裡更亮'],
        interests: ['玩具方塊的顏色', '夜晚的光'],
        goals: [{ goal: '走到藍色方塊小徑的盡頭', status: 'new' }],
      },
    });
    expect(data.reports[0]).toMatchObject({ notes: 2, interests: ['玩具方塊的顏色', '夜晚的光'] });
    const save = calls.find((c) => c.url.endsWith('/rpc/agent_save_mind'))!.body as {
      p_knowledge: { text: string; at: string }[];
    };
    expect(save.p_knowledge[0]).toEqual({ text: '營火在廣場', at: '2026-11-10T03:00:00Z' });
    expect(save.p_knowledge[1]!.text).toBe('藍色方塊在夜裡更亮');
  });

  it('still saves the diary when the mind part is invalid', async () => {
    const { data, calls } = await run({ diary: DIARY_MD, memory: '明天去森林', mind: { knowledge: 'oops' } });
    expect(data.reports[0].error).toBeUndefined();
    expect(data.reports[0].mindError).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith('/rpc/agent_save_diary'))).toBe(true);
    expect(calls.some((c) => c.url.endsWith('/rpc/agent_save_mind'))).toBe(false);
  });
});
