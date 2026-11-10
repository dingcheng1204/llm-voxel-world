import * as THREE from 'three';
import { SEA_LEVEL } from '../world/coords';
import { jitter, merge, painted } from './lowpoly';

export const HORIZON = 0xbfe7ff;
const ZENITH = 0x3f9ef2;

/** Sky dome, lights, animated low-poly ocean and drifting clouds. */
export class Environment {
  readonly group = new THREE.Group();
  private readonly sky: THREE.Mesh;
  private readonly oceanUniforms = { uTime: { value: 0 } };
  private readonly clouds: THREE.InstancedMesh;
  private readonly cloudData: { x: number; y: number; z: number; s: number; r: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();

  constructor() {
    this.group.name = 'environment';

    // Lights only affect props/ocean/clouds; chunk blocks have the same light baked in.
    this.group.add(new THREE.HemisphereLight(0xe6f4ff, 0xe0c890, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(0.6, 1, 0.35);
    this.group.add(sun);

    // Gradient sky dome (follows the camera, never fogged).
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(700, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color(ZENITH) }, horizon: { value: new THREE.Color(HORIZON) } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
          void main() {
            float t = pow(clamp(vDir.y, 0.0, 1.0), 0.6);
            gl_FragColor = vec4(mix(horizon, top, t), 1.0);
          }`,
      }),
    );
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    this.group.add(this.createOcean());
    // Endless sandy sea floor under the ocean, level with the deepest seabed blocks, so the edge
    // of the finite world never shows through the water.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(1100, 1100), new THREE.MeshBasicMaterial({ color: 0xf6dc96 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 1.98;
    floor.name = 'seafloor';
    this.group.add(floor);
    this.clouds = this.createClouds();
    this.group.add(this.clouds);
  }

  update(time: number, camera: THREE.Camera): void {
    this.sky.position.copy(camera.position);
    this.oceanUniforms.uTime.value = time;
    for (let i = 0; i < this.cloudData.length; i++) {
      const c = this.cloudData[i]!;
      let x = c.x + time * 1.2;
      x = ((((x + 220) % 440) + 440) % 440) - 220; // wrap around the island
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), c.r);
      this.clouds.setMatrixAt(i, this.m.compose(this.v.set(x, c.y, c.z), this.q, this.sc.setScalar(c.s)));
    }
    this.clouds.instanceMatrix.needsUpdate = true;
  }

  private createOcean(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(1100, 1100, 130, 130);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({
      color: 0x2fa7ee,
      flatShading: true, // faceted, low-poly waves
      transparent: true,
      opacity: 0.9,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.oceanUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           transformed.y += sin(position.x * 0.32 + uTime * 1.1) * 0.13
                          + cos(position.z * 0.27 + uTime * 0.85) * 0.13
                          + sin((position.x + position.z) * 0.11 + uTime * 0.5) * 0.1;`,
        );
    };
    const ocean = new THREE.Mesh(geo, mat);
    ocean.position.y = SEA_LEVEL + 0.82;
    ocean.renderOrder = 1;
    ocean.name = 'ocean';
    return ocean;
  }

  private createClouds(): THREE.InstancedMesh {
    const puffs: [number, number, number, number][] = [
      [0, 0, 0, 3.2], [3.4, -0.4, 0.4, 2.5], [-3.2, -0.5, -0.3, 2.3], [1.2, 1.4, -0.2, 2.2], [-1.4, 1.0, 0.6, 1.8],
    ];
    const geo = merge(
      puffs.map(([x, y, z, r], i) => {
        const g = jitter(new THREE.IcosahedronGeometry(r, 0), 0.1, i + 10);
        g.scale(1, 0.62, 0.85);
        g.translate(x, y, z);
        return painted(g, 0xffffff, 0.14);
      }),
    );
    const count = 18;
    // Unlit: clouds stay bright white from any angle; per-face variation in the vertex colours keeps the facets.
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), count);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + i * 0.7;
      const r = 90 + ((i * 37) % 90);
      this.cloudData.push({ x: Math.cos(a) * r, y: 62 + ((i * 13) % 14), z: Math.sin(a) * r, s: 0.9 + ((i * 7) % 5) * 0.15, r: a });
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = 'clouds';
    return mesh;
  }
}
