import alea from 'alea';
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { B } from './blocks';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, SEA_LEVEL, localIndex } from './coords';
import { Chunk } from './chunk';
import { hash2 } from './hash';

export { hash2, hash3 } from './hash';

/**
 * The island: 12 × 18 chunks = 192 × 288 blocks (x ∈ [-96, 95], z ∈ [-144, 143]).
 * Everything outside is open ocean (drawn by the ocean plane).
 */
export const ISLAND_CHUNKS = { minX: -6, maxX: 5, minZ: -9, maxZ: 8 } as const;
const RADIUS_X = 82;
const RADIUS_Z = 126;

export type Biome = 'beach' | 'plaza' | 'grass' | 'forest' | 'meadow' | 'lake' | 'mountain' | 'volcano';

export interface Column {
  /** y of the top solid block. */
  h: number;
  top: number;
  biome: Biome;
  /** Height contributed by peaks (0 on flat land). */
  mountain: number;
  /** Lake columns get water from h+1 up to `waterTop`. */
  waterTop?: number;
}

export type PropKind =
  'palm' | 'bush' | 'boulder' | 'mushroom' | 'flower_red' | 'flower_yellow' | 'flower_pink' | 'flower_white';

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
}

interface Peak {
  kind: 'snow' | 'volcano' | 'hill';
  x: number;
  z: number;
  r: number;
  h: number;
  crater?: number;
}

interface Area {
  x: number;
  z: number;
  r: number;
}

/** Deterministic island: same seed ⇒ same world everywhere (browser, worker, server). */
export class TerrainGenerator {
  private readonly noise: NoiseFunction2D;
  readonly peaks: readonly Peak[] = [
    { kind: 'snow', x: -26, z: -96, r: 38, h: 36 },
    { kind: 'snow', x: 24, z: -104, r: 27, h: 26 },
    { kind: 'volcano', x: 54, z: -24, r: 25, h: 23, crater: 5 },
    { kind: 'hill', x: -52, z: 6, r: 15, h: 8 },
  ];
  readonly plaza: Area = { x: 0, z: 24, r: 12 };
  readonly lake: Area = { x: -44, z: 72, r: 13 };
  /** Kept for callers that only need the plaza centre. */
  readonly plazaCenter = { x: this.plaza.x, z: this.plaza.z };
  /** World-space block placements for structures and trees, keyed "x,z" → [y, id][]. */
  private readonly structures = new Map<string, [number, number][]>();
  readonly props: Prop[] = [];
  private readonly columnCache = new Map<number, Column>();

  constructor(readonly seed: number) {
    this.noise = createNoise2D(alea(seed));
    this.buildStructures();
    this.placeTrees();
    this.placeProps();
    this.columnCache.clear();
  }

  heightAt(x: number, z: number): number {
    return this.column(Math.floor(x), Math.floor(z)).h;
  }

  /** Spawn points around the plaza for the characters. */
  spawnPoints(n: number): { x: number; y: number; z: number }[] {
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + 0.4;
      const x = Math.round(this.plaza.x + Math.cos(a) * 5);
      const z = Math.round(this.plaza.z + Math.sin(a) * 5);
      return { x: x + 0.5, y: this.column(x, z).h + 1, z: z + 0.5 };
    });
  }

  biomeAt(x: number, z: number): Biome {
    return this.column(Math.floor(x), Math.floor(z)).biome;
  }

  column(x: number, z: number): Column {
    // Cache only while building structures/props in the constructor (cleared afterwards).
    const key = (x + 512) * 2048 + (z + 1024);
    const cached = this.columnCache.get(key);
    if (cached) return cached;
    const c = this.computeColumn(x, z);
    if (this.columnCache.size < 200_000) this.columnCache.set(key, c);
    return c;
  }

  private computeColumn(x: number, z: number): Column {
    const d = Math.hypot(x / RADIUS_X, z / RADIUS_Z) + this.noise(x / 40, z / 40) * 0.12;
    const land = 1 - smoothstep(0.8, 1.04, d);
    const deep = smoothstep(1.04, 1.25, d) * 14; // seabed keeps falling towards the world edge
    let h = SEA_LEVEL - 7 + land * 9 + this.fbm(x / 44, z / 44) * 2.6 * land - deep;

    // Peaks: keep the tallest contribution.
    let mountain = 0;
    let peak: Peak | undefined;
    let inCrater = false;
    for (const p of this.peaks) {
      const dist = Math.hypot(x - p.x, z - p.z);
      const t = Math.max(0, 1 - dist / p.r);
      let m = p.h * Math.pow(t, 0.85) * (1 + 0.14 * this.noise(x / 7 + p.x, z / 7));
      let crater = false;
      if (p.crater && dist < p.crater) {
        m = p.h * Math.pow(1 - p.crater / p.r, 0.85) - 4;
        crater = dist < p.crater - 1;
      }
      if (m > mountain) {
        mountain = m;
        peak = p;
        inCrater = crater;
      }
    }
    h += mountain;

    // Flatten the plaza.
    const pd = Math.hypot(x - this.plaza.x, z - this.plaza.z);
    const plazaMask = mountain < 3 ? 1 - smoothstep(this.plaza.r - 5, this.plaza.r, pd) : 0;
    h += (SEA_LEVEL + 2 - h) * plazaMask;

    // Freshwater lake sitting slightly above sea level, with a raised rim.
    const ld = Math.hypot(x - this.lake.x, z - this.lake.z) + this.noise(x / 9, z / 9) * 2;
    let waterTop: number | undefined;
    if (ld < this.lake.r) {
      h = SEA_LEVEL + (ld < this.lake.r - 4 ? -1 : 1);
      waterTop = SEA_LEVEL + 3;
    } else if (ld < this.lake.r + 3) {
      h = Math.max(h, SEA_LEVEL + 3);
    }

    const hi = Math.max(1, Math.min(CHUNK_Y - 2, Math.floor(h)));
    const r = hash2(x, z, this.seed + 7);
    let top: number = B.grass;
    let biome: Biome = 'grass';

    if (waterTop !== undefined) {
      top = ld < this.lake.r - 2 ? B.gravel : B.sand;
      biome = 'lake';
    } else if (peak?.kind === 'volcano' && mountain > 3) {
      biome = 'volcano';
      if (inCrater) top = B.lava;
      else if (mountain > peak.h * 0.55) top = r < 0.3 ? B.clay : B.rock;
      else top = r < 0.15 ? B.rock : B.clay;
    } else if (peak?.kind === 'snow' && mountain > 3) {
      biome = 'mountain';
      if (mountain > peak.h * 0.68) top = r < 0.12 ? B.ice : B.snow;
      else if (mountain > 12) top = r < 0.3 ? B.rock : B.stone;
      else if (mountain > 6) top = r < 0.25 ? B.rock : B.stone;
      else top = r < 0.5 ? B.grass : B.stone; // green foothills
    } else if (peak?.kind === 'hill' && mountain > 2) {
      top = B.grass;
    } else if (plazaMask > 0.5) {
      top = B.sand;
      biome = 'plaza';
    } else if (hi <= SEA_LEVEL + 1) {
      top = r < 0.04 ? B.gravel : B.sand;
      biome = 'beach';
    } else if (x > 16 && z > 40 && z < 112) {
      top = B.flower_grass;
      biome = 'meadow';
    } else if (x < -16 && z > -64 && z < 92) {
      biome = 'forest';
    }
    return { h: hi, top, biome, mountain, waterTop };
  }

  generate(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    const b = chunk.blocks;
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const wx = cx * CHUNK_X + lx;
        const wz = cz * CHUNK_Z + lz;
        const { h, top, waterTop } = this.column(wx, wz);
        const under =
          top === B.grass || top === B.flower_grass
            ? B.dirt
            : top === B.sand || top === B.gravel
              ? top
              : top === B.clay || top === B.lava
                ? B.clay
                : B.stone;
        for (let y = 0; y <= h; y++) {
          const id = y === 0 ? B.bedrock : y === h ? top : y >= h - 3 ? under : B.stone;
          b[localIndex(lx, y, lz)] = id;
        }
        if (waterTop !== undefined) for (let y = h + 1; y < waterTop; y++) b[localIndex(lx, y, lz)] = B.water;
        // The sea itself is the animated ocean plane, not water blocks.
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

  private occupied(x: number, z: number): boolean {
    return this.structures.has(`${x},${z}`);
  }

  private buildStructures(): void {
    const s = this.seed;
    const { x: px, z: pz } = this.plaza;

    // Campfire in the middle of the plaza (stones around it are props).
    const g = this.column(px, pz).h;
    this.put(px, g, pz, B.log);
    this.put(px, g + 1, pz, B.fire);

    // Colourful toy blocks and wooden crates scattered around the plaza.
    const toys = [B.toy_red, B.toy_orange, B.toy_yellow, B.toy_blue, B.planks];
    for (let i = 0; i < 14; i++) {
      const a = hash2(i, 1, s) * Math.PI * 2;
      const rr = 3.5 + hash2(i, 2, s) * 6;
      const x = Math.round(px + Math.cos(a) * rr);
      const z = Math.round(pz + Math.sin(a) * rr);
      if (Math.abs(x - px) <= 1 && Math.abs(z - pz) <= 1) continue;
      if (this.occupied(x, z)) continue;
      const id = toys[Math.floor(hash2(i, 3, s) * toys.length)]!;
      const h = this.column(x, z).h;
      const stack = hash2(i, 4, s) < 0.25 ? 2 : 1;
      for (let k = 1; k <= stack; k++) this.put(x, h + k, z, id);
    }

    // Brick well west of the plaza: a 3×3 ring with water inside.
    const wx = px - 10;
    const wz = pz + 6;
    const wh = this.column(wx, wz).h;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) {
          this.put(wx, wh, wz, B.water);
          continue;
        }
        this.put(wx + dx, wh + 1, wz + dz, B.brick);
      }
    }

    // Mossy ruins in the forest: a broken ring of columns.
    const rx = -60;
    const rz = -16;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const x = Math.round(rx + Math.cos(a) * 6);
      const z = Math.round(rz + Math.sin(a) * 6);
      const h = this.column(x, z).h;
      const height = 1 + Math.floor(hash2(i, 9, s) * 4);
      for (let k = 1; k <= height; k++)
        this.put(x, h + k, z, hash2(i, k, s) < 0.25 ? B.brick : B.mossy_stone);
    }

    // Crystal clusters on the big mountain's flanks.
    const big = this.peaks[0]!;
    for (let i = 0; i < 8; i++) {
      const a = hash2(i, 11, s) * Math.PI * 2;
      const rr = big.r * (0.45 + hash2(i, 12, s) * 0.25);
      const x = Math.round(big.x + Math.cos(a) * rr);
      const z = Math.round(big.z + Math.sin(a) * rr);
      const h = this.column(x, z).h;
      const height = 1 + Math.floor(hash2(i, 13, s) * 3);
      for (let k = 1; k <= height; k++) this.put(x, h + k, z, B.crystal);
      this.put(x + 1, h + 1, z, B.crystal);
    }

    // Wooden dock on the south coast.
    let z0 = 100;
    while (this.column(px, z0).h > SEA_LEVEL && z0 < 150) z0++;
    const deck = SEA_LEVEL + 1;
    for (let z = z0 - 3; z < z0 + 10; z++) {
      for (const x of [px, px + 1]) this.put(x, deck, z, B.planks);
      if ((z - z0) % 3 === 0) {
        for (const x of [px - 1, px + 2]) {
          for (let y = Math.max(1, this.column(x, z).h + 1); y <= deck + 1; y++) this.put(x, y, z, B.log);
        }
      }
    }
  }

  /** Round, cute block trees (choppable wood) — dense in the forest, rare elsewhere on grass. */
  private placeTrees(): void {
    const { x0, x1, z0, z1 } = this.extent();
    const s = this.seed;
    for (let z = z0 + 2; z < z1 - 2; z++) {
      for (let x = x0 + 2; x < x1 - 2; x++) {
        const c = this.column(x, z);
        if (c.top !== B.grass) continue;
        const chance = c.biome === 'forest' ? 0.035 : 0.004;
        if (hash2(x, z, s + 21) >= chance) continue;
        if (this.nearStructure(x, z, 2)) continue;
        const trunk = 3 + Math.floor(hash2(x, z, s + 22) * 3);
        const top = c.h + trunk;
        for (let dy = -1; dy <= 2; dy++) {
          const rad = dy === 2 ? 1 : dy === -1 ? 1.6 : 2.3;
          for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (dx * dx + dz * dz > rad * rad) continue;
              this.put(x + dx, top + dy, z + dz, B.leaves);
            }
          }
        }
        for (let i = 1; i <= trunk; i++) this.put(x, c.h + i, z, B.log);
      }
    }
  }

  private nearStructure(x: number, z: number, r: number): boolean {
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) if (this.occupied(x + dx, z + dz)) return true;
    return false;
  }

  private extent() {
    const { minX, maxX, minZ, maxZ } = ISLAND_CHUNKS;
    return { x0: minX * CHUNK_X, x1: (maxX + 1) * CHUNK_X, z0: minZ * CHUNK_Z, z1: (maxZ + 1) * CHUNK_Z };
  }

  private placeProps(): void {
    const { x0, x1, z0, z1 } = this.extent();
    const s = this.seed;
    const taken = new Set<string>();
    const add = (kind: PropKind, x: number, z: number, scale: number) => {
      const c = this.column(x, z);
      taken.add(`${x},${z}`);
      this.props.push({
        kind,
        x: x + 0.5,
        y: c.h + 1,
        z: z + 0.5,
        rotation: hash2(z, x, s + 3) * Math.PI * 2,
        scale,
      });
    };
    const flowers: PropKind[] = ['flower_red', 'flower_yellow', 'flower_pink', 'flower_white'];

    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        if (this.occupied(x, z) || taken.has(`${x},${z}`)) continue;
        const c = this.column(x, z);
        if (c.h <= SEA_LEVEL || c.biome === 'plaza' || c.biome === 'lake') continue;
        const r = hash2(x, z, s + 11);
        const v = hash2(x, z, s + 5);
        switch (c.biome) {
          case 'beach':
            if (r < 0.012) add('palm', x, z, 0.8 + v * 0.35);
            else if (r > 0.993) add('boulder', x, z, 0.5 + v * 0.6);
            break;
          case 'grass':
            if (r < 0.006) add('palm', x, z, 0.85 + v * 0.4);
            else if (r > 0.975) add('bush', x, z, 0.7 + v * 0.5);
            else if (r > 0.955) add(flowers[Math.floor(v * 4)]!, x, z, 0.8 + v * 0.4);
            break;
          case 'meadow':
            if (r < 0.1) add(flowers[Math.floor(v * 4)]!, x, z, 0.8 + v * 0.5);
            else if (r > 0.985) add('bush', x, z, 0.7 + v * 0.4);
            break;
          case 'forest':
            if (r < 0.03) add('mushroom', x, z, 0.6 + v * 0.6);
            else if (r > 0.96) add('bush', x, z, 0.8 + v * 0.5);
            else if (r > 0.95) add(flowers[Math.floor(v * 4)]!, x, z, 0.8);
            break;
          case 'mountain':
          case 'volcano':
            if (r > 0.99 && c.top !== B.lava) add('boulder', x, z, 0.5 + v * 0.9);
            break;
        }
      }
    }
    // A big round boulder in the plaza, like a landmark, and little stones around the campfire.
    const { x: px, z: pz } = this.plaza;
    add('boulder', px - 6, pz + 4, 2.0);
    const g = this.column(px, pz).h + 1;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.props.push({
        kind: 'boulder',
        x: px + 0.5 + Math.cos(a) * 0.95,
        y: g,
        z: pz + 0.5 + Math.sin(a) * 0.95,
        rotation: a,
        scale: 0.3,
      });
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
