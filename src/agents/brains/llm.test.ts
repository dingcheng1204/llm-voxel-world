import { describe, expect, it } from 'vitest';
import type { Perception } from '../perceive';
import { LlmBrain } from './llm';

const p = { self: { id: 'clio', pos: [0, 23, 0], facing: 'north', inventory: {} } } as unknown as Perception;
const fallback = { think: () => ({ thought: 'script', say: null, actions: [{ type: 'idle' }] }) };
const reply = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('LlmBrain', () => {
  it('returns the model output and tracks cost', async () => {
    const b = new LlmBrain(
      'clio',
      fallback,
      '/api',
      reply(200, {
        raw: { thought: 'hi', say: null, actions: [] },
        cost: 0.0004,
        spentToday: 0.01,
        budget: 0.5,
      }),
    );
    expect(await b.think(p)).toEqual({ thought: 'hi', say: null, actions: [] });
    expect(b.stats.cost).toBeCloseTo(0.0004);
    expect(b.stats.mode).toBe('llm');
  });

  it('sleeps on 429 and does not call the API again until retryAfter', async () => {
    let n = 0;
    let t = 0;
    const f = (async () => {
      n++;
      return new Response(JSON.stringify({ error: 'daily budget reached', retryAfter: 60 }), { status: 429 });
    }) as unknown as typeof fetch;
    const b = new LlmBrain('clio', fallback, '/api', f, () => t);
    const r1 = (await b.think(p)) as { actions: { type: string }[] };
    expect(r1.actions[0]!.type).toBe('wait');
    await b.think(p);
    expect(n).toBe(1);
    t = 61_000;
    await b.think(p);
    expect(n).toBe(2);
  });

  it('falls back to the scripted brain when the API fails', async () => {
    const b = new LlmBrain('clio', fallback, '/api', reply(503, { error: 'budget guard not configured' }));
    expect(await b.think(p)).toEqual(fallback.think());
    expect(b.stats.mode).toBe('fallback');
    expect(b.stats.lastError).toContain('budget guard');
  });
});
