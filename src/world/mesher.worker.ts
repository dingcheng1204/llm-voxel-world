/// <reference lib="webworker" />
import { meshChunk, transferables } from './mesher';

export interface MeshRequest {
  jobId: number;
  padded: Uint8Array;
  cx: number;
  cz: number;
}

self.onmessage = (e: MessageEvent<MeshRequest>) => {
  const { jobId, padded, cx, cz } = e.data;
  const data = meshChunk(padded, cx, cz);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ jobId, data }, transferables(data));
};
