// Low-poly models for equipment you can see on a character: the weapon held beside the animal
// (floating at its right side, swung forward on attack) and the shield raised while guarding.
// Same art direction as the animals: flat-shaded, vertex colours, a little jitter.

import * as THREE from 'three';
import { GEAR } from '../player/equipment';
import { jitter, lowPolyMaterial, merge, painted } from './lowpoly';

const material = lowPolyMaterial();

function part(
  g: THREE.BufferGeometry,
  color: number,
  x = 0,
  y = 0,
  z = 0,
  variation = 0.06,
): THREE.BufferGeometry {
  const p = painted(g, color, variation);
  p.translate(x, y, z);
  return p;
}

/** Built along +Y (handle at the origin, tip up); the holder tilts it. */
function weaponParts(id: string): {
  parts: THREE.BufferGeometry[];
  glow?: { color: number; y: number; r: number };
} {
  switch (id) {
    case 'stick':
      return {
        parts: [
          part(jitter(new THREE.CylinderGeometry(0.03, 0.04, 0.62, 5), 0.008, 1), 0x9a6438, 0, 0.31, 0),
          part(new THREE.CylinderGeometry(0.018, 0.022, 0.16, 4).rotateZ(0.9), 0x8a5a30, 0.06, 0.4, 0),
          part(new THREE.IcosahedronGeometry(0.06, 0).scale(1, 0.5, 1.4), 0x7ccb52, 0.12, 0.47, 0),
        ],
      };
    case 'wood_sword':
    case 'stone_sword': {
      const blade = id === 'wood_sword' ? 0xe3b77a : 0xb9c1cc;
      return {
        parts: [
          part(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 6), 0x7a4a2a, 0, 0.08, 0),
          part(new THREE.BoxGeometry(0.2, 0.04, 0.06), id === 'wood_sword' ? 0x9a6438 : 0x868e9c, 0, 0.18, 0),
          part(new THREE.BoxGeometry(0.07, 0.48, 0.025), blade, 0, 0.44, 0, 0.04),
          part(
            new THREE.ConeGeometry(0.05, 0.1, 4).rotateY(Math.PI / 4).scale(1, 1, 0.36),
            blade,
            0,
            0.73,
            0,
            0.04,
          ),
        ],
      };
    }
    case 'magic_twig':
      return {
        parts: [
          part(jitter(new THREE.CylinderGeometry(0.025, 0.035, 0.6, 5), 0.008, 2), 0x8a5a30, 0, 0.3, 0),
          part(new THREE.IcosahedronGeometry(0.05, 0).scale(1, 0.5, 1.4), 0x9fe0a0, -0.07, 0.5, 0),
        ],
        glow: { color: 0xc7a6ff, y: 0.66, r: 0.07 },
      };
    case 'crystal_wand':
      return {
        parts: [
          part(new THREE.CylinderGeometry(0.025, 0.03, 0.58, 6), 0x5b4a8a, 0, 0.29, 0),
          part(new THREE.TorusGeometry(0.06, 0.015, 4, 8).rotateX(Math.PI / 2), 0xd9b25b, 0, 0.6, 0),
          part(new THREE.OctahedronGeometry(0.09, 0).scale(0.8, 1.4, 0.8), 0xb57bff, 0, 0.72, 0, 0.1),
        ],
        glow: { color: 0xe0c8ff, y: 0.72, r: 0.05 },
      };
    default:
      return { parts: [] };
  }
}

export interface GearModel {
  root: THREE.Group;
  dispose(): void;
}

/** The model of a weapon (null for no weapon / unknown id). Handle at the origin, pointing up. */
export function createWeaponModel(id: string | null): GearModel | null {
  if (!id || !GEAR[id]?.weapon) return null;
  const { parts, glow } = weaponParts(id);
  if (!parts.length) return null;
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(merge(parts), material);
  root.add(mesh);
  let glowMesh: THREE.Mesh | null = null;
  if (glow) {
    glowMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(glow.r, 1),
      new THREE.MeshBasicMaterial({ color: glow.color, fog: false }),
    );
    glowMesh.position.y = glow.y;
    root.add(glowMesh);
  }
  return {
    root,
    dispose() {
      mesh.geometry.dispose();
      if (glowMesh) {
        glowMesh.geometry.dispose();
        (glowMesh.material as THREE.Material).dispose();
      }
    },
  };
}

/** Shield colour by armor id (null = no shield shown). */
export function shieldColor(armor: string | null): number | null {
  if (armor === 'wood_shield') return 0xd9a35f;
  if (armor === 'stone_shield') return 0xa7afba;
  return armor && GEAR[armor] ? 0xd9a35f : null;
}

/**
 * Weapon + shield attached to a character's pivot (front = local +Z). Call `update` every frame
 * with the current gear, the swing phase (0…1, 0 = idle) and whether the shield is up.
 */
export class HeldGear {
  readonly holder = new THREE.Group();
  readonly shield: THREE.Mesh;
  private weapon: GearModel | null = null;
  private weaponId: string | null | undefined = undefined;
  private armorId: string | null | undefined = undefined;
  private readonly shieldMat = lowPolyMaterial();
  private baseY = 0.5;

  constructor(parent: THREE.Object3D, side = 0.55, height = 0.5) {
    // The holder sits at the animal's right side; the weapon leans forward, ready to swing.
    this.baseY = height;
    this.holder.position.set(-side, height, 0.15);
    this.holder.scale.setScalar(1.45);
    parent.add(this.holder);
    const disc = new THREE.CylinderGeometry(0.34, 0.34, 0.07, 9);
    disc.rotateX(Math.PI / 2);
    const boss = new THREE.CylinderGeometry(0.09, 0.09, 0.1, 6).rotateX(Math.PI / 2);
    this.shield = new THREE.Mesh(
      merge([part(disc, 0xffffff, 0, 0, 0, 0.08), part(boss, 0xd9d9d9, 0, 0, 0.03)]),
      this.shieldMat,
    );
    // Held at the front-left and angled outwards so it peeks out when seen from behind.
    this.shield.position.set(0.4, 0.62, 0.48);
    this.shield.rotation.y = 0.55;
    this.shield.scale.setScalar(1.1);
    this.shield.visible = false;
    parent.add(this.shield);
  }

  setGear(weapon: string | null, armor: string | null): void {
    if (weapon !== this.weaponId) {
      this.weaponId = weapon;
      if (this.weapon) {
        this.holder.remove(this.weapon.root);
        this.weapon.dispose();
      }
      this.weapon = createWeaponModel(weapon);
      if (this.weapon) this.holder.add(this.weapon.root);
    }
    if (armor !== this.armorId) {
      this.armorId = armor;
      const c = shieldColor(armor);
      if (c !== null) this.shieldMat.color.setHex(c);
    }
  }

  /** `swing` 0…1 through an attack (0 = idle); `guard` = shield raised; `time` for the idle bob. */
  update(swing: number, guard: boolean, time: number, visible = true): void {
    this.holder.visible = visible && !!this.weapon;
    // Idle: tilted forward and bobbing; swing: a quick arc from raised-back to striking down-forward.
    const s = swing > 0 ? Math.sin(swing * Math.PI) : 0;
    const back = swing > 0 && swing < 0.35 ? (swing / 0.35) * 0.6 : 0;
    // Positive Z leans the tip outwards (away from the body); a swing brings it forward and in.
    this.holder.rotation.set(0.35 + s * 1.4 - back, 0, 0.45 - s * 0.5);
    this.holder.position.y = this.baseY + Math.sin(time * 2.2) * 0.03;
    this.shield.visible = visible && guard && shieldColor(this.armorId ?? null) !== null;
  }

  dispose(): void {
    this.weapon?.dispose();
    this.shield.geometry.dispose();
    this.shieldMat.dispose();
  }
}
