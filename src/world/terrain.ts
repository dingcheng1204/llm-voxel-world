import alea from 'alea';
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { B } from './blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL, localIndex } from './coords';
import { Chunk } from './chunk';
import { hash2 } from './hash';

export { hash2, hash3 } from './hash';

/** A small island: every chunk outside these bounds is open ocean (drawn by the ocean plane). */
export const ISLAND_CHUNKS = { minX: -3, maxX: 2, minZ: -3, maxZ: 2 } as const;
const ISLAND_RADIUS = 34;

export interface Column {
  /** y of the top solid block. */
  h: number;
  top: number;
  /** Height contributed by the peaks (0 on flat land). */
  mountain: number;
  plaza: boolean;
}

export type PropKind = 'palm' | 'bush' | 'boulder';
export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
}

interface Peak {
  x: number;
  z: number;
  r: number;
  h: number;
  grassCap: boolean;
}

/** Deterministic island: same seed ⇒ same world everywhere (browser, worker, server). */
export class TerrainGenerator {
  private readonly noise: NoiseFunction2D;
  private readonly peaks: Peak[] = [
    { x: -10, z: -12, r: 16, h: 23, grassCap: false },
    { x: 11, z: -15, r: 11, h: 15, grassCap: true },
  ];
  readonly plazaCenter = { x: 2, z: 8 };
  private readonly plazaRadius = 10;
  /** World-space block placements for hand-made structures, keyed "x,z" → [y, id][]. */
  private readonly structures = new Map<string, [number, number][]>();
  readonly props: Prop[] = [];

  constructor(readonly seed: number) {
    this.noise = createNoise2D(alea(seed));
    this.buildStructures();
    this.placeProps();
  }

  heightAt(x: number, z: number): number {
    return this.column(Math.floor(x), Math.floor(z)).h;
  }

  column(x: number, z: number): Column {
    const d = Math.hypot(x, z) / ISLAND_RADIUS + this.noise(x / 28, z / 28) * 0.16;
    const land = 1 - smoothstep(0.72, 1.05, d);
    // Seabed keeps sloping down away from the island so the edge of the world never shows through the water.
    const deep = smoothstep(1.05, 1.4, d) * 14;
    let h = SEA_LEVEL - 7 + land * 9 + this.fbm(x / 36, z / 36) * 2.2 * land - deep;

    let mountain = 0;
    let cap = false;
    for (const p of this.peaks) {
      const t = Math.max(0, 1 - Math.hypot(x - p.x, z - p.z) / p.r);
      // Exponent < 1 → rounded, friendly domes rather than sharp spikes.
      const m = p.h * Math.pow(t, 0.85) * (1 + 0.15 * this.noise(x / 6 + p.x, z / 6));
      if (m > mountain) {
        mountain = m;
        cap = p.grassCap && m > p.h * 0.82;
      }
    }
    h += mountain;

    const pd = Math.hypot(x - this.plazaCenter.x, z - this.plazaCenter.z);
    const plazaMask = 1 - smoothstep(this.plazaRadius - 4, this.plazaRadius, pd);
    h = h + (SEA_LEVEL + 2 - h) * plazaMask * (mountain < 3 ? 1 : 0);
    const hi = Math.max(1, Math.min(CHUNK_Y - 2, Math.floor(h)));
    const plaza = plazaMask > 0.5;

    let top: number;
    if (cap) top = B.grass;
    else if (mountain > 13) top = hash2(x, z, this.seed + 7) < 0.35 ? B.rock : B.stone;
    else if (mountain > 7) top = hash2(x, z, this.seed + 7) < 0.2 ? B.rock : B.stone;
    else if (mountain > 2) top = hash2(x, z, this.seed + 9) < 0.55 ? B.grass : B.stone; // green foothills
    else if (hi <= SEA_LEVEL + 1 || plaza) top = B.sand;
    else top = B.grass;
    return { h: hi, top, mountain, plaza };
  }

  generate(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    const b = chunk.blocks;
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const wx = cx * CHUNK_X + lx;
        const wz = cz * CHUNK_Z + lz;
        const { h, top } = this.column(wx, wz);
        const under = top === B.grass ? B.dirt : top === B.sand ? B.sand : B.stone;
        for (let y = 0; y <= h; y++) {
          const id = y === 0 ? B.bedrock : y === h ? top : y >= h - 3 ? under : B.stone;
          b[localIndex(lx, y, lz)] = id;
        }
        // No water blocks: the animated ocean plane is the sea. Water stays a placeable block.
        const s = this.structures.get(`${wx},${wz}`);
        if (s) for (const [y, id] of s) chunk.set(lx, y, lz, id);
      }
    }
    return chunk;
  }

  private put(x: number, y: number, z: number, id: number): void {
    const k = `${x},${z}`;
    const list = this.structures.get(k) ?? [];
    list.push([y, id]);
    this.structures.set(k, list);
  }

  private buildStructures(): void {
    // Campfire in the middle of the sandy plaza: a log with fire on top (small stone props ring it).
    const { x: px, z: pz } = this.plazaCenter;
    const g = this.column(px, pz).h;
    this.put(px, g, pz, B.log);
    this.put(px, g + 1, pz, B.fire);

    // A few wooden crates around the plaza.
    for (const [dx, dz, stack] of [[-6, 3, 2], [-5, 4, 1], [6, -2, 1], [5, 5, 1]] as const) {
      const h = this.column(px + dx, pz + dz).h;
      for (let i = 1; i <= stack; i++) this.put(px + dx, h + i, pz + dz, B.planks);
    }

    // Wooden dock heading south into the sea.
    let z0 = pz;
    while (this.column(px, z0).h > SEA_LEVEL && z0 < 60) z0++;
    const deck = SEA_LEVEL + 1;
    for (let z = z0 - 2; z < z0 + 9; z++) {
      for (const x of [px, px + 1]) this.put(x, deck, z, B.planks);
      if ((z - z0) % 3 === 0) {
        for (const x of [px - 1, px + 2]) {
          for (let y = this.column(x, z).h + 1; y <= deck + 1; y++) this.put(x, y, z, B.log);
        }
      }
    }
  }

  private placeProps(): void {
    const { minX, maxX, minZ, maxZ } = ISLAND_CHUNKS;
    const x0 = minX * CHUNK_X;
    const x1 = (maxX + 1) * CHUNK_X;
    const z0 = minZ * CHUNK_Z;
    const z1 = (maxZ + 1) * CHUNK_Z;
    const s = this.seed;
    const taken = new Set<string>();
    const free = (x: number, z: number) => !this.structures.has(`${x},${z}`) && !taken.has(`${x},${z}`);
    const add = (kind: PropKind, x: number, z: number, scale: number) => {
      const c = this.column(x, z);
      taken.add(`${x},${z}`);
      this.props.push({ kind, x: x + 0.5, y: c.h + 1, z: z + 0.5, rotation: hash2(z, x, s + 3) * Math.PI * 2, scale });
    };

    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        if (!free(x, z)) continue;
        const c = this.column(x, z);
        if (c.h <= SEA_LEVEL || c.plaza) continue;
        const r = hash2(x, z, s + 11);
        const nearBeach = c.h <= SEA_LEVEL + 3;
        if (c.mountain < 2 && (c.top === B.grass || (c.top === B.sand && !nearBeach)) && r < 0.02) {
          add('palm', x, z, 0.85 + hash2(x, z, s + 5) * 0.4);
        } else if (c.mountain < 2 && c.top === B.sand && nearBeach && r < 0.012) {
          add('palm', x, z, 0.8 + hash2(x, z, s + 5) * 0.3);
        } else if (c.top === B.grass && r > 0.97) {
          add('bush', x, z, 0.7 + hash2(x, z, s + 6) * 0.5);
        } else if ((c.top === B.sand || c.mountain > 2) && r > 0.988) {
          add('boulder', x, z, 0.6 + hash2(x, z, s + 8) * 0.7);
        }
      }
    }
    // A big round boulder in the plaza, like a landmark.
    add('boulder', this.plazaCenter.x - 5, this.plazaCenter.z + 3, 2.0);
    // Little stones around the campfire.
    const { x: px, z: pz } = this.plazaCenter;
    const g = this.column(px, pz).h + 1;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.props.push({ kind: 'boulder', x: px + 0.5 + Math.cos(a) * 0.95, y: g, z: pz + 0.5 + Math.sin(a) * 0.95, rotation: a, scale: 0.3 });
    }
  }

  private fbm(x: number, z: number): number {
    let amp = 1;
    let f = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < 3; o++) {
      sum += amp * this.noise(x * f, z * f);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
