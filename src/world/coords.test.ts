import { describe, expect, it } from 'vitest';
import { CHUNK_VOLUME, chunkKey, localIndex, paddedIndex, PAD_VOLUME, parseChunkKey, worldToChunk, worldToLocal } from './coords';

describe('coords', () => {
  it('maps negative world coords to the correct chunk and local coord', () => {
    expect(worldToChunk(-1, -16)).toEqual([-1, -1]);
    expect(worldToChunk(-17, 15)).toEqual([-2, 0]);
    expect(worldToLocal(-1, 16)).toBe(15);
    expect(worldToLocal(-16, 16)).toBe(0);
    expect(worldToLocal(33, 16)).toBe(1);
  });

  it('local index covers the volume without overlap', () => {
    expect(localIndex(0, 0, 0)).toBe(0);
    expect(localIndex(15, 63, 15)).toBe(CHUNK_VOLUME - 1);
    expect(localIndex(1, 0, 0) - localIndex(0, 0, 0)).toBe(1);
    expect(localIndex(0, 1, 0) - localIndex(0, 0, 0)).toBe(256);
  });

  it('padded index spans the border', () => {
    expect(paddedIndex(-1, 0, -1)).toBe(0);
    expect(paddedIndex(16, 63, 16)).toBe(PAD_VOLUME - 1);
  });

  it('round-trips chunk keys', () => {
    expect(parseChunkKey(chunkKey(-3, 7))).toEqual([-3, 7]);
  });
});
