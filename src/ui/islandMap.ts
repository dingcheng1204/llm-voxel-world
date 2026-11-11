// A top-down picture of the island, shared by the in-game minimap and the diary page.
// One pixel per block, north (−Z) up, east (+X) right. Colours come from the block registry (top faces),
// with hill shading from the north-west so mountains read at a glance. Built once from the seed.

import { BLOCKS, B } from '../world/blocks';
import { CHUNK_X, CHUNK_Z, SEA_LEVEL } from '../world/coords';
import { ISLAND_CHUNKS, TerrainGenerator } from '../world/terrain';

export const MAP_BOUNDS = {
  minX: ISLAND_CHUNKS.minX * CHUNK_X,
  minZ: ISLAND_CHUNKS.minZ * CHUNK_Z,
  width: (ISLAND_CHUNKS.maxX - ISLAND_CHUNKS.minX + 1) * CHUNK_X,
  height: (ISLAND_CHUNKS.maxZ - ISLAND_CHUNKS.minZ + 1) * CHUNK_Z,
} as const;

const SEA_SHALLOW = [0x5f, 0xcc, 0xf5];
const SEA_DEEP = [0x2a, 0x8f, 0xdb];
const LAKE = [0x4f, 0xbf, 0xf2];

/** Renders the island (terrain only; edits and props are left out) into a canvas, 1 px per block. */
export function renderIslandBase(seed: number, terrain = new TerrainGenerator(seed)): HTMLCanvasElement {
  const { minX, minZ, width: w, height: h } = MAP_BOUNDS;
  const heights = new Int16Array(w * h);
  const tops = new Uint8Array(w * h);
  const lake = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const c = terrain.column(minX + i, minZ + j);
      const k = i + j * w;
      heights[k] = c.h;
      tops[k] = c.top;
      lake[k] = c.waterTop !== undefined && c.waterTop > c.h ? 1 : 0;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(w, h);
  const px = img.data;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = i + j * w;
      const y = heights[k]!;
      let r: number, gg: number, b: number;
      if (lake[k]) {
        [r, gg, b] = LAKE as [number, number, number];
      } else if (y < SEA_LEVEL) {
        const t = Math.min(1, (SEA_LEVEL - y) / 12);
        r = SEA_SHALLOW[0]! + (SEA_DEEP[0]! - SEA_SHALLOW[0]!) * t;
        gg = SEA_SHALLOW[1]! + (SEA_DEEP[1]! - SEA_SHALLOW[1]!) * t;
        b = SEA_SHALLOW[2]! + (SEA_DEEP[2]! - SEA_SHALLOW[2]!) * t;
      } else {
        const top = tops[k] === B.air ? B.grass : tops[k]!;
        const col = BLOCKS[top]?.colors.top ?? 0x84d64c;
        // Hill shading: brighter on slopes facing the north-west light.
        const nw = heights[Math.max(0, i - 1) + Math.max(0, j - 1) * w]!;
        const shade = Math.max(0.72, Math.min(1.18, 1 + (nw - y) * -0.07 + (y - SEA_LEVEL) * 0.004));
        r = ((col >> 16) & 255) * shade;
        gg = ((col >> 8) & 255) * shade;
        b = (col & 255) * shade;
      }
      const o = k * 4;
      px[o] = Math.min(255, r);
      px[o + 1] = Math.min(255, gg);
      px[o + 2] = Math.min(255, b);
      px[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/** World (x, z) → map pixel (before scaling). */
export function toMap(x: number, z: number): [number, number] {
  return [x - MAP_BOUNDS.minX, z - MAP_BOUNDS.minZ];
}

export interface MapMarker {
  kind: 'me' | 'character' | 'player' | 'place';
  x: number;
  z: number;
  label: string;
  color: string;
  /** Radians, map space (0 = east, π/2 = south). Only for `me`. */
  heading?: number;
  highlight?: boolean;
}

export interface DrawOptions {
  /** Pixels per block. */
  scale: number;
  /** true = every name; 'people' = characters and players only (places only when highlighted). */
  labels: boolean | 'people';
  font?: string;
}

/** Draws the base map plus markers into `ctx` (already sized; ctx transform = device pixel ratio). */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  markers: MapMarker[],
  o: DrawOptions,
): void {
  const s = o.scale;
  ctx.imageSmoothingEnabled = s < 1;
  ctx.clearRect(0, 0, MAP_BOUNDS.width * s, MAP_BOUNDS.height * s);
  ctx.drawImage(base, 0, 0, MAP_BOUNDS.width * s, MAP_BOUNDS.height * s);
  const font = o.font ?? '600 12px ui-rounded, system-ui, sans-serif';
  // Places first (under the moving markers), then players, characters, and me on top.
  const order: MapMarker['kind'][] = ['place', 'player', 'character', 'me'];
  const sorted = [...markers].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || Number(!!a.highlight) - Number(!!b.highlight),
  );
  const labels: { text: string; x: number; y: number; color: string; strong: boolean }[] = [];
  for (const m of sorted) {
    const [mx, mz] = toMap(m.x, m.z);
    const x = mx * s;
    const y = mz * s;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    if (m.kind === 'place') {
      const r = m.highlight ? 6 : 3.6;
      if (m.highlight) {
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 214, 64, 0.45)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fillStyle = m.highlight ? '#ffcf3f' : '#ffffff';
      ctx.strokeStyle = '#3a3550';
      ctx.fill();
      ctx.stroke();
    } else if (m.kind === 'me') {
      ctx.rotate(m.heading ?? 0);
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-5, -5.5);
      ctx.lineTo(-2.5, 0);
      ctx.lineTo(-5, 5.5);
      ctx.closePath();
      ctx.fillStyle = m.color;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    } else {
      const r = m.kind === 'character' ? 5 : 4;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    if (o.labels === true || m.highlight || (o.labels === 'people' && m.kind !== 'place')) {
      labels.push({
        text: m.label,
        x,
        y,
        color: m.kind === 'place' ? '#3a3550' : m.color,
        strong: !!m.highlight,
      });
    }
  }
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const l of labels) {
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeText(l.text, l.x + 8, l.y);
    ctx.fillStyle = l.strong ? '#3a3550' : l.color;
    ctx.fillText(l.text, l.x + 8, l.y);
  }
}
