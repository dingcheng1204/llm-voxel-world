// POST /api/agent/think — one "think" for an LLM-driven character. See api/_lib/thinkCore.ts.
import { handleThink } from '../_lib/thinkCore.js';

export async function POST(request: Request): Promise<Response> {
  return handleThink(request, { fetch, env: process.env });
}
