// Live connection to everyone else on the island (Supabase Realtime, one channel per world seed):
//   - presence: who is online (id, name, animal)
//   - broadcast "pos": player positions, ~5 per second while moving (+ a keep-alive every 2 s)
//   - postgres_changes on `messages`: every new chat line (characters and players)
// Players talk through POST /api/chat/say (validated + rate-limited server-side); nothing here writes the DB.

import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config/supabase';
import type { PlayerSpecies } from '../agents/species';
import type { Identity } from './identity';

export interface OnlinePlayer {
  id: string;
  name: string;
  species: PlayerSpecies;
  /** Last reported feet position + heading, if any yet. */
  pos: { x: number; y: number; z: number; heading: number } | null;
  /** performance.now() of the last position. */
  seenAt: number;
}

export interface LiveMessage {
  id: number;
  speaker: string;
  speaker_name: string | null;
  speaker_kind: 'agent' | 'player';
  text: string;
  to_id: string | null;
  pos: number[] | null;
  created_at: string;
}

type Status = 'connecting' | 'online' | 'offline';

const POS_INTERVAL_MS = 200;
const KEEPALIVE_MS = 2000;

export class Island {
  /** Other players currently online (not including me). */
  readonly players = new Map<string, OnlinePlayer>();
  status: Status = 'connecting';
  onRoster: () => void = () => {};
  onMessage: (m: LiveMessage) => void = () => {};
  onStatus: (s: Status) => void = () => {};

  private channel: RealtimeChannel | null = null;
  private lastSent = 0;
  private lastPos = '';

  constructor(
    private me: Identity,
    private readonly seed: number,
  ) {}

  get identity(): Identity {
    return this.me;
  }

  start(): void {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    const ch = sb.channel(`island-${this.seed}`, {
      config: { presence: { key: this.me.id }, broadcast: { self: false } },
    });
    ch.on('presence', { event: 'sync' }, () => this.syncRoster(ch))
      .on('broadcast', { event: 'pos' }, ({ payload }) => this.onPos(payload as Record<string, unknown>))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) =>
        this.onMessage(p.new as LiveMessage),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.setStatus('online');
          void ch.track({ id: this.me.id, name: this.me.name, species: this.me.species });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.setStatus('offline');
        }
      });
    this.channel = ch;
  }

  /** Name or animal changed. */
  setIdentity(me: Identity): void {
    this.me = me;
    if (this.status === 'online') void this.channel?.track({ id: me.id, name: me.name, species: me.species });
  }

  /** Call every frame with the local player's feet position; throttled. */
  sendPosition(x: number, y: number, z: number, heading: number, now = performance.now()): void {
    if (this.status !== 'online' || !this.channel) return;
    const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},${heading.toFixed(2)}`;
    const due = now - this.lastSent >= (key === this.lastPos ? KEEPALIVE_MS : POS_INTERVAL_MS);
    if (!due) return;
    this.lastSent = now;
    this.lastPos = key;
    void this.channel.send({
      type: 'broadcast',
      event: 'pos',
      payload: {
        id: this.me.id,
        x: +x.toFixed(2),
        y: +y.toFixed(2),
        z: +z.toFixed(2),
        h: +heading.toFixed(2),
      },
    });
  }

  /** Say something in the chat window. `to` = null for everyone, or a character / player id. */
  async say(
    text: string,
    to: string | null,
    pos: [number, number, number],
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('/api/chat/say', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: this.me.id, name: this.me.name, text, to: to ?? 'all', pos }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return res.ok ? { ok: true } : { ok: false, error: data.error ?? `發送失敗（${res.status}）` };
    } catch {
      return { ok: false, error: '連不上伺服器，訊息沒有送出' };
    }
  }

  /** The last few chat lines (for the chat window when it opens). */
  async recentMessages(limit = 40): Promise<LiveMessage[]> {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/messages?select=id,speaker,speaker_name,speaker_kind,text,to_id,pos,created_at&order=created_at.desc&limit=${limit}`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    if (!res.ok) throw new Error(`messages ${res.status}`);
    return ((await res.json()) as LiveMessage[]).reverse();
  }

  private setStatus(s: Status): void {
    this.status = s;
    this.onStatus(s);
  }

  private syncRoster(ch: RealtimeChannel): void {
    const state = ch.presenceState<{ id: string; name: string; species: PlayerSpecies }>();
    const seen = new Set<string>();
    for (const [key, metas] of Object.entries(state)) {
      const meta = metas[0];
      if (!meta || key === this.me.id) continue;
      seen.add(key);
      const prev = this.players.get(key);
      this.players.set(key, {
        id: key,
        name: String(meta.name ?? '').slice(0, 16) || '旅人',
        species: meta.species,
        pos: prev?.pos ?? null,
        seenAt: prev?.seenAt ?? performance.now(),
      });
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
    this.onRoster();
  }

  private onPos(p: Record<string, unknown>): void {
    const id = String(p.id ?? '');
    const pl = this.players.get(id);
    if (!pl) return;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const x = n(p.x);
    const y = n(p.y);
    const z = n(p.z);
    if (x === null || y === null || z === null) return;
    pl.pos = { x, y, z, heading: n(p.h) ?? 0 };
    pl.seenAt = performance.now();
  }
}
