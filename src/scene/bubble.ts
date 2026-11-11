import * as THREE from 'three';

export type BubbleStyle = 'speech' | 'thought';

/**
 * A word-wrapped text bubble sprite (speech: white with a tail; thought: soft grey cloud dots).
 * Redraws its canvas only when the text changes.
 */
export class Bubble {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement('canvas');
  private text = '';

  constructor(private readonly style: BubbleStyle) {
    this.canvas.width = 512;
    this.canvas.height = 256;
    const tex = new THREE.CanvasTexture(this.canvas);
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }),
    );
    this.sprite.center.set(0.5, 0); // anchor at the bottom (the tail)
    this.sprite.renderOrder = 5;
    this.sprite.visible = false;
  }

  show(text: string, opacity = 1): void {
    if (text !== this.text) this.draw(text);
    this.sprite.visible = true;
    (this.sprite.material as THREE.SpriteMaterial).opacity = opacity;
  }

  hide(): void {
    this.sprite.visible = false;
  }

  private draw(text: string): void {
    this.text = text;
    const c = this.canvas.getContext('2d')!;
    const font =
      this.style === 'speech'
        ? '600 30px ui-rounded, "Nunito", system-ui, sans-serif'
        : 'italic 26px ui-rounded, system-ui, sans-serif';
    c.font = font;
    const lines = wrap(c, text, 440, 3);
    const lineH = this.style === 'speech' ? 38 : 34;
    const w = Math.min(480, Math.max(...lines.map((l) => c.measureText(l).width)) + 40);
    const h = lines.length * lineH + 26;
    const x = (512 - w) / 2;
    const tail = this.style === 'speech' ? 22 : 34;
    const y = 256 - h - tail;

    c.clearRect(0, 0, 512, 256);
    c.fillStyle = this.style === 'speech' ? 'rgba(255,255,255,0.96)' : 'rgba(236,240,250,0.9)';
    c.strokeStyle = this.style === 'speech' ? 'rgba(43,43,58,0.25)' : 'rgba(120,130,160,0.35)';
    c.lineWidth = 3;
    c.beginPath();
    c.roundRect(x, y, w, h, 22);
    c.fill();
    c.stroke();
    if (this.style === 'speech') {
      c.beginPath();
      c.moveTo(256 - 14, y + h - 1);
      c.lineTo(256, 256 - 2);
      c.lineTo(256 + 10, y + h - 1);
      c.closePath();
      c.fill();
    } else {
      for (const [dx, dy, r] of [
        [-6, 12, 9],
        [4, 26, 6],
      ] as const) {
        c.beginPath();
        c.arc(256 + dx, y + h + dy, r, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.fillStyle = this.style === 'speech' ? '#2b2b3a' : '#5a6078';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    lines.forEach((l, i) => c.fillText(l, 256, y + 13 + lineH * (i + 0.5)));

    const aspect = 512 / 256;
    const scale = this.style === 'speech' ? 2.6 : 2.2;
    this.sprite.scale.set(scale, scale / aspect, 1);
    (this.sprite.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }
}

/** Wrap by measured width; works for Chinese (no spaces) and English. */
function wrap(c: CanvasRenderingContext2D, text: string, max: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of Array.from(text)) {
    if (c.measureText(line + ch).width > max && line) {
      lines.push(line);
      line = ch.trimStart();
      if (lines.length === maxLines) break;
    } else {
      line += ch;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && Array.from(lines.join('')).length < Array.from(text).length) {
    lines[maxLines - 1] = lines[maxLines - 1]!.slice(0, -1) + '…';
  }
  return lines;
}
