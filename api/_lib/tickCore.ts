// Core of POST /api/agent/tick — called once a minute by Supabase pg_cron (see migration
// 20261111030000_agent_state.sql) with the shared secret in `x-agent-secret`.
//
// For every server-run character that no visible browser tab is driving:
//   1. take the lease as "server", load its saved state and the shared world edits
//   2. rebuild the island headless, perceive, ask the LLM once (same budget/rate limit as /think)
//   3. execute the plan with real physics for TICK_SECONDS, save the new state + its block edits
// While someone watches, their tab drives instead (thinks every ~6 s) and this tick just skips.

import { parseSnapshot, type AgentSnapshot } from '../../src/agents/snapshot.js';
import { PERSONAS } from '../../src/agents/personas.js';
import type { AgentResponse } from '../../src/agents/actions.js';
import type {
  createSim as CreateSim,
  parseAgentResponse as ParseAgentResponse,
  SimChatLine,
} from '../_gen/sim.js';
import { config, json, rpc, runThink, type Config, type ThinkDeps } from './thinkCore.js';

export const TICK_SECONDS = 60;
/** Server lease while a tick runs (longer than one tick can take). */
const SERVER_LEASE_SECONDS = 45;
const DEFAULT_SEED = 20261110;

export interface TickDeps extends ThinkDeps {
  sim: { createSim: typeof CreateSim; parseAgentResponse: typeof ParseAgentResponse };
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const anonHeaders = (cfg: Config) => ({
  apikey: cfg.supabaseKey,
  Authorization: `Bearer ${cfg.supabaseKey}`,
  'Content-Type': 'application/json',
});

/** All saved block edits for the seed (public read). */
async function loadEdits(
  deps: ThinkDeps,
  cfg: Config,
  seed: number,
): Promise<[number, number, number, number][]> {
  const out: [number, number, number, number][] = [];
  for (let from = 0; ; from += 1000) {
    const res = await deps.fetch(
      `${cfg.supabaseUrl}/rest/v1/world_edits?seed=eq.${seed}&select=x,y,z,block_id&order=x,y,z`,
      { headers: { ...anonHeaders(cfg), Range: `${from}-${from + 999}` } },
    );
    if (!res.ok) throw new Error(`world_edits ${res.status}`);
    const rows = (await res.json()) as { x: number; y: number; z: number; block_id: number }[];
    for (const r of rows) out.push([r.x, r.y, r.z, r.block_id]);
    if (rows.length < 1000) return out;
  }
}

async function saveEdits(
  deps: ThinkDeps,
  cfg: Config,
  seed: number,
  edits: { x: number; y: number; z: number; id: number; by: string }[],
): Promise<void> {
  if (edits.length === 0) return;
  const res = await deps.fetch(`${cfg.supabaseUrl}/functions/v1/world-edits`, {
    method: 'POST',
    headers: anonHeaders(cfg),
    body: JSON.stringify({ seed, edits: edits.slice(-500) }),
  });
  if (!res.ok) throw new Error(`world-edits ${res.status}`);
}

export interface TickReport {
  agentId: string;
  skipped?: string;
  error?: string;
  thought?: string;
  say?: string | null;
  results?: { action: string; ok: boolean; reason?: string }[];
  walked?: number;
  cost?: number;
}

/** Current saved state of every character (public read) — puppets for characters not simulated now. */
async function loadStates(deps: ThinkDeps, cfg: Config): Promise<Map<string, unknown>> {
  const res = await deps.fetch(`${cfg.supabaseUrl}/rest/v1/agent_state?select=agent_id,state`, {
    headers: anonHeaders(cfg),
  });
  if (!res.ok) throw new Error(`agent_state ${res.status}`);
  const rows = (await res.json()) as { agent_id: string; state: unknown }[];
  return new Map(rows.map((r) => [r.agent_id, r.state]));
}

/** Lines said in the last 10 minutes (public read) — so characters hear each other across ticks. */
async function loadChat(deps: ThinkDeps, cfg: Config, nowMs: number): Promise<SimChatLine[]> {
  const since = new Date(nowMs - 10 * 60_000).toISOString();
  const res = await deps.fetch(
    `${cfg.supabaseUrl}/rest/v1/messages?select=speaker,text,pos,created_at&created_at=gt.${since}&order=created_at`,
    { headers: anonHeaders(cfg) },
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as {
    speaker: string;
    text: string;
    pos: number[] | null;
    created_at: string;
  }[];
  return rows
    .filter((r) => Array.isArray(r.pos) && r.pos.length === 3)
    .map((r) => ({
      from: r.speaker,
      text: r.text,
      pos: r.pos as [number, number, number],
      at: Date.parse(r.created_at),
    }));
}

export async function handleTick(req: Request, deps: TickDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const cfg = config(deps.env);
  if (!cfg.dbSecret) return json({ error: 'not configured' }, 503);
  if (!safeEqual(req.headers.get('x-agent-secret') ?? '', cfg.dbSecret))
    return json({ error: 'forbidden' }, 403);
  const now = deps.now ?? Date.now;
  const started = now();
  const seed = Number(deps.env.WORLD_SEED ?? deps.env.VITE_WORLD_SEED ?? DEFAULT_SEED);
  const minute = Math.floor(started / 60_000);
  const lease = (agentId: string, state: unknown, release: boolean) =>
    rpc<{ driver: boolean; state: unknown }>(deps, cfg, 'agent_state_sync', {
      p_secret: cfg.dbSecret,
      p_agent: agentId,
      p_driver: 'server',
      p_state: state,
      p_lease_seconds: SERVER_LEASE_SECONDS,
      p_release: release,
    });

  // 1. Who thinks this minute: due by their brain's cadence AND not driven by a browser tab.
  const reports = new Map<string, TickReport>();
  const leased = new Map<string, unknown>(); // agentId → saved state
  for (const agentId of cfg.agents.filter((id) => PERSONAS[id])) {
    const report: TickReport = { agentId };
    reports.set(agentId, report);
    const every = cfg.brains[agentId]!.serverEveryMinutes;
    if (minute % every !== 0) {
      report.skipped = `thinks every ${every} min`;
      continue;
    }
    try {
      const l = await lease(agentId, null, false);
      if (l.driver) leased.set(agentId, l.state);
      else report.skipped = 'a browser is driving';
    } catch (err) {
      report.error = `lease: ${(err as Error).message}`;
    }
  }
  if (leased.size === 0) return json({ ms: now() - started, reports: [...reports.values()] });

  // 2. One shared world with every LLM character in it (inactive ones stand where they were saved).
  const snapshots = new Map<string, AgentSnapshot | null>();
  try {
    const [edits, states, chat] = await Promise.all([
      loadEdits(deps, cfg, seed),
      loadStates(deps, cfg),
      loadChat(deps, cfg, started),
    ]);
    const sim = deps.sim.createSim({
      seed,
      agents: cfg.agents
        .filter((id) => PERSONAS[id])
        .map((id) => ({
          agentId: id,
          snapshot: parseSnapshot(leased.has(id) ? leased.get(id) : states.get(id)),
          active: leased.has(id),
        })),
      edits,
      chat,
      now,
    });

    // 3. Think (in parallel; each call is budgeted and logged), one retry for invalid JSON.
    const plans: Record<string, AgentResponse | null> = {};
    await Promise.all(
      [...leased.keys()].map(async (agentId) => {
        const report = reports.get(agentId)!;
        const perception = sim.perception(agentId);
        let retryError: string | undefined;
        plans[agentId] = null;
        for (let attempt = 0; attempt < 2 && plans[agentId] === null; attempt++) {
          if (attempt > 0 && (retryError === undefined || now() - started > 12_000)) break;
          const r = await runThink(deps, cfg, agentId, perception, retryError);
          if (!r.ok) {
            report.error = r.error; // budget / quota / rate limit / model down → rest this tick
            break;
          }
          report.cost = (report.cost ?? 0) + r.cost;
          const parsed = deps.sim.parseAgentResponse(r.raw);
          if (parsed.ok) plans[agentId] = parsed.value;
          else retryError = parsed.error;
        }
        report.thought = plans[agentId]?.thought;
        report.say = plans[agentId]?.say ?? null;
      }),
    );

    // 4. Run 60 s of physics for everyone, save the active characters' block edits.
    const out = sim.run(plans, TICK_SECONDS);
    for (const [agentId, r] of Object.entries(out.agents)) {
      snapshots.set(agentId, r.snapshot);
      const report = reports.get(agentId)!;
      report.results = r.results;
      report.walked = Math.round(r.walked * 10) / 10;
    }
    await saveEdits(deps, cfg, seed, out.edits);
  } catch (err) {
    for (const id of leased.keys()) reports.get(id)!.error ??= `sim: ${(err as Error).message}`;
  } finally {
    // 5. Save (if the run finished) and hand every character back to whoever comes next.
    await Promise.all(
      [...leased.keys()].map((agentId) =>
        lease(agentId, snapshots.get(agentId) ?? null, true).catch((err: Error) => {
          const r = reports.get(agentId)!;
          r.error = `${r.error ?? ''} save: ${err.message}`.trim();
        }),
      ),
    );
  }
  return json({ ms: now() - started, reports: [...reports.values()] });
}
