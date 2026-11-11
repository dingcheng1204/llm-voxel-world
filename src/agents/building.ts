// Choosing where a blueprint goes (the `plan_build` action) and how far along a site is.
// Pure functions over the terrain and the shared site list, so the browser and the server agree.

import {
  blueprint,
  BLUEPRINTS,
  FACINGS,
  footprint,
  layoutSite,
  siteInFront,
  type Blueprint,
  type Facing,
  type Material,
  type Site,
  type SiteTerrain,
} from '../world/blueprints';
import type { Sites } from './worldState';

/** At most this many sites being built at once (island-wide), one per character. */
export const MAX_ACTIVE_SITES = 3;
const ISLAND = { minX: -96, maxX: 95, minZ: -144, maxZ: 143 };

export interface PlanInput {
  blueprint: string;
  /** Where the character stands and which way it looks (heading 0 = south, π/2 = east). */
  cell: [number, number, number];
  heading: number;
  /** Optional: a block the building should be centred on. */
  at?: [number, number, number];
  /** Optional: which way the building's front (door / steps / sea end) faces. */
  facing?: Facing;
  by: string;
  now: number;
}

export type PlanResult = { ok: true; site: Site; replaced?: Site } | { ok: false; reason: string };

/** Which way a heading looks, snapped to the 4 directions. */
export function lookDirection(heading: number): Facing {
  const i = Math.round(((((heading / (Math.PI * 2)) % 1) + 1) % 1) * 4) % 4;
  return (['south', 'east', 'north', 'west'] as const)[i]!;
}

const OPPOSITE: Record<Facing, Facing> = { south: 'north', north: 'south', east: 'west', west: 'east' };

function rect(x0: number, z0: number, bp: Blueprint, facing: Facing): [number, number, number, number] {
  const [fw, fd] = footprint(bp, facing);
  return [x0, z0, x0 + fw - 1, z0 + fd - 1];
}

function overlaps(
  a: [number, number, number, number],
  b: [number, number, number, number],
  margin = 1,
): boolean {
  return a[0] - margin <= b[2] && a[2] + margin >= b[0] && a[1] - margin <= b[3] && a[3] + margin >= b[1];
}

function siteRect(s: Site): [number, number, number, number] | null {
  const bp = blueprint(s.blueprint);
  return bp ? rect(s.origin[0], s.origin[2], bp, s.facing) : null;
}

/**
 * Picks a spot for a blueprint: in front of the character by default (the building faces back at it),
 * or centred on `at`. If that spot does not fit (slope, water, another site), tries nearby spots and
 * the other three facings before giving up with a reason the brain can act on.
 */
export function planSite(input: PlanInput, terrain: SiteTerrain, sites: Sites): PlanResult {
  const bp = blueprint(input.blueprint);
  if (!bp)
    return {
      ok: false,
      reason: `unknown blueprint "${input.blueprint}" (${BLUEPRINTS.map((b) => b.id).join(', ')})`,
    };
  const mine = sites.active().find((s) => s.by === input.by);
  const others = sites.active().filter((s) => s.by !== input.by);
  if (others.length >= MAX_ACTIVE_SITES) {
    return {
      ok: false,
      reason: `there are already ${others.length} building sites — help build one of them first`,
    };
  }
  const preferred = input.facing ?? OPPOSITE[lookDirection(input.heading)];
  const facings = [preferred, ...FACINGS.filter((f) => f !== preferred)];
  const offsets: [number, number][] = [[0, 0]];
  for (let r = 1; r <= 4; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) offsets.push([dx, dz]);
    }
  }
  let firstReason = '';
  for (const facing of facings) {
    const [fw, fd] = footprint(bp, facing);
    const base = input.at
      ? { x0: input.at[0] - Math.floor(fw / 2), z0: input.at[2] - Math.floor(fd / 2) }
      : siteInFront(bp, input.cell, facing);
    for (const [dx, dz] of offsets) {
      const x0 = base.x0 + dx;
      const z0 = base.z0 + dz;
      const r = rect(x0, z0, bp, facing);
      if (r[0] < ISLAND.minX || r[1] < ISLAND.minZ || r[2] > ISLAND.maxX || r[3] > ISLAND.maxZ) continue;
      // Not on top of the character itself, nor too close to another site.
      const [cx, , cz] = input.cell;
      if (cx >= r[0] && cx <= r[2] && cz >= r[1] && cz <= r[3]) continue;
      if (
        others.some((s) => {
          const sr = siteRect(s);
          return sr !== null && overlaps(r, sr);
        })
      ) {
        firstReason ||= 'too close to another building site';
        continue;
      }
      const lay = layoutSite(bp, x0, z0, facing, terrain);
      if (!lay.ok) {
        firstReason ||= lay.reason;
        continue;
      }
      const site: Site = {
        id: `${bp.id}@${x0},${z0}`,
        blueprint: bp.id,
        origin: lay.origin,
        facing,
        by: input.by,
        at: input.now,
        status: 'planned',
      };
      return { ok: true, site, ...(mine && mine.id !== site.id ? { replaced: mine } : {}) };
    }
  }
  const hint = bp.site === 'shore' ? ' — stand on the beach facing the sea' : ' — find a flatter, dry spot';
  return { ok: false, reason: `no room for a ${bp.id} here (${firstReason || 'no fitting spot'})${hint}` };
}

/** Commits a planned site to the shared list (cancelling the character's previous unfinished one). */
export function commitPlan(sites: Sites, r: Extract<PlanResult, { ok: true }>): void {
  if (r.replaced) sites.merge({ ...r.replaced, status: 'cancelled', at: r.site.at });
  sites.merge(r.site);
}

// ---- progress ----

const layoutCache = new Map<string, [number, number, number, Material][]>();

/** The site's blocks in world coordinates (cached per site id + origin). */
export function siteBlocks(site: Site, terrain: SiteTerrain): [number, number, number, Material][] {
  const key = `${site.id}|${site.origin.join(',')}|${site.facing}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const bp = blueprint(site.blueprint);
  if (!bp) return [];
  const lay = layoutSite(bp, site.origin[0], site.origin[2], site.facing, terrain);
  const blocks = lay.ok ? lay.blocks : [];
  if (layoutCache.size > 64) layoutCache.clear();
  layoutCache.set(key, blocks);
  return blocks;
}

export interface SiteProgress {
  done: number;
  total: number;
  /** Materials still to place, e.g. { log: 30, leaves: 12 }. */
  missing: Record<string, number>;
  /** A few next blocks to place (lowest first), for the brain. */
  next: { pos: [number, number, number]; block: Material }[];
}

/** How much of a site is already standing (any builder counts — characters and players). */
export function siteProgress(
  site: Site,
  terrain: SiteTerrain,
  blockAt: (x: number, y: number, z: number) => string,
  nextCount = 3,
): SiteProgress {
  const blocks = siteBlocks(site, terrain);
  const missing: Record<string, number> = {};
  const todo: { pos: [number, number, number]; block: Material }[] = [];
  let done = 0;
  for (const [x, y, z, m] of blocks) {
    if (blockAt(x, y, z) === m) {
      done++;
    } else {
      missing[m] = (missing[m] ?? 0) + 1;
      todo.push({ pos: [x, y, z], block: m });
    }
  }
  todo.sort((a, b) => a.pos[1] - b.pos[1]);
  return { done, total: blocks.length, missing, next: todo.slice(0, nextCount) };
}
