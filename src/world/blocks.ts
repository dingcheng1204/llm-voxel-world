// Block registry. IDs are part of the save format: append only, never renumber.
// `color` is a temporary stand-in until the texture atlas lands (ROADMAP phase 1).

export interface BlockDef {
  id: number;
  name: string;
  solid: boolean;
  transparent: boolean;
  breakable: boolean;
  color: number; // 0xRRGGBB
}

/** Named block ids for code (keep in sync with `defs`). */
export const B = {
  air: 0, grass: 1, dirt: 2, stone: 3, log: 4, leaves: 5,
  sand: 6, water: 7, planks: 8, glass: 9, bedrock: 10,
} as const;
export const AIR = B.air;

const defs: BlockDef[] = [
  { id: 0, name: 'air', solid: false, transparent: true, breakable: false, color: 0x000000 },
  { id: 1, name: 'grass', solid: true, transparent: false, breakable: true, color: 0x5fae3a },
  { id: 2, name: 'dirt', solid: true, transparent: false, breakable: true, color: 0x8a5a36 },
  { id: 3, name: 'stone', solid: true, transparent: false, breakable: true, color: 0x8c8c8c },
  { id: 4, name: 'log', solid: true, transparent: false, breakable: true, color: 0x6b4a2b },
  { id: 5, name: 'leaves', solid: true, transparent: true, breakable: true, color: 0x3f8a2c },
  { id: 6, name: 'sand', solid: true, transparent: false, breakable: true, color: 0xdccf8e },
  { id: 7, name: 'water', solid: false, transparent: true, breakable: false, color: 0x3a6fd8 },
  { id: 8, name: 'planks', solid: true, transparent: false, breakable: true, color: 0xb88a52 },
  { id: 9, name: 'glass', solid: true, transparent: true, breakable: true, color: 0xcfe8f0 },
  { id: 10, name: 'bedrock', solid: true, transparent: false, breakable: false, color: 0x333333 },
];

export const BLOCKS: readonly BlockDef[] = defs;

// Flat lookup tables so hot loops (meshing) avoid object property access.
export const IS_TRANSPARENT = new Uint8Array(256).fill(1);
export const BLOCK_RGB = new Uint8Array(256 * 3);
for (const d of defs) {
  IS_TRANSPARENT[d.id] = d.transparent ? 1 : 0;
  BLOCK_RGB[d.id * 3] = (d.color >> 16) & 0xff;
  BLOCK_RGB[d.id * 3 + 1] = (d.color >> 8) & 0xff;
  BLOCK_RGB[d.id * 3 + 2] = d.color & 0xff;
}
