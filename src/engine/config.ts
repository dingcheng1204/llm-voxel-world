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
  /** Shared cloud save (Supabase). null = local save only. */
  cloud: { url: string; anonKey: string } | null;
  /** ?reset=1 clears this browser's local save on start. */
  resetLocal: boolean;
}

// Public project values (safe in the browser — RLS + the edge function guard all writes).
// Override with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://payozwqnnjmoicomoeej.supabase.co';
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBheW96d3Fubmptb2ljb21vZWVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzMjE4ODMsImV4cCI6MjEwOTg5Nzg4M30.2ryVbZ3Fog0Y96QYC7fpq8BUNJhETTL9NBkr4QXwFfE';

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
    // The deployed site shares one world in the cloud; local dev stays local unless ?cloud=1,
    // so experiments never touch the shared island.
    cloud:
      q.get('cloud') === '0' || (import.meta.env.DEV && q.get('cloud') !== '1')
        ? null
        : { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY },
    resetLocal: q.get('reset') === '1',
  };
}
