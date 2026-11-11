import { describe, expect, it } from 'vitest';
import { stickVector } from './touch';
import { Input } from './input';

describe('stickVector', () => {
  it('maps the thumb offset to forward/right with a dead zone', () => {
    expect(stickVector(0, 0)).toEqual({ fwd: 0, side: 0 });
    expect(stickVector(3, -3)).toEqual({ fwd: 0, side: 0 }); // inside the dead zone
    const up = stickVector(0, -52);
    expect(up.fwd).toBeCloseTo(1);
    expect(up.side).toBeCloseTo(0);
    const right = stickVector(80, 0); // beyond the rim is still full speed
    expect(right.side).toBeCloseTo(1);
    const half = stickVector(0, 30);
    expect(half.fwd).toBeLessThan(0);
    expect(half.fwd).toBeGreaterThan(-0.6);
  });

  it('keeps the direction on diagonals', () => {
    const v = stickVector(40, -40);
    expect(v.fwd).toBeCloseTo(v.side);
    expect(Math.hypot(v.fwd, v.side)).toBeCloseTo(1);
  });
});

describe('Input in touch mode', () => {
  const fakeCanvas = () =>
    ({ addEventListener: () => {}, requestPointerLock: () => undefined }) as unknown as HTMLCanvasElement;
  const withWindow = () => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.window ??= { addEventListener: () => {} };
    g.document ??= { addEventListener: () => {} };
  };

  it('plays without pointer lock and feeds holds, buttons and look from the touch controls', () => {
    withWindow();
    const input = new Input(fakeCanvas());
    input.touchMode = true;
    const changes: boolean[] = [];
    input.onLockChange = (l) => changes.push(l);
    // Nothing is accepted before playing.
    input.hold('Space', true);
    expect(input.keys.has('Space')).toBe(false);
    input.requestLock();
    expect(input.locked).toBe(true);
    input.hold('Space', true);
    input.holdButton(0, true);
    input.addLook(10, -4);
    expect(input.keys.has('Space')).toBe(true);
    expect(input.buttons.has(0)).toBe(true);
    expect(input.takePresses()).toEqual(['Space', 'Mouse0']);
    expect(input.takeLook()).toEqual([10, -4]);
    input.move.fwd = 1;
    input.release();
    expect(input.locked).toBe(false);
    expect(input.keys.size + input.buttons.size).toBe(0);
    expect(input.move).toEqual({ fwd: 0, side: 0 });
    expect(changes).toEqual([true, false]);
  });
});
