import { describe, expect, it } from 'vitest';
import { SEA_LEVEL } from '../world/coords';
import { footprint, type SiteTerrain } from '../world/blueprints';
import { commitPlan, lookDirection, MAX_ACTIVE_SITES, planSite, siteBlocks, siteProgress } from './building';
import { parseAgentResponse } from './actions';
import { parseSnapshot } from './snapshot';
import { Sites } from './worldState';

const flat: SiteTerrain = { heightAt: () => 24, seaLevel: SEA_LEVEL };
const base = { cell: [0, 25, 0] as [number, number, number], heading: 0, by: 'clio', now: 1000 };

describe('lookDirection', () => {
  it('snaps headings to the four directions (0 = south, π/2 = east)', () => {
    expect(lookDirection(0)).toBe('south');
    expect(lookDirection(Math.PI / 2)).toBe('east');
    expect(lookDirection(Math.PI)).toBe('north');
    expect(lookDirection(-Math.PI / 2)).toBe('west');
    expect(lookDirection(0.6)).toBe('south');
  });
});

describe('planSite', () => {
  it('marks the site out in front of the character, its front facing back at it', () => {
    const r = planSite({ ...base, blueprint: 'hut' }, flat, new Sites());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Looking south (+Z): the hut is south of the character and its door faces north.
    expect(r.site.facing).toBe('north');
    const [fw] = footprint({ w: 5, d: 5 }, 'north');
    expect(r.site.origin).toEqual([-Math.floor(fw / 2), 25, 2]);
    expect(r.site).toMatchObject({
      id: 'hut@-2,2',
      blueprint: 'hut',
      by: 'clio',
      status: 'planned',
      at: 1000,
    });
  });

  it('honours "at" and "facing"', () => {
    const r = planSite({ ...base, blueprint: 'garden', at: [20, 25, 20], facing: 'east' }, flat, new Sites());
    expect(r.ok && r.site.origin).toEqual([18, 25, 18]);
    expect(r.ok && r.site.facing).toBe('east');
  });

  it('moves away from other sites and replaces only the character’s own unfinished plan', () => {
    const sites = new Sites();
    const gem = planSite({ ...base, by: 'gem', blueprint: 'hut' }, flat, sites);
    if (!gem.ok) throw new Error(gem.reason);
    commitPlan(sites, gem);
    const clio = planSite({ ...base, blueprint: 'hut', now: 2000 }, flat, sites);
    if (!clio.ok) throw new Error(clio.reason);
    expect(clio.site.id).not.toBe(gem.site.id);
    expect(clio.replaced).toBeUndefined();
    commitPlan(sites, clio);
    const again = planSite({ ...base, blueprint: 'garden', at: [40, 25, 40], now: 3000 }, flat, sites);
    if (!again.ok) throw new Error(again.reason);
    expect(again.replaced?.id).toBe(clio.site.id);
    commitPlan(sites, again);
    expect(
      sites
        .active()
        .map((s) => s.by)
        .sort(),
    ).toEqual(['clio', 'gem']);
    expect(sites.get(clio.site.id)?.status).toBe('cancelled');
  });

  it('explains why a spot does not work', () => {
    const steep: SiteTerrain = {
      heightAt: (x, z) => 20 + Math.abs(x) * 3 + Math.abs(z) * 3,
      seaLevel: SEA_LEVEL,
    };
    const r = planSite({ ...base, blueprint: 'hut' }, steep, new Sites());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no room for a hut here .*flat/);
    const dock = planSite({ ...base, blueprint: 'dock' }, flat, new Sites());
    expect(!dock.ok && dock.reason).toMatch(/beach facing the sea/);
  });

  it('caps the number of sites on the island', () => {
    const sites = new Sites();
    for (let i = 0; i < MAX_ACTIVE_SITES; i++) {
      const r = planSite({ ...base, by: `a${i}`, blueprint: 'garden', at: [i * 20, 25, 0] }, flat, sites);
      if (!r.ok) throw new Error(r.reason);
      commitPlan(sites, r);
    }
    const r = planSite({ ...base, blueprint: 'garden', at: [80, 25, 80] }, flat, sites);
    expect(!r.ok && r.reason).toMatch(/help build one of them/);
  });
});

describe('siteProgress', () => {
  it('counts blocks already in place, lists what is missing and the lowest next blocks', () => {
    const r = planSite({ ...base, blueprint: 'garden' }, flat, new Sites());
    if (!r.ok) throw new Error(r.reason);
    const blocks = siteBlocks(r.site, flat);
    const placed = new Set(blocks.filter((b) => b[3] === 'stone').map((b) => b.slice(0, 3).join(',')));
    const p = siteProgress(r.site, flat, (x, y, z) => (placed.has(`${x},${y},${z}`) ? 'stone' : 'air'));
    expect(p).toMatchObject({ done: 12, total: 29, missing: { log: 4, leaves: 4, flower_grass: 9 } });
    expect(p.next).toHaveLength(3);
    expect(p.next.every((n) => n.pos[1] === 25)).toBe(true);
  });
});

describe('sites in snapshots and actions', () => {
  it('validates plan_build from a brain', () => {
    expect(
      parseAgentResponse({
        thought: 't',
        actions: [{ type: 'plan_build', blueprint: 'dock', facing: 'south' }],
      }).ok,
    ).toBe(true);
    expect(
      parseAgentResponse({ thought: 't', actions: [{ type: 'plan_build', blueprint: 'castle' }] }).ok,
    ).toBe(false);
  });

  it('keeps sites in the snapshot and merges newest-first', () => {
    const site = {
      id: 'hut@1,2',
      blueprint: 'hut',
      origin: [1, 25, 2],
      facing: 'south',
      by: 'gem',
      at: 5,
      status: 'planned',
    };
    const snap = parseSnapshot({ pos: [0, 30, 0], sites: [site] });
    expect(snap?.sites).toHaveLength(1);
    expect(parseSnapshot({ pos: [0, 30, 0], sites: [{ ...site, blueprint: 'Hut!' }] })).toBeNull();
    const sites = new Sites();
    sites.merge(snap!.sites[0]!);
    expect(sites.merge({ ...snap!.sites[0]!, status: 'cancelled', at: 4 })).toBe(false);
    expect(sites.merge({ ...snap!.sites[0]!, status: 'done', at: 6 })).toBe(true);
    expect(sites.get('hut@1,2')?.status).toBe('done');
    expect(sites.active()).toHaveLength(0);
  });
});
