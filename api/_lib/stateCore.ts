// Core of POST /api/agent/state — the browser heartbeat for server-run characters.
//
//   { agentId, clientId, state?: AgentSnapshot | null, release?: boolean }
//   → { driver: boolean, state: AgentSnapshot | null, updatedAt }
//
// A visible tab calls this every few seconds. If no one else holds the lease it becomes (or stays)
// the driver and its snapshot is saved; otherwise it gets the current state back and mirrors it.
// `release: true` means "I'm not simulating" (tab hidden / closing) — the server tick takes over.

import { parseSnapshot } from '../../src/agents/snapshot.js';
import { PERSONAS } from '../../src/agents/personas.js';
import { BROWSER_LEASE_SECONDS, config, json, rpc, type ThinkDeps } from './thinkCore.js';

const MAX_BODY = 16_000;

export async function handleState(req: Request, deps: ThinkDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const cfg = config(deps.env);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'request too large' }, 413);
  let body: { agentId?: unknown; clientId?: unknown; state?: unknown; release?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const agentId = typeof body.agentId === 'string' ? body.agentId : '';
  if (!PERSONAS[agentId] || !cfg.agents.includes(agentId))
    return json({ error: `"${agentId}" is not server-run` }, 403);
  const clientId = typeof body.clientId === 'string' ? body.clientId : '';
  if (!/^[\w-]{8,64}$/.test(clientId) || clientId === 'server') return json({ error: 'bad clientId' }, 400);
  let state = null;
  if (body.state !== undefined && body.state !== null) {
    state = parseSnapshot(body.state);
    if (!state) return json({ error: 'invalid state' }, 400);
  }
  if (!cfg.dbSecret) return json({ error: 'state service not configured (AGENT_DB_SECRET)' }, 503);

  try {
    const r = await rpc<{ driver: boolean; state: unknown; updated_at: string | null }>(
      deps,
      cfg,
      'agent_state_sync',
      {
        p_secret: cfg.dbSecret,
        p_agent: agentId,
        p_driver: clientId,
        p_state: state,
        p_lease_seconds: BROWSER_LEASE_SECONDS,
        p_release: body.release === true,
      },
    );
    return json({ driver: r.driver, state: parseSnapshot(r.state), updatedAt: r.updated_at });
  } catch {
    return json({ error: 'state service unavailable' }, 503);
  }
}
