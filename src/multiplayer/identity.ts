// Who this browser's player is: a stable id, a display name and a look (snake / tiger / monkey).
// Not stored: guests get a fresh identity every visit, signed-in players get theirs from their save.

import { PLAYER_SPECIES, type PlayerSpecies } from '../agents/species';

export interface Identity {
  /** "p-" + 8 lowercase letters/digits — matches the server's PLAYER_ID check. */
  id: string;
  name: string;
  species: PlayerSpecies;
}

const KEY = 'voxel:player';

export const SPECIES_LABEL: Record<PlayerSpecies, string> = { snake: '蛇', tiger: '老虎', monkey: '猴子' };
export const SPECIES_COLOR: Record<PlayerSpecies, string> = {
  snake: '#3fae5a',
  tiger: '#e8892b',
  monkey: '#9a6a46',
};
/** Names the characters use — players can't take them. */
const RESERVED = ['clio', 'gem'];

export function newPlayerId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const rnd = new Uint8Array(8);
  globalThis.crypto.getRandomValues(rnd);
  return `p-${[...rnd].map((b) => chars[b % chars.length]).join('')}`;
}

/** Clean a typed name; returns an error message (Traditional Chinese) or the name. */
export function checkName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 1) return { ok: false, error: '請輸入名字' };
  if (name.length > 16) return { ok: false, error: '名字最多 16 個字' };
  if (RESERVED.includes(name.toLowerCase())) return { ok: false, error: '這是島上角色的名字，換一個吧' };
  return { ok: true, name };
}

export function loadIdentity(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): Identity | null {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? 'null') as Partial<Identity> | null;
    if (!raw || typeof raw.id !== 'string' || !/^p-[a-z0-9]{6,12}$/.test(raw.id)) return null;
    const name = checkName(String(raw.name ?? ''));
    if (!name.ok) return null;
    const species = PLAYER_SPECIES.includes(raw.species as PlayerSpecies)
      ? (raw.species as PlayerSpecies)
      : 'tiger';
    return { id: raw.id, name: name.name, species };
  } catch {
    return null;
  }
}

export function saveIdentity(
  id: Identity,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(id));
  } catch {
    /* private mode: identity lasts for this visit only */
  }
}
