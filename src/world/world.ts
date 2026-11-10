import * as THREE from 'three';
import { Chunk } from './chunk';
import {
  CHUNK_X,
  CHUNK_Y,
  CHUNK_Z,
  PAD_VOLUME,
  chunkKey,
  localIndex,
  paddedIndex,
  type ChunkKey,
} from './coords';
import type { ChunkMeshData, MeshPart } from './mesher';
import { MeshWorkerPool } from './meshWorkerPool';
import { opaqueMaterial, waterMaterial } from './blockMaterials';
import { B, IS_SOLID } from './blocks';
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
  /** No meshing / workers (simulation only — tests, and later server-side agents). */
  headless?: boolean;
}

export interface BlockPos {
  x: number;
  y: number;
  z: number;
}

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
  /** Chunks changed by setBlock that need a priority re-mesh. */
  private readonly dirty = new Set<ChunkKey>();
  private readonly pool: MeshWorkerPool | null;
  private wanted: [number, number][] = [];

  constructor(private readonly opts: WorldOptions) {
    this.terrain = new TerrainGenerator(opts.seed);
    this.bounds = opts.bounds ?? ISLAND_CHUNKS;
    this.pool = opts.headless ? null : new MeshWorkerPool();
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
    const b = this.bounds;
    const total = (b.maxX - b.minX + 1) * (b.maxZ - b.minZ + 1);
    return {
      loaded: this.chunks.size,
      meshed,
      total,
      meshQueue: this.pool?.pending ?? 0,
      workers: this.pool?.size ?? 0,
    };
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
        // Saved / remote edits for this chunk are applied before it is ever meshed.
        const saved = this.pendingEdits.get(key);
        if (saved) {
          for (const [ex, ey, ez, id] of saved) chunk.set(ex - x * CHUNK_X, ey, ez - z * CHUNK_Z, id);
          this.pendingEdits.delete(key);
        }
        this.chunks.set(key, { chunk, version: 1, meshedVersion: 0, meshing: false });
        this.indexFires(key, chunk);
      }
    }

    if (!this.pool) {
      this.dirty.clear();
      return;
    }
    // Edited chunks first, at the front of the worker queue, so changes appear immediately.
    for (const key of this.dirty) {
      const e = this.chunks.get(key);
      if (!e || e.meshing) continue;
      this.dirty.delete(key);
      if (e.meshedVersion === e.version) continue;
      const padded = this.buildPadded(e.chunk.cx, e.chunk.cz);
      if (padded) this.dispatchMesh(e, padded, true);
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

  /** Generate every chunk immediately (headless simulation / tests). */
  loadAll(): void {
    const budget = this.opts.genBudgetMs;
    (this.opts as { genBudgetMs: number }).genBudgetMs = Infinity;
    this.update(new THREE.Vector3());
    (this.opts as { genBudgetMs: number }).genBudgetMs = budget;
  }

  /** Has the chunk containing (x, z) been generated? */
  isLoaded(x: number, z: number): boolean {
    return this.chunks.has(chunkKey(Math.floor(x / CHUNK_X), Math.floor(z / CHUNK_Z)));
  }

  /** Collision query: solid blocks, bedrock below the world, and the sea floor outside the island. */
  isSolid(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    if (y >= CHUNK_Y) return false;
    const cx = Math.floor(x / CHUNK_X);
    const cz = Math.floor(z / CHUNK_Z);
    if (!this.inBounds(cx, cz)) return y < 2; // endless sand floor plane
    return IS_SOLID[this.getBlock(x, y, z)] === 1;
  }

  /** Edits made this session ({x,y,z,id,by,t}); persisted in ROADMAP phase 2. */
  readonly edits: { x: number; y: number; z: number; id: number; by: string; t: number }[] = [];

  /** Called for every local edit (player or agent) — the save system listens here. */
  onEdit: (e: { x: number; y: number; z: number; id: number; by: string; t: number }) => void = () => {};
  /** Saved/remote edits for chunks that are not generated yet; applied right after generation. */
  private readonly pendingEdits = new Map<ChunkKey, [number, number, number, number][]>();

  /**
   * Change one block because a player or agent did something. Logged, saved and synced.
   * Returns false if the position is outside the loaded world.
   */
  setBlock(x: number, y: number, z: number, id: number, by = 'player'): boolean {
    const changed = this.writeBlock(x, y, z, id);
    if (changed === null) return false;
    if (changed) {
      const e = { x, y, z, id, by, t: Date.now() };
      this.edits.push(e);
      this.onEdit(e);
    }
    return true;
  }

  /**
   * Apply an edit that comes from a save file or from another client. Not logged or re-synced.
   * Works before the chunk exists (queued until it is generated).
   */
  applyEdit(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= CHUNK_Y) return;
    const cx = Math.floor(x / CHUNK_X);
    const cz = Math.floor(z / CHUNK_Z);
    if (!this.inBounds(cx, cz)) return;
    const key = chunkKey(cx, cz);
    if (this.chunks.has(key)) {
      this.writeBlock(x, y, z, id);
    } else {
      const list = this.pendingEdits.get(key) ?? [];
      list.push([x, y, z, id]);
      this.pendingEdits.set(key, list);
    }
  }

  /**
   * Low-level block write. Marks the chunk — and neighbours when the block sits on a border — for a
   * priority re-mesh; the old mesh stays visible until the new one arrives (no flicker).
   * Returns null if outside the loaded world, false if nothing changed, true if changed.
   */
  private writeBlock(x: number, y: number, z: number, id: number): boolean | null {
    if (y < 0 || y >= CHUNK_Y) return null;
    const cx = Math.floor(x / CHUNK_X);
    const cz = Math.floor(z / CHUNK_Z);
    const key = chunkKey(cx, cz);
    const e = this.chunks.get(key);
    if (!e) return null;
    const lx = x - cx * CHUNK_X;
    const lz = z - cz * CHUNK_Z;
    const old = e.chunk.get(lx, y, lz);
    if (old === id) return false;
    e.chunk.set(lx, y, lz, id);
    e.version++;
    this.dirty.add(key);
    const touch = (nx: number, nz: number) => {
      const nk = chunkKey(nx, nz);
      const n = this.chunks.get(nk);
      if (n) {
        n.version++;
        this.dirty.add(nk);
      }
    };
    if (lx === 0) touch(cx - 1, cz);
    if (lx === CHUNK_X - 1) touch(cx + 1, cz);
    if (lz === 0) touch(cx, cz - 1);
    if (lz === CHUNK_Z - 1) touch(cx, cz + 1);
    // AO reads diagonal neighbours, so corner edits also dirty the diagonal chunk.
    if ((lx === 0 || lx === CHUNK_X - 1) && (lz === 0 || lz === CHUNK_Z - 1)) {
      touch(lx === 0 ? cx - 1 : cx + 1, lz === 0 ? cz - 1 : cz + 1);
    }
    if (old === B.fire || id === B.fire) this.indexFires(key, e.chunk);
    return true;
  }

  /** y of the first free cell above the highest solid block at (x, z), or the terrain height if not loaded. */
  groundY(x: number, z: number): number {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    if (!this.chunks.has(chunkKey(Math.floor(bx / CHUNK_X), Math.floor(bz / CHUNK_Z)))) {
      return this.terrain.heightAt(bx, bz) + 1;
    }
    for (let y = CHUNK_Y - 1; y >= 0; y--) if (IS_SOLID[this.getBlock(bx, y, bz)] === 1) return y + 1;
    return 0;
  }

  dispose(): void {
    for (const key of [...this.chunks.keys()]) this.unload(key);
    this.pool?.dispose();
  }

  private dispatchMesh(e: ChunkEntry, padded: Uint8Array, urgent = false): void {
    e.meshing = true;
    const version = e.version;
    if (!this.pool) return;
    this.pool
      .mesh(padded, e.chunk.cx, e.chunk.cz, urgent)
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
    const nw = nb(cx - 1, cz - 1);
    const ne = nb(cx + 1, cz - 1);
    const sw = nb(cx - 1, cz + 1);
    const se = nb(cx + 1, cz + 1);
    if (!self || !n || !s || !w || !ea || !nw || !ne || !sw || !se) return null;
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
      // Corner columns (needed for ambient occlusion at chunk corners).
      out[paddedIndex(-1, y, -1)] = nw.blocks[localIndex(CHUNK_X - 1, y, CHUNK_Z - 1)] ?? 0;
      out[paddedIndex(CHUNK_X, y, -1)] = ne.blocks[localIndex(0, y, CHUNK_Z - 1)] ?? 0;
      out[paddedIndex(-1, y, CHUNK_Z)] = sw.blocks[localIndex(CHUNK_X - 1, y, 0)] ?? 0;
      out[paddedIndex(CHUNK_X, y, CHUNK_Z)] = se.blocks[localIndex(0, y, 0)] ?? 0;
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
  for (let dz = -radius; dz <= radius; dz++)
    for (let dx = -radius; dx <= radius; dx++) out.push([cx + dx, cz + dz]);
  out.sort((a, b) => (a[0] - cx) ** 2 + (a[1] - cz) ** 2 - ((b[0] - cx) ** 2 + (b[1] - cz) ** 2));
  return out;
}
