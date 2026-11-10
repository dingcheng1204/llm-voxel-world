import * as THREE from 'three';
import type { CastMember } from './cast';
import { createModel, type CharacterModel } from './species';
import { createNameTag } from '../scene/nameTag';

/** Anything that can answer "how high is the ground here?" (the World). */
export interface Ground {
  groundY(x: number, z: number): number;
}

/**
 * The shared body every character uses. Abilities live here (move, turn, later: mine/place),
 * so a cat and a snake can do exactly the same things — only `model` differs.
 * Simulation runs on fixed ticks; the view interpolates between ticks.
 */
export class AgentBody {
  readonly view = new THREE.Group();
  readonly model: CharacterModel;
  readonly pos = new THREE.Vector3();
  private readonly prevPos = new THREE.Vector3();
  heading = 0;
  private prevHeading = 0;
  /** Current horizontal speed (m/s), used by the animation. */
  speed = 0;
  target: THREE.Vector3 | null = null;
  readonly walkSpeed = 1.7;
  private readonly turnRate = 5; // rad/s

  constructor(
    readonly member: CastMember,
    spawn: { x: number; y: number; z: number },
  ) {
    this.model = createModel(member.species);
    this.view.add(this.model.root);
    const tag = createNameTag(member.name, member.brain, member.tagColor);
    tag.position.y = member.species === 'snake' ? 1.15 : 1.75;
    this.view.add(tag);
    this.view.name = member.id;
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.prevPos.copy(this.pos);
  }

  /** Fixed-step simulation. */
  tick(dt: number, ground: Ground): void {
    this.prevPos.copy(this.pos);
    this.prevHeading = this.heading;
    let moving = false;
    if (this.target) {
      const dx = this.target.x - this.pos.x;
      const dz = this.target.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.15) {
        this.target = null;
      } else {
        const want = Math.atan2(dx, dz);
        this.heading += clampAngle(want - this.heading, this.turnRate * dt);
        const facing = Math.cos(want - this.heading); // slow down while turning
        const step = Math.min(dist, this.walkSpeed * dt * Math.max(0, facing));
        const nx = this.pos.x + Math.sin(this.heading) * step;
        const nz = this.pos.z + Math.cos(this.heading) * step;
        const gy = ground.groundY(nx, nz);
        if (gy - this.pos.y <= 1.01) {
          // can step up at most one block
          this.pos.x = nx;
          this.pos.z = nz;
          moving = step > 0;
        } else {
          this.target = null; // blocked: the brain will pick something else
        }
      }
    }
    // Follow the ground smoothly (fall / step up).
    const gy = ground.groundY(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 12);
    this.speed = moving ? this.walkSpeed : 0;
  }

  /** Per rendered frame. */
  render(alpha: number, time: number): void {
    this.view.position.lerpVectors(this.prevPos, this.pos, alpha);
    this.view.rotation.y = this.prevHeading + wrap(this.heading - this.prevHeading) * alpha;
    this.model.animate(time, this.speed);
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function clampAngle(delta: number, max: number): number {
  const d = wrap(delta);
  return Math.max(-max, Math.min(max, d));
}
