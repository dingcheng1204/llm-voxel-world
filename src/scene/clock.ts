// Shared world clock: the in-game time of day is derived from real time, so every browser and the
// server simulation agree on it without syncing. No rendering imports (used server-side too).

/** Real seconds per in-game day (ROADMAP: 1 game day = 20 minutes). */
export const DAY_SECONDS = 20 * 60;

export class WorldClock {
  /** Fixed time of day for screenshots/tests (?time=0.8), otherwise null. */
  constructor(
    private readonly fixed: number | null = null,
    private readonly daySeconds = DAY_SECONDS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private get total(): number {
    if (this.fixed !== null) return this.fixed;
    return this.now() / 1000 / this.daySeconds + 0.35; // offset: pick a pleasant phase for epoch 0
  }

  /** Time of day in [0, 1). */
  get t(): number {
    const v = this.total;
    return v - Math.floor(v);
  }

  /** Whole in-game days since the epoch (used for diaries later). */
  get day(): number {
    return Math.floor(this.total);
  }

  /** "HH:MM" in-game. */
  get clock(): string {
    const minutes = Math.floor(this.t * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
}
