import * as THREE from 'three';
import type { GameConfig } from './config';

export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dispose(): void;
}

const SKY = 0x87b5e8;

// Stylised palette: colours are authored in sRGB and should hit the screen exactly as written.
// Disabling colour management keeps vertex colours, fog and sky consistent without per-vertex conversion.
THREE.ColorManagement.enabled = false;

export function createRenderer(container: HTMLElement, cfg: GameConfig): RenderContext {
  const renderer = new THREE.WebGLRenderer({
    antialias: cfg.antialias, // off by default: MSAA is expensive and pixel-art blocks don't need it
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.maxPixelRatio));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // no extra encode pass: colours are already display-ready
  renderer.shadowMap.enabled = false; // baked face shading instead of real-time shadows
  renderer.setClearColor(SKY);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const viewDist = cfg.renderDistance * 16;
  // Fog hides chunk pop-in at the edge and lets us keep the far plane tight.
  scene.fog = new THREE.Fog(SKY, viewDist * 0.55, viewDist * 0.95);

  const camera = new THREE.PerspectiveCamera(cfg.fov, 1, 0.1, viewDist + 32);

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Recover gracefully if the GPU drops the context (driver reset, too many tabs).
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('WebGL context lost');
  });

  return {
    renderer,
    scene,
    camera,
    dispose() {
      ro.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
