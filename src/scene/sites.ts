// Building sites in the 3D world: every block still to place is a translucent "ghost" block, and a sign
// floats above the site ("小木屋 · Clio 的計畫 · 12/79"). Rebuilt when the site list changes and every
// couple of seconds (blocks placed by anyone count as done).

import * as THREE from 'three';
import { blueprint } from '../world/blueprints';
import { BLOCKS } from '../world/blocks';
import { SEA_LEVEL } from '../world/coords';
import { siteBlocks, siteProgress } from '../agents/building';
import type { Sites } from '../agents/worldState';
import { createNameTag } from './nameTag';

const MAX_GHOSTS = 800;
const REFRESH_MS = 2000;

interface WorldLike {
  getBlock(x: number, y: number, z: number): number;
  terrain: { heightAt(x: number, z: number): number };
}

export class SiteGhosts {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;
  private tags: THREE.Sprite[] = [];
  private version = -1;
  private lastBuild = 0;
  private readonly colorOf = new Map<string, THREE.Color>();

  constructor(
    private readonly world: WorldLike,
    private readonly sites: Sites,
    private readonly nameOf: (id: string) => string,
    private readonly colorOfAgent: (id: string) => string,
  ) {
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      vertexColors: false,
    });
    const geo = new THREE.BoxGeometry(0.96, 0.96, 0.96);
    this.mesh = new THREE.InstancedMesh(geo, this.material, MAX_GHOSTS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);
    for (const b of BLOCKS) {
      const c = b.colors.side;
      this.colorOf.set(b.name, new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.25));
    }
  }

  private terrain() {
    return { heightAt: (x: number, z: number) => this.world.terrain.heightAt(x, z), seaLevel: SEA_LEVEL };
  }

  private blockName(x: number, y: number, z: number): string {
    return BLOCKS[this.world.getBlock(x, y, z)]?.name ?? 'air';
  }

  private rebuild(): void {
    for (const t of this.tags) {
      this.group.remove(t);
      t.material.map?.dispose();
      t.material.dispose();
    }
    this.tags = [];
    const m = new THREE.Matrix4();
    let n = 0;
    const t = this.terrain();
    for (const s of this.sites.active()) {
      const blocks = siteBlocks(s, t);
      if (blocks.length === 0) continue;
      const pr = siteProgress(s, t, (x, y, z) => this.blockName(x, y, z), 0);
      let top = -Infinity;
      let sx = 0;
      let sz = 0;
      for (const [x, y, z, mat] of blocks) {
        top = Math.max(top, y);
        sx += x;
        sz += z;
        if (this.blockName(x, y, z) === mat || n >= MAX_GHOSTS) continue;
        m.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
        this.mesh.setMatrixAt(n, m);
        this.mesh.setColorAt(n, this.colorOf.get(mat) ?? new THREE.Color(0xffffff));
        n++;
      }
      const bp = blueprint(s.blueprint);
      const tag = createNameTag(
        s.name ?? bp?.name ?? s.blueprint,
        `${this.nameOf(s.by)} 的計畫 · ${pr.done}/${pr.total}`,
        this.colorOfAgent(s.by),
      );
      tag.position.set(sx / blocks.length + 0.5, top + 2.2, sz / blocks.length + 0.5);
      tag.scale.multiplyScalar(1.4);
      this.group.add(tag);
      this.tags.push(tag);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Call every frame. */
  update(time: number, nowMs: number): void {
    if (this.sites.version !== this.version || nowMs - this.lastBuild > REFRESH_MS) {
      this.version = this.sites.version;
      this.lastBuild = nowMs;
      this.rebuild();
    }
    // A gentle shimmer so ghosts read as "not built yet".
    this.material.opacity = 0.26 + Math.sin(time * 2.2) * 0.06;
  }

  dispose(): void {
    this.rebuild = () => {};
    this.mesh.geometry.dispose();
    this.material.dispose();
    for (const t of this.tags) {
      t.material.map?.dispose();
      t.material.dispose();
    }
  }
}
