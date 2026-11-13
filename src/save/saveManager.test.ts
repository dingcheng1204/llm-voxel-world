import { describe, expect, it, vi } from 'vitest';
import type { Account } from './account';
import { forgetGuestData, SaveManager } from './saveManager';

describe('guests leave no record', () => {
  it('saving as a guest writes nothing and does not even collect the state', async () => {
    const collect = vi.fn(() => null);
    const saves = new SaveManager(1, null, collect);
    expect(saves.guest).toBe(true);
    expect(await saves.save('manual')).toBe(false);
    expect(await saves.save('auto')).toBe(false);
    expect(collect).not.toHaveBeenCalled();
    expect(await saves.loadBest()).toBeNull();
  });

  it('a signed-out account is a guest too', async () => {
    const account = { userId: null } as unknown as Account;
    const saves = new SaveManager(1, account, () => null);
    expect(saves.guest).toBe(true);
    expect(await saves.save('manual')).toBe(false);
  });

  it('forgets what older versions kept for guests', () => {
    const mem = new Map([
      ['voxel:save:7:guest', '{}'],
      ['voxel:player', '{}'],
      ['voxel:save:7:some-user-id', '{}'],
    ]);
    forgetGuestData(7, { removeItem: (k: string) => void mem.delete(k) });
    expect([...mem.keys()]).toEqual(['voxel:save:7:some-user-id']);
  });
});
