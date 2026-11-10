import * as THREE from 'three';
import { Chunk } from './chunk';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, PAD_VOLUME, chunkKey, localIndex, paddedIndex, type ChunkKey } from './coords';
import type { ChunkMeshData, MeshPart } from './mesher';
import { MeshWorkerPool } from './meshWorkerPool';
import { B } from './blocks';
import { ISLAND_CHUNKS, TerrainGenerator } from './terrain';

interface ChunkEntry {
  chunk: Chunk;
  /** Bumped on every edit; stale worker results are discarded. */
  version: number;
  meshedVersion: number;
  meshing: boolean;
  opaque?: THREE.Mesh;
  water?: THREE.Mesh;
}

export interface WorldOptions {
  seed: number;
  renderDistance: number;
  /** Max milliseconds per frame spent generating terrain on the main thread. */
  genBudgetMs: number;
  /** Finite world: only these chunks exist; everything outside is ocean. Defaults to the island. */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface BlockPos {
  x: number;
  y: number;
  z: number;
}

// One material per pass, shared by every chunk → minimal state changes per draw call.
const opaqueMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
const waterMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
});

const HALF_X = CHUNK_X / 2;
const HALF_Y = CHUNK_Y / 2;
const HALF_Z = CHUNK_Z / 2;
const CHUNK_SPHERE = new THREE.Sphere(
  new THREE.Vector3(HALF_X, HALF_Y, HALF_Z),
  Math.hypot(HALF_X, HALF_Y, HALF_Z),
);
const CHUNK_BOX = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(CHUNK_X, CHUNK_Y, CHUNK_Z));

const EMPTY_CHUNK = new Chunk(0, 0);

export class World {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<ChunkKey, ChunkEntry>();
  readonly terrain: TerrainGenerator;
  private readonly bounds;
  /** World positions of fire blocks (rendered by FireSystem). `fireVersion` bumps on change. */
  private readonly fireByChunk = new Map<ChunkKey, BlockPos[]>();
  fireVersion = 0;
  private readonly pool = new MeshWorkerPool();
  private wanted: [number, number][] = [];

  constructor(private readonly opts: WorldOptions) {
    this.terrain = new TerrainGenerator(opts.seed);
    this.bounds = opts.bounds ?? ISLAND_CHUNKS;
    this.group.name = 'world';
  }

  get fires(): BlockPos[] {
    return [...this.fireByChunk.values()].flat();
  }

  private inBounds(cx: number, cz: number): boolean {
    const b = this.bounds;
    return cx >= b.minX && cx <= b.maxX && cz >= b.minZ && cz <= b.maxZ;
  }

  get stats() {
    let meshed = 0;
    for (const e of this.chunks.values()) if (e.opaque || e.water) meshed++;
    return { loaded: this.chunks.size, meshed, meshQueue: this.pool.pending, workers: this.pool.size };
  }

  heightAt(x: number, z: number): number {
    return this.terrain.heightAt(Math.floor(x), Math.floor(z));
  }

  /** Call once per frame with the camera/player position. */
  update(_pos: THREE.Vector3): void {
    if (this.wanted.length === 0) {
      // Finite world: want every chunk in bounds, nearest to the centre first.
      const b = this.bounds;
      const mx = Math.round((b.minX + b.maxX) / 2);
      const mz = Math.round((b.minZ + b.maxZ) / 2);
      const r = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
      this.wanted = spiral(mx, mz, r).filter(([x, z]) => this.inBounds(x, z));
    }

    // Time-sliced generation: never spend more than genBudgetMs per frame.
    const deadline = performance.now() + this.opts.genBudgetMs;
    for (const [x, z] of this.wanted) {
      if (performance.now() > deadline) break;
      const key = chunkKey(x, z);
      if (!this.chunks.has(key)) {
        const chunk = this.terrain.generate(x, z);
        this.chunks.set(key, { chunk, version: 1, meshedVersion: 0, meshing: false });
        this.indexFires(key, chunk);
      }
    }

    // Dispatch meshing for chunks whose in-bounds neighbours exist.
    for (const [x, z] of this.wanted) {
      const e = this.chunks.get(chunkKey(x, z));
      if (!e || e.meshing || e.meshedVersion === e.version) continue;
      const padded = this.buildPadded(x, z);
      if (!padded) continue;
      this.dispatchMesh(e, padded);
    }
  }

  private indexFires(key: ChunkKey, chunk: Chunk): void {
    const list: BlockPos[] = [];
    const b = chunk.blocks;
    for (let i = 0; i < b.length; i++) {
      if (b[i] !== B.fire) continue;
      const lx = i % CHUNK_X;
      const lz = Math.floor(i / CHUNK_X) % CHUNK_Z;
      const y = Math.floor(i / (CHUNK_X * CHUNK_Z));
      list.push({ x: chunk.cx * CHUNK_X + lx, y, z: chunk.cz * CHUNK_Z + lz });
    }
    if (list.length > 0 || this.fireByChunk.has(key)) {
      if (list.length > 0) this.fireByChunk.set(key, list);
      else this.fireByChunk.delete(key);
      this.fireVersion++;
    }
  }

  getBlock(x: number, y: number, z: number): number {
    const e = this.chunks.get(chunkKey(Math.floor(x / CHUNK_X), Math.floor(z / CHUNK_Z)));
    if (!e) return 0;
    return e.chunk.get(((x % CHUNK_X) + CHUNK_X) % CHUNK_X, y, ((z % CHUNK_Z) + CHUNK_Z) % CHUNK_Z);
  }

  dispose(): void {
    for (const key of [...this.chunks.keys()]) this.unload(key);
    this.pool.dispose();
  }

  private dispatchMesh(e: ChunkEntry, padded: Uint8Array): void {
    e.meshing = true;
    const version = e.version;
    this.pool
      .mesh(padded, e.chunk.cx, e.chunk.cz)
      .then((data) => {
        e.meshing = false;
        if (this.chunks.get(chunkKey(e.chunk.cx, e.chunk.cz)) !== e) return; // unloaded meanwhile
        e.meshedVersion = version;
        this.applyMesh(e, data);
      })
      .catch((err: unknown) => {
        e.meshing = false;
        console.error('mesh worker failed', err);
      });
  }

  private applyMesh(e: ChunkEntry, data: ChunkMeshData): void {
    e.opaque = this.replaceMesh(e.opaque, data.opaque, opaqueMaterial, e.chunk, 0);
    e.water = this.replaceMesh(e.water, data.water, waterMaterial, e.chunk, 1);
  }

  private replaceMesh(
    old: THREE.Mesh | undefined,
    part: MeshPart,
    material: THREE.Material,
    chunk: Chunk,
    renderOrder: number,
  ): THREE.Mesh | undefined {
    if (old) {
      this.group.remove(old);
      old.geometry.dispose(); // leaking geometries is the #1 FPS killer
    }
    if (part.vertexCount === 0) return undefined;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(part.colors, 3, true));
    g.setIndex(new THREE.BufferAttribute(part.indices, 1));
    // Known bounds: skip the per-vertex computeBounding* loops.
    g.boundingSphere = CHUNK_SPHERE.clone();
    g.boundingBox = CHUNK_BOX.clone();
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(chunk.cx * CHUNK_X, 0, chunk.cz * CHUNK_Z);
    mesh.matrixAutoUpdate = false; // chunks never move
    mesh.updateMatrix();
    mesh.renderOrder = renderOrder;
    this.group.add(mesh);
    return mesh;
  }

  /** Chunk + one-block border from its 4 neighbours, or null if a neighbour isn't generated yet. */
  private buildPadded(cx: number, cz: number): Uint8Array | null {
    const self = this.chunks.get(chunkKey(cx, cz))?.chunk;
    // Neighbours outside the world bounds are open ocean (empty).
    const nb = (x: number, z: number) =>
      this.inBounds(x, z) ? this.chunks.get(chunkKey(x, z))?.chunk : EMPTY_CHUNK;
    const n = nb(cx, cz - 1);
    const s = nb(cx, cz + 1);
    const w = nb(cx - 1, cz);
    const ea = nb(cx + 1, cz);
    if (!self || !n || !s || !w || !ea) return null;
    const out = new Uint8Array(PAD_VOLUME);
    const src = self.blocks;
    for (let y = 0; y < CHUNK_Y; y++) {
      for (let z = 0; z < CHUNK_Z; z++) {
        // Copy one contiguous row of 16 blocks at a time.
        const from = localIndex(0, y, z);
        out.set(src.subarray(from, from + CHUNK_X), paddedIndex(0, y, z));
        out[paddedIndex(-1, y, z)] = w.blocks[localIndex(CHUNK_X - 1, y, z)] ?? 0;
        out[paddedIndex(CHUNK_X, y, z)] = ea.blocks[localIndex(0, y, z)] ?? 0;
      }
      for (let x = 0; x < CHUNK_X; x++) {
        out[paddedIndex(x, y, -1)] = n.blocks[localIndex(x, y, CHUNK_Z - 1)] ?? 0;
        out[paddedIndex(x, y, CHUNK_Z)] = s.blocks[localIndex(x, y, 0)] ?? 0;
      }
    }
    return out;
  }

  private unload(key: ChunkKey): void {
    const e = this.chunks.get(key);
    if (!e) return;
    for (const m of [e.opaque, e.water]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.chunks.delete(key);
    if (this.fireByChunk.delete(key)) this.fireVersion++;
  }
}

/** Chunk coords within `radius` (Chebyshev), nearest first. */
export function spiral(cx: number, cz: number, radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) out.push([cx + dx, cz + dz]);
  out.sort((a, b) => (a[0] - cx) ** 2 + (a[1] - cz) ** 2 - ((b[0] - cx) ** 2 + (b[1] - cz) ** 2));
  return out;
}
