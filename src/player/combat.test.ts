import { describe, expect, it } from 'vitest';
import { COMBAT, fallDamage, pickTarget, Vitals } from './combat';

const me = { x: 0, z: 0 };
// yaw 0 faces −Z.
const front = { x: 0, z: -2 };
const behind = { x: 0, z: 2 };

describe('Vitals', () => {
  it('takes damage, then is briefly invulnerable', () => {
    const v = new Vitals();
    v.invuln = 0;
    expect(v.damage(4, { from: front }, me, 0).dealt).toBe(4);
    expect(v.hp).toBe(COMBAT.maxHp - 4);
    expect(v.damage(4, { from: front }, me, 0).dealt).toBe(0);
    v.tick(COMBAT.hurtInvuln + 0.01);
    expect(v.damage(4, { from: front }, me, 0).dealt).toBe(4);
  });

  it('guard blocks most damage from the front only, and costs stamina', () => {
    const v = new Vitals();
    v.invuln = 0;
    v.guarding = true;
    const r = v.damage(8, { from: front }, me, 0);
    expect(r.blocked).toBe(true);
    expect(r.dealt).toBe(2);
    expect(v.stamina).toBe(COMBAT.maxStamina - COMBAT.guardStaminaPerHit);
    v.tick(1);
    expect(v.damage(8, { from: behind }, me, 0).blocked).toBe(false);
  });

  it('a guard with no stamina breaks', () => {
    const v = new Vitals();
    v.invuln = 0;
    v.guarding = true;
    v.stamina = 5;
    expect(v.damage(8, { from: front }, me, 0).dealt).toBe(8);
    expect(v.guarding).toBe(false);
  });

  it('dodging avoids everything, even lava', () => {
    const v = new Vitals();
    v.invuln = 0;
    v.dodgeInvuln = 0.2;
    expect(v.damage(5, { from: null, environment: true }, me, 0).dodged).toBe(true);
    expect(v.hp).toBe(COMBAT.maxHp);
  });

  it('dies at 0 and stays dead', () => {
    const v = new Vitals();
    v.invuln = 0;
    expect(v.damage(99, { from: null, environment: true }, me, 0).died).toBe(true);
    expect(v.dead).toBe(true);
    v.tick(60);
    expect(v.hp).toBe(0);
    v.reset();
    expect(v.hp).toBe(COMBAT.maxHp);
    expect(v.invuln).toBe(COMBAT.spawnInvuln);
  });

  it('regenerates after a quiet while', () => {
    const v = new Vitals();
    v.invuln = 0;
    v.damage(5, { from: null, environment: true }, me, 0);
    v.tick(COMBAT.regenDelay - 1);
    expect(v.hp).toBe(15);
    for (let i = 0; i < 60; i++) v.tick(0.1);
    expect(v.hp).toBeGreaterThan(15);
  });
});

describe('rules', () => {
  it('fall damage starts after a few blocks', () => {
    expect(fallDamage(3)).toBe(0);
    expect(fallDamage(6)).toBe(3);
  });

  it('a swing hits the closest target in front, within reach', () => {
    const p = { x: 0, y: 0, z: 0 };
    const a = { x: 0, y: 0, z: -2.5, id: 'a' };
    const b = { x: 0, y: 0, z: -1.5, id: 'b' };
    const back = { x: 0, y: 0, z: 1.5, id: 'back' };
    const far = { x: 0, y: 0, z: -5, id: 'far' };
    expect(pickTarget(p, 0, [a, b, back, far])?.id).toBe('b');
    expect(pickTarget(p, 0, [back, far])).toBeNull();
  });
});
