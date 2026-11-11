// Turns validated actions into body movement and world changes, one fixed tick at a time.
// Every action ends with an ActionResult that is fed back to the brain next think.

import * as THREE from 'three';
import { B, BLOCKS, IS_SOLID } from '../world/blocks';
import { raycastVoxel } from '../world/raycast';
import { blockIntersectsBody, createBody } from '../player/physics';
import type { Action, ActionResult, ActionType } from './actions';
import { AGENT_BODY, type AgentBody, type AgentWorld } from './AgentBody';
import { findPath, groundCell, standable, type Cell } from './pathfinding';
import type { Landmarks } from './worldState';
import { SEA_LEVEL } from '../world/coords';
import { commitPlan, planSite } from './building';

export const REACH = 5;
const MINE_TIME = 0.6;
const PLACE_TIME = 0.3;

export interface ExecutorContext {
  world: AgentWorld;
  landmarks: Landmarks;
  /** Other characters (and the player) — for walk_to/follow agent and "don't place a block inside someone". */
  bodies(): { id: string; pos: THREE.Vector3; halfWidth: number; height: number }[];
}

type Running =
  | {
      a: Extract<Action, { type: 'walk_to' }>;
      path: Cell[];
      i: number;
      goal: Cell;
      near: number;
      repaths: number;
      best: number;
      stall: number;
      timeLeft: number;
      agentT: number;
    }
  | { a: Extract<Action, { type: 'follow' }>; path: Cell[]; i: number; timeLeft: number; agentT: number }
  | {
      a: Extract<
        Action,
        { type: 'mine' | 'place' | 'look_at' | 'wait' | 'idle' | 'name_place' | 'plan_build' }
      >;
      timer: number;
    };

type Timed<T extends ActionType> = { a: Extract<Action, { type: T }>; timer: number };

const VERB: Record<ActionType, string> = {
  walk_to: 'walking',
  look_at: 'looking',
  mine: 'mining',
  place: 'building',
  follow: 'following',
  name_place: 'naming a place',
  plan_build: 'planning a building',
  wait: 'waiting',
  idle: 'idle',
};

export class ActionExecutor {
  private queue: Action[] = [];
  private cur: Running | null = null;
  readonly inventory = new Map<string, number>();
  lastResult: ActionResult | null = null;
  /** Current path (for the debug view). */
  path: Cell[] = [];
  /** Called after every finished action (logging / events). */
  onResult: (r: ActionResult, a: Action) => void = () => {};

  constructor(
    private readonly body: AgentBody,
    private readonly ctx: ExecutorContext,
  ) {}

  get busy(): boolean {
    return this.cur !== null || this.queue.length > 0;
  }

  /** What the character is doing, for perception of others ("doing": "mining"). */
  get doing(): string {
    return this.cur ? VERB[this.cur.a.type] : 'idle';
  }

  get current(): Action | null {
    return this.cur?.a ?? null;
  }

  enqueue(actions: Action[]): void {
    this.queue.push(...actions);
  }

  clear(): void {
    this.queue = [];
    this.cur = null;
    this.path = [];
    this.body.steer(0, 0);
  }

  tick(dt: number): void {
    if (!this.cur) {
      const next = this.queue.shift();
      if (!next) {
        this.body.steer(0, 0);
        return;
      }
      this.start(next);
      if (!this.cur) return; // finished instantly (e.g. failed validation)
    }
    this.step(dt);
  }

  private finish(ok: boolean, reason?: string): void {
    const a = this.cur!.a;
    this.cur = null;
    this.path = [];
    this.body.steer(0, 0);
    const r: ActionResult = { action: a.type, ok, ...(reason ? { reason } : {}) };
    this.lastResult = r;
    // A failure cancels the rest of the plan: the brain should rethink with the new situation.
    if (!ok) this.queue = [];
    this.onResult(r, a);
  }

  private start(a: Action): void {
    switch (a.type) {
      case 'walk_to': {
        let goal: Cell | null = null;
        let near = 0;
        if (a.target) {
          const [x, y, z] = a.target;
          if (standable(this.ctx.world, x, y, z)) goal = [x, y, z];
          else {
            goal = [x, y, z];
            near = 1.5; // a block, not a floor cell: stand next to it
          }
        } else if (a.agent) {
          const other = this.ctx.bodies().find((b) => b.id === a.agent);
          if (!other) return this.fail(a, `no one called ${a.agent}`);
          goal = [Math.floor(other.pos.x), Math.floor(other.pos.y + 0.01), Math.floor(other.pos.z)];
          near = 1.5;
        } else if (a.landmark) {
          const l = this.ctx.landmarks.find(a.landmark);
          if (!l) return this.fail(a, `unknown place "${a.landmark}"`);
          goal = l.pos;
          near = 1;
        }
        if (!goal) return this.fail(a, 'no destination');
        this.cur = {
          a,
          path: [],
          i: 0,
          goal,
          near,
          repaths: 0,
          best: Infinity,
          stall: 0,
          timeLeft: 0,
          agentT: 0,
        };
        if (!this.plan()) return this.finish(false, 'no path');
        return;
      }
      case 'follow':
        if (!this.ctx.bodies().some((b) => b.id === a.agent)) return this.fail(a, `no one called ${a.agent}`);
        this.cur = { a, path: [], i: 0, timeLeft: a.seconds, agentT: 0 };
        return;
      case 'mine':
      case 'place':
      case 'look_at': {
        const [x, y, z] = a.target;
        this.body.faceTowards(x + 0.5, z + 0.5);
        this.cur = { a, timer: a.type === 'mine' ? MINE_TIME : a.type === 'place' ? PLACE_TIME : 0.3 };
        const err =
          a.type === 'mine'
            ? this.checkMine(x, y, z)
            : a.type === 'place'
              ? this.checkPlace(x, y, z, a.block)
              : null;
        if (err) this.finish(false, err);
        return;
      }
      case 'wait':
        this.cur = { a, timer: a.seconds };
        return;
      case 'idle':
        this.cur = { a, timer: 1 };
        return;
      case 'name_place': {
        this.ctx.landmarks.add(a.name, this.body.cell, this.body.id);
        this.cur = { a, timer: 0 };
        this.finish(true);
        return;
      }
      case 'plan_build': {
        const terrain = this.ctx.world.terrain;
        if (!terrain) return this.fail(a, 'cannot plan buildings here');
        const r = planSite(
          {
            blueprint: a.blueprint,
            cell: this.body.cell,
            heading: this.body.heading,
            at: a.at,
            facing: a.facing,
            by: this.body.id,
            now: Date.now(),
          },
          { heightAt: (x, z) => terrain.heightAt(x, z), seaLevel: SEA_LEVEL },
          this.ctx.landmarks.sites,
        );
        if (!r.ok) return this.fail(a, r.reason);
        commitPlan(this.ctx.landmarks.sites, r);
        this.cur = { a, timer: 0 };
        this.finish(true);
        return;
      }
    }
  }

  private fail(a: Action, reason: string): void {
    this.cur = { a, timer: 0 } as Running;
    this.finish(false, reason);
  }

  /** (Re)compute the path for walk_to. */
  private plan(): boolean {
    const c = this.cur;
    if (!c || c.a.type !== 'walk_to') return false;
    const r = c as Extract<Running, { a: { type: 'walk_to' } }>;
    const start = this.startCell();
    if (!start) return false;
    const res = findPath(this.ctx.world, start, r.goal, { near: r.near, allowPartial: true, maxNodes: 8000 });
    if (!res) return false;
    r.path = res.path;
    r.i = Math.min(1, res.path.length - 1);
    r.best = Infinity;
    r.stall = 0;
    r.timeLeft = 6 + res.path.length * 1.2;
    this.path = res.path;
    return true;
  }

  private startCell(): Cell | null {
    const [x, y, z] = this.body.cell;
    if (standable(this.ctx.world, x, y, z)) return [x, y, z];
    return groundCell(this.ctx.world, x, z, y + 1);
  }

  private step(dt: number): void {
    const c = this.cur!;
    switch (c.a.type) {
      case 'walk_to': {
        const r = c as Extract<Running, { a: { type: 'walk_to' } }>;
        // Moving targets (another agent): refresh the goal now and then.
        if (r.a.agent) {
          r.agentT -= dt;
          if (r.agentT <= 0) {
            r.agentT = 1.5;
            const other = this.ctx.bodies().find((b) => b.id === r.a.agent);
            if (other)
              r.goal = [Math.floor(other.pos.x), Math.floor(other.pos.y + 0.01), Math.floor(other.pos.z)];
          }
        }
        const done = this.followPath(r, dt);
        if (done === 'arrived') {
          const last = r.path.at(-1);
          const reached =
            last && Math.hypot(last[0] - r.goal[0], last[2] - r.goal[2]) <= Math.max(r.near, 0.5) + 0.01;
          this.finish(Boolean(reached), reached ? undefined : 'could only get partway there');
        } else if (done === 'stuck') {
          if (r.repaths++ < 3 && this.plan()) return;
          this.finish(false, 'stuck');
        }
        r.timeLeft -= dt;
        if (this.cur === c && r.timeLeft <= 0) this.finish(false, 'took too long');
        return;
      }
      case 'follow': {
        const r = c as Extract<Running, { a: { type: 'follow' } }>;
        r.timeLeft -= dt;
        if (r.timeLeft <= 0) return this.finish(true);
        r.agentT -= dt;
        const other = this.ctx.bodies().find((b) => b.id === r.a.agent);
        if (!other) return this.finish(false, `${r.a.agent} is gone`);
        const dist = Math.hypot(other.pos.x - this.body.pos.x, other.pos.z - this.body.pos.z);
        if (dist < 2) {
          this.body.steer(0, 0);
          this.body.faceTowards(other.pos.x, other.pos.z);
          return;
        }
        if (r.agentT <= 0 || r.i >= r.path.length) {
          r.agentT = 1;
          const start = this.startCell();
          const goal: Cell = [
            Math.floor(other.pos.x),
            Math.floor(other.pos.y + 0.01),
            Math.floor(other.pos.z),
          ];
          const res =
            start && findPath(this.ctx.world, start, goal, { near: 1.5, allowPartial: true, maxNodes: 4000 });
          r.path = res ? res.path : [];
          r.i = Math.min(1, r.path.length - 1);
          this.path = r.path;
        }
        this.followPath(r, dt);
        return;
      }
      case 'mine': {
        const t = c as Timed<'mine'>;
        t.timer -= dt;
        if (t.timer > 0) return;
        const [x, y, z] = t.a.target;
        const err = this.checkMine(x, y, z);
        if (err) return this.finish(false, err);
        const id = this.ctx.world.getBlock(x, y, z);
        this.ctx.world.setBlock(x, y, z, B.air, this.body.id);
        if (id !== B.fire) {
          const name = BLOCKS[id]!.name;
          this.inventory.set(name, (this.inventory.get(name) ?? 0) + 1);
        }
        return this.finish(true);
      }
      case 'place': {
        const t = c as Timed<'place'>;
        t.timer -= dt;
        if (t.timer > 0) return;
        const [x, y, z] = t.a.target;
        const block = t.a.block;
        const err = this.checkPlace(x, y, z, block);
        if (err) return this.finish(false, err);
        const id = BLOCKS.find((b) => b.name === block)!.id;
        this.ctx.world.setBlock(x, y, z, id, this.body.id);
        const left = (this.inventory.get(block) ?? 0) - 1;
        if (left > 0) this.inventory.set(block, left);
        else this.inventory.delete(block);
        return this.finish(true);
      }
      case 'look_at':
      case 'wait':
      case 'idle': {
        const t = c as Timed<'look_at' | 'wait' | 'idle'>;
        t.timer -= dt;
        if (t.timer <= 0) this.finish(true);
        return;
      }
      case 'name_place':
      case 'plan_build':
        return;
    }
  }

  /** Steer along the current path. */
  private followPath(
    r: { path: Cell[]; i: number; best?: number; stall?: number },
    dt: number,
  ): 'moving' | 'arrived' | 'stuck' {
    const b = this.body.body;
    if (r.path.length === 0 || r.i >= r.path.length) {
      this.body.steer(0, 0);
      return 'arrived';
    }
    const wp = r.path[r.i]!;
    const tx = wp[0] + 0.5;
    const tz = wp[2] + 0.5;
    const dx = tx - b.x;
    const dz = tz - b.z;
    const dist = Math.hypot(dx, dz);
    const dy = wp[1] - b.y;
    if (dist < 0.3 && dy > -1.5 && dy < 0.6) {
      r.i++;
      r.best = Infinity;
      r.stall = 0;
      return r.i >= r.path.length ? 'arrived' : 'moving';
    }
    // Jump when the next cell is a step up and we are close to it.
    const jump = dy > 0.4 && dist < 1.3;
    this.body.steer(dx / Math.max(dist, 1e-3), dz / Math.max(dist, 1e-3), jump);
    // Stall detection: no progress towards this waypoint for 2 s.
    if (r.best !== undefined && r.stall !== undefined) {
      if (dist < r.best - 0.05) {
        r.best = dist;
        r.stall = 0;
      } else if ((r.stall += dt) > 2) {
        return 'stuck';
      }
    }
    return 'moving';
  }

  private reachOk(x: number, y: number, z: number): string | null {
    const eye = this.body.eyePosition();
    const d = Math.hypot(x + 0.5 - eye.x, y + 0.5 - eye.y, z + 0.5 - eye.z);
    return d > REACH + 0.5 ? `out of reach (${d.toFixed(1)} blocks away, reach is ${REACH})` : null;
  }

  private checkMine(x: number, y: number, z: number): string | null {
    const w = this.ctx.world;
    const id = w.getBlock(x, y, z);
    if (id === B.air || id === B.water || id === B.lava) return 'nothing to mine there';
    if (!BLOCKS[id]?.breakable) return `${BLOCKS[id]?.name ?? 'that'} cannot be mined`;
    const far = this.reachOk(x, y, z);
    if (far) return far;
    // Must be visible: the first block hit on the line of sight is the target.
    const eye = this.body.eyePosition();
    const dir = new THREE.Vector3(x + 0.5 - eye.x, y + 0.5 - eye.y, z + 0.5 - eye.z);
    // See-through: air, water and fire (unless the fire itself is the target).
    const sees = (v: number) => v !== B.air && v !== B.water && (v !== B.fire || id === B.fire);
    const hit = raycastVoxel((a, b2, c) => w.getBlock(a, b2, c), sees, eye, dir, REACH + 1);
    if (!hit || hit.block[0] !== x || hit.block[1] !== y || hit.block[2] !== z)
      return 'cannot see that block from here';
    return null;
  }

  private checkPlace(x: number, y: number, z: number, block: string): string | null {
    const w = this.ctx.world;
    if ((this.inventory.get(block) ?? 0) <= 0) return `no ${block} in inventory`;
    const here = w.getBlock(x, y, z);
    if (here !== B.air && here !== B.water && here !== B.fire) return 'that spot is not empty';
    const far = this.reachOk(x, y, z);
    if (far) return far;
    const supported = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ].some(([dx, dy, dz]) => IS_SOLID[w.getBlock(x + dx!, y + dy!, z + dz!)] === 1);
    if (!supported) return 'blocks must touch another block';
    const def = BLOCKS.find((b) => b.name === block);
    if (def?.solid) {
      const self = {
        id: this.body.id,
        pos: this.body.pos,
        halfWidth: AGENT_BODY.halfWidth,
        height: AGENT_BODY.height,
      };
      for (const o of [self, ...this.ctx.bodies()]) {
        if (blockIntersectsBody(x, y, z, createBody(o.pos.x, o.pos.y, o.pos.z, o.halfWidth, o.height)))
          return o.id === this.body.id ? 'would place it inside myself' : `${o.id} is standing there`;
      }
    }
    return null;
  }
}
