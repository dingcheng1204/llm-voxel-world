// Fixed-timestep game loop: simulation runs at a constant rate (deterministic physics),
// rendering runs at display rate and receives an interpolation factor.

export interface LoopHandlers {
  /** Fixed step, dt in seconds (1 / tickRate). */
  update(dt: number): void;
  /** Once per displayed frame. alpha ∈ [0,1) = progress towards the next tick; frameDt = real seconds. */
  render(alpha: number, frameDt: number): void;
}

export class GameLoop {
  private acc = 0;
  private last = 0;
  private running = false;
  private readonly step: number;
  /** Ticks dropped because the tab stalled (spiral-of-death guard). */
  droppedTicks = 0;

  constructor(
    private readonly h: LoopHandlers,
    tickRate = 60,
    private readonly maxTicksPerFrame = 5,
    private readonly schedule: (cb: ((t: number) => void) | null) => void = (cb) => {
      if (cb) requestAnimationFrame(cb);
    },
  ) {
    this.step = 1 / tickRate;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.schedule(this.frame);
  }

  stop(): void {
    this.running = false;
  }

  /** Exposed for tests: advance by a given timestamp. */
  readonly frame = (now: number): void => {
    if (!this.running) return;
    const frameDt = Math.min((now - this.last) / 1000, 0.25); // clamp after tab-switch
    this.last = now;
    this.acc += frameDt;
    let ticks = 0;
    while (this.acc >= this.step && ticks < this.maxTicksPerFrame) {
      this.h.update(this.step);
      this.acc -= this.step;
      ticks++;
    }
    if (this.acc >= this.step) {
      this.droppedTicks += Math.floor(this.acc / this.step);
      this.acc %= this.step;
    }
    this.h.render(this.acc / this.step, frameDt);
    this.schedule(this.frame);
  };
}
