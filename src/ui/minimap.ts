// In-game minimap (top right): the island, you (arrow), Clio and Gem, other players, and the places the
// characters have named. M or a click toggles a big map with names. Redrawn a few times a second.

import { drawMap, MAP_BOUNDS, renderIslandBase, type MapMarker } from './islandMap';

const SMALL_SCALE = 0.75;
const KEY = 'voxel:map-big';

export class Minimap {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private big: boolean;
  private lastDraw = 0;
  private scale = SMALL_SCALE;

  constructor(
    parent: HTMLElement,
    private readonly seed: number,
    private readonly markers: () => MapMarker[],
  ) {
    this.el = document.createElement('div');
    this.el.id = 'minimap';
    this.el.hidden = true;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '小島地圖');
    const hint = document.createElement('button');
    hint.type = 'button';
    hint.className = 'map-toggle';
    hint.addEventListener('click', () => this.toggle());
    this.canvas.addEventListener('click', () => this.toggle());
    this.el.append(this.canvas, hint);
    parent.append(this.el);
    this.ctx = this.canvas.getContext('2d')!;
    let saved = false;
    try {
      saved = localStorage.getItem(KEY) === '1';
    } catch {
      /* storage unavailable */
    }
    this.big = saved;
    window.addEventListener('resize', () => this.layout());
  }

  /** Builds the terrain picture (a few dozen ms) and shows the map. */
  show(): void {
    // Built a moment later so joining (pointer lock) is not held up by the render.
    setTimeout(() => {
      if (!this.base) this.base = renderIslandBase(this.seed);
      this.el.hidden = false;
      this.layout();
    }, 300);
  }

  toggle(): void {
    this.big = !this.big;
    try {
      localStorage.setItem(KEY, this.big ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    this.layout();
  }

  get isBig(): boolean {
    return this.big;
  }

  private layout(): void {
    if (!this.base) return;
    const maxH = window.innerHeight - 140;
    const maxW = window.innerWidth - 24;
    const want = this.big ? 2 : SMALL_SCALE;
    // Fit the screen (phones get a smaller map).
    const fit = Math.min(maxH / MAP_BOUNDS.height, maxW / MAP_BOUNDS.width);
    this.scale = Math.max(
      0.35,
      Math.min(want, this.big ? fit : Math.min(fit, window.innerWidth < 600 ? 0.5 : want)),
    );
    const w = Math.round(MAP_BOUNDS.width * this.scale);
    const h = Math.round(MAP_BOUNDS.height * this.scale);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.el.classList.toggle('big', this.big);
    const btn = this.el.querySelector<HTMLButtonElement>('.map-toggle')!;
    btn.textContent = this.big ? '縮小（M）' : '放大（M）';
    btn.setAttribute('aria-expanded', String(this.big));
    this.lastDraw = 0;
  }

  /** Call every frame; draws at most ~6 times a second. */
  update(nowMs: number): void {
    if (this.el.hidden || !this.base || nowMs - this.lastDraw < 160) return;
    this.lastDraw = nowMs;
    drawMap(this.ctx, this.base, this.markers(), {
      scale: this.scale,
      labels: this.big,
      font: this.big ? '700 13px ui-rounded, system-ui, sans-serif' : undefined,
    });
  }
}
