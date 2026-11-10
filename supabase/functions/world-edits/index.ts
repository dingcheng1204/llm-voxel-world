// Supabase Edge Function: shared world edits.
//   GET  /world-edits?seed=<n>[&since=<ISO time>]  → { edits: [[x,y,z,id,tMs], ...], now }
//   POST /world-edits  { seed, edits: [{x,y,z,id,by}] }  → { ok, count }
// Writes use the service role (never exposed to browsers); input is validated here.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const BOUNDS = { minX: -96, maxX: 95, minY: 0, maxY: 63, minZ: -144, maxZ: 143 };
const MAX_BATCH = 500;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const seed = Number(url.searchParams.get('seed'));
      if (!Number.isSafeInteger(seed)) return json({ error: 'bad seed' }, 400);
      const since = url.searchParams.get('since');
      const now = new Date().toISOString();
      const edits: [number, number, number, number, number][] = [];
      for (let from = 0; ; from += 1000) {
        let q = sb
          .from('world_edits')
          .select('x,y,z,block_id,updated_at')
          .eq('seed', seed)
          .order('updated_at', { ascending: true })
          .range(from, from + 999);
        if (since) q = q.gt('updated_at', since);
        const { data, error } = await q;
        if (error) throw error;
        for (const r of data) edits.push([r.x, r.y, r.z, r.block_id, Date.parse(r.updated_at)]);
        if (data.length < 1000) break;
      }
      return json({ edits, now });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => null);
      const seed = body?.seed;
      const list = body?.edits;
      if (!Number.isSafeInteger(seed) || !Array.isArray(list)) return json({ error: 'bad body' }, 400);
      if (list.length === 0) return json({ ok: true, count: 0 });
      if (list.length > MAX_BATCH) return json({ error: `max ${MAX_BATCH} edits per request` }, 413);
      // Last write wins per block: keep only the final edit for each position in this batch.
      const rows = new Map<string, Record<string, unknown>>();
      for (const e of list) {
        const { x, y, z, id } = e ?? {};
        if (![x, y, z, id].every(isInt)) return json({ error: 'edits must be integers' }, 400);
        if (x < BOUNDS.minX || x > BOUNDS.maxX || y < BOUNDS.minY || y > BOUNDS.maxY || z < BOUNDS.minZ || z > BOUNDS.maxZ)
          return json({ error: 'edit out of bounds' }, 400);
        if (id < 0 || id > 255 || id === 10) return json({ error: 'bad block id' }, 400); // 10 = bedrock
        const by = typeof e.by === 'string' ? e.by.slice(0, 32) : 'player';
        rows.set(`${x},${y},${z}`, { seed, x, y, z, block_id: id, by, updated_at: new Date().toISOString() });
      }
      const { error } = await sb.from('world_edits').upsert([...rows.values()], { onConflict: 'seed,x,y,z' });
      if (error) throw error;
      return json({ ok: true, count: rows.size });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (err) {
    console.error(err);
    return json({ error: 'server error' }, 500);
  }
});
