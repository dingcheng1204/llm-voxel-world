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
  /** Combat state from their position updates. */
  combat: RemoteCombat;
}

export interface RemoteCombat {
  hp: number;
  maxHp: number;
  mode: 'build' | 'combat';
  guard: boolean;
  /** Swing counter (a change = they just swung). */
  swings: number;
  dead: boolean;
  /** Equipped weapon / armor ids (validated against the gear list before drawing). */
  weapon: string | null;
  armor: string | null;
}

/** What the local player broadcasts with each position. */
export interface MyCombat {
  hp: number;
  maxHp: number;
  mode: 'build' | 'combat';
  guard: boolean;
  swings: number;
  dead: boolean;
  weapon: string | null;
  armor: string | null;
}

/** A PvP hit someone landed on me (validated by main before it hurts). */
export interface HitEvent {
  from: string;
  dmg: number;
  kind: 'melee' | 'magic';
}

/** A magic bolt someone fired (drawn locally; its hit arrives as a HitEvent). */
export interface ShotEvent {
  from: string;
  origin: [number, number, number];
  dir: [number, number, number];
  range: number;
}

const freshCombat = (): RemoteCombat => ({
  hp: 6,
  maxHp: 6,
  mode: 'build',
  guard: false,
  swings: 0,
  dead: false,
  weapon: null,
  armor: null,
});
const gearId = (v: unknown): string | null => (typeof v === 'string' && /^[a-z_]{1,24}$/.test(v) ? v : null);

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
  /** Someone hit me (PvP). */
  onHit: (e: HitEvent) => void = () => {};
  /** Someone fired a magic bolt. */
  onShot: (e: ShotEvent) => void = () => {};
  /** Someone was knocked out: `victim` by `by` (either may be me). */
  onKo: (victim: string, by: string) => void = () => {};

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
      .on('broadcast', { event: 'hit' }, ({ payload }) => this.onHitMsg(payload as Record<string, unknown>))
      .on('broadcast', { event: 'shot' }, ({ payload }) => this.onShotMsg(payload as Record<string, unknown>))
      .on('broadcast', { event: 'ko' }, ({ payload }) => {
        const p = payload as Record<string, unknown>;
        if (typeof p.victim === 'string' && typeof p.by === 'string') this.onKo(p.victim, p.by);
      })
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
  sendPosition(x: number, y: number, z: number, heading: number, c: MyCombat, now = performance.now()): void {
    if (this.status !== 'online' || !this.channel) return;
    const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},${heading.toFixed(2)},${c.hp},${c.maxHp},${c.mode},${c.guard},${c.swings},${c.dead},${c.weapon},${c.armor}`;
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
        hp: Math.round(c.hp),
        mh: Math.round(c.maxHp),
        m: c.mode === 'combat' ? 'c' : 'b',
        g: c.guard ? 1 : 0,
        s: c.swings,
        d: c.dead ? 1 : 0,
        w: c.weapon ?? '',
        a: c.armor ?? '',
      },
    });
  }

  /** Tell `to` that I hit them for `dmg` (they decide whether it counts). */
  sendHit(to: string, dmg: number, kind: 'melee' | 'magic'): void {
    if (this.status !== 'online' || !this.channel) return;
    void this.channel.send({ type: 'broadcast', event: 'hit', payload: { from: this.me.id, to, dmg, kind } });
  }

  /** I fired a magic bolt (everyone nearby draws it). */
  sendShot(origin: [number, number, number], dir: [number, number, number], range: number): void {
    if (this.status !== 'online' || !this.channel) return;
    const r = (v: number) => +v.toFixed(2);
    void this.channel.send({
      type: 'broadcast',
      event: 'shot',
      payload: { from: this.me.id, o: origin.map(r), d: dir.map(r), r: range },
    });
  }

  /** I was knocked out by `by` (everyone shows it). */
  sendKo(by: string): void {
    if (this.status !== 'online' || !this.channel) return;
    void this.channel.send({ type: 'broadcast', event: 'ko', payload: { victim: this.me.id, by } });
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
        combat: prev?.combat ?? freshCombat(),
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
    const hp = n(p.hp);
    pl.combat = {
      hp: hp === null ? pl.combat.hp : Math.max(0, Math.min(20, hp)),
      maxHp: Math.max(2, Math.min(20, n(p.mh) ?? pl.combat.maxHp)),
      mode: p.m === 'c' ? 'combat' : 'build',
      guard: p.g === 1,
      swings: n(p.s) ?? pl.combat.swings,
      dead: p.d === 1,
      weapon: gearId(p.w),
      armor: gearId(p.a),
    };
  }

  private onHitMsg(p: Record<string, unknown>): void {
    if (p.to !== this.me.id || typeof p.from !== 'string' || !this.players.has(p.from)) return;
    const dmg = typeof p.dmg === 'number' && Number.isFinite(p.dmg) ? p.dmg : 0;
    this.onHit({ from: p.from, dmg, kind: p.kind === 'magic' ? 'magic' : 'melee' });
  }

  private onShotMsg(p: Record<string, unknown>): void {
    if (typeof p.from !== 'string' || !this.players.has(p.from)) return;
    const vec = (v: unknown) =>
      Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
        ? (v as [number, number, number])
        : null;
    const o = vec(p.o);
    const d = vec(p.d);
    const range = typeof p.r === 'number' && Number.isFinite(p.r) ? Math.min(30, Math.max(1, p.r)) : 0;
    if (!o || !d || !range) return;
    this.onShot({ from: p.from, origin: o, dir: d, range });
  }
}
