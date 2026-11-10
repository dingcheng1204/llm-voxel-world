import * as THREE from 'three';

/** Small rounded name label that always faces the camera. One sprite (= one draw call) per character. */
export function createNameTag(name: string, subtitle: string, color: string): THREE.Sprite {
  const w = 256;
  const h = 80;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  roundRect(ctx, 4, 4, w - 8, h - 8, 26);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(34, h / 2, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2b2b3a';
  ctx.font = 'bold 30px ui-rounded, "Nunito", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 56, h / 2 - 9);
  ctx.fillStyle = '#7a7a8c';
  ctx.font = '20px ui-rounded, system-ui, sans-serif';
  ctx.fillText(subtitle, 57, h / 2 + 17);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 1;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(1.6, 0.5, 1);
  sprite.renderOrder = 2;
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
