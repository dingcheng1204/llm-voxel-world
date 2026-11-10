// The action contract between a brain (LLM or script) and a body. See agent-persona skill §4.
// Every brain response is validated here — never trust raw model output.

import { z } from 'zod';
import { BLOCKS } from '../world/blocks';

const vec3 = z.tuple([z.number().int(), z.number().int(), z.number().int()]);
const blockNames = BLOCKS.filter((b) => b.id !== 0).map((b) => b.name) as [string, ...string[]];

export const ActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('walk_to'),
      target: vec3.optional(),
      agent: z.string().max(32).optional(),
      landmark: z.string().max(40).optional(),
    })
    .refine((a) => [a.target, a.agent, a.landmark].filter((v) => v !== undefined).length === 1, {
      message: 'walk_to needs exactly one of target, agent or landmark',
    }),
  z.object({ type: z.literal('look_at'), target: vec3 }),
  z.object({ type: z.literal('mine'), target: vec3 }),
  z.object({ type: z.literal('place'), target: vec3, block: z.enum(blockNames) }),
  z.object({ type: z.literal('follow'), agent: z.string().max(32), seconds: z.number().min(1).max(60) }),
  z.object({ type: z.literal('name_place'), name: z.string().min(1).max(40) }),
  z.object({ type: z.literal('wait'), seconds: z.number().min(0).max(30) }),
  z.object({ type: z.literal('idle') }),
]);

export const AgentResponseSchema = z.object({
  thought: z.string().max(400),
  say: z.string().max(140).nullable().optional(),
  actions: z.array(ActionSchema).max(3),
});

export type Action = z.infer<typeof ActionSchema>;
export type AgentResponse = z.infer<typeof AgentResponseSchema>;
export type ActionType = Action['type'];

export interface ActionResult {
  action: ActionType;
  ok: boolean;
  /** Short reason on failure (fed back to the brain), e.g. "no path", "out of reach". */
  reason?: string;
}

/** Parse untrusted brain output (string or object). Returns the error text for the retry prompt. */
export function parseAgentResponse(
  raw: unknown,
): { ok: true; value: AgentResponse } | { ok: false; error: string } {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      // Models sometimes wrap JSON in ```json fences.
      data = JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
    } catch {
      return { ok: false, error: 'response is not valid JSON' };
    }
  }
  const r = AgentResponseSchema.safeParse(data);
  if (r.success) return { ok: true, value: r.data };
  return {
    ok: false,
    error: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
  };
}

/** What a brain gets when its output is invalid twice (skill §4). */
export const IDLE_RESPONSE: AgentResponse = { thought: '…', say: null, actions: [{ type: 'idle' }] };
