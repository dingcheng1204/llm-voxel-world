// The player's inventory: 9 slots (= the hotbar), each a stack of one block type (max 64).
// Mining puts the dropped block in; placing takes one out. New players and players who die
// get the starter kit. Pure data (no DOM) so it can be tested and saved.

import { B, BLOCKS } from '../world/blocks';

export const SLOTS = 9;
export const MAX_STACK = 64;

export interface Stack {
  id: number;
  count: number;
}
export type Slots = (Stack | null)[];

/** What a new (or respawned) player carries. */
export const STARTER_KIT: readonly Stack[] = [
  { id: B.planks, count: 32 },
  { id: B.dirt, count: 16 },
  { id: B.stone, count: 16 },
  { id: B.log, count: 8 },
  { id: B.brick, count: 8 },
  { id: B.toy_yellow, count: 8 },
  { id: B.glass, count: 4 },
  { id: B.fire, count: 3 },
];

/** Chinese names shown in the hotbar and messages. */
export const BLOCK_LABEL: Record<number, string> = {
  [B.grass]: '草',
  [B.dirt]: '土',
  [B.stone]: '石頭',
  [B.log]: '原木',
  [B.leaves]: '樹葉',
  [B.sand]: '沙',
  [B.water]: '水',
  [B.planks]: '木板',
  [B.glass]: '玻璃',
  [B.rock]: '岩石',
  [B.fire]: '火',
  [B.snow]: '雪',
  [B.ice]: '冰',
  [B.clay]: '黏土',
  [B.gravel]: '礫石',
  [B.brick]: '磚',
  [B.mossy_stone]: '青苔石',
  [B.crystal]: '水晶',
  [B.toy_red]: '紅色玩具方塊',
  [B.toy_orange]: '橘色玩具方塊',
  [B.toy_yellow]: '黃色玩具方塊',
  [B.toy_blue]: '藍色玩具方塊',
  [B.flower_grass]: '花草地',
};

export const labelOf = (id: number): string => BLOCK_LABEL[id] ?? BLOCKS[id]?.name ?? '?';

/** Block you get from mining `id` (null = nothing, e.g. fire just goes out). */
export function dropOf(id: number): number | null {
  if (id === B.grass || id === B.flower_grass) return B.dirt;
  if (id === B.fire || id === B.air || id === B.water || id === B.lava || id === B.bedrock) return null;
  return BLOCKS[id] ? id : null;
}

/** Can this id be carried? (everything you can mine, plus fire from the kit) */
export const carriable = (id: number): boolean =>
  Number.isInteger(id) && id > 0 && id !== B.bedrock && id !== B.lava && id !== B.water && !!BLOCKS[id];

export class Inventory {
  slots: Slots = new Array<Stack | null>(SLOTS).fill(null);
  /** Called after any change (hotbar redraw, "unsaved changes"). */
  onChange: () => void = () => {};

  constructor(initial: readonly (Stack | null)[] = STARTER_KIT) {
    this.set(initial);
  }

  /** Replace the contents (starter kit, loaded save). Invalid entries are dropped. */
  set(list: readonly (Stack | null)[]): void {
    this.slots = new Array<Stack | null>(SLOTS).fill(null);
    list.slice(0, SLOTS).forEach((s, i) => {
      if (s && carriable(s.id) && Number.isFinite(s.count) && s.count >= 1) {
        this.slots[i] = { id: s.id, count: Math.min(MAX_STACK, Math.floor(s.count)) };
      }
    });
    this.onChange();
  }

  reset(): void {
    this.set(STARTER_KIT);
  }

  countOf(id: number): number {
    return this.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
  }

  /** Add `n` blocks: fill existing stacks first, then empty slots. Returns how many fit. */
  add(id: number, n = 1): number {
    if (!carriable(id) || n <= 0) return 0;
    let left = n;
    for (const s of this.slots) {
      if (left === 0) break;
      if (s?.id !== id || s.count >= MAX_STACK) continue;
      const k = Math.min(left, MAX_STACK - s.count);
      s.count += k;
      left -= k;
    }
    for (let i = 0; i < SLOTS && left > 0; i++) {
      if (this.slots[i]) continue;
      const k = Math.min(left, MAX_STACK);
      this.slots[i] = { id, count: k };
      left -= k;
    }
    if (left !== n) this.onChange();
    return n - left;
  }

  /** Take one block out of slot `i`; returns its id or null if empty. */
  takeOne(i: number): number | null {
    const s = this.slots[i];
    if (!s) return null;
    s.count -= 1;
    if (s.count <= 0) this.slots[i] = null;
    this.onChange();
    return s.id;
  }

  /** Plain JSON for saves. */
  toJSON(): Slots {
    return this.slots.map((s) => (s ? { id: s.id, count: s.count } : null));
  }

  /** Parse untrusted JSON (a save) into slots; anything odd becomes an empty slot. */
  static parse(raw: unknown): Slots | null {
    if (!Array.isArray(raw)) return null;
    return raw.slice(0, SLOTS).map((s) => {
      if (!s || typeof s !== 'object') return null;
      const { id, count } = s as { id?: unknown; count?: unknown };
      if (typeof id !== 'number' || typeof count !== 'number' || !carriable(id) || count < 1) return null;
      return { id, count: Math.min(MAX_STACK, Math.floor(count)) };
    });
  }
}
