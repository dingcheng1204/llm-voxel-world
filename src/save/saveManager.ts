// When to save: manually (K or the 💾 button), automatically every minute, when the tab is hidden or
// closed, and right after respawning — but only for signed-in players. Guests (not signed in) leave
// no record at all: nothing is written, and closing the game forgets them.
// Signed-in saves go to the account (automatic cloud saves at most every 20 s) plus a local copy
// keyed by the account, used when the cloud copy is older or unreachable.

import type { Account } from './account';
import { loadLocal, saveLocal, type PlayerSaveData } from './playerSave';

export type SaveReason = 'manual' | 'auto' | 'leave' | 'respawn' | 'login';

/** Remove what older versions kept for guests (a local save and the remembered name/animal). */
export function forgetGuestData(
  seed: number,
  storage: Pick<Storage, 'removeItem'> | undefined = globalThis.localStorage,
) {
  try {
    storage?.removeItem(`voxel:save:${seed}:guest`);
    storage?.removeItem('voxel:player');
  } catch {
    /* storage unavailable: nothing was kept anyway */
  }
}

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

  /** Signed in (progress is saved) or a guest (nothing is saved). */
  get guest(): boolean {
    return !this.account?.userId;
  }

  /** The best save to resume from: the account's cloud save (newest wins against its local copy). */
  async loadBest(): Promise<PlayerSaveData | null> {
    const who = this.account?.userId;
    if (!who) return null;
    const local = loadLocal(this.seed, who);
    const cloud = await this.account!.load(this.seed);
    if (!cloud) return local;
    return local && local.savedAt > cloud.savedAt ? local : cloud;
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
    const who = this.account?.userId;
    if (!who) return false; // guests leave no record
    const data = this.collect();
    if (!data) return false;
    data.savedAt = Date.now();
    const okLocal = saveLocal(this.seed, who, data);
    let where: SaveStatus['where'] = okLocal ? 'local' : null;
    this.status.error = okLocal ? null : '瀏覽器不能存檔（無痕模式？）';
    const cloudDue =
      reason === 'manual' ||
      reason === 'login' ||
      reason === 'respawn' ||
      Date.now() - this.lastCloud >= CLOUD_AUTO_MIN_MS;
    if (cloudDue) {
      this.status.saving = true;
      if (reason === 'manual') this.onStatus(this.status, null);
      try {
        await this.account!.save(this.seed, data);
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
