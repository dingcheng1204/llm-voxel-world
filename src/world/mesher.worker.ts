/// <reference lib="webworker" />
import { meshChunk, transferables } from './mesher';

export interface MeshRequest {
  jobId: number;
  padded: Uint8Array;
  cx: number;
  cz: number;
}

self.onmessage = (e: MessageEvent<MeshRequest>) => {
  const { jobId, padded } = e.data;
  const data = meshChunk(padded);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ jobId, data }, transferables(data));
};
