import * as THREE from 'three';
import { createModel, type CharacterModel, type PlayerSpecies } from '../agents/species';
import { lowPolyMaterial, painted } from '../scene/lowpoly';
import { B, BLOCKS } from '../world/blocks';
import { SEA_LEVEL } from '../world/coords';
import { raycastVoxel, type VoxelHit } from '../world/raycast';
import type { World } from '../world/world';
import { COMBAT, fallDamage, pickTarget, Vitals, type DamageResult, type Mode } from './combat';
import { Hotbar } from './hotbar';
import { Input } from './input';
import { dropOf, labelOf } from './inventory';
import { PLAYER, blockIntersectsBody, createBody, overlapsSolid, stepBody, type Body } from './physics';

const LOOK_SENSITIVITY = 0.0022;
const REACH = 5;
const REPEAT = 0.22; // seconds between repeated break/place while a button is held
const FLY_SPEED = 12;
const OCEAN_SURFACE = SEA_LEVEL + 0.82;
/** Third-person camera distance behind the head, and how high above the feet it looks from. */
const CAM_DIST = 4.2;
const CAM_HEAD = 1.5;
/** Over-the-shoulder: the camera sits a little to the right so your animal doesn't hide the crosshair. */
const CAM_SHOULDER = 0.75;

/** Anything else with a body that a placed block must not trap (the agents). */
export interface Occupant {
  pos: THREE.Vector3;
}

/** Something the player can hit in combat mode (a monster, another player). */
export interface Hittable {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Apply a hit from the player standing at (fromX, fromZ). */
  hit(damage: number, fromX: number, fromZ: number): void;
}

export type CameraView = 'first' | 'third';

const hittable = (id: number) => id !== B.air && id !== B.water && id !== B.lava;

/**
 * The player: pointer-lock mouse look, WASD / jump / sprint / swim / fly, a first- or third-person
 * camera (V), an inventory-backed hotbar, and two modes (R): build (mine/place) and combat
 * (attack/guard/dodge). Physics runs on fixed ticks (shared `stepBody`), the camera interpolates.
 */
export class PlayerController {
  readonly body: Body;
  private readonly prev = new THREE.Vector3();
  yaw = 0;
  pitch = -0.15;
  flying = false;
  inWater = false;
  target: VoxelHit | null = null;
  mode: Mode = 'build';
  view: CameraView = 'third';
  readonly vitals = new Vitals();
  /** Increments on every swing (other players see the animation). */
  swings = 0;
  /** Called when the player dies (main shows the death screen). */
  onDeath: (cause: string) => void = () => {};
  /** Called when mode or camera changes (HUD, touch buttons). */
  onModeChange: () => void = () => {};
  /** Called after a swing lands on a target. */
  onHitLanded: (target: Hittable) => void = () => {};
  /** Called on damage taken (screen flash). */
  onHurt: (r: DamageResult) => void = () => {};
  /** Called when a block is mined or placed (unsaved changes). */
  onInventoryUse: () => void = () => {};

  private repeatTimer = 0;
  private attackTimer = 0;
  private dodgeTimer = 0;
  private dodgeCooldown = 0;
  private readonly dodgeDir = { x: 0, z: 0 };
  private swingAnim = 0;
  private fallStart: number | null = null;
  private hazardTimer = 0;
  private lastCause = '';
  private readonly selection: THREE.LineSegments;
  private readonly group = new THREE.Group();
  /** Your own animal (seen in third person). */
  private avatar: { species: PlayerSpecies; model: CharacterModel; pivot: THREE.Group } | null = null;
  private readonly shield: THREE.Mesh;
  private readonly spawn: THREE.Vector3;
  private readonly dir = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private camDist = CAM_DIST;
  private renderSpeed = 0;
  private readonly lastRender = new THREE.Vector3();

  constructor(
    private readonly world: World,
    readonly input: Input,
    readonly hotbar: Hotbar,
    private readonly camera: THREE.PerspectiveCamera,
    spawn: { x: number; z: number },
    private readonly occupants: () => Occupant[] = () => [],
    private readonly targets: () => Hittable[] = () => [],
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
    // A round wooden shield, shown in front of the animal while guarding.
    const disc = new THREE.CylinderGeometry(0.34, 0.34, 0.07, 9);
    disc.rotateX(Math.PI / 2);
    this.shield = new THREE.Mesh(painted(disc, 0xd9a35f, 0.1), lowPolyMaterial());
    this.shield.position.set(0, 0.55, 0.62);
    this.shield.visible = false;
    this.group.add(this.selection);
  }

  private readonly feet = new THREE.Vector3();
  /** Feet position (for agents: "don't place a block inside the player", walk_to player later). */
  get bodyPos(): THREE.Vector3 {
    return this.feet.set(this.body.x, this.body.y, this.body.z);
  }

  /** Add to the scene once: selection outline + your animal. */
  get object(): THREE.Object3D {
    return this.group;
  }

  get dead(): boolean {
    return this.vitals.dead;
  }

  get guarding(): boolean {
    return this.vitals.guarding;
  }

  get spawnPoint(): THREE.Vector3 {
    return this.spawn;
  }

  /** Show this animal as you (third person). */
  setSpecies(species: PlayerSpecies): void {
    if (this.avatar?.species === species) return;
    if (this.avatar) {
      this.group.remove(this.avatar.pivot);
      this.avatar.model.dispose();
    }
    const model = createModel(species);
    const pivot = new THREE.Group();
    pivot.add(model.root, this.shield);
    this.group.add(pivot);
    this.avatar = { species, model, pivot };
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.vitals.guarding = false;
    if (mode === 'combat') this.flying = false;
    this.hotbar.flash(
      mode === 'combat' ? '⚔️ 戰鬥模式：左鍵攻擊、右鍵防禦、Q 閃避' : '🔨 一般模式：挖和放方塊',
    );
    this.onModeChange();
  }

  setView(view: CameraView): void {
    if (view === this.view) return;
    this.view = view;
    this.onModeChange();
  }

  /** Put the player somewhere (loading a save). Moves up out of blocks placed there since. */
  teleport(x: number, y: number, z: number, yaw?: number): void {
    const b = this.body;
    b.x = x;
    b.y = y;
    b.z = z;
    b.vx = b.vy = b.vz = 0;
    if (yaw !== undefined && Number.isFinite(yaw)) this.yaw = yaw;
    if (this.world.isLoaded(x, z)) this.unstick();
    else this.needsUnstick = true;
    this.prev.set(b.x, b.y, b.z);
    this.fallStart = null;
  }
  private needsUnstick = false;

  private unstick(): void {
    const b = this.body;
    const solid = (x: number, y: number, z: number) => this.world.isSolid(x, y, z);
    for (let i = 0; i < 64 && overlapsSolid(b, solid); i++) b.y = Math.floor(b.y) + 1.01;
    this.needsUnstick = false;
  }

  /** Fixed-step simulation. */
  tick(dt: number): void {
    const b = this.body;
    this.prev.set(b.x, b.y, b.z);
    // Wait for the ground under us to exist before simulating (no falling through unloaded chunks).
    if (!this.world.isLoaded(b.x, b.z)) return;
    if (this.needsUnstick) this.unstick();
    const k = this.input.keys;
    const presses = this.input.takePresses();
    this.vitals.tick(dt);
    this.attackTimer -= dt;
    this.dodgeCooldown -= dt;
    this.swingAnim = Math.max(0, this.swingAnim - dt);

    if (this.dead) {
      b.vx *= 0.8;
      b.vz *= 0.8;
      b.vy = Math.max(b.vy - PLAYER.gravity * dt, -PLAYER.maxFall);
      stepBody(b, dt, (x, y, z) => this.world.isSolid(x, y, z));
      return;
    }

    this.hotbar.handle(presses, this.input.takeWheel());
    if (presses.includes('KeyR')) this.setMode(this.mode === 'build' ? 'combat' : 'build');
    if (presses.includes('KeyV')) this.setView(this.view === 'first' ? 'third' : 'first');
    if (presses.includes('KeyF')) {
      if (this.mode === 'combat') this.hotbar.flash('戰鬥模式不能飛（按 R 回一般模式）');
      else this.flying = !this.flying;
    }
    const combat = this.mode === 'combat';
    this.vitals.guarding = combat && this.input.buttons.has(2) && this.vitals.stamina > 0;

    // Wanted horizontal direction from WASD relative to where we look.
    // Keys give full speed; the touch joystick adds an analog amount (a light push walks slowly).
    const m = this.input.move;
    const fwd =
      (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + m.fwd;
    const side =
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + m.side;
    let wx = -Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * side;
    let wz = -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * side;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }

    // Dodge (combat mode, Q): a short dash where you're steering (backwards if standing still).
    if (combat && presses.includes('KeyQ') && this.dodgeCooldown <= 0 && !this.vitals.guarding) {
      if (this.vitals.spend(COMBAT.dodgeStamina)) {
        const l = Math.hypot(wx, wz);
        this.dodgeDir.x = l > 0.1 ? wx / l : Math.sin(this.yaw);
        this.dodgeDir.z = l > 0.1 ? wz / l : Math.cos(this.yaw);
        this.dodgeTimer = COMBAT.dodgeTime;
        this.dodgeCooldown = COMBAT.dodgeCooldown;
        this.vitals.dodgeInvuln = COMBAT.dodgeInvuln;
      } else {
        this.hotbar.flash('體力不夠');
      }
    }

    this.inWater = this.isInWater();
    // Joystick pushed all the way = sprint.
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight') || Math.hypot(m.fwd, m.side) > 0.97;
    let speed = this.flying ? FLY_SPEED : sprint && !this.vitals.guarding ? PLAYER.sprint : PLAYER.walk;
    if (this.vitals.guarding) speed *= COMBAT.guardSlow;
    if (this.inWater && !this.flying) speed *= 0.55;
    const accel = b.onGround || this.flying || this.inWater ? 1 - Math.exp(-18 * dt) : 1 - Math.exp(-5 * dt);
    if (this.dodgeTimer > 0) {
      this.dodgeTimer -= dt;
      b.vx = this.dodgeDir.x * COMBAT.dodgeSpeed;
      b.vz = this.dodgeDir.z * COMBAT.dodgeSpeed;
    } else {
      b.vx += (wx * speed - b.vx) * accel;
      b.vz += (wz * speed - b.vz) * accel;
    }

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
    this.environment(dt);
    if (b.y < -5) {
      this.hurt(COMBAT.maxHp, { from: null, environment: true }, '掉出世界');
      if (!this.dead) this.respawn();
    }

    this.repeatTimer -= dt;
    if (combat) {
      // Attack: on click, and repeated (at the attack cooldown) while held.
      if ((presses.includes('Mouse0') || this.input.buttons.has(0)) && !this.vitals.guarding) this.attack();
    } else {
      // Break / place: on click, and repeated while held.
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
  }

  /** Fall damage, lava and fire. */
  private environment(dt: number): void {
    const b = this.body;
    // Falls: remember where a fall started; landing hurts if it was long. Water and flying reset it.
    if (this.flying || this.inWater) this.fallStart = null;
    else if (!b.onGround) {
      if (this.fallStart === null || b.y > this.fallStart) this.fallStart = b.y;
    } else if (this.fallStart !== null) {
      const dmg = fallDamage(this.fallStart - b.y);
      this.fallStart = null;
      if (dmg > 0) this.hurt(dmg, { from: null, environment: true }, '摔傷');
    }
    // Standing in lava or fire burns (checked a few times a second).
    this.hazardTimer -= dt;
    if (this.hazardTimer > 0) return;
    this.hazardTimer = 0.25;
    const ids = [
      this.world.getBlock(Math.floor(b.x), Math.floor(b.y + 0.1), Math.floor(b.z)),
      this.world.getBlock(Math.floor(b.x), Math.floor(b.y + 1), Math.floor(b.z)),
    ];
    if (ids.includes(B.lava)) this.hurt(COMBAT.lavaDps / 4, { from: null, environment: true }, '掉進岩漿');
    else if (ids.includes(B.fire)) this.hurt(COMBAT.fireDps / 4, { from: null, environment: true }, '被火燒');
  }

  /** Damage from anything (monster, player, environment). `cause` is shown on the death screen. */
  hurt(amount: number, src: { from: { x: number; z: number } | null; environment?: boolean }, cause: string) {
    const b = this.body;
    const r = this.vitals.damage(amount, src, b, this.yaw);
    if (r.dealt > 0 && src.from) {
      const dx = b.x - src.from.x;
      const dz = b.z - src.from.z;
      const l = Math.hypot(dx, dz) || 1;
      const kb = COMBAT.knockback * (r.blocked ? 0.4 : 1);
      b.vx = (dx / l) * kb;
      b.vz = (dz / l) * kb;
      if (!this.flying) b.vy = Math.max(b.vy, 4);
    }
    if (r.dealt > 0 || r.blocked || r.dodged) this.onHurt(r);
    if (r.died) {
      this.lastCause = cause;
      this.flying = false;
      this.vitals.guarding = false;
      this.selection.visible = false;
      this.onDeath(cause);
    }
    return r;
  }

  get deathCause(): string {
    return this.lastCause;
  }

  private attack(): void {
    if (this.attackTimer > 0) return;
    this.attackTimer = COMBAT.attackCooldown;
    this.swings++;
    this.swingAnim = 0.25;
    const b = this.body;
    const t = pickTarget(b, this.yaw, this.targets());
    if (!t) return;
    t.hit(COMBAT.attackDamage, b.x, b.z);
    this.onHitLanded(t);
  }

  /** Per rendered frame: mouse look, camera, block target and outline, the animal. */
  render(alpha: number, time = 0, frameDt = 1 / 60): void {
    const [dx, dy] = this.input.takeLook();
    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * LOOK_SENSITIVITY));

    const b = this.body;
    const fx = this.prev.x + (b.x - this.prev.x) * alpha;
    const fy = this.prev.y + (b.y - this.prev.y) * alpha;
    const fz = this.prev.z + (b.z - this.prev.z) * alpha;
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.view === 'first') {
      this.camera.position.set(fx, fy + PLAYER.eye, fz);
    } else {
      // Behind the head along the look direction, pulled in where a block is in the way.
      this.camera.getWorldDirection(this.dir);
      // Shoulder point: right of the head (camera right = (cos yaw, 0, −sin yaw)), unless a block is there.
      let sh = CAM_SHOULDER;
      for (; sh > 0; sh -= 0.25) {
        const x = fx + Math.cos(this.yaw) * sh;
        const z = fz - Math.sin(this.yaw) * sh;
        if (!this.world.isSolid(Math.floor(x), Math.floor(fy + CAM_HEAD), Math.floor(z))) break;
      }
      sh = Math.max(0, sh);
      const hx = fx + Math.cos(this.yaw) * sh;
      const hy = fy + CAM_HEAD;
      const hz = fz - Math.sin(this.yaw) * sh;
      let free = CAM_DIST;
      for (let d = 0.3; d <= CAM_DIST; d += 0.2) {
        const x = hx - this.dir.x * d;
        const y = hy - this.dir.y * d;
        const z = hz - this.dir.z * d;
        if (this.world.isSolid(Math.floor(x), Math.floor(y), Math.floor(z))) {
          free = Math.max(0.3, d - 0.35);
          break;
        }
      }
      // Pull in at once, ease back out.
      this.camDist =
        free < this.camDist ? free : this.camDist + (free - this.camDist) * (1 - Math.exp(-6 * frameDt));
      this.camPos.set(
        hx - this.dir.x * this.camDist,
        hy - this.dir.y * this.camDist,
        hz - this.dir.z * this.camDist,
      );
      this.camera.position.copy(this.camPos);
    }

    // Your animal: hidden in first person (and when the camera is pressed against it).
    if (this.avatar) {
      const show = this.view === 'third' && this.camDist > 0.9;
      const pv = this.avatar.pivot;
      pv.visible = show;
      if (show) {
        const moved = Math.hypot(fx - this.lastRender.x, fz - this.lastRender.z) / Math.max(frameDt, 1e-3);
        this.renderSpeed += (Math.min(moved, 8) - this.renderSpeed) * 0.3;
        pv.position.set(fx, fy, fz);
        pv.rotation.set(0, this.yaw + Math.PI, 0);
        // Swing: a quick lunge forward; dead: lie on the side.
        const s = this.swingAnim > 0 ? Math.sin((1 - this.swingAnim / 0.25) * Math.PI) : 0;
        this.avatar.model.root.position.z = s * 0.35;
        this.avatar.model.root.rotation.x = s * 0.25;
        this.avatar.model.root.rotation.z = this.dead ? Math.PI / 2 : 0;
        this.shield.visible = this.vitals.guarding;
        // Blink while invulnerable after spawning or dodging.
        const blink = this.vitals.invuln > COMBAT.hurtInvuln || this.vitals.dodgeInvuln > 0;
        this.avatar.model.root.visible = !blink || Math.floor(time * 12) % 2 === 0;
        this.avatar.model.animate(time, this.dead ? 0 : this.renderSpeed);
      }
      this.lastRender.set(fx, fy, fz);
    }

    if (this.mode === 'build' && !this.dead) this.updateTarget();
    else {
      this.target = null;
      this.selection.visible = false;
    }
  }

  breakTarget(): boolean {
    this.updateTarget();
    const t = this.target;
    if (!t || !BLOCKS[t.id]?.breakable) return false;
    const drop = dropOf(t.id);
    if (drop !== null && this.hotbar.inventory.add(drop, 1) === 0) {
      this.hotbar.flash('背包滿了');
      return false;
    }
    const ok = this.world.setBlock(t.block[0], t.block[1], t.block[2], B.air);
    if (ok) this.onInventoryUse();
    return ok;
  }

  placeTarget(): boolean {
    this.updateTarget();
    const t = this.target;
    if (!t) return false;
    const stack = this.hotbar.current;
    if (!stack) {
      this.hotbar.flash('這格是空的');
      return false;
    }
    const [x, y, z] = [t.block[0] + t.normal[0], t.block[1] + t.normal[1], t.block[2] + t.normal[2]];
    const here = this.world.getBlock(x, y, z);
    if (here !== B.air && here !== B.water && here !== B.fire) return false;
    const id = stack.id;
    if (BLOCKS[id]?.solid) {
      if (blockIntersectsBody(x, y, z, this.body)) return false;
      for (const o of this.occupants()) {
        const ob = createBody(o.pos.x, o.pos.y, o.pos.z, 0.4, 1.0);
        if (blockIntersectsBody(x, y, z, ob)) return false;
      }
    }
    if (!this.world.setBlock(x, y, z, id)) return false;
    this.hotbar.inventory.takeOne(this.hotbar.selected);
    if (!this.hotbar.current) this.hotbar.flash(`${labelOf(id)}用完了`);
    this.onInventoryUse();
    return true;
  }

  /** Back to the spawn point (falling out of the world, or after dying). */
  respawn(): void {
    const b = this.body;
    b.x = this.spawn.x;
    b.y = this.world.groundY(this.spawn.x, this.spawn.z) + 0.1;
    b.z = this.spawn.z;
    b.vx = b.vy = b.vz = 0;
    this.prev.set(b.x, b.y, b.z);
    this.fallStart = null;
    this.flying = false;
    this.dodgeTimer = 0;
  }

  private updateTarget(): void {
    this.eye.set(this.body.x, this.body.y + PLAYER.eye, this.body.z);
    this.camera.getWorldDirection(this.dir);
    // Third person: aim along the camera ray (what the crosshair is on), but only within reach of the body.
    const third = this.view === 'third';
    const origin = third ? this.camera.position : this.eye;
    const hit = raycastVoxel(
      (x, y, z) => this.world.getBlock(x, y, z),
      hittable,
      origin,
      this.dir,
      third ? REACH + this.camDist : REACH,
    );
    if (hit && third) {
      const cx = hit.block[0] + 0.5 - this.eye.x;
      const cy = hit.block[1] + 0.5 - this.eye.y;
      const cz = hit.block[2] + 0.5 - this.eye.z;
      if (Math.hypot(cx, cy, cz) > REACH + 0.5) {
        this.target = null;
        this.selection.visible = false;
        return;
      }
    }
    this.target = hit;
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
