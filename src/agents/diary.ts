// Daily diary (agent-persona skill §7, references/diary-format.md).
//   buildDigest()     — compress a day of `events` (hundreds of thinks) into a short factual log
//   diaryMessages()   — the prompt: persona + yesterday's entry + today's digest
//   parseDiaryReply() — validate the model's JSON {diary, memory} and fix the title line
// Plain data + formatting + zod only (no relative runtime imports): used by api/_lib/diaryCore.ts.

import { z } from 'zod';
import { describeAction, type MemoryEvent } from './memory.js';
import { MAX_GOALS, MAX_INTERESTS, MAX_KNOWLEDGE, MindUpdateSchema, parseMind, type Mind } from './mind.js';
import type { Persona } from './personas.js';
import type { ChatMessage } from './prompt.js';

export interface DiaryInput {
  /** This will be the character's Nth diary. */
  day: number;
  previous: { date: string; content: string } | null;
  events: (MemoryEvent & { learn?: string | null })[];
  messages: { at: string; speaker: string; text: string }[];
  /** Current knowledge / interests / goals (tidied and updated by tonight's call). */
  mind?: unknown;
}

export const DIARY_HEADINGS = [
  '今天做了什麼',
  '今天發現的事',
  '和誰聊了什麼',
  '我還想不通的問題',
  '心情',
  '明天想做',
] as const;

const TAIPEI_MS = 8 * 3600_000;
const hhmm = (iso: string) => new Date(Date.parse(iso) + TAIPEI_MS).toISOString().slice(11, 16);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Evenly pick up to `n` items, always keeping the first and last. */
function sample<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(list[Math.round((i * (list.length - 1)) / (n - 1))]!);
  return out;
}

/** A factual, compact log of the day (≈ 1–2k tokens however many thinks there were). */
export function buildDigest(input: DiaryInput): string {
  const ev = [...input.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (ev.length === 0) return 'Nothing was recorded today.';
  const lines: string[] = [];
  lines.push(
    `Awake from ${hhmm(ev[0]!.at)} to ${hhmm(ev[ev.length - 1]!.at)} (Taipei time), ${ev.length} moments recorded.`,
  );

  // Where: areas in the order visited (consecutive duplicates merged) + how much time in each.
  const route: string[] = [];
  const share = new Map<string, number>();
  for (const e of ev) {
    const a = e.area ?? 'unknown';
    if (route[route.length - 1] !== a) route.push(a);
    share.set(a, (share.get(a) ?? 0) + 1);
  }
  lines.push(`Areas visited, in order: ${sample(route, 20).join(' → ')}.`);
  lines.push(
    `Time spent: ${[...share.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([a, c]) => `${a} ${Math.round((c * 100) / ev.length)}%`)
      .join(', ')}.`,
  );

  // What: action counts, named places, failures.
  const counts = new Map<string, number>();
  const named: string[] = [];
  for (const e of ev) {
    for (const a of e.actions ?? []) {
      const t = (a as { type?: string }).type ?? '?';
      counts.set(t, (counts.get(t) ?? 0) + 1);
      if (t === 'name_place')
        named.push(`"${(a as { name?: string }).name}" (${e.area ?? '?'}, ${hhmm(e.at)})`);
    }
  }
  if (counts.size)
    lines.push(
      `Actions planned: ${[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t, c]) => `${t} ×${c}`)
        .join(', ')}.`,
    );
  if (named.length) lines.push(`Places you named: ${[...new Set(named)].slice(0, 12).join(', ')}.`);
  const learned = ev.filter((e) => e.learn).map((e) => `- ${hhmm(e.at)} ${clip(e.learn!, 100)}`);
  if (learned.length) lines.push(`Notes you wrote down today:\n${learned.slice(-15).join('\n')}`);
  const failures = [
    ...new Set(
      ev
        .filter((e) => e.last_result && e.last_result.ok === false)
        .map((e) => e.last_result!.reason ?? 'failed'),
    ),
  ];
  if (failures.length)
    lines.push(
      `Things that didn't work: ${failures
        .slice(0, 8)
        .map((f) => clip(f, 80))
        .join('; ')}.`,
    );

  // Words: everything said (deduplicated), heard lines, and a sample of thoughts.
  const said = ev.filter((e) => e.say).map((e) => `${hhmm(e.at)} "${clip(e.say!, 80)}"`);
  const uniqueSaid = [...new Map(said.map((s) => [s.slice(6), s])).values()];
  if (uniqueSaid.length)
    lines.push(
      `Things you said aloud:\n${sample(uniqueSaid, 25)
        .map((s) => `- ${s}`)
        .join('\n')}`,
    );
  const heard = input.messages.map((m) => `- ${hhmm(m.at)} ${m.speaker}: "${clip(m.text, 80)}"`);
  if (heard.length) lines.push(`Conversations:\n${sample(heard, 20).join('\n')}`);
  const thoughts = ev
    .filter((e) => e.thought)
    .map((e) => {
      const acts = (e.actions ?? []).map(describeAction).join(', ');
      return `- ${hhmm(e.at)} (${e.area ?? '?'}) ${clip(e.thought!, 90)}${acts ? ` [${clip(acts, 60)}]` : ''}`;
    });
  if (thoughts.length)
    lines.push(`Your thoughts through the day (sample):\n${sample(thoughts, 30).join('\n')}`);
  return lines.join('\n');
}

export function diaryMessages(
  p: Persona,
  input: DiaryInput,
  date: string,
  others: string[] = [],
): ChatMessage[] {
  const system = `You are ${p.displayName}, a small ${p.species} living on a cute island made of blocks.
${p.personality}
How you speak: ${p.speechStyle}

Tonight you write your diary in ${p.language}, first person, about 300–700 characters (150–350 words), using EXACTLY
these Markdown headings in this order:
${DIARY_HEADINGS.map((h) => `## ${h}`).join('\n')}

Rules:
- Only describe things that appear in today's log. Never invent events, places, conversations or other characters.
  If nobody talked with you, say so honestly under "和誰聊了什麼".
- Feelings, guesses and open questions are welcome. Refer to areas and place names, not raw coordinates.
- You are a character in this world — never mention being an AI, a model, a log or "events".
- Who lives on the island: you${others.length ? ` and ${others.join(', ')}` : ''} — nobody else. If the log mentions
  anyone else, they have left the island: mention that at most briefly, and never make notes, interests or goals
  about them.

After writing, also tidy up your mind for tomorrow ("mind" in the reply):
- "knowledge": your notes about the island, at most ${MAX_KNOWLEDGE}. Keep true, useful facts (what is where, what happens
  when…), merge duplicates, drop trivial or wrong ones, add today's real discoveries. Short (under 60 characters each),
  in ${p.language}.
- "interests": what you are into lately, 2–${MAX_INTERESTS} short phrases in ${p.language}. Let them change slowly with
  what fascinated you today; you stay curious and kind at heart.
- "goals": up to ${MAX_GOALS} concrete things you want to do on this island with your abilities (walk, look, mine, place
  blocks, name places, visit others), in ${p.language}, each with status "new", "in_progress" or "done". Keep goals you
  are still working on, mark finished ones "done" (drop them the next night), add new ones from today's questions.

Reply with ONE JSON object and nothing else:
{"diary": "the Markdown diary (headings above; no title line)", "memory": "1–2 sentences in ${p.language}, at most 120 characters: what you most want to remember tomorrow (a discovery, an open question, a plan)", "mind": {"knowledge": ["…"], "interests": ["…"], "goals": [{"goal": "…", "status": "new"}]}}`;

  const mind = parseMind(input.mind);
  const mindText = mind
    ? `Your mind before today:\nNotes:\n${mind.knowledge.map((k) => `- ${k.text}`).join('\n') || '(none)'}\nInterests: ${
        mind.interests.join(', ') || p.interests.join(', ')
      }\nGoals:\n${mind.goals.map((g) => `- [${g.status}] ${g.goal}`).join('\n') || '(none)'}\n\n`
    : `Your mind before today: no notes or goals yet. Your starting interests: ${p.interests.join(', ')}.\n\n`;
  const user = `${mindText}${input.previous ? `Yesterday's entry (${input.previous.date}):\n${input.previous.content}\n\n` : 'This is your first diary entry.\n\n'}Today's log (${date}):\n${buildDigest(input)}\n\nWrite today's diary now. JSON only.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

const ReplySchema = z.object({
  diary: z.string().min(80).max(4000),
  memory: z.string().min(4).max(240),
});

export interface MindUpdate {
  knowledge: string[];
  interests: string[];
  goals: Mind['goals'];
}

export type DiaryReply =
  | { ok: true; diary: string; memory: string; mind: MindUpdate | null; mindError?: string }
  | { ok: false; error: string };

/** Validate the model output; puts our own title line on top (`# 第 N 天 · YYYY-MM-DD`). */
export function parseDiaryReply(raw: unknown, day: number, date: string): DiaryReply {
  const r = ReplySchema.safeParse(raw);
  if (!r.success)
    return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const body = r.data.diary
    .replace(/\r/g, '')
    .replace(/^\s*#\s[^\n]*\n/, '') // drop a title line if the model wrote one
    .trim();
  const missing = DIARY_HEADINGS.filter((h) => !body.includes(`## ${h}`));
  if (missing.length)
    return { ok: false, error: `missing headings: ${missing.map((h) => `## ${h}`).join(', ')}` };
  // The mind update is optional: a bad one is dropped (yesterday's mind stays); the diary is still saved.
  const m = MindUpdateSchema.safeParse((raw as { mind?: unknown }).mind);
  return {
    ok: true,
    diary: `# 第 ${day} 天 · ${date}\n\n${body}\n`,
    memory: r.data.memory.trim().slice(0, 200),
    mind: m.success
      ? {
          knowledge: [...new Set(m.data.knowledge.map((k) => k.trim()).filter(Boolean))],
          interests: m.data.interests.map((i) => i.trim()).filter(Boolean),
          goals: m.data.goals,
        }
      : null,
    ...(m.success
      ? {}
      : { mindError: m.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }),
  };
}
