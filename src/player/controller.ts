import * as THREE from 'three';
import { B, BLOCKS } from '../world/blocks';
import { SEA_LEVEL } from '../world/coords';
import { raycastVoxel, type VoxelHit } from '../world/raycast';
import type { World } from '../world/world';
import { Hotbar } from './hotbar';
import { Input } from './input';
import { PLAYER, blockIntersectsBody, createBody, stepBody, type Body } from './physics';

const LOOK_SENSITIVITY = 0.0022;
const REACH = 5;
const REPEAT = 0.22; // seconds between repeated break/place while a button is held
const FLY_SPEED = 12;
const OCEAN_SURFACE = SEA_LEVEL + 0.82;

/** Anything else with a body that a placed block must not trap (the agents). */
export interface Occupant {
  pos: THREE.Vector3;
}

const hittable = (id: number) => id !== B.air && id !== B.water && id !== B.lava;

/**
 * First-person player: pointer-lock mouse look, WASD / jump / sprint / swim / fly,
 * break and place blocks with the hotbar. Physics runs on fixed ticks (shared `stepBody`),
 * the camera interpolates between ticks.
 */
export class PlayerController {
  readonly body: Body;
  private readonly prev = new THREE.Vector3();
  yaw = 0;
  pitch = -0.15;
  flying = false;
  inWater = false;
  target: VoxelHit | null = null;
  private repeatTimer = 0;
  private readonly selection: THREE.LineSegments;
  private readonly spawn: THREE.Vector3;
  private readonly dir = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();

  constructor(
    private readonly world: World,
    readonly input: Input,
    readonly hotbar: Hotbar,
    private readonly camera: THREE.PerspectiveCamera,
    spawn: { x: number; z: number },
    private readonly occupants: () => Occupant[] = () => [],
  ) {
    const y = world.groundY(spawn.x, spawn.z);
    this.spawn = new THREE.Vector3(spawn.x, y + 0.1, spawn.z);
    this.body = createBody(this.spawn.x, this.spawn.y, this.spawn.z);
    this.prev.copy(this.spawn);

    // Thin dark outline around the targeted block.
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.selection = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x1d1d2b, transparent: true, opacity: 0.55, fog: false }),
    );
    this.selection.visible = false;
    this.selection.renderOrder = 3;
  }

  private readonly feet = new THREE.Vector3();
  /** Feet position (for agents: "don't place a block inside the player", walk_to player later). */
  get bodyPos(): THREE.Vector3 {
    return this.feet.set(this.body.x, this.body.y, this.body.z);
  }

  get object(): THREE.Object3D {
    return this.selection;
  }

  /** Fixed-step simulation. */
  tick(dt: number): void {
    const b = this.body;
    this.prev.set(b.x, b.y, b.z);
    // Wait for the ground under us to exist before simulating (no falling through unloaded chunks).
    if (!this.world.isLoaded(b.x, b.z)) return;
    const k = this.input.keys;
    const presses = this.input.takePresses();
    this.hotbar.handle(presses, this.input.takeWheel());
    if (presses.includes('KeyF')) this.flying = !this.flying;

    // Wanted horizontal direction from WASD relative to where we look.
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side =
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let wx = -Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * side;
    let wz = -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * side;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) {
      wx /= wl;
      wz /= wl;
    }

    this.inWater = this.isInWater();
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    let speed = this.flying ? FLY_SPEED : sprint ? PLAYER.sprint : PLAYER.walk;
    if (this.inWater && !this.flying) speed *= 0.55;
    const accel = b.onGround || this.flying || this.inWater ? 1 - Math.exp(-18 * dt) : 1 - Math.exp(-5 * dt);
    b.vx += (wx * speed - b.vx) * accel;
    b.vz += (wz * speed - b.vz) * accel;

    const jump = k.has('Space');
    if (this.flying) {
      const up = (jump ? 1 : 0) - (k.has('KeyC') || k.has('ControlLeft') ? 1 : 0);
      b.vy += (up * FLY_SPEED - b.vy) * (1 - Math.exp(-12 * dt));
    } else if (this.inWater) {
      b.vy -= 6 * dt;
      if (jump) b.vy = Math.min(b.vy + 22 * dt, 3.5);
      b.vy = Math.max(b.vy, -3);
    } else {
      if (jump && b.onGround) b.vy = PLAYER.jump;
      b.vy = Math.max(b.vy - PLAYER.gravity * dt, -PLAYER.maxFall);
    }

    stepBody(b, dt, (x, y, z) => this.world.isSolid(x, y, z));
    if (b.y < -5) this.respawn();

    // Break / place: on click, and repeated while held.
    this.repeatTimer -= dt;
    const clickBreak = presses.includes('Mouse0');
    const clickPlace = presses.includes('Mouse2');
    const holdBreak = this.input.buttons.has(0) && this.repeatTimer <= 0;
    const holdPlace = this.input.buttons.has(2) && this.repeatTimer <= 0;
    if (clickBreak || holdBreak) {
      if (this.breakTarget()) this.repeatTimer = REPEAT;
    } else if (clickPlace || holdPlace) {
      if (this.placeTarget()) this.repeatTimer = REPEAT;
    }
  }

  /** Per rendered frame: mouse look, camera, block target and outline. */
  render(alpha: number): void {
    const [dx, dy] = this.input.takeLook();
    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * LOOK_SENSITIVITY));

    const b = this.body;
    this.camera.position.set(
      this.prev.x + (b.x - this.prev.x) * alpha,
      this.prev.y + (b.y - this.prev.y) * alpha + PLAYER.eye,
      this.prev.z + (b.z - this.prev.z) * alpha,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    this.updateTarget();
  }

  breakTarget(): boolean {
    this.updateTarget();
    const t = this.target;
    if (!t || !BLOCKS[t.id]?.breakable) return false;
    return this.world.setBlock(t.block[0], t.block[1], t.block[2], B.air);
  }

  placeTarget(): boolean {
    this.updateTarget();
    const t = this.target;
    if (!t) return false;
    const [x, y, z] = [t.block[0] + t.normal[0], t.block[1] + t.normal[1], t.block[2] + t.normal[2]];
    const here = this.world.getBlock(x, y, z);
    if (here !== B.air && here !== B.water && here !== B.fire) return false;
    const id = this.hotbar.current.id;
    if (BLOCKS[id]?.solid) {
      if (blockIntersectsBody(x, y, z, this.body)) return false;
      for (const o of this.occupants()) {
        const ob = createBody(o.pos.x, o.pos.y, o.pos.z, 0.4, 1.0);
        if (blockIntersectsBody(x, y, z, ob)) return false;
      }
    }
    return this.world.setBlock(x, y, z, id);
  }

  respawn(): void {
    const b = this.body;
    b.x = this.spawn.x;
    b.y = this.world.groundY(this.spawn.x, this.spawn.z) + 0.1;
    b.z = this.spawn.z;
    b.vx = b.vy = b.vz = 0;
    this.prev.set(b.x, b.y, b.z);
  }

  private updateTarget(): void {
    this.eye.set(this.body.x, this.body.y + PLAYER.eye, this.body.z);
    this.camera.getWorldDirection(this.dir);
    this.target = raycastVoxel(
      (x, y, z) => this.world.getBlock(x, y, z),
      hittable,
      this.eye,
      this.dir,
      REACH,
    );
    if (this.target) {
      const [x, y, z] = this.target.block;
      this.selection.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.selection.visible = true;
    } else {
      this.selection.visible = false;
    }
  }

  private isInWater(): boolean {
    const b = this.body;
    if (b.y + 0.6 < OCEAN_SURFACE) return true; // in the sea
    const fx = Math.floor(b.x);
    const fz = Math.floor(b.z);
    const id = this.world.getBlock(fx, Math.floor(b.y + 0.4), fz);
    return id === B.water;
  }
}
