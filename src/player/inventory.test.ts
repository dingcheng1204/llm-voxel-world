import { describe, expect, it } from 'vitest';
import { B } from '../world/blocks';
import { dropOf, Inventory, MAX_STACK, STARTER_KIT } from './inventory';

describe('Inventory', () => {
  it('starts with the starter kit', () => {
    const inv = new Inventory();
    expect(inv.countOf(B.planks)).toBe(32);
    expect(inv.slots.filter(Boolean)).toHaveLength(STARTER_KIT.length);
  });

  it('fills existing stacks, then empty slots, and reports what did not fit', () => {
    const inv = new Inventory([{ id: B.stone, count: 60 }]);
    expect(inv.add(B.stone, 10)).toBe(10);
    expect(inv.slots[0]).toEqual({ id: B.stone, count: MAX_STACK });
    expect(inv.slots[1]).toEqual({ id: B.stone, count: 6 });
    const full = new Inventory(Array.from({ length: 9 }, () => ({ id: B.dirt, count: MAX_STACK })));
    expect(full.add(B.sand, 1)).toBe(0);
  });

  it('takes one block and empties the slot at zero', () => {
    const inv = new Inventory([{ id: B.log, count: 1 }]);
    expect(inv.takeOne(0)).toBe(B.log);
    expect(inv.slots[0]).toBeNull();
    expect(inv.takeOne(0)).toBeNull();
  });

  it('parses untrusted saves safely', () => {
    expect(Inventory.parse('x')).toBeNull();
    const s = Inventory.parse([{ id: B.stone, count: 999 }, { id: B.bedrock, count: 1 }, null, { id: 'x' }]);
    expect(s).toEqual([{ id: B.stone, count: MAX_STACK }, null, null, null]);
  });

  it('mining drops', () => {
    expect(dropOf(B.grass)).toBe(B.dirt);
    expect(dropOf(B.fire)).toBeNull();
    expect(dropOf(B.crystal)).toBe(B.crystal);
  });
});
