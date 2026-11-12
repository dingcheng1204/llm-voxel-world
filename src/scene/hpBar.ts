// A small health bar that floats above a character or monster (one sprite, redrawn only when the
// value changes). Green → yellow → red as health drops.

import * as THREE from 'three';

export class HpBar {
  readonly sprite: THREE.Sprite;
  /** No canvas when there is no DOM (headless tests / server simulation): the bar just isn't drawn. */
  private readonly canvas: HTMLCanvasElement | null =
    typeof document === 'undefined' ? null : document.createElement('canvas');
  private key = '';

  /** `icon`: an emoji drawn at the left (e.g. ⚔️ for players in combat mode), or '' for none. */
  constructor(
    private readonly icon = '',
    width = 0.9,
  ) {
    if (this.canvas) {
      this.canvas.width = 128;
      this.canvas.height = 24;
    }
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.canvas ? new THREE.CanvasTexture(this.canvas) : null,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sprite.scale.set(width, width * 0.19, 1);
    this.sprite.renderOrder = 2;
  }

  set(hp: number, max: number): void {
    const key = `${hp}/${max}`;
    if (key === this.key || !this.canvas) return;
    this.key = key;
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, 128, 24);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath();
    g.roundRect(0, 0, 128, 24, 12);
    g.fill();
    const x0 = this.icon ? 26 : 8;
    const w = 128 - x0 - 6;
    if (this.icon) {
      g.font = '16px system-ui';
      g.textBaseline = 'middle';
      g.fillText(this.icon, 4, 13);
    }
    g.fillStyle = '#e3e8f0';
    g.beginPath();
    g.roundRect(x0, 7, w, 10, 5);
    g.fill();
    const f = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    g.fillStyle = f > 0.5 ? '#5bc95b' : f > 0.25 ? '#f2b33d' : '#e8574a';
    if (f > 0) {
      g.beginPath();
      g.roundRect(x0, 7, Math.max(10, w * f), 10, 5);
      g.fill();
    }
    (this.sprite.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }

  dispose(): void {
    const m = this.sprite.material as THREE.SpriteMaterial;
    m.map?.dispose();
    m.dispose();
  }
}
