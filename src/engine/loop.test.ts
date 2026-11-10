import { describe, expect, it } from 'vitest';
import { GameLoop } from './loop';
import { frameStats } from './debugOverlay';

describe('GameLoop', () => {
  it('runs a fixed number of ticks regardless of frame rate', () => {
    let ticks = 0;
    let lastAlpha = -1;
    const frames: ((t: number) => void)[] = [];
    const loop = new GameLoop({ update: () => ticks++, render: (a) => (lastAlpha = a) }, 60, 5, (cb) => {
      if (cb) frames.push(cb);
    });
    const t0 = performance.now();
    loop.start();
    // 30 FPS for 1 second → 60 ticks
    for (let i = 1; i <= 30; i++) loop.frame(t0 + (i * 1000) / 30);
    expect(ticks).toBeGreaterThanOrEqual(59);
    expect(ticks).toBeLessThanOrEqual(61);
    expect(lastAlpha).toBeGreaterThanOrEqual(0);
    expect(lastAlpha).toBeLessThan(1);
  });

  it('caps catch-up ticks after a long stall', () => {
    let ticks = 0;
    const loop = new GameLoop({ update: () => ticks++, render: () => {} }, 60, 5, () => {});
    const t0 = performance.now();
    loop.start();
    loop.frame(t0 + 5000);
    expect(ticks).toBe(5);
    expect(loop.droppedTicks).toBeGreaterThan(0);
  });
});

describe('frameStats', () => {
  it('reports average fps and 1% low', () => {
    const ms = new Array(100).fill(10);
    ms[0] = 50;
    const s = frameStats(ms);
    expect(Math.round(s.low1)).toBe(20);
    expect(s.maxMs).toBe(50);
  });
});
