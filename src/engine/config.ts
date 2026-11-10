// Runtime settings. Override any of them with URL params, e.g. ?rd=8&pr=1&seed=42
export interface GameConfig {
  seed: number;
  /** Chunk radius rendered around the camera. */
  renderDistance: number;
  /** Cap on devicePixelRatio — the single biggest GPU cost knob on HiDPI screens. */
  maxPixelRatio: number;
  fov: number;
  /** Main-thread terrain generation budget per frame (ms). */
  genBudgetMs: number;
  /** Fixed simulation rate (Hz). */
  tickRate: number;
  antialias: boolean;
}

export function loadConfig(search = location.search): GameConfig {
  const q = new URLSearchParams(search);
  const num = (k: string, d: number) => {
    const v = Number(q.get(k));
    return q.has(k) && Number.isFinite(v) ? v : d;
  };
  return {
    seed: num('seed', Number(import.meta.env.VITE_WORLD_SEED ?? 20261110)),
    renderDistance: Math.max(1, Math.min(16, Math.floor(num('rd', 6)))),
    maxPixelRatio: num('pr', 1.5),
    fov: num('fov', 75),
    genBudgetMs: num('gen', 4),
    tickRate: 60,
    antialias: q.get('aa') === '1',
  };
}
