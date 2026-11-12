import { describe, expect, it } from 'vitest';
import { B } from '../world/blocks';
import { loadLocal, parseSave, saveLocal, type PlayerSaveData } from './playerSave';
import { authError, checkCredentials } from './account';

const good: PlayerSaveData = {
  v: 1,
  playerId: 'p-abc12345',
  name: '小丁',
  species: 'monkey',
  pos: [3.5, 22, 30.5],
  yaw: 1.2,
  hp: 5,
  maxHp: 8,
  maxStamina: 60,
  inventory: [{ id: B.stone, count: 5 }, null],
  gear: { weapon: 'magic_twig', armor: 'wood_shield', shoes: null, bag: ['stick'] },
  savedAt: 123,
};

describe('player saves', () => {
  it('round-trips through storage', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    expect(saveLocal(1, 'guest', good, storage)).toBe(true);
    expect(loadLocal(1, 'guest', storage)).toEqual(good);
    expect(loadLocal(1, 'someone-else', storage)).toBeNull();
  });

  it('rejects broken or out-of-bounds saves and clamps the rest', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave({ ...good, v: 2 })).toBeNull();
    expect(parseSave({ ...good, playerId: 'hacker' })).toBeNull();
    expect(parseSave({ ...good, pos: [9999, 20, 0] })).toBeNull();
    expect(parseSave({ ...good, pos: [0, Number.NaN, 0] })).toBeNull();
    const p = parseSave({ ...good, hp: 500, maxHp: 999, species: 'dragon', inventory: 'lots', gear: 'x' })!;
    expect(p.maxHp).toBe(20);
    expect(p.hp).toBe(20);
    expect(p.gear).toBeNull();
    // Old saves without the new fields: 3 hearts.
    const old = parseSave({ ...good, hp: 20, maxHp: undefined, maxStamina: undefined, gear: undefined })!;
    expect(old.maxHp).toBe(6);
    expect(old.hp).toBe(6);
    expect(p.species).toBe('tiger');
    expect(p.inventory).toEqual([]);
  });
});

describe('account helpers', () => {
  it('checks credentials and translates errors', () => {
    expect(checkCredentials('a@b.co', '123456')).toBeNull();
    expect(checkCredentials('nope', '123456')).not.toBeNull();
    expect(checkCredentials('a@b.co', '123')).not.toBeNull();
    expect(authError('Invalid login credentials')).toBe('Email 或密碼不對');
    expect(authError('User already registered')).toContain('註冊過');
  });
});

describe('confirmation links', () => {
  it('reads what the link put in the URL', async () => {
    const { readLink } = await import('./account');
    expect(readLink('#access_token=abc&type=signup&expires_in=3600', '')).toEqual({ kind: 'confirmed' });
    expect(
      readLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid', ''),
    ).toEqual({
      kind: 'error',
      message: '確認連結已經過期或用過了，請重寄一封確認信',
    });
    expect(readLink('', '?error=server_error&error_description=Oops+here')?.kind).toBe('error');
    expect(readLink('', '?touch=1')).toBeNull();
  });
});
