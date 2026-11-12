// Player-vs-player rules. Hits are sent by the attacker and judged by the victim's browser, which
// only accepts a hit if: both players are in combat mode, the attacker is alive, close enough by their
// last broadcast position, and not hitting faster than the attack cooldown allows.
// (Client-side trust — fine for a friendly island; a determined cheater could still fake hits.)

import { COMBAT } from '../player/combat';
import type { OnlinePlayer } from './island';

/** Extra distance allowed on top of the reach (position updates lag ~0.2 s). */
const LAG_SLACK = 2;
/** Ignore attackers whose last position update is older than this. */
const STALE_MS = 3000;

export function acceptHit(o: {
  myMode: 'build' | 'combat';
  myPos: { x: number; y: number; z: number };
  attacker: OnlinePlayer | undefined;
  dmg: number;
  lastHitAt: number | undefined;
  now: number;
}): number {
  const a = o.attacker;
  if (!a?.pos || o.myMode !== 'combat') return 0;
  if (a.combat.mode !== 'combat' || a.combat.dead) return 0;
  if (o.now - a.seenAt > STALE_MS) return 0;
  const d = Math.hypot(a.pos.x - o.myPos.x, a.pos.z - o.myPos.z);
  if (d > COMBAT.attackReach + LAG_SLACK || Math.abs(a.pos.y - o.myPos.y) > 3) return 0;
  if (o.lastHitAt !== undefined && o.now - o.lastHitAt < COMBAT.attackCooldown * 1000 * 0.8) return 0;
  if (!Number.isFinite(o.dmg) || o.dmg <= 0) return 0;
  return Math.min(o.dmg, COMBAT.attackDamage);
}
