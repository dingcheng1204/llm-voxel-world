---
name: voxel-engine
description: Conventions for this repo's Minecraft-like voxel engine (Three.js + TypeScript) — coordinate system, chunk layout, block IDs, meshing, raycasting, collision and world persistence. Use whenever writing or changing anything under src/engine, src/world or src/player, adding a block type, touching terrain generation, or debugging rendering/collision.
---

# Voxel engine conventions

These rules keep the engine, the AI agents and the save format agreeing on what a
"block at (x, y, z)" means. Do not change a convention here without updating this
file and docs/BLUEPRINT.md in the same commit.

## 1. Coordinate system

- Three.js default: **right-handed, Y up**. +X east, +Z south, -Z north.
- 1 world unit = 1 block = 1 meter.
- A block at integer coords `(x, y, z)` occupies `[x, x+1) × [y, y+1) × [z, z+1)`.
  Its center is `(x+0.5, y+0.5, z+0.5)`.
- World → block: `Math.floor(v)` per axis (never `Math.round`, never `| 0` — both break for negatives).
- World height: `y ∈ [0, 64)`. `y < 0` is solid bedrock for collision; `y ≥ 64` is air.
- Sea level: `y = 20`.

## 2. Chunks

- Chunk size: `CHUNK_X = 16`, `CHUNK_Z = 16`, `CHUNK_Y = 64` (full height, no vertical chunking).
- Chunk coords: `cx = Math.floor(x / 16)`, `cz = Math.floor(z / 16)`.
- Local coords: `lx = x - cx * 16` (use `((x % 16) + 16) % 16` if needed), same for z; `ly = y`.
- Chunk key: the string `` `${cx},${cz}` `` (used in maps, DB rows and save files).
- Storage: one `Uint8Array(16 * 16 * 64)` per chunk.
  Index: `i = lx + lz * 16 + ly * 256` (Y-major layers: a horizontal slice is contiguous).
- Helpers live in `src/world/coords.ts`: `worldToChunk`, `worldToLocal`, `localIndex`, `chunkKey`.
  Always use them; never inline the index math elsewhere.
- Render distance default: 6 chunks radius (configurable). Load in a spiral from the player outward.

## 3. Block registry

Block IDs are `Uint8` (0–255). **IDs are part of the save format — never renumber; only append.**

| id | name    | solid | transparent | notes                        |
|----|---------|-------|-------------|------------------------------|
| 0  | air     | no    | yes         | never rendered               |
| 1  | grass   | yes   | no          | top/side/bottom textures differ |
| 2  | dirt    | yes   | no          |                              |
| 3  | stone   | yes   | no          |                              |
| 4  | log     | yes   | no          | top/side differ              |
| 5  | leaves  | yes   | yes         | leaf/leaf faces culled while leaves are solid colour; revisit with alpha atlas |
| 6  | sand    | yes   | no          |                              |
| 7  | water   | no    | yes         | separate transparent mesh, no collision |
| 8  | planks  | yes   | no          |                              |
| 9  | glass   | yes   | yes         |                              |
| 10 | bedrock | yes   | no          | unbreakable                  |
| 11 | rock    | yes   | no          | darker 岩石, mountain tops / boulders |
| 12 | fire    | no    | yes         | `render: 'none'` — drawn by `scene/fire.ts` (animated instanced flames) |

The registry is `src/world/blocks.ts`: `BlockDef { id, name, solid, transparent, breakable, render, colors: { top, side, bottom } }`.
Blocks are **flat-coloured, no textures** (art direction §10). `render: 'none'` blocks (fire) are skipped by the mesher
and drawn by their own system. The mesher reads flat lookup tables (`FACE_RGB`, `IS_TRANSPARENT`, `RENDERS_AS_BLOCK`).

## 4. Meshing

- Phase 1: **face culling** — emit a face only if the neighbor in that direction is air or
  (transparent and a different block id). Neighbor lookups across chunk borders must read
  the adjacent chunk; if it is not loaded, treat it as air on the border (rebuild when it loads).
- Phase 2: **greedy meshing** per face direction, in a Web Worker (`src/world/mesher.worker.ts`).
- One `BufferGeometry` per chunk for opaque, one for water. Implemented in `src/world/mesher.ts`.
  Current attributes (compact on purpose): `position` as **Uint8** local coords, `color` as **Uint8 normalised**
  with directional shading baked in (top 1.0, ±X 0.8, ±Z 0.65, bottom 0.5); Uint16 indices unless > 65535 verts.
  `MeshBasicMaterial` (no lighting cost). Phase 1–2 add `uv` (atlas) and per-vertex AO.
- Meshing runs in `MeshWorkerPool` workers; the padded volume and the result buffers are **transferred**, not copied.
- Set `geometry.boundingSphere/boundingBox` from the known chunk bounds; never call `computeBoundingSphere`.
- Chunk meshes use `matrixAutoUpdate = false` and two shared materials.
- After a block edit, rebuild that chunk, plus the neighbor chunk if the block is on a border.
- Dispose the old geometry (`geometry.dispose()`) on every rebuild — leaks are the #1 FPS killer.

## 5. Terrain generation — a small island

- The world is **finite and small**: chunks `x, z ∈ [-3, 2]` (96 × 96 blocks, `ISLAND_CHUNKS` in `terrain.ts`).
  Everything outside is open ocean drawn by the ocean plane. Keep it small — it is a stage for the AI characters.
- Deterministic from the seed (`simplex-noise` + `alea`). Same seed ⇒ same world, everywhere.
- Shape: radial island (radius ≈ 34, noise-warped coastline), seabed slopes deeper towards the world edge,
  two rounded peaks (rock/stone with green foothills, one with a grass cap), a flat sandy plaza in the middle.
- Columns: top = grass / sand (beach + plaza) / stone / rock, 3 blocks of dirt or sand under it, stone, bedrock at `y = 0`.
- **No generated water blocks** — the animated ocean plane at `SEA_LEVEL + 0.82` is the sea. Water is still a placeable block.
- Hand-made structures are world-space block lists (`buildStructures`): campfire (log + fire), wooden crates, a dock.
- Decorative props (palms, bushes, boulders) come from `terrain.props` and are drawn by `scene/props.ts`
  (one InstancedMesh per kind). They have **no collision** yet.
- Generated chunks are NOT saved. Only player/agent **edits** are saved (see §8).

## 6. Raycasting (block picking)

- Use the voxel DDA (Amanatides & Woo) in `src/world/raycast.ts`, not `THREE.Raycaster` against meshes.
- Signature: `raycastVoxel(origin: Vector3, dir: Vector3, maxDist = 5): { block: Vec3i, normal: Vec3i, id } | null`.
- Break = set `block` to air. Place = set `block + normal` to the selected id, only if it does not
  intersect the player's (or any agent's) AABB.
- Agents use the same function for "what am I looking at".

## 7. Player physics

- AABB: width 0.6, height 1.8, eye height 1.62. Position = feet center.
- Gravity −28 m/s², jump velocity 9 m/s, walk 4.3 m/s, sprint 5.6 m/s.
- Fixed-timestep physics at 60 Hz with an accumulator; render interpolates.
- Collision: resolve per axis (Y first, then X, then Z) against solid blocks overlapping the AABB.
- Controls: `PointerLockControls`, WASD, Space jump, Shift sprint, LMB break, RMB place, 1–9 hotbar.
- **Agents use the same physics and collision code as the player.** No teleporting.

## 8. Persistence

- An edit is `{ x, y, z, id, by, t }` (`by` = `"player"` or an agent id, `t` = epoch ms).
- In memory: `edits: Map<chunkKey, Map<localIndex, id>>`, applied on top of generated terrain.
- Phase 1: save to `localStorage` key `voxel:world:<seed>` (JSON of edits).
- Phase 2+: Supabase table `world_edits` (see docs/BLUEPRINT.md). Last write wins per block.

## 9. Debugging checklist

Before saying a rendering/engine change works:
1. Run `npm run dev`, open the page with the Chrome DevTools MCP, and take a screenshot.
2. Check the console for WebGL errors / warnings.
3. Read the debug overlay (F3): FPS, draw calls, triangles, loaded chunks, player position.
   Targets: ≥ 60 FPS, < 200 draw calls at render distance 6.
4. If FPS drops, record a performance trace with Chrome DevTools MCP and find the slow function
   before changing code.

## 10. Art direction — cute low-poly island

Reference: a bright toy-like low-poly island (sand plaza, palm trees, grey faceted peaks, turquoise sea, white clouds).
- **Palette**: saturated and light. Grass `#84d64c`, sand `#f6dc96`, stone `#b9c1cc`, rock `#868e9c`, wood `#e3a865`/`#9a6438`,
  sea `#2fa7ee`, sky `#3f9ef2` → horizon `#bfe7ff`. Avoid dark, muddy or desaturated colours.
- **Blocks**: flat colours, baked directional shade per face, ±7 % per-block brightness tint (faceted, hand-painted look).
- **Props**: low-poly primitives (icosahedron/cone/cylinder), `flatShading`, jittered vertices, vertex colours,
  built once and drawn with `InstancedMesh`. Built with helpers in `scene/lowpoly.ts`.
- **Lighting**: hemisphere + one directional light, matching the baked block shading (sun from +X/+Y). No real-time shadows.
- **Sky & sea**: gradient dome, unlit faceted clouds, flat-shaded ocean with vertex-shader waves, horizon-coloured fog.
- New content must keep this look and stay within the performance budgets (docs/PERFORMANCE.md).

## 11. File map

```
src/engine/   renderer, game loop, input, debug overlay
src/world/    coords, blocks, chunk, terrain, mesher(.worker), raycast, world (edits + chunk manager)
src/player/   controller, physics, hotbar
src/scene/    environment (sky, ocean, clouds, lights), props, fire, lowpoly helpers
src/agents/   agent entity, action executor, pathfinding (uses world + player/physics)
```
