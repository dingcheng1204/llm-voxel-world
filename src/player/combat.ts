// Health, stamina and the combat rules (pure — no Three.js, no DOM — so they can be unit tested).
//
// Two modes:
//   build  (一般模式): LMB mine, RMB place, F fly — the original controls.
//   combat (戰鬥模式): LMB attack (melee swing or magic bolt, depending on the weapon), hold RMB
//                      to guard, tap Shift to dodge (holding Shift still sprints). No flying. Other players can only hit you while BOTH of you
//                      are in combat mode, so builders are never griefed.
// Monsters at night hurt you in either mode. Attack / defense / speed come from equipment.ts;
// max hp (hearts × 2) and max stamina are per player.

import { START_HEARTS, START_STAMINA } from './equipment';

export type Mode = 'build' | 'combat';

export const COMBAT = {
  /** Half-angle of the melee hit cone (radians). */
  attackCone: 0.75,
  /** Magic bolt speed (m/s) and hit radius around a target. */
  boltSpeed: 18,
  boltRadius: 0.7,
  /** Guarding a hit from the front: damage kept, stamina cost per blocked hit, front half-angle. */
  guardKeep: 0.25,
  guardStaminaPerHit: 15,
  guardFront: 1.2,
  /** Walking speed multiplier while guarding. */
  guardSlow: 0.45,
  /** Dodge: dash speed (m/s), dash time, invulnerable time, stamina cost, cooldown. */
  dodgeSpeed: 13,
  dodgeTime: 0.18,
  dodgeInvuln: 0.32,
  dodgeStamina: 25,
  dodgeCooldown: 0.6,
  /** After taking a hit: no further damage for this long. */
  hurtInvuln: 0.5,
  /** Invulnerable after (re)spawning. */
  spawnInvuln: 3,
  /** Stamina regen per second, and the pause after spending it. */
  staminaRegen: 32,
  staminaDelay: 0.6,
  /** HP regen: +1 every `regenEvery` s once `regenDelay` s have passed without damage. */
  regenDelay: 6,
  regenEvery: 2.5,
  /** Falls longer than this (blocks) hurt, 1 HP per extra block. */
  safeFall: 3.5,
  /** Lava / fire contact damage per second. */
  lavaDps: 6,
  fireDps: 2,
  /** Knockback speed when hit. */
  knockback: 6.5,
} as const;

export interface DamageSource {
  /** Attacker position (for guard direction and knockback); null = environment (fall, lava). */
  from: { x: number; z: number } | null;
  /** Environment damage ignores guard and short invulnerability windows (still blocked by dodge/spawn). */
  environment?: boolean;
}

export interface DamageResult {
  /** HP actually lost. */
  dealt: number;
  blocked: boolean;
  dodged: boolean;
  died: boolean;
}

/** Fall damage for a fall of `blocks` (0 if safe). */
export function fallDamage(blocks: number): number {
  return blocks > COMBAT.safeFall ? Math.floor(blocks - COMBAT.safeFall + 0.5) : 0;
}

/** Angle between facing `yaw` (look direction (−sin yaw, −cos yaw)) and the direction towards (dx, dz). */
export function angleTo(yaw: number, dx: number, dz: number): number {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return 0;
  const dot = (fx * dx + fz * dz) / len;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** Damage after defense: at least 1 (a guard can bring it down further, to 0). */
export function afterDefense(raw: number, defense: number): number {
  return Math.max(1, Math.round(raw - defense));
}

/** Pick the target a swing hits: closest one inside reach and the facing cone (or null). */
export function pickTarget<T extends { x: number; y: number; z: number }>(
  me: { x: number; y: number; z: number },
  yaw: number,
  targets: readonly T[],
  reach: number,
  cone: number = COMBAT.attackCone,
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    const dx = t.x - me.x;
    const dz = t.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d > reach || Math.abs(t.y - me.y) > 2.2) continue;
    // Very close targets count even slightly off-centre.
    if (d > 0.6 && angleTo(yaw, dx, dz) > cone) continue;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/** Hit points + stamina + the timers that gate them. Advance with `tick(dt)`. */
export class Vitals {
  /** Upper limits — only raised by special items / events (hearts × 2). */
  maxHp: number = START_HEARTS * 2;
  maxStamina: number = START_STAMINA;
  hp: number = this.maxHp;
  stamina: number = this.maxStamina;
  /** Seconds left of each window. */
  invuln = 0;
  dodgeInvuln = 0;
  private sinceDamage = 99;
  private regenTimer = 0;
  private staminaPause = 0;
  guarding = false;
  /** Called on every change of hp (HUD). */
  onChange: () => void = () => {};

  get dead(): boolean {
    return this.hp <= 0;
  }

  /** Full health and stamina (spawn / respawn), with spawn protection. */
  reset(hp: number = this.maxHp): void {
    this.hp = Math.max(1, Math.min(this.maxHp, Math.round(hp)));
    this.stamina = this.maxStamina;
    this.invuln = COMBAT.spawnInvuln;
    this.dodgeInvuln = 0;
    this.sinceDamage = 99;
    this.onChange();
  }

  /** Spend stamina if there is enough; returns false (and spends nothing) otherwise. */
  spend(amount: number): boolean {
    if (this.stamina < amount) return false;
    this.stamina -= amount;
    this.staminaPause = COMBAT.staminaDelay;
    this.onChange();
    return true;
  }

  tick(dt: number): void {
    this.invuln = Math.max(0, this.invuln - dt);
    this.dodgeInvuln = Math.max(0, this.dodgeInvuln - dt);
    this.staminaPause = Math.max(0, this.staminaPause - dt);
    if (this.dead) return;
    this.sinceDamage += dt;
    const before = this.stamina;
    if (!this.guarding && this.staminaPause === 0)
      this.stamina = Math.min(this.maxStamina, this.stamina + COMBAT.staminaRegen * dt);
    let changed = this.stamina !== before;
    if (this.sinceDamage > COMBAT.regenDelay && this.hp < this.maxHp) {
      this.regenTimer += dt;
      if (this.regenTimer >= COMBAT.regenEvery) {
        this.regenTimer = 0;
        this.hp += 1;
        changed = true;
      }
    } else {
      this.regenTimer = 0;
    }
    if (changed) this.onChange();
  }

  /**
   * Take `amount` raw damage. Attacks are reduced by `defense` (environment damage is not).
   * `yaw` is where I'm facing (guarding only blocks hits from the front).
   * Returns what happened; nothing happens while dead or invulnerable.
   */
  damage(
    amount: number,
    src: DamageSource,
    me: { x: number; z: number },
    yaw: number,
    defense = 0,
  ): DamageResult {
    const none = { dealt: 0, blocked: false, dodged: false, died: false };
    if (this.dead || amount <= 0) return none;
    if (this.dodgeInvuln > 0) return { ...none, dodged: true };
    if (this.invuln > 0 && (!src.environment || this.invuln > COMBAT.hurtInvuln)) return none;
    let dealt = src.environment ? Math.round(amount) || 1 : afterDefense(amount, defense);
    let blocked = false;
    if (this.guarding && src.from && !src.environment) {
      const front = angleTo(yaw, src.from.x - me.x, src.from.z - me.z) < COMBAT.guardFront;
      if (front && this.spend(COMBAT.guardStaminaPerHit)) {
        blocked = true;
        dealt = Math.round(dealt * COMBAT.guardKeep);
      } else if (front) {
        this.guarding = false; // out of stamina: the guard breaks
      }
    }
    this.hp = Math.max(0, this.hp - dealt);
    this.sinceDamage = 0;
    if (!src.environment) this.invuln = COMBAT.hurtInvuln;
    this.onChange();
    return { dealt, blocked, dodged: false, died: this.hp <= 0 };
  }
}
