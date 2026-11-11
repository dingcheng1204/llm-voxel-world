// Core of POST /api/chat/say — an online player says something in the chat window.
//   { playerId: "p-xxxxxx", name, text, to: null | "all" | characterId | playerId, pos: [x, y, z] }
// Validated here, rate-limited in the DB (agent_player_say: 1 line / 2 s, 12 / minute per player).
// The line lands in `messages` → every browser's chat window (Realtime) and the characters' hearing.

import { PERSONAS } from '../../src/agents/personas.js';
import { config, json, rpc, type ThinkDeps } from './thinkCore.js';

export const PLAYER_ID = /^p-[a-z0-9]{6,12}$/;
const MAX_BODY = 2_000;

/** Trim, collapse whitespace and drop control characters. */
export function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length >= 1 && t.length <= max ? t : null;
}

export async function handleSay(req: Request, deps: ThinkDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const cfg = config(deps.env);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: 'request too large' }, 413);
  let body: { playerId?: unknown; name?: unknown; text?: unknown; to?: unknown; pos?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const playerId = typeof body.playerId === 'string' && PLAYER_ID.test(body.playerId) ? body.playerId : null;
  if (!playerId) return json({ error: 'bad playerId' }, 400);
  const name = cleanText(body.name, 16);
  if (!name) return json({ error: '名字要 1–16 個字' }, 400);
  const characterNames = Object.values(PERSONAS).flatMap((p) => [p.id, p.displayName.toLowerCase()]);
  if (characterNames.includes(name.toLowerCase())) return json({ error: '這個名字是島上角色的名字' }, 400);
  const text = cleanText(body.text, 140);
  if (!text) return json({ error: '訊息要 1–140 個字' }, 400);
  let to: string | null = null;
  if (typeof body.to === 'string' && body.to !== 'all' && body.to !== '') {
    if (PERSONAS[body.to] || PLAYER_ID.test(body.to)) to = body.to;
    else return json({ error: 'bad target' }, 400);
  }
  if (to === playerId) return json({ error: 'bad target' }, 400);
  const p = body.pos;
  const ok =
    Array.isArray(p) &&
    p.length === 3 &&
    p.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    Math.abs(p[0]) <= 100 &&
    p[1] >= -10 &&
    p[1] <= 80 &&
    Math.abs(p[2]) <= 150;
  if (!ok) return json({ error: 'bad position' }, 400);
  const pos = (p as number[]).map((v) => Math.floor(v));
  if (!cfg.dbSecret) return json({ error: 'chat not configured' }, 503);

  try {
    const r = await rpc<{ ok: boolean; error?: string; id?: number }>(deps, cfg, 'agent_player_say', {
      p_secret: cfg.dbSecret,
      p_player: playerId,
      p_name: name,
      p_text: text,
      p_to: to,
      p_pos: pos,
    });
    if (!r.ok) return json({ error: '說太快了，等一下再說' }, 429, { 'Retry-After': '2' });
    return json({ ok: true, id: r.id });
  } catch {
    return json({ error: 'chat unavailable' }, 503);
  }
}
