// Magic bolts from magic weapons: small glowing orbs that fly straight, stop at blocks, and hit the
// first target they pass close to. Bolts fired by other players are shown too (visual only — their
// hits arrive as PvP hit events and are judged by the victim).

import * as THREE from 'three';
import type { World } from '../world/world';
import { COMBAT } from './combat';
import type { Hittable } from './controller';

interface Bolt {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** Distance left to fly. */
  left: number;
  damage: number;
  /** Fired by this player (can hit) or a remote player (just drawn). */
  own: boolean;
  fromX: number;
  fromZ: number;
  mesh: THREE.Mesh;
}

const geometry = new THREE.IcosahedronGeometry(0.16, 1);
const materialOwn = new THREE.MeshBasicMaterial({ color: 0xc7a6ff, fog: false });
const materialOther = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, fog: false });

export class Bolts {
  readonly group = new THREE.Group();
  readonly list: Bolt[] = [];
  /** Called when one of my bolts hits something. */
  onHit: (t: Hittable) => void = () => {};

  fire(origin: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number, own: boolean): void {
    const d = dir.clone().normalize();
    const mesh = new THREE.Mesh(geometry, own ? materialOwn : materialOther);
    mesh.position.copy(origin);
    this.group.add(mesh);
    this.list.push({
      pos: origin.clone(),
      vel: d.multiplyScalar(COMBAT.boltSpeed),
      left: range,
      damage,
      own,
      fromX: origin.x,
      fromZ: origin.z,
      mesh,
    });
  }

  /** Fixed step: move in small sub-steps so bolts never skip through a block or a target. */
  tick(dt: number, world: World, targets: () => Hittable[]): void {
    const ts = this.list.some((b) => b.own) ? targets() : [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i]!;
      const step = b.vel.length() * dt;
      const n = Math.max(1, Math.ceil(step / 0.3));
      let done = false;
      for (let k = 0; k < n && !done; k++) {
        b.pos.addScaledVector(b.vel, dt / n);
        b.left -= step / n;
        if (b.left <= 0 || world.isSolid(Math.floor(b.pos.x), Math.floor(b.pos.y), Math.floor(b.pos.z))) {
          done = true;
          break;
        }
        if (!b.own) continue;
        for (const t of ts) {
          const dy = b.pos.y - (t.y + 0.5);
          if (Math.hypot(b.pos.x - t.x, dy * 0.7, b.pos.z - t.z) < COMBAT.boltRadius) {
            t.hit(b.damage, b.fromX, b.fromZ, 'magic');
            this.onHit(t);
            done = true;
            break;
          }
        }
      }
      if (done) this.remove(i);
    }
  }

  render(time: number): void {
    for (const b of this.list) {
      b.mesh.position.copy(b.pos);
      const s = 1 + Math.sin(time * 30 + b.fromX) * 0.2;
      b.mesh.scale.setScalar(s);
    }
  }

  clear(): void {
    while (this.list.length) this.remove(this.list.length - 1);
  }

  private remove(i: number): void {
    this.group.remove(this.list[i]!.mesh);
    this.list.splice(i, 1);
  }
}
