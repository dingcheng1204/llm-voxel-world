// Builds the Perception JSON a brain receives each think (agent-persona skill §3).
// Small and summarised on purpose: it goes straight into an LLM prompt.

import * as THREE from 'three';
import { siteBlocks, siteProgress } from './building';
import { SEA_LEVEL } from '../world/coords';
import { B, BLOCKS, IS_SOLID } from '../world/blocks';
import { raycastVoxel } from '../world/raycast';
import type { ActionResult } from './actions';
import type { AgentBody, AgentWorld } from './AgentBody';
import type { ChatLog, Landmarks } from './worldState';

export const BLOCK_RADIUS = 8;
export const NEAREST_RADIUS = 16;
export const AGENT_RADIUS = 24;
export const LANDMARK_RADIUS = 96;

export interface Perception {
  time: { day: number; clock: string; phase: 'night' | 'dawn' | 'day' | 'dusk' };
  self: {
    id: string;
    pos: [number, number, number];
    /** Island area under the character (beach, plaza, forest, meadow, lake, mountain, volcano, grass). */
    area?: string;
    facing: string;
    inventory: Record<string, number>;
  };
  looking_at: { block: string; pos: [number, number, number]; dist: number } | null;
  /** Counts of visible (air-exposed) blocks within 8 blocks. */
  nearby_blocks: Record<string, number>;
  /** Nearest visible block of each kind within 16 blocks — positions the brain can walk to / mine. */
  nearest: Record<string, { pos: [number, number, number]; dist: number }>;
  landmarks: { name: string; pos: [number, number, number]; dist: number }[];
  /** Building sites still being built, nearest first (progress counts blocks already in place). */
  sites?: {
    id: string;
    blueprint: string;
    by: string;
    center: [number, number, number];
    facing: string;
    dist: number;
    progress: string;
    missing: Record<string, number>;
    next: { pos: [number, number, number]; block: string }[];
  }[];
  nearby_agents: { id: string; name?: string; pos: [number, number, number]; dist: number; doing: string }[];
  heard: { from: string; name?: string; to?: string; text: string; t: string }[];
  last_action_result: ActionResult | null;
  /** Conversation rules state (added server-side from the `messages` table; see chatRules.ts). */
  conversation?: {
    state: 'none' | 'active' | 'waiting_for_reply' | 'cooldown';
    with: string | null;
    exchanges: number;
    exchanges_left: number;
    quiet_for_s?: number;
    last_line?: { from: string; text: string; seconds_ago: number };
  };
}

export interface PerceiveContext {
  world: AgentWorld;
  landmarks: Landmarks;
  chat: ChatLog;
  clock: { day: number; clock: string; t: number };
  others(): { id: string; name?: string; pos: THREE.Vector3; doing: string }[];
  /** Sim time (s) — lines heard since `lastHeard` are reported. */
  now: number;
  /** Island area name at (x, z) — `world.terrain.biomeAt` in the game and on the server. */
  areaAt?(x: number, z: number): string;
}

/** Blocks not worth reporting (everywhere, or invisible). */
const BORING = new Set<number>([B.air, B.bedrock, B.dirt]);

const r1 = (v: number) => Math.round(v * 10) / 10;
const cellOf = (p: THREE.Vector3): [number, number, number] => [
  Math.floor(p.x),
  Math.floor(p.y + 0.01),
  Math.floor(p.z),
];

export function phaseOf(t: number): Perception['time']['phase'] {
  if (t < 0.22 || t >= 0.82) return 'night';
  if (t < 0.32) return 'dawn';
  if (t < 0.7) return 'day';
  return 'dusk';
}

export function compass(heading: number): string {
  // heading 0 = +Z (south), π/2 = +X (east)
  const names = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
  const i = Math.round(((((heading / (Math.PI * 2)) % 1) + 1) % 1) * 8) % 8;
  return names[i]!;
}

function exposed(w: AgentWorld, x: number, y: number, z: number): boolean {
  return (
    IS_SOLID[w.getBlock(x, y + 1, z)] === 0 ||
    IS_SOLID[w.getBlock(x + 1, y, z)] === 0 ||
    IS_SOLID[w.getBlock(x - 1, y, z)] === 0 ||
    IS_SOLID[w.getBlock(x, y, z + 1)] === 0 ||
    IS_SOLID[w.getBlock(x, y, z - 1)] === 0
  );
}

export function perceive(
  agent: AgentBody,
  inventory: Map<string, number>,
  lastResult: ActionResult | null,
  lastHeard: number,
  ctx: PerceiveContext,
): Perception {
  const w = ctx.world;
  const [px, py, pz] = agent.cell;

  // Blocks around: counts within 8, nearest of each kind within 16 (visible surfaces only).
  const counts: Record<string, number> = {};
  const nearest: Perception['nearest'] = {};
  for (let dz = -NEAREST_RADIUS; dz <= NEAREST_RADIUS; dz++) {
    for (let dx = -NEAREST_RADIUS; dx <= NEAREST_RADIUS; dx++) {
      const hd = Math.hypot(dx, dz);
      if (hd > NEAREST_RADIUS) continue;
      for (let dy = -4; dy <= 8; dy++) {
        const x = px + dx;
        const y = py + dy;
        const z = pz + dz;
        const id = w.getBlock(x, y, z);
        if (BORING.has(id)) continue;
        if (id !== B.water && id !== B.fire && !exposed(w, x, y, z)) continue;
        const name = BLOCKS[id]!.name;
        const d = Math.hypot(dx, dy, dz);
        if (d <= BLOCK_RADIUS) counts[name] = (counts[name] ?? 0) + 1;
        const prev = nearest[name];
        if (!prev || d < prev.dist) nearest[name] = { pos: [x, y, z], dist: r1(d) };
      }
    }
  }

  const eye = agent.eyePosition();
  const dir = new THREE.Vector3(Math.sin(agent.heading), -0.25, Math.cos(agent.heading));
  const hit = raycastVoxel(
    (a, b, c) => w.getBlock(a, b, c),
    (id) => id !== B.air && id !== B.water,
    eye,
    dir,
    6,
  );

  const pos = cellOf(agent.pos);
  const dist3 = (p: [number, number, number]) => r1(Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]));

  return {
    time: { day: ctx.clock.day, clock: ctx.clock.clock, phase: phaseOf(ctx.clock.t) },
    self: {
      id: agent.id,
      pos,
      ...(ctx.areaAt ? { area: ctx.areaAt(pos[0], pos[2]) } : {}),
      facing: compass(agent.heading),
      inventory: Object.fromEntries(inventory),
    },
    looking_at: hit ? { block: BLOCKS[hit.id]!.name, pos: hit.block, dist: r1(hit.distance) } : null,
    nearby_blocks: counts,
    nearest,
    landmarks: ctx.landmarks.list
      .map((l) => ({ name: l.name, pos: l.pos, dist: dist3(l.pos) }))
      .filter((l) => l.dist <= LANDMARK_RADIUS)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 8),
    ...sitesFor(ctx, dist3),
    nearby_agents: ctx
      .others()
      .filter((o) => o.id !== agent.id)
      .map((o) => ({
        id: o.id,
        ...(o.name && o.name !== o.id ? { name: o.name } : {}),
        pos: cellOf(o.pos),
        dist: dist3(cellOf(o.pos)),
        doing: o.doing,
      }))
      .filter((o) => o.dist <= AGENT_RADIUS)
      .sort((a, b) => a.dist - b.dist),
    heard: ctx.chat.heard(agent.id, pos, lastHeard).map((l) => ({
      from: l.from,
      ...(l.name && l.name !== l.from ? { name: l.name } : {}),
      ...(l.to ? { to: l.to } : {}),
      text: l.text,
      t: l.clock,
    })),
    last_action_result: lastResult,
  };
}

const SITE_RADIUS = 64;

/** Active building sites within reach of the senses (needs the terrain to lay them out). */
function sitesFor(
  ctx: PerceiveContext,
  dist3: (p: [number, number, number]) => number,
): Pick<Perception, 'sites'> {
  const terrain = ctx.world.terrain;
  const active = ctx.landmarks.sites.active();
  if (!terrain || active.length === 0) return {};
  const t = { heightAt: (x: number, z: number) => terrain.heightAt(x, z), seaLevel: SEA_LEVEL };
  const blockAt = (x: number, y: number, z: number) => BLOCKS[ctx.world.getBlock(x, y, z)]?.name ?? 'air';
  const out: NonNullable<Perception['sites']> = [];
  for (const s of active) {
    const blocks = siteBlocks(s, t);
    if (blocks.length === 0) continue;
    let sx = 0;
    let sz = 0;
    for (const [x, , z] of blocks) {
      sx += x;
      sz += z;
    }
    const center: [number, number, number] = [
      Math.round(sx / blocks.length),
      s.origin[1],
      Math.round(sz / blocks.length),
    ];
    const dist = dist3(center);
    if (dist > SITE_RADIUS) continue;
    const pr = siteProgress(s, t, blockAt);
    out.push({
      id: s.id,
      blueprint: s.blueprint,
      by: s.by,
      center,
      facing: s.facing,
      dist,
      progress: `${pr.done}/${pr.total}`,
      missing: pr.missing,
      next: pr.next,
    });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out.length ? { sites: out } : {};
}
