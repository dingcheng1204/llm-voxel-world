// Today's usage and limits per character (diary page cost panel).
import { handleUsage } from '../_lib/usageCore.js';

export async function GET(): Promise<Response> {
  return handleUsage({ fetch, env: process.env });
}
