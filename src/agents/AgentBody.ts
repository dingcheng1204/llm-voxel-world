import * as THREE from 'three';
import { createBody, stepBody, type Body } from '../player/physics';
import type { CastMember } from './cast';

/** What a body needs from the world. The real World implements all of it. */
export interface AgentWorld {
  getBlock(x: number, y: number, z: number): number;
  isSolid(x: number, y: number, z: number): boolean;
  setBlock(x: number, y: number, z: number, id: number, by?: string): boolean;
  isLoaded(x: number, z: number): boolean;
}

/** Same for every species — the cast differs only in looks (agent-persona skill). */
export const AGENT_BODY = {
  halfWidth: 0.35,
  height: 0.95,
  eye: 0.8,
  walkSpeed: 2.2,
  gravity: 28,
  jump: 9,
  turnRate: 7,
} as const;

/**
 * The simulated body every character uses: same AABB physics as the player (`stepBody`),
 * steering and heading. No rendering here, so it also runs headless (tests, later the server).
 */
export class AgentBody {
  readonly body: Body;
  /** Feet position (kept in sync with `body` for convenience). */
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  heading = 0;
  prevHeading = 0;
  /** Horizontal speed this tick (m/s) — drives the walk animation. */
  speed = 0;
  /** Steering input set by the executor each tick. */
  private wishX = 0;
  private wishZ = 0;
  private wantJump = false;
  private faceTarget: number | null = null;

  constructor(
    readonly member: CastMember,
    spawn: { x: number; y: number; z: number },
  ) {
    this.body = createBody(spawn.x, spawn.y, spawn.z, AGENT_BODY.halfWidth, AGENT_BODY.height);
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.prevPos.copy(this.pos);
  }

  get id(): string {
    return this.member.id;
  }

  /** Feet cell. */
  get cell(): [number, number, number] {
    return [Math.floor(this.body.x), Math.floor(this.body.y + 0.01), Math.floor(this.body.z)];
  }

  eyePosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.body.x, this.body.y + AGENT_BODY.eye, this.body.z);
  }

  /** Walk in a direction (normalised x/z, or 0,0 to stop) this tick. */
  steer(x: number, z: number, jump = false): void {
    this.wishX = x;
    this.wishZ = z;
    this.wantJump = jump;
  }

  /** Turn to face a world point (used by look_at, mine, place). */
  faceTowards(x: number, z: number): void {
    this.faceTarget = Math.atan2(x - this.body.x, z - this.body.z);
  }

  tick(dt: number, world: AgentWorld): void {
    this.prevPos.copy(this.pos);
    this.prevHeading = this.heading;
    const b = this.body;
    if (!world.isLoaded(b.x, b.z)) return;

    const len = Math.hypot(this.wishX, this.wishZ);
    const tx = len > 0 ? (this.wishX / len) * AGENT_BODY.walkSpeed : 0;
    const tz = len > 0 ? (this.wishZ / len) * AGENT_BODY.walkSpeed : 0;
    const accel = 1 - Math.exp((b.onGround ? -14 : -4) * dt);
    b.vx += (tx - b.vx) * accel;
    b.vz += (tz - b.vz) * accel;
    if (this.wantJump && b.onGround) b.vy = AGENT_BODY.jump;
    b.vy = Math.max(b.vy - AGENT_BODY.gravity * dt, -50);
    stepBody(b, dt, (x, y, z) => world.isSolid(x, y, z));

    // Face the way we walk, or a requested target.
    const want = len > 0 ? Math.atan2(tx, tz) : this.faceTarget;
    if (want !== null) this.heading += clampAngle(want - this.heading, AGENT_BODY.turnRate * dt);
    if (len > 0) this.faceTarget = null;

    this.pos.set(b.x, b.y, b.z);
    this.speed = Math.hypot(this.pos.x - this.prevPos.x, this.pos.z - this.prevPos.z) / dt;
    this.wantJump = false;
  }
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function clampAngle(delta: number, max: number): number {
  const d = wrapAngle(delta);
  return Math.max(-max, Math.min(max, d));
}
