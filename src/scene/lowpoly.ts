// Helpers for building cute, flat-shaded low-poly props with baked vertex colours.
// Every prop type becomes ONE geometry rendered with ONE InstancedMesh → one draw call per type.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Non-indexed copy with a constant vertex colour (slight per-face variation for the faceted look). */
export function painted(geo: THREE.BufferGeometry, hex: number, variation = 0.06): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  geo.dispose();
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  const base = new THREE.Color(hex);
  for (let tri = 0; tri < n / 3; tri++) {
    const k = 1 - variation / 2 + pseudo(tri * 31 + hex) * variation;
    for (let v = 0; v < 3; v++) {
      const i = (tri * 3 + v) * 3;
      colors[i] = Math.min(1, base.r * k);
      colors[i + 1] = Math.min(1, base.g * k);
      colors[i + 2] = Math.min(1, base.b * k);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal'); // flatShading derives face normals in the shader
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('mergeGeometries failed (attribute mismatch)');
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

/** Move shared vertices together by a deterministic amount so a solid stays closed. */
export function jitter(geo: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key =
      (Math.round(x * 1000) * 73856093) ^
      (Math.round(y * 1000) * 19349663) ^
      (Math.round(z * 1000) * 83492791);
    const s = 1 + (pseudo(key + seed) - 0.5) * 2 * amount;
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  pos.needsUpdate = true;
  return geo;
}

export function lowPolyMaterial(opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...opts });
}

function pseudo(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
