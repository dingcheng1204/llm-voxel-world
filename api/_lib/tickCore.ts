// Core of POST /api/agent/tick — called once a minute by Supabase pg_cron (see migration
// 20261111030000_agent_state.sql) with the shared secret in `x-agent-secret`.
//
// For every server-run character that no visible browser tab is driving:
//   1. take the lease as "server", load its saved state and the shared world edits
//   2. rebuild the island headless, perceive, ask the LLM once (same budget/rate limit as /think)
//   3. execute the plan with real physics for TICK_SECONDS, save the new state + its block edits
// While someone watches, their tab drives instead (thinks every ~6 s) and this tick just skips.

import { parseSnapshot } from '../../src/agents/snapshot.js';
import { PERSONAS } from '../../src/agents/personas.js';
import type { AgentResponse } from '../../src/agents/actions.js';
import type { createSim as CreateSim, parseAgentResponse as ParseAgentResponse } from '../_gen/sim.js';
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

export async function handleTick(req: Request, deps: TickDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const cfg = config(deps.env);
  if (!cfg.dbSecret) return json({ error: 'not configured' }, 503);
  if (!safeEqual(req.headers.get('x-agent-secret') ?? '', cfg.dbSecret))
    return json({ error: 'forbidden' }, 403);
  const now = deps.now ?? Date.now;
  const started = now();
  const seed = Number(deps.env.WORLD_SEED ?? deps.env.VITE_WORLD_SEED ?? DEFAULT_SEED);

  const reports: TickReport[] = [];
  let edits: [number, number, number, number][] | null = null;
  for (const agentId of cfg.agents.filter((id) => PERSONAS[id])) {
    const report: TickReport = { agentId };
    reports.push(report);
    let lease: { driver: boolean; state: unknown };
    try {
      lease = await rpc(deps, cfg, 'agent_state_sync', {
        p_secret: cfg.dbSecret,
        p_agent: agentId,
        p_driver: 'server',
        p_state: null,
        p_lease_seconds: SERVER_LEASE_SECONDS,
        p_release: false,
      });
    } catch (err) {
      report.error = `lease: ${(err as Error).message}`;
      continue;
    }
    if (!lease.driver) {
      report.skipped = 'a browser is driving';
      continue;
    }

    let snapshot = null;
    try {
      edits ??= await loadEdits(deps, cfg, seed);
      const sim = deps.sim.createSim({ seed, agentId, snapshot: parseSnapshot(lease.state), edits, now });

      // One think (plus one retry if the JSON is invalid and there is time left).
      let plan: AgentResponse | null = null;
      let retryError: string | undefined;
      for (let attempt = 0; attempt < 2 && plan === null; attempt++) {
        if (attempt > 0 && (retryError === undefined || now() - started > 12_000)) break;
        const r = await runThink(deps, cfg, agentId, sim.perception(), retryError);
        if (!r.ok) {
          report.error = r.error; // budget reached / rate limited / model down → rest this minute
          break;
        }
        report.cost = (report.cost ?? 0) + r.cost;
        const parsed = deps.sim.parseAgentResponse(r.raw);
        if (parsed.ok) plan = parsed.value;
        else retryError = parsed.error;
      }

      const out = sim.run(plan, TICK_SECONDS);
      snapshot = out.snapshot;
      report.thought = plan?.thought;
      report.say = plan?.say ?? null;
      report.results = out.results;
      report.walked = Math.round(out.walked * 10) / 10;
      await saveEdits(deps, cfg, seed, out.edits);
    } catch (err) {
      report.error = `sim: ${(err as Error).message}`;
    } finally {
      // Save (if the run finished) and hand the character back to whoever comes next.
      await rpc(deps, cfg, 'agent_state_sync', {
        p_secret: cfg.dbSecret,
        p_agent: agentId,
        p_driver: 'server',
        p_state: snapshot,
        p_lease_seconds: SERVER_LEASE_SECONDS,
        p_release: true,
      }).catch((err: Error) => {
        report.error = `${report.error ?? ''} save: ${err.message}`.trim();
      });
    }
  }
  return json({ ms: now() - started, reports });
}
