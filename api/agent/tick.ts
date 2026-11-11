// Once-a-minute server tick (Supabase pg_cron → here). The simulation is a pre-bundled copy of
// src/server/sim.ts (npm run build:sim) because this runtime can't load src/ directly.
import { createSim, parseAgentResponse } from '../_gen/sim.js';
import { handleTick } from '../_lib/tickCore.js';

export async function POST(request: Request): Promise<Response> {
  return handleTick(request, { fetch, env: process.env, sim: { createSim, parseAgentResponse } });
}
