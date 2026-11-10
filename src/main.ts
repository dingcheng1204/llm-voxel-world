import * as THREE from 'three';
import { loadConfig } from './engine/config';
import { DebugOverlay } from './engine/debugOverlay';
import { GameLoop } from './engine/loop';
import { createRenderer } from './engine/renderer';
import { Environment } from './scene/environment';
import { FireSystem } from './scene/fire';
import { createProps } from './scene/props';
import { SEA_LEVEL } from './world/coords';
import { World } from './world/world';

const cfg = loadConfig();
const container = document.getElementById('app')!;
const ctx = createRenderer(container, cfg);

const world = new World({ seed: cfg.seed, renderDistance: cfg.renderDistance, genBudgetMs: cfg.genBudgetMs });
const env = new Environment();
const fire = new FireSystem();
const props = createProps(world.terrain.props);
ctx.scene.add(env.group, world.group, props, fire.mesh);

const overlay = new DebugOverlay(document.getElementById('debug')!, ctx.renderer);

// Phase 0 demo camera: slow orbit around the island. Replaced by the player in ROADMAP phase 1.
// ?orbit=0 freezes it; ?angle=<radians>, ?dist=<blocks>, ?h=<blocks above sea> set the view.
const params = new URLSearchParams(location.search);
const cam = ctx.camera;
const orbitSpeed = params.get('orbit') === '0' ? 0 : 0.05;
const startAngle = Number(params.get('angle') ?? 1.2);
const orbitRadius = Number(params.get('dist') ?? 62);
const orbitHeight = Number(params.get('h') ?? 34);
const target = new THREE.Vector3(world.terrain.plazaCenter.x, SEA_LEVEL + 4, world.terrain.plazaCenter.z - 6);
const prev = new THREE.Vector3();
const next = new THREE.Vector3();
let t = 0;

function orbit(time: number, out: THREE.Vector3): THREE.Vector3 {
  const a = startAngle + time * orbitSpeed;
  return out.set(target.x + Math.cos(a) * orbitRadius, SEA_LEVEL + orbitHeight, target.z + Math.sin(a) * orbitRadius);
}
orbit(0, next);
prev.copy(next);

const loop = new GameLoop(
  {
    update(dt) {
      t += dt;
      prev.copy(next);
      orbit(t, next);
    },
    render(alpha, frameDt) {
      cam.position.lerpVectors(prev, next, alpha);
      cam.lookAt(target);
      const time = t + alpha / cfg.tickRate;
      world.update(cam.position);
      fire.sync(world.fireVersion, world.fires);
      fire.update(time);
      env.update(time, cam);
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
    props: world.terrain.props.length,
    pos: `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
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
