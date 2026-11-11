import { handleSay } from '../_lib/chatCore.js';

export async function POST(request: Request): Promise<Response> {
  return handleSay(request, { fetch, env: process.env });
}
