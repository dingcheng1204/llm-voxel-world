import { describe, expect, it } from 'vitest';
import { cleanText, handleSay } from './chatCore';

const env = { AGENT_DB_SECRET: 's' };

function backend(reply: unknown = { ok: true, id: 7 }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(reply));
  }) as unknown as typeof fetch;
  return { f, calls };
}
const post = (body: unknown) =>
  new Request('http://x/api/chat/say', { method: 'POST', body: JSON.stringify(body) });
const good = { playerId: 'p-abc123', name: 'Ding', text: '  Clio 妳好！ ', to: 'clio', pos: [1.6, 23, -4.2] };

describe('handleSay', () => {
  it('saves a direct line to a character (cleaned, floored position)', async () => {
    const b = backend();
    const res = await handleSay(post(good), { fetch: b.f, env });
    expect(res.status).toBe(200);
    expect(b.calls[0]!.url).toContain('/rpc/agent_player_say');
    expect(b.calls[0]!.body).toMatchObject({
      p_player: 'p-abc123',
      p_name: 'Ding',
      p_text: 'Clio 妳好！',
      p_to: 'clio',
      p_pos: [1, 23, -5],
    });
  });

  it('treats "all" as everyone', async () => {
    const b = backend();
    await handleSay(post({ ...good, to: 'all' }), { fetch: b.f, env });
    expect(b.calls[0]!.body.p_to).toBeNull();
  });

  it('rejects bad input without touching the DB', async () => {
    const b = backend();
    const bad = [
      { ...good, playerId: 'clio' },
      { ...good, name: '' },
      { ...good, name: 'Gem' }, // can't pretend to be a character
      { ...good, text: 'x'.repeat(141) },
      { ...good, to: 'drop table' },
      { ...good, to: 'p-abc123' }, // to yourself
      { ...good, pos: [999, 0, 0] },
    ];
    for (const body of bad) expect((await handleSay(post(body), { fetch: b.f, env })).status).toBe(400);
    expect(b.calls).toHaveLength(0);
  });

  it('passes on the rate limit', async () => {
    const b = backend({ ok: false, error: 'rate_limited' });
    expect((await handleSay(post(good), { fetch: b.f, env })).status).toBe(429);
  });
});

describe('cleanText', () => {
  it('drops control characters and collapses spaces', () => {
    expect(cleanText('a\u0000b\n\n c‮', 10)).toBe('a b c');
    expect(cleanText('   ', 10)).toBeNull();
  });
});
