// Nightly diary writer (Supabase pg_cron at 23:30 Asia/Taipei → here).
import { handleDiary } from '../_lib/diaryCore.js';

export async function POST(request: Request): Promise<Response> {
  return handleDiary(request, { fetch, env: process.env });
}
