import { describe, expect, it } from 'vitest';
import { afterDefense, COMBAT, fallDamage, pickTarget, Vitals } from './combat';
import { START_HEARTS, START_STAMINA } from './equipment';

const me = { x: 0, z: 0 };
// yaw 0 faces −Z.
const front = { x: 0, z: -2 };
const behind = { x: 0, z: 2 };

function fresh(): Vitals {
  const v = new Vitals();
  v.invuln = 0;
  return v;
}

describe('Vitals', () => {
  it('starts with 3 hearts and a small stamina bar', () => {
    const v = new Vitals();
    expect(v.maxHp).toBe(START_HEARTS * 2);
    expect(v.hp).toBe(6);
    expect(v.stamina).toBe(START_STAMINA);
  });

  it('defense reduces hits (never below 1), not environment damage', () => {
    const v = fresh();
    expect(v.damage(4, { from: front }, me, 0, 1).dealt).toBe(3);
    v.tick(1);
    expect(v.damage(1, { from: front }, me, 0, 5).dealt).toBe(1);
    v.tick(1);
    expect(v.damage(2, { from: null, environment: true }, me, 0, 5).dealt).toBe(2);
  });

  it('is briefly invulnerable after a hit', () => {
    const v = fresh();
    v.damage(2, { from: front }, me, 0);
    expect(v.damage(2, { from: front }, me, 0).dealt).toBe(0);
    v.tick(COMBAT.hurtInvuln + 0.01);
    expect(v.damage(2, { from: front }, me, 0).dealt).toBe(2);
  });

  it('guard blocks most damage from the front only, and costs stamina', () => {
    const v = fresh();
    v.guarding = true;
    const r = v.damage(8, { from: front }, me, 0, 0);
    expect(r.blocked).toBe(true);
    expect(r.dealt).toBe(2);
    expect(v.stamina).toBe(START_STAMINA - COMBAT.guardStaminaPerHit);
    v.tick(1);
    expect(v.damage(3, { from: behind }, me, 0).blocked).toBe(false);
  });

  it('guard + defense can block a weak hit completely', () => {
    const v = fresh();
    v.guarding = true;
    expect(v.damage(2, { from: front }, me, 0, 1).dealt).toBe(0);
  });

  it('a guard with no stamina breaks', () => {
    const v = fresh();
    v.guarding = true;
    v.stamina = 5;
    expect(v.damage(4, { from: front }, me, 0).dealt).toBe(4);
    expect(v.guarding).toBe(false);
  });

  it('dodging avoids everything, even lava', () => {
    const v = fresh();
    v.dodgeInvuln = 0.2;
    expect(v.damage(5, { from: null, environment: true }, me, 0).dodged).toBe(true);
    expect(v.hp).toBe(v.maxHp);
  });

  it('dies at 0, stays dead, and respawns with full (raised) limits', () => {
    const v = fresh();
    v.maxHp = 10;
    expect(v.damage(99, { from: null, environment: true }, me, 0).died).toBe(true);
    v.tick(60);
    expect(v.hp).toBe(0);
    v.reset();
    expect(v.hp).toBe(10);
    expect(v.invuln).toBe(COMBAT.spawnInvuln);
  });

  it('regenerates after a quiet while', () => {
    const v = fresh();
    v.damage(3, { from: null, environment: true }, me, 0);
    v.tick(COMBAT.regenDelay - 1);
    expect(v.hp).toBe(3);
    for (let i = 0; i < 60; i++) v.tick(0.1);
    expect(v.hp).toBeGreaterThan(3);
  });
});

describe('rules', () => {
  it('fall damage starts after a few blocks', () => {
    expect(fallDamage(3)).toBe(0);
    expect(fallDamage(6)).toBe(3);
  });

  it('defense never brings a hit below 1', () => {
    expect(afterDefense(4, 1)).toBe(3);
    expect(afterDefense(1, 3)).toBe(1);
  });

  it('a swing hits the closest target in front, within reach', () => {
    const p = { x: 0, y: 0, z: 0 };
    const a = { x: 0, y: 0, z: -2.5, id: 'a' };
    const b = { x: 0, y: 0, z: -1.5, id: 'b' };
    const back = { x: 0, y: 0, z: 1.5, id: 'back' };
    const far = { x: 0, y: 0, z: -5, id: 'far' };
    expect(pickTarget(p, 0, [a, b, back, far], 3)?.id).toBe('b');
    expect(pickTarget(p, 0, [back, far], 3)).toBeNull();
    expect(pickTarget(p, 0, [a], 2)).toBeNull();
  });
});
