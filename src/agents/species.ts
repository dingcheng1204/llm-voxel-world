// Cute low-poly character models. Species changes ONLY the look — every character has the same
// body, physics and abilities (see agent-persona skill). Front of every model is local +Z.

import * as THREE from 'three';
import { jitter, lowPolyMaterial, merge, painted } from '../scene/lowpoly';

export type Species = 'cat' | 'fox' | 'wolf' | 'snake';

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
    out.push(at(blob(r * 0.06, 1, 1, 1, 0xffffff, 4, 0), side * r * spread + 0.03, r * height + r * 0.07, r * 0.98));
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
  tail: 'thin' | 'bushy' | 'fluffy';
  tailTip?: number;
  snout: number;
}

function quadruped(spec: QuadSpec): CharacterModel {
  const root = new THREE.Group();

  // Body (with belly patch merged in).
  const body = mesh([
    at(blob(0.42, 1, 0.82, 1.25, spec.body, 1), 0, 0.55, 0),
    at(blob(0.3, 0.95, 0.7, 1.1, spec.belly, 2), 0, 0.45, 0.12),
  ]);
  root.add(body);

  // Legs pivot at the hip so they can swing.
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.2, 0.3], [0.2, 0.3], [-0.2, -0.32], [0.2, -0.32]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.42, z);
    const leg = new THREE.CylinderGeometry(0.085, 0.075, 0.38, 5);
    leg.translate(0, -0.19, 0);
    const paw = blob(0.09, 1.1, 0.7, 1.3, spec.legs, 5, 0);
    paw.translate(0, -0.39, 0.03);
    pivot.add(mesh([painted(leg, spec.legs), paw]));
    root.add(pivot);
    legs.push(pivot);
  }

  // Big cute head.
  const head = new THREE.Group();
  head.position.set(0, 0.95, 0.5);
  const r = 0.38;
  const headParts = [
    blob(r, 1.08, 0.95, 0.95, spec.body, 6),
    at(blob(r * 0.48, 1.1, 0.75, 0.9 + spec.snout, spec.muzzle, 7), 0, -r * 0.32, r * 0.72),
    at(blob(r * 0.11, 1.2, 0.9, 1, 0x2a2230, 8, 0), 0, -r * 0.16, r * (1.1 + spec.snout * 0.35)),
    ...eyes(r),
  ];
  for (const side of [-1, 1]) {
    const ear = new THREE.ConeGeometry(spec.earWidth, spec.earHeight, 4);
    ear.rotateZ(side * -0.28);
    headParts.push(at(painted(ear, spec.body), side * r * 0.55, r * 0.78 + spec.earHeight * 0.35, -0.02));
    const inner = new THREE.ConeGeometry(spec.earWidth * 0.55, spec.earHeight * 0.65, 4);
    inner.rotateZ(side * -0.28);
    headParts.push(at(painted(inner, spec.earInner), side * r * 0.55, r * 0.74 + spec.earHeight * 0.3, 0.06));
  }
  head.add(mesh(headParts));
  root.add(head);

  // Tail pivots at the rump.
  const tail = new THREE.Group();
  tail.position.set(0, 0.62, -0.5);
  const tailParts: THREE.BufferGeometry[] = [];
  if (spec.tail === 'thin') {
    for (let i = 0; i < 4; i++) {
      tailParts.push(at(blob(0.07 - i * 0.008, 1, 1, 1.6, spec.body, 10 + i, 0), 0, i * 0.11, -0.08 - i * 0.07));
    }
  } else {
    const len = spec.tail === 'fluffy' ? 0.62 : 0.5;
    tailParts.push(at(blob(0.17, 1, 1, len / 0.34, spec.body, 14), 0, 0.05, -len * 0.55));
    if (spec.tailTip) tailParts.push(at(blob(0.12, 1, 1, 1.2, spec.tailTip, 15), 0, 0.08, -len * 1.05));
  }
  tail.add(mesh(tailParts));
  tail.rotation.x = spec.tail === 'thin' ? -0.2 : 0.5;
  root.add(tail);

  const tailBase = tail.rotation.x;
  return {
    root,
    animate(time, speed) {
      const moving = speed > 0.05;
      const phase = time * (moving ? 9 : 0);
      // Diagonal pairs move together (front-left with back-right), like a real trot.
      legs.forEach((l, i) => (l.rotation.x = moving ? Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.6 : 0));
      body.position.y = moving ? Math.abs(Math.sin(phase)) * 0.05 : Math.sin(time * 2) * 0.012;
      head.position.y = 0.95 + body.position.y;
      head.rotation.y = moving ? 0 : Math.sin(time * 0.7) * 0.35;
      head.rotation.z = moving ? 0 : Math.sin(time * 0.45) * 0.08;
      tail.rotation.y = Math.sin(time * (moving ? 10 : 3)) * (moving ? 0.25 : 0.45);
      tail.rotation.x = tailBase + Math.sin(time * 1.3) * 0.05;
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
      return quadruped({ body: 0xffb562, belly: 0xfff1dc, legs: 0xfff1dc, earInner: 0xff9fb4, earHeight: 0.24, earWidth: 0.14, muzzle: 0xfff1dc, tail: 'thin', snout: 0 });
    case 'fox':
      return quadruped({ body: 0xff7f3a, belly: 0xfff4e6, legs: 0x4a3328, earInner: 0x3a2a22, earHeight: 0.34, earWidth: 0.15, muzzle: 0xfff4e6, tail: 'fluffy', tailTip: 0xffffff, snout: 0.45 });
    case 'wolf':
      return quadruped({ body: 0x9aa7bd, belly: 0xe8edf5, legs: 0x7d8aa1, earInner: 0x5d6880, earHeight: 0.3, earWidth: 0.15, muzzle: 0xe8edf5, tail: 'bushy', tailTip: 0xe8edf5, snout: 0.35 });
    case 'snake':
      return snake();
  }
}
