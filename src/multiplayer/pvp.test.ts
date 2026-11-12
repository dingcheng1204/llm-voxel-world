import { describe, expect, it } from 'vitest';
import { maxAttack } from '../player/equipment';
import type { OnlinePlayer } from './island';
import { acceptHit } from './pvp';

const attacker = (over: Partial<OnlinePlayer['combat']> = {}, x = 1.5): OnlinePlayer => ({
  id: 'p-attacker1',
  name: 'A',
  species: 'tiger',
  pos: { x, y: 20, z: 0, heading: 0 },
  seenAt: 1000,
  combat: { hp: 6, mode: 'combat', guard: false, swings: 1, dead: false, ...over },
});
const base = {
  myMode: 'combat' as const,
  myPos: { x: 0, y: 20, z: 0 },
  dmg: 4,
  kind: 'melee' as const,
  lastHitAt: undefined,
  now: 1100,
};

describe('acceptHit', () => {
  it('accepts a fair hit', () => {
    expect(acceptHit({ ...base, attacker: attacker() })).toBe(4);
  });
  it('needs both players in combat mode', () => {
    expect(acceptHit({ ...base, myMode: 'build', attacker: attacker() })).toBe(0);
    expect(acceptHit({ ...base, attacker: attacker({ mode: 'build' }) })).toBe(0);
  });
  it('magic reaches far but is capped low; melee does not reach far', () => {
    expect(acceptHit({ ...base, attacker: attacker({}, 12) })).toBe(0);
    expect(acceptHit({ ...base, kind: 'magic', dmg: 99, attacker: attacker({}, 12) })).toBe(
      maxAttack('magic'),
    );
  });
  it('rejects dead, too-fast and inflated hits', () => {
    expect(acceptHit({ ...base, attacker: attacker({ dead: true }) })).toBe(0);
    expect(acceptHit({ ...base, attacker: attacker(), lastHitAt: 1050 })).toBe(0);
    expect(acceptHit({ ...base, attacker: attacker(), dmg: 99 })).toBe(maxAttack('melee'));
    expect(acceptHit({ ...base, attacker: undefined })).toBe(0);
  });
});
