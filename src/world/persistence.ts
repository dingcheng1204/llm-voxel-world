// Saving block edits.
//  1. localStorage — instant, works offline, survives reloads on this browser.
//  2. Supabase (optional) — one shared island for every visitor and, later, the AI agents.
//     Reads/writes go through the `world-edits` edge function (supabase/functions/world-edits).
// Conflicts: last write wins per block, by timestamp.

export interface EditSink {
  applyEdit(x: number, y: number, z: number, id: number): void;
}

export interface CloudConfig {
  url: string; // https://<ref>.supabase.co
  anonKey: string; // public (publishable/anon) key — safe to ship in the browser
}

/** [x, y, z, id, tMs] */
type Saved = [number, number, number, number, number];

interface Pending {
  x: number;
  y: number;
  z: number;
  id: number;
  by: string;
}

export interface SaveStatus {
  saved: number;
  pending: number;
  cloud: 'off' | 'connecting' | 'ok' | 'offline';
  lastSync: number | null;
}

const PUSH_INTERVAL = 2000;
const PULL_INTERVAL = 10000;
const MAX_BATCH = 500;
const SINCE_OVERLAP_MS = 5000;

export class WorldSave {
  private readonly blocks = new Map<string, Saved>();
  private pending: Pending[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pushing = false;
  private since: string | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  readonly status: SaveStatus = { saved: 0, pending: 0, cloud: 'off', lastSync: null };

  constructor(
    private readonly seed: number,
    private readonly sink: EditSink,
    private readonly cloud: CloudConfig | null,
    private readonly storage: Storage | null = globalThis.localStorage ?? null,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  private get localKey(): string {
    return `voxel:world:${this.seed}`;
  }

  private get pendingKey(): string {
    return `voxel:pending:${this.seed}`;
  }

  /** Load the local save, apply it to the world, then start cloud sync (if configured). */
  start(): void {
    try {
      const raw = this.storage?.getItem(this.localKey);
      if (raw) {
        const data = JSON.parse(raw) as { v: number; edits: Saved[] };
        for (const e of data.edits ?? []) this.remember(e, true);
      }
      const p = this.storage?.getItem(this.pendingKey);
      if (p) this.pending = JSON.parse(p) as Pending[];
    } catch (err) {
      console.warn('could not read local save', err);
    }
    this.updateStatus();
    if (this.cloud) {
      this.status.cloud = 'connecting';
      void this.pull();
      this.timers.push(setInterval(() => void this.push(), PUSH_INTERVAL));
      this.timers.push(setInterval(() => void this.pull(), PULL_INTERVAL));
    }
    globalThis.addEventListener?.('pagehide', () => this.flushLocal());
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.flushLocal();
  }

  /** Record a local edit (from World.onEdit). */
  record(e: { x: number; y: number; z: number; id: number; by: string; t: number }): void {
    this.remember([e.x, e.y, e.z, e.id, e.t], false);
    if (this.cloud) this.pending.push({ x: e.x, y: e.y, z: e.z, id: e.id, by: e.by });
    this.updateStatus();
    this.scheduleLocalSave();
  }

  /** Forget the local save for this seed (does not touch the cloud). */
  clearLocal(): void {
    this.blocks.clear();
    this.pending = [];
    this.storage?.removeItem(this.localKey);
    this.storage?.removeItem(this.pendingKey);
    this.updateStatus();
  }

  /** Keep the newest edit per block; optionally apply it to the world. */
  private remember(e: Saved, apply: boolean): boolean {
    const key = `${e[0]},${e[1]},${e[2]}`;
    const prev = this.blocks.get(key);
    if (prev && prev[4] >= e[4]) return false;
    this.blocks.set(key, e);
    if (apply) this.sink.applyEdit(e[0], e[1], e[2], e[3]);
    return true;
  }

  private scheduleLocalSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flushLocal(), 800);
  }

  flushLocal(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      this.storage?.setItem(this.localKey, JSON.stringify({ v: 1, edits: [...this.blocks.values()] }));
      this.storage?.setItem(this.pendingKey, JSON.stringify(this.pending));
    } catch (err) {
      console.warn('could not write local save', err);
    }
  }

  private headers(): Record<string, string> {
    const k = this.cloud!.anonKey;
    return { Authorization: `Bearer ${k}`, apikey: k, 'Content-Type': 'application/json' };
  }

  private endpoint(): string {
    return `${this.cloud!.url}/functions/v1/world-edits`;
  }

  /** Fetch edits made by others since the last pull and apply the newer ones. */
  async pull(): Promise<void> {
    if (!this.cloud) return;
    try {
      const q = new URLSearchParams({ seed: String(this.seed) });
      if (this.since) q.set('since', this.since);
      const res = await this.fetchFn(`${this.endpoint()}?${q}`, { headers: this.headers() });
      if (!res.ok) throw new Error(`pull ${res.status}`);
      const data = (await res.json()) as { edits: Saved[]; now: string };
      let changed = false;
      for (const e of data.edits) changed = this.remember(e, true) || changed;
      // Overlap the next pull by a few seconds: an upload that was in flight while this pull ran can
      // carry a timestamp slightly before `now`. Duplicates are harmless (newest-wins by timestamp).
      this.since = new Date(Date.parse(data.now) - SINCE_OVERLAP_MS).toISOString();
      this.status.cloud = 'ok';
      this.status.lastSync = Date.now();
      if (changed) this.scheduleLocalSave();
    } catch {
      this.status.cloud = 'offline';
    }
    this.updateStatus();
  }

  /** Send queued local edits in batches; keeps them queued (and saved) if offline. */
  async push(): Promise<void> {
    if (!this.cloud || this.pushing || this.pending.length === 0) return;
    this.pushing = true;
    const batch = this.pending.slice(0, MAX_BATCH);
    try {
      const res = await this.fetchFn(this.endpoint(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ seed: this.seed, edits: batch }),
      });
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        // Rejected as invalid: drop it instead of retrying forever.
        console.warn('cloud rejected edits', res.status);
        this.pending.splice(0, batch.length);
        return;
      }
      if (!res.ok) throw new Error(`push ${res.status}`);
      this.pending.splice(0, batch.length);
      this.status.cloud = 'ok';
      this.status.lastSync = Date.now();
      this.scheduleLocalSave();
    } catch {
      this.status.cloud = 'offline';
    } finally {
      this.pushing = false;
      this.updateStatus();
    }
  }

  private updateStatus(): void {
    this.status.saved = this.blocks.size;
    this.status.pending = this.pending.length;
  }
}
