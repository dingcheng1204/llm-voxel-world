import { B } from './blocks';
import { CHUNK_VOLUME, CHUNK_X, CHUNK_Y, CHUNK_Z, localIndex } from './coords';

/** One 16×64×16 column of blocks. Pure data — no Three.js here. */
export class Chunk {
  readonly blocks: Uint8Array;

  constructor(
    readonly cx: number,
    readonly cz: number,
    blocks?: Uint8Array,
  ) {
    this.blocks = blocks ?? new Uint8Array(CHUNK_VOLUME);
  }

  get(lx: number, ly: number, lz: number): number {
    if (ly < 0) return B.bedrock; // solid below the world
    if (ly >= CHUNK_Y || lx < 0 || lx >= CHUNK_X || lz < 0 || lz >= CHUNK_Z) return 0;
    return this.blocks[localIndex(lx, ly, lz)] ?? 0;
  }

  set(lx: number, ly: number, lz: number, id: number): void {
    if (ly < 0 || ly >= CHUNK_Y || lx < 0 || lx >= CHUNK_X || lz < 0 || lz >= CHUNK_Z) return;
    this.blocks[localIndex(lx, ly, lz)] = id;
  }
}
