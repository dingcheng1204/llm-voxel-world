import * as THREE from 'three';
import type { BlockPos } from '../world/world';
import { merge, painted } from './lowpoly';

const MAX_FIRES = 64;

function flameGeometry(): THREE.BufferGeometry {
  // A little cluster of cute faceted flames: big orange core, yellow and red tongues around it.
  const cone = (r: number, h: number, sides: number, x: number, z: number, tilt: number, color: number) => {
    const g = new THREE.ConeGeometry(r, h, sides);
    g.translate(0, h / 2, 0);
    g.rotateZ(tilt);
    g.translate(x, 0, z);
    return painted(g, color, 0.14);
  };
  return merge([
    cone(0.36, 1.0, 5, 0, 0, 0, 0xff7a1a),
    cone(0.22, 0.7, 5, 0.22, 0.2, -0.18, 0xffd23a),
    cone(0.2, 0.62, 5, -0.24, 0.12, 0.2, 0xffb02e),
    cone(0.18, 0.55, 4, 0.02, -0.26, 0.05, 0xff4d1f),
  ]);
}

/** Animated low-poly flames for every fire block. One draw call for all fires. */
export class FireSystem {
  readonly mesh: THREE.InstancedMesh;
  private positions: BlockPos[] = [];
  private version = -1;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor() {
    // Unlit material: flames glow regardless of scene lighting.
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    this.mesh = new THREE.InstancedMesh(flameGeometry(), mat, MAX_FIRES);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // few instances; skip bounds bookkeeping as they animate
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = 'fire';
  }

  sync(version: number, fires: BlockPos[]): void {
    if (version === this.version) return;
    this.version = version;
    this.positions = fires.slice(0, MAX_FIRES);
    this.mesh.count = this.positions.length;
  }

  update(time: number): void {
    const n = this.positions.length;
    for (let i = 0; i < n; i++) {
      const f = this.positions[i]!;
      const flicker = 1 + 0.16 * Math.sin(time * 9 + i * 1.7) + 0.06 * Math.sin(time * 23 + i * 3.1);
      const sway = 1 + 0.05 * Math.sin(time * 6 + i);
      this.q.setFromAxisAngle(this.up, time * 0.8 + i);
      this.s.set(sway * 1.25, flicker * 1.5, sway * 1.25); // campfire flames a bit larger than one block
      this.p.set(f.x + 0.5, f.y, f.z + 0.5);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    if (n > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
