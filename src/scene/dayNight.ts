import * as THREE from 'three';
import { blockLighting, MAX_LIGHTS } from '../world/blockMaterials';
import type { BlockPos } from '../world/world';
import type { Environment } from './environment';
import { DAY_SECONDS, WorldClock } from './clock';

export { DAY_SECONDS, WorldClock };

/**
 * Shared world clock derived from real time, so every visitor (and, later, every AI agent on the
 * server) sees the same time of day and the same day number.
 *   t = 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
 */

interface Key {
  t: number;
  top: number;
  horizon: number;
  /** Light colour applied to blocks (and used to tint clouds / sea floor). */
  light: [number, number, number];
  hemi: number;
  sun: number;
}

// Cute, not scary: nights are a soft navy you can still see in.
const KEYS: Key[] = [
  { t: 0.0, top: 0x0f1d45, horizon: 0x2c4277, light: [0.42, 0.48, 0.78], hemi: 0.8, sun: 0.3 },
  { t: 0.21, top: 0x1d2c62, horizon: 0x5d5f9e, light: [0.5, 0.52, 0.8], hemi: 0.9, sun: 0.3 },
  { t: 0.265, top: 0x5c8ad4, horizon: 0xffb48c, light: [0.98, 0.84, 0.76], hemi: 1.5, sun: 1.0 },
  { t: 0.33, top: 0x3f9ef2, horizon: 0xbfe7ff, light: [1, 1, 1], hemi: 1.7, sun: 1.5 },
  { t: 0.67, top: 0x3f9ef2, horizon: 0xbfe7ff, light: [1, 1, 1], hemi: 1.7, sun: 1.5 },
  { t: 0.735, top: 0x5677c9, horizon: 0xff9a6c, light: [1, 0.82, 0.7], hemi: 1.5, sun: 1.0 },
  { t: 0.79, top: 0x27326c, horizon: 0x7c62a3, light: [0.58, 0.56, 0.84], hemi: 0.95, sun: 0.35 },
  { t: 0.85, top: 0x0f1d45, horizon: 0x2c4277, light: [0.42, 0.48, 0.78], hemi: 0.8, sun: 0.3 },
  { t: 1.0, top: 0x0f1d45, horizon: 0x2c4277, light: [0.42, 0.48, 0.78], hemi: 0.8, sun: 0.3 },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function sample(t: number) {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.t <= t) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const mix = (x: number, y: number) => x + (y - x) * f;
  return {
    top: tmpA.setHex(a.top).lerp(tmpB.setHex(b.top), f).getHex(),
    horizon: tmpA.setHex(a.horizon).lerp(tmpB.setHex(b.horizon), f).getHex(),
    light: [mix(a.light[0], b.light[0]), mix(a.light[1], b.light[1]), mix(a.light[2], b.light[2])] as const,
    hemi: mix(a.hemi, b.hemi),
    sun: mix(a.sun, b.sun),
  };
}

/** Drives sky, fog, lights, block light, stars, sun/moon and campfire glow from the world clock. */
export class DayNight {
  readonly group = new THREE.Group();
  private readonly stars: THREE.Points;
  private readonly sunDisc: THREE.Sprite;
  private readonly moonDisc: THREE.Sprite;
  private readonly fireLight = new THREE.PointLight(0xffa45a, 0, 16, 1.6);
  private readonly dir = new THREE.Vector3();
  night = 0;

  constructor(
    readonly clock: WorldClock,
    private readonly env: Environment,
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.group.name = 'dayNight';

    // Stars: a few hundred points on the upper sky, fading in at night.
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2;
      const y = 0.08 + Math.random() * 0.92;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(u) * r * 640, y * 640, Math.sin(u) * r * 640], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 2.2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        fog: false,
        depthWrite: false,
      }),
    );
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;

    this.sunDisc = disc('#fff6c8', 'rgba(255,230,150,0)', 90);
    this.moonDisc = disc('#f4f1ff', 'rgba(200,210,255,0)', 55);
    this.group.add(this.stars, this.sunDisc, this.moonDisc, this.fireLight);
  }

  update(camera: THREE.Camera, fires: BlockPos[]): void {
    const t = this.clock.t;
    const k = sample(t);

    // Sun travels east → overhead → west; the moon is opposite.
    const a = (t - 0.25) * Math.PI * 2;
    this.dir.set(Math.cos(a), Math.sin(a), 0.35).normalize();
    const sunUp = this.dir.y;
    this.night = 1 - smoothstep(-0.15, 0.2, sunUp);

    this.env.skyUniforms.top.value.setHex(k.top);
    this.env.skyUniforms.horizon.value.setHex(k.horizon);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(k.horizon);
    this.renderer.setClearColor(k.horizon);

    blockLighting.uLight.value.setRGB(k.light[0], k.light[1], k.light[2]);
    blockLighting.uNight.value = this.night;
    const count = Math.min(fires.length, MAX_LIGHTS);
    blockLighting.uFireCount.value = count;
    for (let i = 0; i < count; i++) {
      const f = fires[i]!;
      blockLighting.uFirePos.value[i]!.set(f.x + 0.5, f.y + 0.5, f.z + 0.5);
    }

    // Props, agents, ocean (Lambert) use real lights.
    this.env.hemi.intensity = k.hemi;
    this.env.hemi.color.setRGB(k.light[0], k.light[1], k.light[2]);
    this.env.sun.intensity = k.sun;
    if (sunUp > -0.05) this.env.sun.position.copy(this.dir);
    else this.env.sun.position.set(-this.dir.x, -this.dir.y, this.dir.z); // moonlight
    this.env.sun.color.setHex(sunUp > -0.05 ? 0xffffff : 0xaab8ff);
    this.env.cloudMaterial.color.setRGB(
      0.55 + 0.45 * k.light[0],
      0.55 + 0.45 * k.light[1],
      0.6 + 0.4 * k.light[2],
    );
    this.env.seaFloor.color.setHex(0xf6dc96).multiply(tmpA.setRGB(k.light[0], k.light[1], k.light[2]));

    // Warm light for props/animals near the (first) campfire, mostly at night.
    if (count > 0) {
      const f = fires[0]!;
      this.fireLight.position.set(f.x + 0.5, f.y + 1.2, f.z + 0.5);
      this.fireLight.intensity = 3 + 22 * this.night;
    } else {
      this.fireLight.intensity = 0;
    }

    // Sky decorations follow the camera.
    (this.stars.material as THREE.PointsMaterial).opacity = Math.pow(this.night, 1.5) * 0.9;
    this.stars.position.copy(camera.position);
    this.sunDisc.position.copy(camera.position).addScaledVector(this.dir, 600);
    this.moonDisc.position.copy(camera.position).addScaledVector(this.dir, -600);
    this.moonDisc.position.z = camera.position.z + this.dir.z * 600; // keep moon on the same side as the sun's z tilt
    this.sunDisc.visible = sunUp > -0.1;
    this.moonDisc.visible = sunUp < 0.1;
  }
}

function disc(core: string, edge: string, size: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 18, 64, 64, 64);
  grad.addColorStop(0, core);
  grad.addColorStop(0.45, core);
  grad.addColorStop(1, edge);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      fog: false,
      depthWrite: false,
      transparent: true,
    }),
  );
  s.scale.setScalar(size);
  s.renderOrder = -1;
  s.frustumCulled = false;
  return s;
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
