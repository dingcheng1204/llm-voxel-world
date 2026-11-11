// What a character remembers, rendered into its prompt (agent-persona skill §2 "What you remember"):
//   - short-term: its last few thinks (what it thought, said, did and how that went) from `events`
//   - long-term: one-line memories from its newest diaries
// Plain data + string formatting only (no relative runtime imports): used by the API functions.

/** One `events` row of kind 'think' (payload written by api/_lib/thinkCore.ts). */
export interface MemoryEvent {
  /** ISO time the think happened. */
  at: string;
  thought?: string | null;
  say?: string | null;
  actions?: unknown[] | null;
  last_result?: { action?: string; ok?: boolean; reason?: string } | null;
  pos?: [number, number, number] | null;
  area?: string | null;
}

export interface DiaryMemory {
  date: string; // YYYY-MM-DD
  day: number; // the character's Nth diary
  summary: string;
}

export const RECENT_EVENTS = 10;
const CLIP = 70;

const clip = (s: string, n = CLIP) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function ago(atIso: string, nowMs: number): string {
  const min = Math.max(0, Math.round((nowMs - Date.parse(atIso)) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** Compact one-line description of an action, e.g. `walk_to [3,23,29]`, `name_place "海邊"`. */
export function describeAction(a: unknown): string {
  if (!a || typeof a !== 'object') return '?';
  const o = a as Record<string, unknown>;
  const type = String(o.type ?? '?');
  if (Array.isArray(o.target))
    return `${type} [${o.target.join(',')}]${o.block ? ` ${String(o.block)}` : ''}`;
  if (o.landmark) return `${type} "${String(o.landmark)}"`;
  if (o.agent) return `${type} ${String(o.agent)}`;
  if (o.name) return `${type} "${String(o.name)}"`;
  if (o.seconds !== undefined) return `${type} ${String(o.seconds)}s`;
  return type;
}

function outcome(r: MemoryEvent['last_result']): string {
  if (!r) return '';
  return r.ok ? ' → ok' : ` → FAILED (${clip(r.reason ?? r.action ?? 'failed', 50)})`;
}

/**
 * Short-term memory, oldest first. `events` may come newest-first (as the DB returns them).
 * The outcome of a plan is the `last_result` reported by the following think.
 */
export function formatRecent(events: MemoryEvent[], nowMs: number, max = RECENT_EVENTS): string {
  const list = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-max - 1);
  const lines: string[] = [];
  for (let i = Math.max(0, list.length - max); i < list.length; i++) {
    const e = list[i]!;
    const next = list[i + 1];
    const parts: string[] = [];
    if (e.thought) parts.push(`thought "${clip(e.thought)}"`);
    if (e.say) parts.push(`said "${clip(e.say)}"`);
    const acts = Array.isArray(e.actions) ? e.actions.map(describeAction).join(', ') : '';
    if (acts) parts.push(`did ${acts}${next ? outcome(next.last_result) : ''}`);
    if (parts.length === 0) continue;
    const where = e.pos ? ` at [${e.pos.join(',')}]${e.area ? ` (${e.area})` : ''}` : '';
    lines.push(`- ${ago(e.at, nowMs)}${where}: ${parts.join('; ')}`);
  }
  return lines.join('\n');
}

/** Long-term memory from diaries, newest first. */
export function formatDiaries(diaries: DiaryMemory[]): string {
  return [...diaries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) => `- Day ${d.day} (${d.date}): ${clip(d.summary, 240)}`)
    .join('\n');
}
