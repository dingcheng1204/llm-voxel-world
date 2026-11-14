// Cute low-poly character models. Species changes ONLY the look — every character has the same
// body, physics and abilities (see agent-persona skill). Front of every model is local +Z.

import * as THREE from 'three';
import { jitter, lowPolyMaterial, merge, painted } from '../scene/lowpoly';

export type Species = 'cat' | 'fox' | 'wolf' | 'snake' | 'tiger' | 'monkey' | 'elephant';

/** Looks a human player can pick when joining (characters use the others). */
export const PLAYER_SPECIES = ['snake', 'tiger', 'monkey', 'elephant'] as const;
export type PlayerSpecies = (typeof PLAYER_SPECIES)[number];

export interface CharacterModel {
  root: THREE.Group;
  /** Called every rendered frame. `speed` in m/s (0 = idle). */
  animate(time: number, speed: number): void;
  dispose(): void;
}

const material = lowPolyMaterial();

function blob(r: number, sx: number, sy: number, sz: number, color: number, seed: number, detail = 1) {
  const g = jitter(new THREE.IcosahedronGeometry(r, detail), 0.05, seed);
  g.scale(sx, sy, sz);
  return painted(g, color, 0.08);
}

function at(g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  g.translate(x, y, z);
  return g;
}

function mesh(parts: THREE.BufferGeometry[]): THREE.Mesh {
  return new THREE.Mesh(merge(parts), material);
}

/** Two shiny black eyes for a head of radius ~r, facing +Z. */
function eyes(r: number, spread = 0.42, height = 0.12): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    out.push(at(blob(r * 0.17, 1, 1.15, 0.7, 0x1d1d2b, 3, 0), side * r * spread, r * height, r * 0.86));
    out.push(
      at(blob(r * 0.06, 1, 1, 1, 0xffffff, 4, 0), side * r * spread + 0.03, r * height + r * 0.07, r * 0.98),
    );
  }
  return out;
}

interface QuadSpec {
  body: number;
  belly: number;
  legs: number;
  earInner: number;
  earHeight: number;
  earWidth: number;
  muzzle: number;
  tail: 'thin' | 'bushy' | 'fluffy' | 'curl';
  tailTip?: number;
  snout: number;
  /** Dark stripes across back and head (tiger). */
  stripes?: number;
  /** Round ears instead of pointy ones (monkey). */
  roundEars?: boolean;
  /** Lighter face mask (monkey). */
  face?: number;
  /** Elephant: a trunk instead of a muzzle (this colour), big flapping ears, small tusks, thick legs. */
  trunk?: number;
  /** Tail ending in a small tuft (elephant). */
  tuft?: number;
}

function quadruped(spec: QuadSpec): CharacterModel {
  const root = new THREE.Group();

  // Body (with belly patch merged in).
  const body = mesh([
    at(blob(0.42, 1, 0.82, 1.25, spec.body, 1), 0, 0.55, 0),
    at(blob(0.3, 0.95, 0.7, 1.1, spec.belly, 2), 0, 0.45, 0.12),
  ]);
  if (spec.stripes !== undefined) {
    // Bold bands over the back that wrap down both flanks.
    const stripes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const z = 0.36 - i * 0.24;
      stripes.push(at(blob(0.1, 3.2, 0.42, 0.62, spec.stripes, 50 + i, 0), 0, 0.88, z));
      for (const side of [-1, 1]) {
        stripes.push(at(blob(0.08, 0.42, 1.9, 0.62, spec.stripes, 54 + i, 0), side * 0.4, 0.62, z));
      }
    }
    body.add(mesh(stripes));
  }
  root.add(body);

  // Legs pivot at the hip so they can swing.
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [
    [-0.2, 0.3],
    [0.2, 0.3],
    [-0.2, -0.32],
    [0.2, -0.32],
  ] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.42, z);
    const thick = spec.trunk !== undefined ? 1.45 : 1;
    const leg = new THREE.CylinderGeometry(0.085 * thick, 0.075 * thick, 0.38, 5);
    leg.translate(0, -0.19, 0);
    const paw = blob(0.09 * thick, 1.1, 0.7, spec.trunk !== undefined ? 1.05 : 1.3, spec.legs, 5, 0);
    paw.translate(0, -0.39, 0.03);
    pivot.add(mesh([painted(leg, spec.legs), paw]));
    root.add(pivot);
    legs.push(pivot);
  }

  // Big cute head.
  const head = new THREE.Group();
  head.position.set(0, 0.95, 0.5);
  const r = 0.38;
  const headParts = [blob(r, 1.08, 0.95, 0.95, spec.body, 6), ...eyes(r)];
  if (spec.trunk === undefined) {
    headParts.push(
      at(blob(r * 0.48, 1.1, 0.75, 0.9 + spec.snout, spec.muzzle, 7), 0, -r * 0.32, r * 0.72),
      at(blob(r * 0.11, 1.2, 0.9, 1, 0x2a2230, 8, 0), 0, -r * 0.16, r * (1.1 + spec.snout * 0.35)),
    );
  } else {
    // Small tusks either side of where the trunk starts.
    for (const side of [-1, 1]) {
      const tusk = new THREE.ConeGeometry(0.035, 0.16, 5);
      tusk.rotateX(Math.PI * 0.62);
      headParts.push(at(painted(tusk, 0xfffaf0, 0.02), side * r * 0.32, -r * 0.5, r * 0.82));
    }
  }
  if (spec.face !== undefined)
    headParts.push(at(blob(r * 0.72, 1.15, 0.85, 0.5, spec.face, 9), 0, -r * 0.05, r * 0.55));
  if (spec.stripes !== undefined) {
    for (const x of [-0.12, 0, 0.12])
      headParts.push(at(blob(r * 0.1, 0.5, 1.6, 0.6, spec.stripes, 60, 0), x, r * 0.72, r * 0.45));
  }
  const flaps: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    if (spec.trunk !== undefined) {
      // Big round ears on hinges at the side of the head, so they can flap.
      const hinge = new THREE.Group();
      hinge.position.set(side * r * 0.7, r * 0.1, -0.08);
      const flap = blob(0.3, 1, 1.05, 0.18, spec.body, 72, 1);
      flap.translate(side * 0.26, -0.03, 0);
      const inner = blob(0.21, 1, 1.05, 0.12, spec.earInner, 73, 0);
      inner.translate(side * 0.26, -0.04, 0.035);
      hinge.add(mesh([flap, inner]));
      head.add(hinge);
      flaps.push(hinge);
      continue;
    }
    if (spec.roundEars) {
      headParts.push(at(blob(spec.earWidth, 0.6, 1, 1, spec.body, 70, 0), side * r * 1.02, r * 0.18, -0.02));
      headParts.push(
        at(blob(spec.earWidth * 0.6, 0.5, 1, 1, spec.earInner, 71, 0), side * r * 1.08, r * 0.18, 0.02),
      );
      continue;
    }
    const ear = new THREE.ConeGeometry(spec.earWidth, spec.earHeight, 4);
    ear.rotateZ(side * -0.28);
    headParts.push(at(painted(ear, spec.body), side * r * 0.55, r * 0.78 + spec.earHeight * 0.35, -0.02));
    const inner = new THREE.ConeGeometry(spec.earWidth * 0.55, spec.earHeight * 0.65, 4);
    inner.rotateZ(side * -0.28);
    headParts.push(at(painted(inner, spec.earInner), side * r * 0.55, r * 0.74 + spec.earHeight * 0.3, 0.06));
  }
  head.add(mesh(headParts));
  // Trunk: a chain of segments hanging from the face, each one pivoting on the one before.
  const trunkJoints: THREE.Object3D[] = [];
  if (spec.trunk !== undefined) {
    let parent: THREE.Object3D = head;
    const n = 6;
    for (let i = 0; i < n; i++) {
      const joint = new THREE.Group();
      if (i === 0) joint.position.set(0, -r * 0.2, r * 0.86);
      else joint.position.set(0, -0.07, 0.008);
      const w = 0.105 - i * 0.01;
      const seg = blob(w, 1, 1.5, 1, i === n - 1 ? spec.earInner : spec.trunk, 74 + i, 0);
      seg.translate(0, -0.04, 0);
      joint.add(mesh([seg]));
      parent.add(joint);
      parent = joint;
      trunkJoints.push(joint);
    }
  }
  root.add(head);

  // Tail pivots at the rump.
  const tail = new THREE.Group();
  tail.position.set(0, 0.62, -0.5);
  const tailParts: THREE.BufferGeometry[] = [];
  if (spec.tail === 'curl') {
    // Long monkey tail curling up at the end.
    for (let i = 0; i < 8; i++) {
      const a = i * 0.32;
      tailParts.push(
        at(
          blob(0.055, 1, 1, 1.4, spec.body, 80 + i, 0),
          0,
          Math.sin(a) * 0.32,
          -0.05 - Math.sin(a * 0.6) * 0.42,
        ),
      );
    }
  } else if (spec.tuft !== undefined) {
    // Short rope tail hanging down, ending in a tuft (elephant).
    for (let i = 0; i < 3; i++)
      tailParts.push(at(blob(0.045, 1, 1.6, 1, spec.body, 16 + i, 0), 0, -i * 0.08, -0.04 - i * 0.02));
    tailParts.push(at(blob(0.065, 1, 1.3, 1, spec.tuft, 19, 0), 0, -0.25, -0.1));
  } else if (spec.tail === 'thin') {
    for (let i = 0; i < 4; i++) {
      tailParts.push(
        at(blob(0.07 - i * 0.008, 1, 1, 1.6, spec.body, 10 + i, 0), 0, i * 0.11, -0.08 - i * 0.07),
      );
    }
  } else {
    const len = spec.tail === 'fluffy' ? 0.62 : 0.5;
    tailParts.push(at(blob(0.17, 1, 1, len / 0.34, spec.body, 14), 0, 0.05, -len * 0.55));
    if (spec.tailTip) tailParts.push(at(blob(0.12, 1, 1, 1.2, spec.tailTip, 15), 0, 0.08, -len * 1.05));
  }
  if (spec.stripes !== undefined && spec.tail === 'thin') {
    for (let i = 1; i < 4; i++) {
      tailParts.push(
        at(blob(0.075 - i * 0.008, 1.05, 1.05, 0.5, spec.stripes, 90 + i, 0), 0, i * 0.11, -0.08 - i * 0.07),
      );
    }
  }
  tail.add(mesh(tailParts));
  tail.rotation.x =
    spec.tuft !== undefined ? 0.35 : spec.tail === 'thin' || spec.tail === 'curl' ? -0.2 : 0.5;
  root.add(tail);

  const tailBase = tail.rotation.x;
  return {
    root,
    animate(time, speed) {
      const moving = speed > 0.05;
      const phase = time * (moving ? 9 : 0);
      // Diagonal pairs move together (front-left with back-right), like a real trot.
      legs.forEach(
        (l, i) => (l.rotation.x = moving ? Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.6 : 0),
      );
      body.position.y = moving ? Math.abs(Math.sin(phase)) * 0.05 : Math.sin(time * 2) * 0.012;
      head.position.y = 0.95 + body.position.y;
      head.rotation.y = moving ? 0 : Math.sin(time * 0.7) * 0.35;
      head.rotation.z = moving ? 0 : Math.sin(time * 0.45) * 0.08;
      tail.rotation.y = Math.sin(time * (moving ? 10 : 3)) * (moving ? 0.25 : 0.45);
      tail.rotation.x = tailBase + Math.sin(time * 1.3) * 0.05;
      // Elephant: ears flap gently, the trunk sways and curls up now and then.
      flaps.forEach(
        (f, i) => (f.rotation.y = (i === 0 ? -1 : 1) * (0.15 + Math.sin(time * (moving ? 6 : 1.8)) * 0.18)),
      );
      if (trunkJoints.length) {
        const curl = moving ? 0.12 : Math.max(0, Math.sin(time * 0.6)) * 0.42;
        trunkJoints.forEach((j, i) => {
          j.rotation.x = (i === 0 ? 0.25 : 0) - curl * (i / trunkJoints.length) * 1.6;
          j.rotation.z = Math.sin(time * (moving ? 7 : 1.6) - i * 0.6) * (moving ? 0.1 : 0.16);
        });
      }
    },
    dispose() {
      root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}

function snake(): CharacterModel {
  const root = new THREE.Group();
  const green = 0x5ccf6b;
  const belly = 0xd9f28a;
  const segments: THREE.Mesh[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const r = 0.2 - i * 0.012;
    const seg = mesh([
      blob(r, 1, 0.85, 1.15, i % 2 ? green : 0x4cbe5c, 20 + i),
      at(blob(r * 0.75, 0.95, 0.5, 1.05, belly, 30 + i, 0), 0, -r * 0.45, 0),
    ]);
    seg.position.set(0, r * 0.85, -i * 0.24);
    root.add(seg);
    segments.push(seg);
  }
  const head = new THREE.Group();
  const hr = 0.27;
  const tongue = new THREE.ConeGeometry(0.03, 0.22, 3);
  tongue.rotateX(Math.PI / 2);
  head.add(
    mesh([
      blob(hr, 1.05, 0.8, 1.2, green, 40),
      at(blob(hr * 0.6, 1, 0.5, 1, belly, 41, 0), 0, -hr * 0.4, hr * 0.3),
      at(painted(tongue, 0xff4d6d), 0, -hr * 0.2, hr * 1.25),
      ...eyes(hr, 0.48, 0.32),
    ]),
  );
  head.position.set(0, 0.42, 0.2);
  root.add(head);

  return {
    root,
    animate(time, speed) {
      const moving = speed > 0.05;
      const amp = moving ? 0.22 : 0.06;
      const freq = moving ? 7 : 1.5;
      segments.forEach((s, i) => {
        s.position.x = Math.sin(time * freq - i * 0.7) * amp * Math.min(1, i / 2 + 0.3);
      });
      head.position.x = Math.sin(time * freq + 0.7) * amp * 0.4;
      head.position.y = 0.42 + Math.sin(time * 1.6) * 0.04;
      head.rotation.y = moving ? 0 : Math.sin(time * 0.8) * 0.4;
    },
    dispose() {
      root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}

export function createModel(species: Species): CharacterModel {
  switch (species) {
    case 'cat':
      return quadruped({
        body: 0xffb562,
        belly: 0xfff1dc,
        legs: 0xfff1dc,
        earInner: 0xff9fb4,
        earHeight: 0.24,
        earWidth: 0.14,
        muzzle: 0xfff1dc,
        tail: 'thin',
        snout: 0,
      });
    case 'fox':
      return quadruped({
        body: 0xff7f3a,
        belly: 0xfff4e6,
        legs: 0x4a3328,
        earInner: 0x3a2a22,
        earHeight: 0.34,
        earWidth: 0.15,
        muzzle: 0xfff4e6,
        tail: 'fluffy',
        tailTip: 0xffffff,
        snout: 0.45,
      });
    case 'wolf':
      return quadruped({
        body: 0x9aa7bd,
        belly: 0xe8edf5,
        legs: 0x7d8aa1,
        earInner: 0x5d6880,
        earHeight: 0.3,
        earWidth: 0.15,
        muzzle: 0xe8edf5,
        tail: 'bushy',
        tailTip: 0xe8edf5,
        snout: 0.35,
      });
    case 'snake':
      return snake();
    case 'tiger':
      return quadruped({
        body: 0xffa13d,
        belly: 0xfff6e8,
        legs: 0xffa13d,
        earInner: 0xfff6e8,
        earHeight: 0.16,
        earWidth: 0.15,
        muzzle: 0xfff6e8,
        tail: 'thin',
        snout: 0.1,
        stripes: 0x3b2a2a,
      });
    case 'monkey':
      return quadruped({
        body: 0x9a6a46,
        belly: 0xf3d9b8,
        legs: 0x8a5d3d,
        earInner: 0xf3d9b8,
        earHeight: 0.12,
        earWidth: 0.12,
        muzzle: 0xf3d9b8,
        tail: 'curl',
        snout: 0,
        roundEars: true,
        face: 0xf3d9b8,
      });
    case 'elephant':
      return quadruped({
        body: 0xa9b6cc,
        belly: 0xc9d3e3,
        legs: 0x9ba9c0,
        earInner: 0xffb8c8,
        earHeight: 0.1,
        earWidth: 0.1,
        muzzle: 0xa9b6cc,
        tail: 'thin',
        tuft: 0x6f7c93,
        snout: 0,
        trunk: 0xa3b1c8,
      });
  }
}
