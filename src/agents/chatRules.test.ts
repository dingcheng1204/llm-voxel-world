import { describe, expect, it } from 'vitest';
import { conversationState, mayTalk, type ChatMessage } from './chatRules';

const T0 = Date.parse('2026-11-11T04:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const line = (s: number, speaker: string, heard_by: string[], text = '…'): ChatMessage => ({
  at: at(s),
  speaker,
  text,
  heard_by,
});
// Gem thinks every 4 min on the server → wait at most 3 min for it; Clio every minute → 90 s.
const window = (p: string) => (p === 'gem' ? 270_000 : 90_000);

describe('conversationState', () => {
  it('is "none" with nobody around', () => {
    expect(conversationState('clio', [line(0, 'clio', [], '自言自語')], T0 + 5000, window).state).toBe(
      'none',
    );
  });

  it('waits for an answer after asking (Clio must not repeat her question every minute)', () => {
    const msgs = [line(0, 'clio', ['gem'], 'gem，rook 去哪了？')];
    const c = conversationState('clio', msgs, T0 + 60_000, window);
    expect(c.state).toBe('waiting_for_reply');
    expect(c.with).toBe('gem');
    expect(c.quiet_for_s).toBe(120); // capped at 3 min
    expect(mayTalk(c)).toBe(false);
    // Gem answers → Clio may talk again.
    const after = conversationState(
      'clio',
      [...msgs, line(200, 'gem', ['clio'], '不知道耶！')],
      T0 + 205_000,
      window,
    );
    expect(after.state).toBe('active');
    expect(mayTalk(after)).toBe(true);
  });

  it('stops waiting after the window', () => {
    const c = conversationState('clio', [line(0, 'clio', ['gem'])], T0 + 181_000, window);
    expect(c.state).toBe('none');
  });

  it('ends a conversation after 8 lines and imposes a 60 s cooldown on both', () => {
    const msgs = Array.from({ length: 8 }, (_, i) =>
      line(i * 10, i % 2 ? 'gem' : 'clio', [i % 2 ? 'clio' : 'gem']),
    );
    for (const self of ['clio', 'gem']) {
      const c = conversationState(self, msgs, T0 + 80_000, window);
      expect(c.state).toBe('cooldown');
      expect(c.quiet_for_s).toBe(50);
    }
    expect(conversationState('clio', msgs, T0 + 131_000, window).state).toBe('none');
  });

  it('ends a conversation after 2 minutes', () => {
    const msgs = [0, 40, 80, 125].map((s, i) => line(s, i % 2 ? 'gem' : 'clio', [i % 2 ? 'clio' : 'gem']));
    expect(conversationState('clio', msgs, T0 + 130_000, window).state).toBe('cooldown');
  });

  it('counts exchanges in an active conversation and starts fresh after a long pause', () => {
    const msgs = [line(0, 'gem', ['clio']), line(10, 'clio', ['gem']), line(20, 'gem', ['clio'])];
    const c = conversationState('clio', msgs, T0 + 25_000, window);
    expect(c).toMatchObject({ state: 'active', exchanges: 3, exchanges_left: 5 });
    const later = [...msgs, line(300, 'gem', ['clio'])];
    expect(conversationState('clio', later, T0 + 305_000, window)).toMatchObject({
      state: 'active',
      exchanges: 1,
    });
  });
});
