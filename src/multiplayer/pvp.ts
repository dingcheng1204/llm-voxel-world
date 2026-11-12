// Player-vs-player rules. Hits are sent by the attacker and judged by the victim's browser, which
// only accepts a hit if: both players are in combat mode, the attacker is alive, close enough for
// that kind of weapon (melee reach, or a magic bolt's range) by their last broadcast position, not
// hitting faster than any weapon allows, and the damage is not above the strongest weapon of that kind.
// The victim then applies their own defense / guard / dodge.
// (Client-side trust — fine for a friendly island; a determined cheater could still fake hits.)

import { GEAR, maxAttack, type WeaponKind } from '../player/equipment';
import type { OnlinePlayer } from './island';

/** Extra distance allowed on top of the range (position updates lag ~0.2 s). */
const LAG_SLACK = 2;
/** Ignore attackers whose last position update is older than this. */
const STALE_MS = 3000;

const longest = (kind: WeaponKind) =>
  Math.max(
    kind === 'melee' ? 2.2 : 0,
    ...Object.values(GEAR).map((g) => (g.weapon?.kind === kind ? g.weapon.range : 0)),
  );
const fastest = Math.min(...Object.values(GEAR).map((g) => g.weapon?.cooldown ?? 99));

export function acceptHit(o: {
  myMode: 'build' | 'combat';
  myPos: { x: number; y: number; z: number };
  attacker: OnlinePlayer | undefined;
  dmg: number;
  kind: WeaponKind;
  lastHitAt: number | undefined;
  now: number;
}): number {
  const a = o.attacker;
  if (!a?.pos || o.myMode !== 'combat') return 0;
  if (a.combat.mode !== 'combat' || a.combat.dead) return 0;
  if (o.now - a.seenAt > STALE_MS) return 0;
  const d = Math.hypot(a.pos.x - o.myPos.x, a.pos.z - o.myPos.z);
  if (d > longest(o.kind) + LAG_SLACK || Math.abs(a.pos.y - o.myPos.y) > (o.kind === 'magic' ? 12 : 3))
    return 0;
  if (o.lastHitAt !== undefined && o.now - o.lastHitAt < fastest * 1000 * 0.8) return 0;
  if (!Number.isFinite(o.dmg) || o.dmg <= 0) return 0;
  return Math.min(o.dmg, maxAttack(o.kind));
}
