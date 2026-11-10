import * as THREE from 'three';
import type { Prop, PropKind } from '../world/terrain';
import { jitter, lowPolyMaterial, merge, painted } from './lowpoly';

// Decorative props (palms, bushes, boulders). Visual only for now: no collision.

function palmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Curved trunk: stacked, slightly leaning segments.
  let x = 0;
  let y = 0;
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.CylinderGeometry(0.17, 0.22, 0.95, 6);
    seg.translate(0, 0.475, 0);
    seg.rotateZ(-0.06 * i);
    seg.translate(x, y, 0);
    parts.push(painted(seg, i % 2 ? 0xb07a45 : 0x9a6438));
    x += 0.07 * i;
    y += 0.9;
  }
  // Fronds: flattened, drooping leaves around the crown.
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.ConeGeometry(0.42, 2.3, 4);
    leaf.scale(1, 1, 0.25);
    leaf.rotateZ(-Math.PI / 2 - 0.35); // point outwards and droop
    leaf.translate(1.05, -0.2, 0);
    leaf.rotateY((i / 7) * Math.PI * 2);
    leaf.translate(x, y, 0);
    parts.push(painted(leaf, i % 2 ? 0x4fbf3a : 0x3fa52f));
  }
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.IcosahedronGeometry(0.16, 0);
    nut.translate(x + Math.cos(i * 2.1) * 0.2, y - 0.25, Math.sin(i * 2.1) * 0.2);
    parts.push(painted(nut, 0x7a4a26));
  }
  return merge(parts);
}

function bushGeometry(): THREE.BufferGeometry {
  const blobs: [number, number, number, number, number][] = [
    [0, 0.45, 0, 0.6, 0x5cc443],
    [0.45, 0.35, 0.15, 0.45, 0x4fb53a],
    [-0.4, 0.33, -0.1, 0.42, 0x68cf4a],
  ];
  return merge(
    blobs.map(([x, y, z, r, c], i) => {
      const g = jitter(new THREE.IcosahedronGeometry(r, 0), 0.12, i);
      g.translate(x, y, z);
      return painted(g, c);
    }),
  );
}

function boulderGeometry(seed: number): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(0.8, 1), 0.16, seed);
  g.scale(1, 0.78, 1);
  g.translate(0, 0.5, 0);
  return merge([painted(g, 0xaab3bf, 0.1)]);
}

const builders: Record<PropKind, () => THREE.BufferGeometry> = {
  palm: palmGeometry,
  bush: bushGeometry,
  boulder: () => boulderGeometry(3),
};

export function createProps(props: readonly Prop[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'props';
  const material = lowPolyMaterial();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();

  for (const kind of Object.keys(builders) as PropKind[]) {
    const list = props.filter((pr) => pr.kind === kind);
    if (list.length === 0) continue;
    const mesh = new THREE.InstancedMesh(builders[kind](), material, list.length);
    list.forEach((pr, i) => {
      q.setFromAxisAngle(up, pr.rotation);
      s.setScalar(pr.scale);
      p.set(pr.x, pr.y - 0.05, pr.z);
      mesh.setMatrixAt(i, m.compose(p, q, s));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = kind;
    group.add(mesh);
  }
  return group;
}
