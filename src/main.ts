import * as THREE from 'three';
import { loadConfig } from './engine/config';
import { DebugOverlay } from './engine/debugOverlay';
import { GameLoop } from './engine/loop';
import { createRenderer } from './engine/renderer';
import { World } from './world/world';

const cfg = loadConfig();
const container = document.getElementById('app')!;
const ctx = createRenderer(container, cfg);
const world = new World({ seed: cfg.seed, renderDistance: cfg.renderDistance, genBudgetMs: cfg.genBudgetMs });
ctx.scene.add(world.group);

const overlay = new DebugOverlay(document.getElementById('debug')!, ctx.renderer);

// Phase 0 demo camera: a slow fly-around that exercises chunk streaming.
// Replaced by the first-person player in ROADMAP phase 1.
const cam = ctx.camera;
const prev = new THREE.Vector3();
const next = new THREE.Vector3();
let t = 0;
const flyRadius = 48;
const flySpeed = 0.08; // rad/s

function flyPosition(time: number, out: THREE.Vector3): THREE.Vector3 {
  const a = time * flySpeed;
  const x = Math.cos(a) * flyRadius;
  const z = Math.sin(a) * flyRadius;
  return out.set(x, Math.max(world.heightAt(x, z), 20) + 14, z);
}
flyPosition(0, next);
prev.copy(next);

const look = new THREE.Vector3();
const loop = new GameLoop(
  {
    update(dt) {
      t += dt;
      prev.copy(next);
      flyPosition(t, next);
      // Smooth the height so the camera doesn't jitter over terrain steps.
      next.y = prev.y + (next.y - prev.y) * 0.05;
    },
    render(alpha, frameDt) {
      cam.position.lerpVectors(prev, next, alpha);
      flyPosition(t + 6, look);
      cam.lookAt(look.x, cam.position.y - 6, look.z);
      world.update(cam.position);
      ctx.renderer.render(ctx.scene, cam);
      overlay.frame(frameDt);
    },
  },
  cfg.tickRate,
);

overlay.setExtra(() => {
  const s = world.stats;
  const p = cam.position;
  return {
    chunks: `${s.meshed}/${s.loaded}  queue ${s.meshQueue}  workers ${s.workers}`,
    pos: `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
    'render dist': cfg.renderDistance,
    dropped: loop.droppedTicks,
  };
});

loop.start();

// Expose for debugging from DevTools / MCP.
Object.assign(window, { __game: { cfg, ctx, world, loop } });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    world.dispose();
    ctx.dispose();
  });
}
