// Night slimes: cute bouncy green blobs that come out after dark, hop towards the player and bite.
// Purely local (each player fights their own slimes; they are not synced to other players).
// The plaza around the campfire is a safe zone: no slimes spawn there and they won't follow you in.

import * as THREE from 'three';
import { createBody, stepBody, type Body } from '../player/physics';
import { jitter, lowPolyMaterial, merge, painted } from '../scene/lowpoly';
import { B } from '../world/blocks';
import { SEA_LEVEL } from '../world/coords';
import type { World } from '../world/world';
import type { Hittable } from '../player/controller';

export const SLIME = {
  hp: 8,
  damage: 2,
  biteCooldown: 1.1,
  hopSpeed: 3.4,
  hopUp: 8,
  sight: 24,
  maxCount: 5,
  spawnEvery: 4,
  /** Night amount (0 day … 1 night) above which slimes spawn, and below which they melt away. */
  nightOn: 0.6,
  nightOff: 0.3,
  /** Safe zone radius around the plaza centre. */
  safeRadius: 18,
  despawnDist: 56,
} as const;

export interface SlimeTarget {
  x: number;
  y: number;
  z: number;
  alive: boolean;
}

export class Slime implements Hittable {
  readonly body: Body;
  hp: number = SLIME.hp;
  /** Seconds left of the melt/poof animation once dying (removed at 0). */
  dying: number | null = null;
  hopTimer: number;
  biteTimer = 0;
  hurtFlash = 0;
  readonly root = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshLambertMaterial;
  private squash = 0;
  /** Horizontal velocity of the current hop (kept while airborne so a wall bump doesn't stop it). */
  private readonly hopVel = { x: 0, z: 0 };
  onHit: (s: Slime, damage: number) => void = () => {};

  constructor(
    readonly id: string,
    x: number,
    y: number,
    z: number,
    private readonly rnd: () => number,
  ) {
    this.body = createBody(x, y, z, 0.4, 0.8);
    this.hopTimer = 0.5 + rnd();
    this.material = lowPolyMaterial({ transparent: true, opacity: 0.88 });
    const parts = [painted(jitter(new THREE.IcosahedronGeometry(0.46, 1), 0.04, 7), 0x7ad66a, 0.08)];
    parts[0]!.scale(1, 0.8, 1);
    parts[0]!.translate(0, 0.37, 0);
    for (const side of [-1, 1]) {
      const eye = painted(new THREE.IcosahedronGeometry(0.075, 0), 0x1d1d2b, 0);
      eye.scale(1, 1.3, 0.7);
      eye.translate(side * 0.15, 0.46, 0.38);
      const glint = painted(new THREE.IcosahedronGeometry(0.028, 0), 0xffffff, 0);
      glint.translate(side * 0.15 + 0.025, 0.49, 0.43);
      parts.push(eye, glint);
    }
    const cheek = painted(new THREE.IcosahedronGeometry(0.05, 0), 0xff9fb4, 0);
    cheek.scale(1.3, 0.7, 0.5);
    cheek.translate(0, 0.33, 0.42);
    parts.push(cheek);
    this.mesh = new THREE.Mesh(merge(parts), this.material);
    this.root.add(this.mesh);
  }

  get x(): number {
    return this.body.x;
  }
  get y(): number {
    return this.body.y;
  }
  get z(): number {
    return this.body.z;
  }
  get alive(): boolean {
    return this.dying === null;
  }

  hit(damage: number, fromX: number, fromZ: number): void {
    if (!this.alive) return;
    this.hp -= damage;
    this.hurtFlash = 0.2;
    const dx = this.body.x - fromX;
    const dz = this.body.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    this.body.vx = (dx / l) * 7;
    this.body.vz = (dz / l) * 7;
    this.body.vy = 5;
    this.hopVel.x = this.hopVel.z = 0;
    this.hopTimer = 0.8;
    this.onHit(this, damage);
    if (this.hp <= 0) this.dying = 0.35;
  }

  /** Simulate one fixed step. Returns true when the slime bites the target this step. */
  tick(
    dt: number,
    world: World,
    target: SlimeTarget | null,
    safe: (x: number, z: number) => boolean,
  ): boolean {
    const b = this.body;
    this.biteTimer -= dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    if (this.dying !== null) {
      this.dying -= dt;
      return false;
    }
    let tx = 0;
    let tz = 0;
    const chasing =
      !!target &&
      target.alive &&
      Math.hypot(target.x - b.x, target.z - b.z) < SLIME.sight &&
      !safe(target.x, target.z);
    if (chasing) {
      tx = target.x - b.x;
      tz = target.z - b.z;
    } else if (safe(b.x, b.z)) {
      tx = b.x; // wandered into the plaza: hop back out
      tz = b.z;
    }
    if (b.onGround) {
      b.vx *= 0.75;
      b.vz *= 0.75;
      this.hopTimer -= dt;
      if (this.hopTimer <= 0) {
        let dirX = tx;
        let dirZ = tz;
        if (dirX === 0 && dirZ === 0) {
          const a = this.rnd() * Math.PI * 2;
          dirX = Math.cos(a);
          dirZ = Math.sin(a);
        }
        const l = Math.hypot(dirX, dirZ) || 1;
        const speed = chasing ? SLIME.hopSpeed : SLIME.hopSpeed * 0.5;
        b.vx = this.hopVel.x = (dirX / l) * speed;
        b.vz = this.hopVel.z = (dirZ / l) * speed;
        b.vy = SLIME.hopUp * (chasing ? 1 : 0.8);
        this.hopTimer = (chasing ? 0.7 : 1.6) + this.rnd() * 0.8;
        this.squash = 1;
        this.root.rotation.y = Math.atan2(dirX, dirZ);
      }
    } else if (b.vy > 0 && this.hurtFlash === 0) {
      // Rising: keep pushing in the hop direction (so the slime makes it up a 1-block step).
      b.vx = this.hopVel.x;
      b.vz = this.hopVel.z;
    }
    b.vy = Math.max(b.vy - 22 * dt, -30);
    stepBody(b, dt, (x, y, z) => world.isSolid(x, y, z));
    this.squash = Math.max(0, this.squash - dt * 4);
    if (!chasing || !target || this.biteTimer > 0) return false;
    const close = Math.hypot(target.x - b.x, target.z - b.z) < 0.9 && Math.abs(target.y - b.y) < 1.4;
    if (!close) return false;
    this.biteTimer = SLIME.biteCooldown;
    return true;
  }

  render(alpha: number, prev: { x: number; y: number; z: number }, time: number): void {
    const b = this.body;
    this.root.position.set(
      prev.x + (b.x - prev.x) * alpha,
      prev.y + (b.y - prev.y) * alpha,
      prev.z + (b.z - prev.z) * alpha,
    );
    const wob = Math.sin(time * 5 + this.body.x) * 0.04;
    const sq = this.squash * 0.25;
    let s = 1;
    if (this.dying !== null) s = Math.max(0.01, this.dying / 0.35);
    this.mesh.scale.set(s * (1 + sq + wob), s * (1 - sq - wob), s * (1 + sq + wob));
    // A faint green glow keeps them readable at night; red flash when hit.
    if (this.hurtFlash > 0) this.material.emissive.setRGB(0.8, 0.05, 0.05);
    else this.material.emissive.setRGB(0.08, 0.22, 0.08);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Spawns, simulates and draws the night slimes around the local player. */
export class Slimes {
  readonly group = new THREE.Group();
  readonly list: Slime[] = [];
  private readonly prevPos = new Map<Slime, { x: number; y: number; z: number }>();
  private spawnTimer = 2;
  private nextId = 1;
  /** Called when a slime bites the player. */
  onBite: (s: Slime) => void = () => {};
  /** Called when the player defeats a slime. */
  onKill: (s: Slime) => void = () => {};

  constructor(
    private readonly world: World,
    private readonly safeCenter: { x: number; z: number },
    private readonly rnd: () => number = Math.random,
  ) {}

  safe = (x: number, z: number): boolean =>
    Math.hypot(x - this.safeCenter.x, z - this.safeCenter.z) < SLIME.safeRadius;

  /** Fixed step. `night` 0 (day) … 1 (night). */
  tick(dt: number, night: number, target: SlimeTarget | null): void {
    // Spawning (only at night, around a living player outside the safe zone).
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = SLIME.spawnEvery;
      const alive = this.list.filter((s) => s.alive).length;
      if (night > SLIME.nightOn && target?.alive && alive < SLIME.maxCount) this.trySpawn(target);
    }
    for (const s of this.list) {
      const p = this.prevPos.get(s)!;
      p.x = s.body.x;
      p.y = s.body.y;
      p.z = s.body.z;
      if (s.tick(dt, this.world, target, this.safe)) this.onBite(s);
      // Melt away at dawn, when far away, or in the sea.
      const far = target ? Math.hypot(target.x - s.x, target.z - s.z) > SLIME.despawnDist : false;
      if (s.alive && (night < SLIME.nightOff || far || s.y < SEA_LEVEL - 1)) s.dying = 0.6;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i]!;
      if (s.dying !== null && s.dying <= 0) this.remove(i);
    }
  }

  render(alpha: number, time: number): void {
    for (const s of this.list) s.render(alpha, this.prevPos.get(s)!, time);
  }

  /** Living slimes the player can hit. */
  targets(): Slime[] {
    return this.list.filter((s) => s.alive);
  }

  clear(): void {
    while (this.list.length) this.remove(this.list.length - 1);
  }

  private trySpawn(target: SlimeTarget): void {
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = this.rnd() * Math.PI * 2;
      const d = 13 + this.rnd() * 12;
      const x = Math.floor(target.x + Math.cos(a) * d) + 0.5;
      const z = Math.floor(target.z + Math.sin(a) * d) + 0.5;
      if (this.safe(x, z) || !this.world.isLoaded(x, z)) continue;
      const gy = this.world.groundY(x, z);
      if (gy <= SEA_LEVEL + 1) continue;
      const below = this.world.getBlock(Math.floor(x), Math.floor(gy) - 1, Math.floor(z));
      if (below === B.water || below === B.lava || below === B.air) continue;
      const s = new Slime(`slime-${this.nextId++}`, x, gy + 0.05, z, this.rnd);
      s.onHit = (sl) => {
        if (sl.hp <= 0) this.onKill(sl);
      };
      this.list.push(s);
      this.prevPos.set(s, { x, y: gy, z });
      this.group.add(s.root);
      return;
    }
  }

  private remove(i: number): void {
    const s = this.list[i]!;
    this.group.remove(s.root);
    s.dispose();
    this.prevPos.delete(s);
    this.list.splice(i, 1);
  }
}
