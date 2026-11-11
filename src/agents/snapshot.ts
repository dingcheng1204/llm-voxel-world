// What survives between sessions for a server-run character: where it is, what it carries,
// the places it named and what it last thought/said. Stored as JSON in Supabase `agent_state`.
// Shared by the browser, the Vercel functions and the server simulation — keep runtime imports to
// packages only (no relative runtime imports), so the API functions can import it directly.

import { z } from 'zod';
import type { ActionResult } from './actions.js';
import type { Agent } from './Agent.js';
import type { Landmarks } from './worldState.js';

const ISLAND = { minX: -96, maxX: 96, minY: 0, maxY: 64, minZ: -144, maxZ: 144 };
const finite = z.number().finite();

export const SnapshotSchema = z.object({
  pos: z.tuple([
    finite.min(ISLAND.minX).max(ISLAND.maxX),
    finite.min(ISLAND.minY).max(ISLAND.maxY),
    finite.min(ISLAND.minZ).max(ISLAND.maxZ),
  ]),
  heading: finite.default(0),
  inventory: z
    .record(z.string().regex(/^[a-z_]{1,24}$/), z.number().int().min(1).max(999))
    .refine((r) => Object.keys(r).length <= 32, 'too many inventory kinds')
    .default({}),
  landmarks: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        pos: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
        by: z.string().max(32),
      }),
    )
    .max(50)
    .default([]),
  thought: z.string().max(400).default(''),
  /** Epoch ms of the thought (for the bubble). */
  thoughtAt: z.number().default(0),
  /** Epoch ms of the last perception this character acted on — lines said after it count as "heard". */
  lastThinkAt: z.number().default(0),
  say: z.string().max(140).nullable().default(null),
  sayAt: z.number().nullable().default(null),
  lastResult: z
    .object({ action: z.string().max(16), ok: z.boolean(), reason: z.string().max(200).optional() })
    .nullable()
    .default(null),
});

export type AgentSnapshot = z.infer<typeof SnapshotSchema>;

/** Validate untrusted JSON (from the DB or a browser). Returns null when unusable. */
export function parseSnapshot(raw: unknown): AgentSnapshot | null {
  if (!raw || typeof raw !== 'object' || Object.keys(raw).length === 0) return null;
  const r = SnapshotSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function takeSnapshot(agent: Agent, landmarks: Landmarks, lastThinkAt = Date.now()): AgentSnapshot {
  const b = agent.body.body;
  return {
    pos: [round(b.x), round(b.y), round(b.z)],
    heading: round(agent.body.heading),
    inventory: Object.fromEntries(agent.executor.inventory),
    landmarks: landmarks.list.slice(-50).map((l) => ({ name: l.name, pos: l.pos, by: l.by })),
    thought: agent.thought.slice(0, 400),
    thoughtAt: agent.thoughtAt,
    lastThinkAt,
    say: agent.lastSay?.text.slice(0, 140) ?? null,
    sayAt: agent.lastSay?.at ?? null,
    lastResult: agent.executor.lastResult
      ? {
          action: agent.executor.lastResult.action,
          ok: agent.executor.lastResult.ok,
          ...(agent.executor.lastResult.reason
            ? { reason: agent.executor.lastResult.reason.slice(0, 200) }
            : {}),
        }
      : null,
  };
}

/** Put a character back where the snapshot says (teleport; clears its current plan). */
export function restoreSnapshot(agent: Agent, s: AgentSnapshot, landmarks: Landmarks): void {
  agent.executor.clear();
  agent.body.teleport(s.pos[0], s.pos[1], s.pos[2], s.heading);
  agent.executor.inventory.clear();
  for (const [k, v] of Object.entries(s.inventory)) agent.executor.inventory.set(k, v);
  for (const l of s.landmarks) landmarks.add(l.name, l.pos, l.by);
  showSnapshotLines(agent, s);
  agent.executor.lastResult = s.lastResult as ActionResult | null;
}

/** Copy the thought/speech bubbles from a snapshot (mirrors show what the driver's Clio is thinking). */
export function showSnapshotLines(agent: Agent, s: AgentSnapshot): void {
  if (s.thoughtAt > agent.thoughtAt) {
    agent.thought = s.thought;
    agent.thoughtAt = s.thoughtAt;
  }
  if (s.say && s.sayAt && s.sayAt > (agent.lastSay?.at ?? 0)) agent.lastSay = { text: s.say, at: s.sayAt };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
