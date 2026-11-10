import { describe, expect, it } from 'vitest';
import { PLAYER, blockIntersectsBody, createBody, stepBody } from './physics';

/** Flat floor whose top surface is at y = 10, plus optional extra blocks. */
const world = (extra: [number, number, number][] = []) => {
  const set = new Set(extra.map((c) => c.join(',')));
  return (x: number, y: number, z: number) => y < 10 || set.has(`${x},${y},${z}`);
};
const dt = 1 / 60;

function run(b: ReturnType<typeof createBody>, solid: ReturnType<typeof world>, ticks: number, each?: () => void) {
  for (let i = 0; i < ticks; i++) {
    each?.();
    b.vy = Math.max(b.vy - PLAYER.gravity * dt, -PLAYER.maxFall);
    stepBody(b, dt, solid);
  }
}

describe('stepBody', () => {
  it('falls and lands on the floor', () => {
    const b = createBody(0.5, 20, 0.5);
    run(b, world(), 120);
    expect(b.y).toBeCloseTo(10, 2);
    expect(b.onGround).toBe(true);
  });

  it('does not tunnel through a floor at high speed', () => {
    const b = createBody(0.5, 60, 0.5);
    b.vy = -50;
    run(b, world(), 200);
    expect(b.y).toBeCloseTo(10, 2);
  });

  it('is stopped by a wall', () => {
    const wall: [number, number, number][] = [];
    for (let z = -2; z <= 2; z++) for (let y = 10; y <= 12; y++) wall.push([3, y, z]);
    const b = createBody(0.5, 10, 0.5);
    run(b, world(wall), 120, () => (b.vx = PLAYER.walk));
    expect(b.x).toBeLessThanOrEqual(3 - PLAYER.halfWidth + 1e-3);
    expect(b.x).toBeGreaterThan(2.5);
  });

  it('jumps high enough to climb one block but not two', () => {
    const b = createBody(0.5, 10, 0.5);
    run(b, world(), 5);
    b.vy = PLAYER.jump;
    let peak = b.y;
    run(b, world(), 60, () => (peak = Math.max(peak, b.y)));
    expect(peak - 10).toBeGreaterThan(1.2);
    expect(peak - 10).toBeLessThan(2);
  });

  it('bumps its head on a ceiling', () => {
    const b = createBody(0.5, 10, 0.5);
    b.vy = PLAYER.jump;
    run(b, world([[0, 12, 0]]), 30);
    expect(b.y + b.height).toBeLessThanOrEqual(12 + 1e-3);
  });
});

describe('blockIntersectsBody', () => {
  it('forbids placing a block where the player stands', () => {
    const b = createBody(0.5, 10, 0.5);
    expect(blockIntersectsBody(0, 10, 0, b)).toBe(true);
    expect(blockIntersectsBody(0, 11, 0, b)).toBe(true);
    expect(blockIntersectsBody(0, 12, 0, b)).toBe(false);
    expect(blockIntersectsBody(1, 10, 0, b)).toBe(false);
  });
});
