import type * as THREE from 'three';

/** F3 overlay. Collects every frame, but only writes to the DOM 4×/s (DOM writes are not free). */
export class DebugOverlay {
  private readonly frameMs = new Float32Array(240);
  private idx = 0;
  private filled = 0;
  private lastDraw = 0;
  private extra: () => Record<string, string | number> = () => ({});

  constructor(
    private readonly el: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.el.hidden = !this.el.hidden;
      }
    });
  }

  setExtra(fn: () => Record<string, string | number>): void {
    this.extra = fn;
  }

  /** Call right after renderer.render() so renderer.info reflects this frame. */
  frame(frameDt: number, now = performance.now()): void {
    this.frameMs[this.idx] = frameDt * 1000;
    this.idx = (this.idx + 1) % this.frameMs.length;
    this.filled = Math.min(this.filled + 1, this.frameMs.length);
    if (this.el.hidden || now - this.lastDraw < 250) return;
    this.lastDraw = now;

    const s = frameStats(this.frameMs.subarray(0, this.filled));
    const info = this.renderer.info;
    const lines: Record<string, string | number> = {
      FPS: `${s.fps.toFixed(0)}  (1% low ${s.low1.toFixed(0)})`,
      frame: `${s.avgMs.toFixed(2)} ms  max ${s.maxMs.toFixed(1)} ms`,
      'draw calls': info.render.calls,
      triangles: info.render.triangles.toLocaleString(),
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      'pixel ratio': this.renderer.getPixelRatio().toFixed(2),
      ...this.extra(),
    };
    this.el.textContent = Object.entries(lines)
      .map(([k, v]) => `${k.padEnd(12)} ${v}`)
      .join('\n');
  }
}

export interface FrameStats {
  fps: number;
  avgMs: number;
  maxMs: number;
  /** FPS of the slowest 1% of frames — the number that tells you about stutter. */
  low1: number;
}

export function frameStats(ms: ArrayLike<number>): FrameStats {
  const n = ms.length;
  if (n === 0) return { fps: 0, avgMs: 0, maxMs: 0, low1: 0 };
  let sum = 0;
  let max = 0;
  const sorted = Array.from(ms).sort((a, b) => b - a);
  for (const v of sorted) {
    sum += v;
    if (v > max) max = v;
  }
  const avg = sum / n;
  const worstCount = Math.max(1, Math.floor(n * 0.01));
  let worstSum = 0;
  for (let i = 0; i < worstCount; i++) worstSum += sorted[i]!;
  return { fps: 1000 / avg, avgMs: avg, maxMs: max, low1: 1000 / (worstSum / worstCount) };
}
