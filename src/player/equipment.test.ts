import { describe, expect, it } from 'vitest';
import { BAG_SIZE, BASE_STATS, Equipment, GEAR, maxAttack } from './equipment';

describe('Equipment', () => {
  it('starts with a stick, a wooden shield and straw sandals', () => {
    const e = new Equipment();
    expect([e.weapon, e.armor, e.shoes]).toEqual(['stick', 'wood_shield', 'straw_sandals']);
    expect(e.stats).toEqual({
      attack: BASE_STATS.attack + 3,
      defense: BASE_STATS.defense + 1,
      speed: BASE_STATS.speed + 0.2,
    });
    expect(e.weaponDef?.weapon?.kind).toBe('melee');
  });

  it('melee weapons hit much harder than magic ones', () => {
    expect(maxAttack('melee')).toBeGreaterThanOrEqual(maxAttack('magic') * 2);
    for (const g of Object.values(GEAR)) {
      if (g.weapon?.kind === 'magic') expect(g.stats.attack).toBeLessThan(GEAR.stick!.stats.attack);
    }
  });

  it('equips from the bag and swaps the old item back in', () => {
    const e = new Equipment();
    expect(e.give('magic_twig')).toBe(true);
    expect(e.equip(0)).toBe(true);
    expect(e.weapon).toBe('magic_twig');
    expect(e.bag).toEqual(['stick']);
    expect(e.weaponDef?.weapon?.kind).toBe('magic');
  });

  it('the bag has a limit', () => {
    const e = new Equipment();
    for (let i = 0; i < BAG_SIZE; i++) e.give('wood_sword');
    expect(e.give('wood_sword')).toBe(false);
    expect(e.give('nope')).toBe(false);
  });

  it('parses saves and drops items in the wrong slot', () => {
    expect(Equipment.parse(null)).toBeNull();
    expect(
      Equipment.parse({ weapon: 'wood_shield', armor: 'stone_shield', shoes: 'x', bag: ['stick', 7, 'bad'] }),
    ).toEqual({ weapon: null, armor: 'stone_shield', shoes: null, bag: ['stick'] });
  });
});
