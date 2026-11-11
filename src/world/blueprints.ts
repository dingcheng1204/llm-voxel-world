// Building blueprints: small structures the characters can choose to build together.
// Each blueprint is a list of blocks in local coordinates. Only materials the characters can gather
// on the island (there is no crafting): log, leaves, stone, flower_grass.
//
// Local frame: x = 0..w-1 (left → right), z = 0..d-1 (back → front), y = 0 = first layer above the ground.
// The front (door, stairs, the water end of the dock) is the z = d-1 side. `facing` rotates the
// footprint so the front looks south (+Z), west (−X), north (−Z) or east (+X).
//
// Pure data + math, no runtime imports: shared by the game, the server simulation and the prompts.

export type Facing = 'south' | 'west' | 'north' | 'east';
export const FACINGS: readonly Facing[] = ['south', 'west', 'north', 'east'];

/** Material names (must exist in the block registry — checked by tests). */
export type Material = 'log' | 'leaves' | 'stone' | 'flower_grass';

export interface Blueprint {
  id: string;
  /** Display name (zh-TW). */
  name: string;
  /** One short line for prompts. */
  summary: string;
  w: number;
  d: number;
  /** land = on flat ground; shore = the back rows on the beach, the front reaches out over the sea. */
  site: 'land' | 'shore';
  /** [x, y, z, material] in the local frame. */
  blocks: readonly [number, number, number, Material][];
}

type B = [number, number, number, Material];

function hut(): B[] {
  // 5×5 log cabin, walls 3 high, door in the front middle, a window on each side, leafy roof.
  const out: B[] = [];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        const edge = x === 0 || x === 4 || z === 0 || z === 4;
        if (!edge) continue;
        const door = z === 4 && x === 2 && y < 2;
        const window = y === 1 && z === 2 && (x === 0 || x === 4);
        if (!door && !window) out.push([x, y, z, 'log']);
      }
    }
  }
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) out.push([x, 3, z, 'leaves']);
  for (let x = 1; x < 4; x++) for (let z = 1; z < 4; z++) out.push([x, 4, z, 'leaves']);
  out.push([2, 5, 2, 'leaves']);
  return out;
}

function watchtower(): B[] {
  // 3×3 tower at the back (log posts, log platform, corner rails), stone steps in front.
  const out: B[] = [];
  for (const [x, z] of [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ] as const) {
    for (let y = 0; y < 3; y++) out.push([x, y, z, 'log']);
    out.push([x, 4, z, 'log']);
  }
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) out.push([x, 3, z, 'log']);
  // Steps: climb from the front (z = 5) towards the tower; each step one block higher.
  for (let y = 0; y < 1; y++) out.push([1, y, 5, 'stone']);
  for (let y = 0; y < 2; y++) out.push([1, y, 4, 'stone']);
  for (let y = 0; y < 3; y++) out.push([1, y, 3, 'stone']);
  return out;
}

function dock(): B[] {
  // 3 wide, 8 long log deck. Posts under the deck are added per site (they depend on the sea depth).
  const out: B[] = [];
  for (let z = 0; z < 8; z++) for (let x = 0; x < 3; x++) out.push([x, 0, z, 'log']);
  return out;
}

function garden(): B[] {
  // 5×5 raised flower bed: stone border, flower grass inside, a log post with a leaf "bush" on each corner.
  const out: B[] = [];
  for (let x = 0; x < 5; x++) {
    for (let z = 0; z < 5; z++) {
      const corner = (x === 0 || x === 4) && (z === 0 || z === 4);
      const edge = x === 0 || x === 4 || z === 0 || z === 4;
      if (corner) {
        out.push([x, 0, z, 'log'], [x, 1, z, 'leaves']);
      } else {
        out.push([x, 0, z, edge ? 'stone' : 'flower_grass']);
      }
    }
  }
  return out;
}

export const BLUEPRINTS: readonly Blueprint[] = [
  {
    id: 'hut',
    name: '小木屋',
    summary: '5×5 log cabin with a door, two windows and a leafy roof',
    w: 5,
    d: 5,
    site: 'land',
    blocks: hut(),
  },
  {
    id: 'watchtower',
    name: '瞭望台',
    summary: '3×3 log lookout platform with stone steps in front',
    w: 3,
    d: 6,
    site: 'land',
    blocks: watchtower(),
  },
  {
    id: 'dock',
    name: '碼頭',
    summary: '3×8 log pier from the beach out over the sea (stone posts in the water)',
    w: 3,
    d: 8,
    site: 'shore',
    blocks: dock(),
  },
  {
    id: 'garden',
    name: '花圃',
    summary: '5×5 raised flower bed with a stone border and leafy corner posts',
    w: 5,
    d: 5,
    site: 'land',
    blocks: garden(),
  },
];

export function blueprint(id: string): Blueprint | undefined {
  return BLUEPRINTS.find((b) => b.id === id);
}

/** Materials a blueprint needs (without per-site extras such as foundations or dock posts). */
export function materialsOf(bp: Blueprint): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [, , , m] of bp.blocks) out[m] = (out[m] ?? 0) + 1;
  return out;
}

/** Local (x, z) → offset from the site's min corner, after turning the front to `facing`. */
export function rotate(
  x: number,
  z: number,
  bp: Pick<Blueprint, 'w' | 'd'>,
  facing: Facing,
): [number, number] {
  const { w, d } = bp;
  switch (facing) {
    case 'south':
      return [x, z];
    case 'west':
      return [d - 1 - z, x];
    case 'north':
      return [w - 1 - x, d - 1 - z];
    case 'east':
      return [z, w - 1 - x];
  }
}

/** Footprint size in world x/z after rotation. */
export function footprint(bp: Pick<Blueprint, 'w' | 'd'>, facing: Facing): [number, number] {
  return facing === 'south' || facing === 'north' ? [bp.w, bp.d] : [bp.d, bp.w];
}

export interface Site {
  /** Stable id, e.g. "hut@3,-12". */
  id: string;
  blueprint: string;
  /** Min corner of the footprint (x, z) and the y of the first layer above the ground. */
  origin: [number, number, number];
  facing: Facing;
  /** Character who proposed it. */
  by: string;
  /** Epoch ms of the last change (newest wins when snapshots are merged). */
  at: number;
  status: 'planned' | 'done' | 'cancelled';
  /** Optional name the characters gave it. */
  name?: string;
}

export interface SiteTerrain {
  /** y of the top solid block of the generated terrain (edits ignored — every simulator agrees). */
  heightAt(x: number, z: number): number;
  seaLevel: number;
}

export type SiteCheck =
  | { ok: true; origin: [number, number, number]; blocks: [number, number, number, Material][] }
  | { ok: false; reason: string };

/**
 * Where exactly a blueprint goes when its footprint's min corner is at (x, z), and every block in world
 * coordinates — including per-site extras (stone foundation under low ground, stone posts under a dock).
 * Deterministic from the terrain, so the browser, the server and the ghost preview all agree.
 */
export function layoutSite(bp: Blueprint, x0: number, z0: number, facing: Facing, t: SiteTerrain): SiteCheck {
  const [fw, fd] = footprint(bp, facing);
  // Ground under each local (x, z).
  const ground = (lx: number, lz: number) => {
    const [ox, oz] = rotate(lx, lz, bp, facing);
    return t.heightAt(x0 + ox, z0 + oz);
  };
  const world = (lx: number, ly: number, lz: number, y0: number): [number, number, number] => {
    const [ox, oz] = rotate(lx, lz, bp, facing);
    return [x0 + ox, y0 + ly, z0 + oz];
  };
  const blocks: [number, number, number, Material][] = [];
  if (bp.site === 'land') {
    let lo = Infinity;
    let hi = -Infinity;
    for (let lx = 0; lx < bp.w; lx++) {
      for (let lz = 0; lz < bp.d; lz++) {
        const h = ground(lx, lz);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    if (lo < t.seaLevel) return { ok: false, reason: 'part of this spot is under water' };
    if (hi - lo > 1)
      return { ok: false, reason: `the ground here is not flat enough (${fw}×${fd} needs a flat spot)` };
    const y0 = hi + 1;
    for (const [lx, ly, lz, m] of bp.blocks) blocks.push([...world(lx, ly, lz, y0), m]);
    // Fill the one-block dips under the footprint with stone so nothing floats.
    for (let lx = 0; lx < bp.w; lx++) {
      for (let lz = 0; lz < bp.d; lz++) {
        if (ground(lx, lz) < hi) blocks.push([...world(lx, -1, lz, y0), 'stone']);
      }
    }
    return { ok: true, origin: [x0, y0, z0], blocks };
  }
  // Shore: the back two rows stand on the beach, every row from the third one is over the sea.
  let landTop = -Infinity;
  for (let lx = 0; lx < bp.w; lx++) {
    for (let lz = 0; lz < bp.d; lz++) {
      const h = ground(lx, lz);
      if (lz < 2) {
        if (h < t.seaLevel) return { ok: false, reason: 'the back of a dock must stand on the beach' };
        landTop = Math.max(landTop, h);
      } else if (h >= t.seaLevel) {
        return {
          ok: false,
          reason: 'the front of a dock must reach out over the sea (face it towards the water)',
        };
      }
    }
  }
  if (landTop > t.seaLevel + 2) return { ok: false, reason: 'the beach here is too high for a dock' };
  const y0 = landTop + 1;
  for (const [lx, ly, lz, m] of bp.blocks) blocks.push([...world(lx, ly, lz, y0), m]);
  // Stone posts down to the sea floor under the outer corners every other row.
  for (let lz = 3; lz < bp.d; lz += 2) {
    for (const lx of [0, bp.w - 1]) {
      for (let y = y0 - 1; y > ground(lx, lz); y--) blocks.push([...world(lx, y - y0, lz, y0), 'stone']);
    }
  }
  return { ok: true, origin: [x0, y0, z0], blocks };
}

/** Site placed in front of a character: footprint centred on its x (or z), starting `gap` blocks ahead. */
export function siteInFront(
  bp: Blueprint,
  cell: [number, number, number],
  facing: Facing,
  gap = 2,
): { x0: number; z0: number } {
  const [fw, fd] = footprint(bp, facing);
  const [cx, , cz] = cell;
  // The character stands in front of the building, looking at it: the building's front faces back at them.
  switch (facing) {
    case 'south': // front faces +Z → building is north of the character
      return { x0: cx - Math.floor(fw / 2), z0: cz - gap - fd + 1 };
    case 'north':
      return { x0: cx - Math.floor(fw / 2), z0: cz + gap };
    case 'west': // front faces −X → building is east of the character
      return { x0: cx + gap, z0: cz - Math.floor(fd / 2) };
    case 'east':
      return { x0: cx - gap - fw + 1, z0: cz - Math.floor(fd / 2) };
  }
}

/** One line per blueprint for the system prompt. */
export function blueprintCatalog(): string {
  return BLUEPRINTS.map((b) => {
    const mats = Object.entries(materialsOf(b))
      .map(([m, n]) => `${n} ${m}`)
      .join(', ');
    return `- "${b.id}" (${b.name}): ${b.summary}. Needs about ${mats}.`;
  }).join('\n');
}
