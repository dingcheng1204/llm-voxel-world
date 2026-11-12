// One save per player: name, animal, where you stand, which way you face, hp and inventory.
// Guests keep it in localStorage; signed-in players also keep it in Supabase (`player_saves`).
// Everything read back is untrusted and validated here.

import { PLAYER_SPECIES, type PlayerSpecies } from '../agents/species';
import { COMBAT } from '../player/combat';
import { Inventory, type Slots } from '../player/inventory';

export interface PlayerSaveData {
  v: 1;
  playerId: string;
  name: string;
  species: PlayerSpecies;
  /** Feet position. */
  pos: [number, number, number];
  yaw: number;
  hp: number;
  inventory: Slots;
  /** Epoch ms. */
  savedAt: number;
}

/** Island bounds (blocks) a saved position must fall inside, with some margin for the sea. */
const BOUNDS = { x: [-110, 110], y: [0, 80], z: [-160, 160] } as const;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseSave(raw: unknown): PlayerSaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  if (typeof r.playerId !== 'string' || !/^p-[a-z0-9]{6,12}$/.test(r.playerId)) return null;
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, 16) : '';
  if (!name) return null;
  const species = PLAYER_SPECIES.includes(r.species as PlayerSpecies)
    ? (r.species as PlayerSpecies)
    : 'tiger';
  const p = r.pos;
  if (!Array.isArray(p) || p.length !== 3 || !p.every(num)) return null;
  const [x, y, z] = p as [number, number, number];
  if (
    x < BOUNDS.x[0] ||
    x > BOUNDS.x[1] ||
    y < BOUNDS.y[0] ||
    y > BOUNDS.y[1] ||
    z < BOUNDS.z[0] ||
    z > BOUNDS.z[1]
  )
    return null;
  const inventory = Inventory.parse(r.inventory) ?? [];
  const hp = num(r.hp) ? Math.max(1, Math.min(COMBAT.maxHp, Math.round(r.hp))) : COMBAT.maxHp;
  return {
    v: 1,
    playerId: r.playerId,
    name,
    species,
    pos: [x, y, z],
    yaw: num(r.yaw) ? r.yaw : 0,
    hp,
    inventory,
    savedAt: num(r.savedAt) ? r.savedAt : 0,
  };
}

/** localStorage key: per world seed and per account ("guest" when not signed in). */
export const localKey = (seed: number, who: string) => `voxel:save:${seed}:${who}`;

export function loadLocal(
  seed: number,
  who: string,
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): PlayerSaveData | null {
  try {
    return parseSave(JSON.parse(storage?.getItem(localKey(seed, who)) ?? 'null'));
  } catch {
    return null;
  }
}

export function saveLocal(
  seed: number,
  who: string,
  data: PlayerSaveData,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
): boolean {
  try {
    storage?.setItem(localKey(seed, who), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
