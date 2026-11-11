// A character's "mind" — what it has learned and what it currently cares about. Grows with experience:
//   - knowledge: short notes about the island ("lava in the volcano crater burns"), added during the day
//     through the optional `learn` field of a think, tidied up every night with the diary
//   - interests: what it's into lately (evolves nightly from the persona's starting interests)
//   - goals: up to 3 concrete things it wants to do, with a status (set and updated nightly)
// The persona (personality, speech, kindness, curiosity) never changes — only this layer does.
// Plain data + zod only (no relative runtime imports): used by the API functions.

import { z } from 'zod';

export const MAX_KNOWLEDGE = 30;
/** Notes shown in each think prompt (newest first) — keeps the prompt small. */
export const PROMPT_KNOWLEDGE = 12;
export const MAX_INTERESTS = 5;
export const MAX_GOALS = 3;

const GoalSchema = z.object({
  goal: z.string().min(2).max(100),
  status: z.enum(['new', 'in_progress', 'done']).default('new'),
});

export const MindSchema = z.object({
  knowledge: z
    .array(z.object({ text: z.string().min(2).max(140), at: z.string().max(40).optional() }))
    .max(60)
    .default([]),
  interests: z.array(z.string().min(1).max(60)).max(10).default([]),
  goals: z.array(GoalSchema).max(6).default([]),
});

export type Mind = z.infer<typeof MindSchema>;
export type Goal = z.infer<typeof GoalSchema>;

export function parseMind(raw: unknown): Mind | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = MindSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** What the nightly update may return (validated, trimmed to the caps). */
export const MindUpdateSchema = z.object({
  knowledge: z.array(z.string().min(2).max(140)).max(MAX_KNOWLEDGE),
  interests: z.array(z.string().min(1).max(60)).min(1).max(MAX_INTERESTS),
  goals: z.array(GoalSchema).max(MAX_GOALS),
});

/** A note learned during a think: short, factual. Returns the cleaned text or null. */
export function cleanLearned(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.replace(/\s+/g, ' ').trim();
  return t.length >= 4 && t.length <= 140 ? t : null;
}

export interface MindPrompt {
  knowledge: string;
  interests: string;
  goals: string;
}

/** Render the mind for the think prompt (empty strings when there is nothing yet). */
export function formatMind(mind: Mind | null): MindPrompt {
  if (!mind) return { knowledge: '', interests: '', goals: '' };
  const notes = mind.knowledge.slice(-PROMPT_KNOWLEDGE).reverse();
  const order = { in_progress: 0, new: 1, done: 2 } as const;
  const goals = [...mind.goals].sort((a, b) => order[a.status] - order[b.status]);
  return {
    knowledge: notes.map((k) => `- ${k.text}`).join('\n'),
    interests: mind.interests.join(', '),
    goals: goals.map((g) => `- [${g.status.replace('_', ' ')}] ${g.goal}`).join('\n'),
  };
}
