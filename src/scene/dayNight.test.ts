import { describe, expect, it } from 'vitest';
import { DAY_SECONDS, WorldClock } from './dayNight';

describe('WorldClock', () => {
  it('a game day lasts 20 real minutes', () => {
    let now = 0;
    const c = new WorldClock(null, DAY_SECONDS, () => now);
    const t0 = c.t;
    now = (DAY_SECONDS / 2) * 1000;
    expect((c.t - t0 + 1) % 1).toBeCloseTo(0.5);
    now = DAY_SECONDS * 1000;
    expect(c.t).toBeCloseTo(t0);
    expect(c.day).toBe(new WorldClock(null, DAY_SECONDS, () => 0).day + 1);
  });

  it('can be frozen for screenshots', () => {
    const c = new WorldClock(0.5);
    expect(c.t).toBe(0.5);
    expect(c.clock).toBe('12:00');
    expect(new WorldClock(0.75).clock).toBe('18:00');
  });
});
