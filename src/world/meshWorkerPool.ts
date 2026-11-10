import type { ChunkMeshData } from './mesher';
import type { MeshRequest } from './mesher.worker';

interface Job {
  jobId: number;
  padded: Uint8Array;
  resolve: (d: ChunkMeshData) => void;
  reject: (e: unknown) => void;
}

/** Small worker pool so meshing never blocks the render thread. */
export class MeshWorkerPool {
  private readonly idle: Worker[] = [];
  private readonly busy = new Map<Worker, Job>();
  private readonly queue: Job[] = [];
  private nextId = 1;

  constructor(size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ jobId: number; data: ChunkMeshData }>) => this.finish(w, e.data.data);
      w.onerror = (e) => this.fail(w, e);
      this.idle.push(w);
    }
  }

  get size(): number {
    return this.idle.length + this.busy.size;
  }

  get pending(): number {
    return this.queue.length + this.busy.size;
  }

  /** `padded` is transferred (neutered) — do not reuse it after calling. */
  mesh(padded: Uint8Array): Promise<ChunkMeshData> {
    return new Promise((resolve, reject) => {
      this.queue.push({ jobId: this.nextId++, padded, resolve, reject });
      this.pump();
    });
  }

  dispose(): void {
    for (const w of [...this.idle, ...this.busy.keys()]) w.terminate();
    this.idle.length = 0;
    this.busy.clear();
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.busy.set(w, job);
      const msg: MeshRequest = { jobId: job.jobId, padded: job.padded };
      w.postMessage(msg, [job.padded.buffer as ArrayBuffer]);
    }
  }

  private finish(w: Worker, data: ChunkMeshData): void {
    const job = this.busy.get(w);
    this.busy.delete(w);
    this.idle.push(w);
    job?.resolve(data);
    this.pump();
  }

  private fail(w: Worker, e: unknown): void {
    const job = this.busy.get(w);
    this.busy.delete(w);
    this.idle.push(w);
    job?.reject(e);
    this.pump();
  }
}
