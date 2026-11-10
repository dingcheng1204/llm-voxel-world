// Block registry. IDs are part of the save format: append only, never renumber.
// Colours are the art direction (see voxel-engine skill §10): bright, saturated, toy-like.

export type FaceKind = 'top' | 'side' | 'bottom';

export interface BlockDef {
  id: number;
  name: string;
  solid: boolean;
  transparent: boolean;
  breakable: boolean;
  /** 'block' = part of the chunk mesh; 'none' = drawn by its own system (e.g. animated fire). */
  render: 'block' | 'none';
  /** 0xRRGGBB per face kind. */
  colors: Record<FaceKind, number>;
}

/** Named block ids for code (keep in sync with `defs`). */
export const B = {
  air: 0, grass: 1, dirt: 2, stone: 3, log: 4, leaves: 5,
  sand: 6, water: 7, planks: 8, glass: 9, bedrock: 10,
  rock: 11, fire: 12,
} as const;
export const AIR = B.air;

const all = (c: number) => ({ top: c, side: c, bottom: c });

const defs: BlockDef[] = [
  { id: 0, name: 'air', solid: false, transparent: true, breakable: false, render: 'none', colors: all(0) },
  { id: 1, name: 'grass', solid: true, transparent: false, breakable: true, render: 'block',
    colors: { top: 0x84d64c, side: 0x6cc243, bottom: 0xb07444 } },
  { id: 2, name: 'dirt', solid: true, transparent: false, breakable: true, render: 'block', colors: all(0xb07444) },
  { id: 3, name: 'stone', solid: true, transparent: false, breakable: true, render: 'block',
    colors: { top: 0xb9c1cc, side: 0xa6afbb, bottom: 0x8d96a3 } },
  { id: 4, name: 'log', solid: true, transparent: false, breakable: true, render: 'block',
    colors: { top: 0xe0b072, side: 0x9a6438, bottom: 0xe0b072 } },
  { id: 5, name: 'leaves', solid: true, transparent: true, breakable: true, render: 'block', colors: all(0x56c23e) },
  { id: 6, name: 'sand', solid: true, transparent: false, breakable: true, render: 'block',
    colors: { top: 0xf6dc96, side: 0xe9c97c, bottom: 0xd9b66a } },
  { id: 7, name: 'water', solid: false, transparent: true, breakable: false, render: 'block', colors: all(0x39a8f2) },
  { id: 8, name: 'planks', solid: true, transparent: false, breakable: true, render: 'block',
    colors: { top: 0xe3a865, side: 0xcf904e, bottom: 0xb87b3e } },
  { id: 9, name: 'glass', solid: true, transparent: true, breakable: true, render: 'block', colors: all(0xd6f1fb) },
  { id: 10, name: 'bedrock', solid: true, transparent: false, breakable: false, render: 'block', colors: all(0x4a4d5c) },
  { id: 11, name: 'rock', solid: true, transparent: false, breakable: true, render: 'block',
    colors: { top: 0x868e9c, side: 0x737b89, bottom: 0x5e6573 } },
  { id: 12, name: 'fire', solid: false, transparent: true, breakable: true, render: 'none', colors: all(0xff8a1f) },
];

export const BLOCKS: readonly BlockDef[] = defs;

// Flat lookup tables so hot loops (meshing) avoid object property access.
export const IS_TRANSPARENT = new Uint8Array(256).fill(1);
export const RENDERS_AS_BLOCK = new Uint8Array(256);
/** RGB per (id, faceKind): index = (id * 3 + kind) * 3, kind 0 = top, 1 = side, 2 = bottom. */
export const FACE_RGB = new Uint8Array(256 * 9);
for (const d of defs) {
  IS_TRANSPARENT[d.id] = d.transparent ? 1 : 0;
  RENDERS_AS_BLOCK[d.id] = d.render === 'block' ? 1 : 0;
  [d.colors.top, d.colors.side, d.colors.bottom].forEach((c, kind) => {
    const i = (d.id * 3 + kind) * 3;
    FACE_RGB[i] = (c >> 16) & 0xff;
    FACE_RGB[i + 1] = (c >> 8) & 0xff;
    FACE_RGB[i + 2] = c & 0xff;
  });
}
