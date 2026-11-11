// Conversation rules (agent-persona skill §6), computed from the shared `messages` table so the browser
// and the server tick agree:
//   - after saying something to someone, wait for their answer (they may think only every few minutes)
//   - a conversation ends after 8 lines or 2 minutes; then both stay quiet for 60 s and do something else
// The state goes into the perception ("conversation") and is ENFORCED on the reply: a muted character's
// `say` is dropped, whatever the model wrote. Plain data only (no relative runtime imports).

export interface ChatMessage {
  /** ISO time. */
  at: string;
  speaker: string;
  text: string;
  /** Other characters within hearing range when it was said. */
  heard_by: string[];
}

export const MAX_EXCHANGES = 8;
export const MAX_CONVERSATION_MS = 2 * 60_000;
export const COOLDOWN_MS = 60_000;
/** A pause longer than this starts a new conversation. */
export const NEW_CONVERSATION_GAP_MS = 90_000;
/** Never wait longer than this for an answer. */
export const MAX_REPLY_WAIT_MS = 3 * 60_000;

export interface Conversation {
  state: 'none' | 'active' | 'waiting_for_reply' | 'cooldown';
  with: string | null;
  /** Lines in the current conversation (both sides). */
  exchanges: number;
  exchanges_left: number;
  /** Seconds until you may speak again (waiting_for_reply / cooldown). */
  quiet_for_s?: number;
  last_line?: { from: string; text: string; seconds_ago: number };
}

const NONE: Conversation = { state: 'none', with: null, exchanges: 0, exchanges_left: MAX_EXCHANGES };

/** Can the character speak right now? */
export const mayTalk = (c: Conversation) => c.state !== 'waiting_for_reply' && c.state !== 'cooldown';

/**
 * @param replyWindowMs how long to wait for `partner` to answer (depends on how often the partner thinks)
 */
export function conversationState(
  self: string,
  messages: ChatMessage[],
  nowMs: number,
  replyWindowMs: (partner: string) => number,
): Conversation {
  // Lines between `self` and someone else: said by self and heard by them, or said by them and heard by self.
  const lines = messages
    .map((m) => ({ ...m, t: Date.parse(m.at) }))
    .filter((m) => Number.isFinite(m.t) && m.t <= nowMs)
    .map((m) => ({
      ...m,
      partner: m.speaker === self ? (m.heard_by[0] ?? null) : m.heard_by.includes(self) ? m.speaker : null,
    }))
    .filter((m): m is typeof m & { partner: string } => m.partner !== null && m.partner !== self)
    .sort((a, b) => a.t - b.t);
  if (lines.length === 0) return NONE;
  const partner = lines[lines.length - 1]!.partner;
  const pair = lines.filter((l) => l.partner === partner);

  // Split into conversations: a long pause, or the previous one hitting its limit, starts a new one.
  let start = pair[0]!.t;
  let count = 0;
  let endedAt: number | null = null;
  let prev = -Infinity;
  for (const l of pair) {
    if (endedAt !== null || l.t - prev > NEW_CONVERSATION_GAP_MS) {
      start = l.t;
      count = 0;
      endedAt = null;
    }
    count++;
    prev = l.t;
    if (count >= MAX_EXCHANGES || l.t - start >= MAX_CONVERSATION_MS) endedAt = l.t;
  }
  const last = pair[pair.length - 1]!;
  const lastLine = { from: last.speaker, text: last.text, seconds_ago: Math.round((nowMs - last.t) / 1000) };
  const base = {
    with: partner,
    exchanges: count,
    exchanges_left: Math.max(0, MAX_EXCHANGES - count),
    last_line: lastLine,
  };

  if (endedAt !== null && nowMs - endedAt < COOLDOWN_MS) {
    return {
      ...base,
      state: 'cooldown',
      exchanges_left: 0,
      quiet_for_s: Math.ceil((endedAt + COOLDOWN_MS - nowMs) / 1000),
    };
  }
  if (endedAt !== null) return { ...NONE, last_line: lastLine };
  const wait = Math.min(replyWindowMs(partner), MAX_REPLY_WAIT_MS);
  if (last.speaker === self && nowMs - last.t < wait) {
    return { ...base, state: 'waiting_for_reply', quiet_for_s: Math.ceil((last.t + wait - nowMs) / 1000) };
  }
  if (nowMs - last.t > NEW_CONVERSATION_GAP_MS) return { ...NONE, last_line: lastLine };
  return { ...base, state: 'active' };
}
