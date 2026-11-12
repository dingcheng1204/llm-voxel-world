// When to save: manually (K or the 💾 button), automatically every minute, when the tab is hidden or
// closed, and right after respawning. Always to localStorage; also to the account when signed in
// (automatic cloud saves at most every 20 s).

import type { Account } from './account';
import { loadLocal, saveLocal, type PlayerSaveData } from './playerSave';

export type SaveReason = 'manual' | 'auto' | 'leave' | 'respawn' | 'login';

const AUTO_EVERY_MS = 60_000;
const CLOUD_AUTO_MIN_MS = 20_000;

export interface SaveStatus {
  /** Epoch ms of the last successful save (local or cloud). */
  at: number | null;
  where: 'local' | 'cloud' | null;
  error: string | null;
  saving: boolean;
}

export class SaveManager {
  readonly status: SaveStatus = { at: null, where: null, error: null, saving: false };
  onStatus: (s: SaveStatus, reason: SaveReason | null) => void = () => {};
  private lastCloud = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly seed: number,
    readonly account: Account | null,
    /** Current state to save, or null if there is nothing to save yet (not joined, dead). */
    private readonly collect: () => PlayerSaveData | null,
  ) {}

  private get who(): string {
    return this.account?.userId ?? 'guest';
  }

  /** The best save to resume from: the account's cloud save (newest wins against its local copy). */
  async loadBest(): Promise<PlayerSaveData | null> {
    const local = loadLocal(this.seed, this.who);
    if (!this.account?.userId) return local;
    const cloud = await this.account.load(this.seed);
    if (!cloud) return local;
    return local && local.savedAt > cloud.savedAt ? local : cloud;
  }

  loadGuest(): PlayerSaveData | null {
    return loadLocal(this.seed, 'guest');
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.save('auto'), AUTO_EVERY_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.save('leave');
    });
    window.addEventListener('pagehide', () => void this.save('leave'));
  }

  async save(reason: SaveReason): Promise<boolean> {
    const data = this.collect();
    if (!data) return false;
    data.savedAt = Date.now();
    const okLocal = saveLocal(this.seed, this.who, data);
    let where: SaveStatus['where'] = okLocal ? 'local' : null;
    this.status.error = okLocal ? null : '瀏覽器不能存檔（無痕模式？）';
    const cloudDue =
      reason === 'manual' ||
      reason === 'login' ||
      reason === 'respawn' ||
      Date.now() - this.lastCloud >= CLOUD_AUTO_MIN_MS;
    if (this.account?.userId && cloudDue) {
      this.status.saving = true;
      if (reason === 'manual') this.onStatus(this.status, null);
      try {
        await this.account.save(this.seed, data);
        this.lastCloud = Date.now();
        where = 'cloud';
        this.status.error = null;
      } catch {
        this.status.error = '雲端存檔失敗，先存在這台電腦';
      } finally {
        this.status.saving = false;
      }
    }
    if (where) {
      this.status.at = data.savedAt;
      this.status.where = where;
    }
    this.onStatus(this.status, reason);
    return where !== null;
  }
}
