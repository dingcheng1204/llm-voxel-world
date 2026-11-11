import { handleState } from '../_lib/stateCore.js';

export async function POST(request: Request): Promise<Response> {
  return handleState(request, { fetch, env: process.env });
}
