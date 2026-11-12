// Equipment: three slots (weapon, armor, shoes) plus a small bag for gear you find.
// There are no levels: attack, defense and speed come from the character's base stats plus what
// is equipped. Max hearts / stamina only change through special items or events (stored on the
// player, kept after death). Weapons are either melee (strong) or magic (ranged bolts, much weaker).

export type GearSlot = 'weapon' | 'armor' | 'shoes';
export type WeaponKind = 'melee' | 'magic';

export interface Stats {
  attack: number;
  defense: number;
  /** Walking speed bonus (m/s). */
  speed: number;
}

export interface GearDef {
  id: string;
  name: string;
  icon: string;
  slot: GearSlot;
  stats: Stats;
  /** Weapons only. */
  weapon?: {
    kind: WeaponKind;
    /** Melee: reach from the body (blocks). Magic: how far a bolt flies. */
    range: number;
    /** Seconds between attacks. */
    cooldown: number;
    /** Stamina per attack (magic costs some; melee is free). */
    stamina: number;
  };
  note: string;
}

/** The character itself, before any gear. */
export const BASE_STATS: Stats = { attack: 1, defense: 0, speed: 4 };
/** Hearts (1 heart = 2 hp) and stamina a new character starts with. */
export const START_HEARTS = 3;
export const START_STAMINA = 60;
export const MAX_HEARTS = 10;
export const MAX_STAMINA_CAP = 200;

const none: Stats = { attack: 0, defense: 0, speed: 0 };

export const GEAR: Record<string, GearDef> = {
  // Weapons — melee
  stick: {
    id: 'stick',
    name: '樹枝',
    icon: '🌿',
    slot: 'weapon',
    stats: { ...none, attack: 3 },
    weapon: { kind: 'melee', range: 2.6, cooldown: 0.5, stamina: 0 },
    note: '撿來的樹枝，總比空手好',
  },
  wood_sword: {
    id: 'wood_sword',
    name: '木劍',
    icon: '🗡️',
    slot: 'weapon',
    stats: { ...none, attack: 5 },
    weapon: { kind: 'melee', range: 2.8, cooldown: 0.5, stamina: 0 },
    note: '削得很用心的木劍',
  },
  stone_sword: {
    id: 'stone_sword',
    name: '石劍',
    icon: '⚔️',
    slot: 'weapon',
    stats: { ...none, attack: 7 },
    weapon: { kind: 'melee', range: 3, cooldown: 0.55, stamina: 0 },
    note: '又重又硬',
  },
  // Weapons — magic (ranged, much weaker per hit)
  magic_twig: {
    id: 'magic_twig',
    name: '魔法樹枝',
    icon: '🪄',
    slot: 'weapon',
    stats: { ...none, attack: 1 },
    weapon: { kind: 'magic', range: 14, cooldown: 0.7, stamina: 12 },
    note: '會發出小小的魔法彈',
  },
  crystal_wand: {
    id: 'crystal_wand',
    name: '水晶法杖',
    icon: '🔮',
    slot: 'weapon',
    stats: { ...none, attack: 2 },
    weapon: { kind: 'magic', range: 18, cooldown: 0.6, stamina: 12 },
    note: '紫水晶裡有光在轉',
  },
  // Armor
  wood_shield: {
    id: 'wood_shield',
    name: '木盾',
    icon: '🛡️',
    slot: 'armor',
    stats: { ...none, defense: 1 },
    note: '圓圓的木盾',
  },
  stone_shield: {
    id: 'stone_shield',
    name: '石盾',
    icon: '🪨',
    slot: 'armor',
    stats: { ...none, defense: 2, speed: -0.2 },
    note: '很穩，但有點重',
  },
  // Shoes
  straw_sandals: {
    id: 'straw_sandals',
    name: '草鞋',
    icon: '🩴',
    slot: 'shoes',
    stats: { ...none, speed: 0.2 },
    note: '草編的鞋子',
  },
  leather_boots: {
    id: 'leather_boots',
    name: '皮靴',
    icon: '🥾',
    slot: 'shoes',
    stats: { ...none, speed: 0.7 },
    note: '跑起來很輕快',
  },
};

export const STARTER_GEAR: Readonly<Record<GearSlot, string>> = {
  weapon: 'stick',
  armor: 'wood_shield',
  shoes: 'straw_sandals',
};
export const BAG_SIZE = 6;

/** Biggest attack a hit of this kind can carry (base + best weapon of that kind) — for PvP checks. */
export function maxAttack(kind: WeaponKind): number {
  let best = 0;
  for (const g of Object.values(GEAR)) if (g.weapon?.kind === kind) best = Math.max(best, g.stats.attack);
  return BASE_STATS.attack + best;
}

export interface GearState {
  weapon: string | null;
  armor: string | null;
  shoes: string | null;
  bag: string[];
}

export class Equipment {
  weapon: string | null = STARTER_GEAR.weapon;
  armor: string | null = STARTER_GEAR.armor;
  shoes: string | null = STARTER_GEAR.shoes;
  bag: string[] = [];
  onChange: () => void = () => {};

  get(slot: GearSlot): GearDef | null {
    const id = this[slot];
    return id ? (GEAR[id] ?? null) : null;
  }

  get weaponDef(): GearDef | null {
    return this.get('weapon');
  }

  /** Base + everything equipped. Speed never drops below 2. */
  get stats(): Stats {
    const s = { ...BASE_STATS };
    for (const slot of ['weapon', 'armor', 'shoes'] as const) {
      const g = this.get(slot);
      if (!g) continue;
      s.attack += g.stats.attack;
      s.defense += g.stats.defense;
      s.speed += g.stats.speed;
    }
    s.speed = Math.max(2, s.speed);
    return s;
  }

  /** Put a found item in the bag (false if the bag is full or the id is unknown). */
  give(id: string): boolean {
    if (!GEAR[id] || this.bag.length >= BAG_SIZE) return false;
    this.bag.push(id);
    this.onChange();
    return true;
  }

  /** Equip bag item `i`; whatever was in that slot goes back into the bag. */
  equip(i: number): boolean {
    const id = this.bag[i];
    const def = id ? GEAR[id] : undefined;
    if (!def) return false;
    const old = this[def.slot];
    this.bag.splice(i, 1);
    if (old) this.bag.splice(i, 0, old);
    this[def.slot] = id!;
    this.onChange();
    return true;
  }

  /** Take an equipped item off into the bag (needs room). */
  unequip(slot: GearSlot): boolean {
    const id = this[slot];
    if (!id || this.bag.length >= BAG_SIZE) return false;
    this[slot] = null;
    this.bag.push(id);
    this.onChange();
    return true;
  }

  reset(): void {
    this.set({ ...STARTER_GEAR, bag: [] });
  }

  set(g: GearState): void {
    this.weapon = g.weapon;
    this.armor = g.armor;
    this.shoes = g.shoes;
    this.bag = g.bag.slice(0, BAG_SIZE);
    this.onChange();
  }

  toJSON(): GearState {
    return { weapon: this.weapon, armor: this.armor, shoes: this.shoes, bag: [...this.bag] };
  }

  /** Parse untrusted save data: unknown ids or items in the wrong slot are dropped. */
  static parse(raw: unknown): GearState | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const slot = (s: GearSlot) => {
      const id = r[s];
      return typeof id === 'string' && GEAR[id]?.slot === s ? id : null;
    };
    const bag = Array.isArray(r.bag)
      ? r.bag.filter((id): id is string => typeof id === 'string' && !!GEAR[id]).slice(0, BAG_SIZE)
      : [];
    return { weapon: slot('weapon'), armor: slot('armor'), shoes: slot('shoes'), bag };
  }
}
