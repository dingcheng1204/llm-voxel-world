import * as THREE from 'three';
import { loadConfig } from './engine/config';
import { DebugOverlay } from './engine/debugOverlay';
import { GameLoop } from './engine/loop';
import { createRenderer } from './engine/renderer';
import { Environment } from './scene/environment';
import { FireSystem } from './scene/fire';
import { createProps } from './scene/props';
import { AgentBody } from './agents/AgentBody';
import { CAST } from './agents/cast';
import { WanderBrain } from './agents/wanderBrain';
import { Hotbar } from './player/hotbar';
import { Input } from './player/input';
import { PlayerController } from './player/controller';
import { SEA_LEVEL } from './world/coords';
import { World } from './world/world';

const cfg = loadConfig();
const container = document.getElementById('app')!;
const ctx = createRenderer(container, cfg);

const world = new World({ seed: cfg.seed, renderDistance: cfg.renderDistance, genBudgetMs: cfg.genBudgetMs });
const env = new Environment();
const fire = new FireSystem();
const props = createProps(world.terrain.props);
props.visible = false;
ctx.scene.add(env.group, world.group, props, fire.mesh);

// The four characters. Same body and abilities; only the species model differs.
// ?lineup=1 stands them in a row facing the camera (handy for checking the models).
const lineup = new URLSearchParams(location.search).get('lineup') === '1';
const plaza = world.terrain.plaza;
const spawns = lineup
  ? CAST.map((_, i) => {
      const x = plaza.x - 3.5 + i * 2.3;
      const z = plaza.z + 7;
      return { x, y: world.terrain.heightAt(x, z) + 1, z };
    })
  : world.terrain.spawnPoints(CAST.length);
const agents = CAST.map((m, i) => new AgentBody(m, spawns[i]!));
const brains = lineup ? [] : agents.map((a) => new WanderBrain(a, plaza, plaza.r - 2));
for (const a of agents) ctx.scene.add(a.view);

const params = new URLSearchParams(location.search);
const debugEl = document.getElementById('debug')!;
if (params.get('debug') === '1') debugEl.hidden = false;
const overlay = new DebugOverlay(debugEl, ctx.renderer);

// Two camera modes:
//  - play (default): first-person player — click to lock the mouse.
//  - demo (?view=overview or ?lineup=1): slow orbit camera, handy for screenshots and checks.
//    ?orbit=0 freezes it; ?angle= ?dist= ?h= fine-tune the view.
const demo = params.get('view') === 'overview' || lineup;
const input = new Input(ctx.renderer.domElement);
const hotbarEl = document.getElementById('hotbar')!;
const hotbar = new Hotbar(hotbarEl);
const player = demo
  ? null
  : new PlayerController(world, input, hotbar, ctx.camera, { x: plaza.x + 0.5, z: plaza.z + 5.5 }, () =>
      agents.map((a) => ({ pos: a.pos })),
    );
if (player) {
  ctx.scene.add(player.object);
  const playOverlay = document.getElementById('play-overlay')!;
  const crosshair = document.getElementById('crosshair')!;
  playOverlay.hidden = false;
  hotbarEl.hidden = false;
  playOverlay.addEventListener('click', () => input.requestLock());
  input.onLockChange = (locked) => {
    playOverlay.hidden = locked;
    crosshair.hidden = !locked;
  };
}
const cam = ctx.camera;
const orbitSpeed = params.get('orbit') === '0' ? 0 : 0.05;
const startAngle = Number(params.get('angle') ?? (params.get('lineup') === '1' ? Math.PI / 2 : 1.2));
const overview = params.get('view') === 'overview';
const orbitRadius = Number(params.get('dist') ?? (overview ? 210 : params.get('lineup') === '1' ? 6.5 : 15));
const orbitHeight = Number(params.get('h') ?? (overview ? 120 : params.get('lineup') === '1' ? 4.5 : 7));
const target = lineup
  ? new THREE.Vector3(plaza.x, SEA_LEVEL + 3.6, plaza.z + 7)
  : overview
  ? new THREE.Vector3(0, SEA_LEVEL, -10)
  : new THREE.Vector3(world.terrain.plaza.x, SEA_LEVEL + 3, world.terrain.plaza.z);
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
      player?.tick(dt);
      for (const b of brains) b.tick(dt);
      for (const a of agents) a.tick(dt, world);
    },
    render(alpha, frameDt) {
      if (player) {
        player.render(alpha);
      } else {
        cam.position.lerpVectors(prev, next, alpha);
        cam.lookAt(target);
      }
      const time = t + alpha / cfg.tickRate;
      world.update(cam.position);
      // Props appear once the terrain under them exists (no floating palms while loading).
      if (!props.visible && world.stats.meshed === world.stats.total) props.visible = true;
      fire.sync(world.fireVersion, world.fires);
      fire.update(time);
      env.update(time, cam);
      for (const a of agents) a.render(alpha, time);
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
    agents: agents.map((a) => `${a.member.name}(${a.member.species})`).join(' '),
    pos: `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
    ...(player
      ? {
          player: `${player.flying ? 'flying' : player.inWater ? 'swimming' : player.body.onGround ? 'ground' : 'air'}  edits ${world.edits.length}`,
          target: player.target ? `${player.target.block.join(',')} (${player.target.id})` : '-',
        }
      : {}),
    dropped: loop.droppedTicks,
  };
});

loop.start();

// Expose for debugging from DevTools / MCP.
Object.assign(window, { __game: { cfg, ctx, world, loop, agents, player, input, hotbar } });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    world.dispose();
    ctx.dispose();
  });
}
