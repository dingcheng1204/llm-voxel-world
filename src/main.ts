import * as THREE from 'three';
import { loadConfig } from './engine/config';
import { DebugOverlay } from './engine/debugOverlay';
import { GameLoop } from './engine/loop';
import { createRenderer } from './engine/renderer';
import { DayNight, WorldClock } from './scene/dayNight';
import { Environment } from './scene/environment';
import { FireSystem } from './scene/fire';
import { createProps } from './scene/props';
import { Agent } from './agents/Agent';
import { AgentView } from './agents/AgentView';
import { DemoBrain } from './agents/brains/demo';
import { LlmBrain } from './agents/brains/llm';
import { CAST } from './agents/cast';
import { ChatLog, Landmarks } from './agents/worldState';
import { Hotbar } from './player/hotbar';
import { Input } from './player/input';
import { PlayerController } from './player/controller';
import { SEA_LEVEL } from './world/coords';
import { WorldSave } from './world/persistence';
import { World } from './world/world';

const cfg = loadConfig();
const container = document.getElementById('app')!;
const ctx = createRenderer(container, cfg);

const world = new World({ seed: cfg.seed, renderDistance: cfg.renderDistance, genBudgetMs: cfg.genBudgetMs });
// Saving: local edits → localStorage (+ shared Supabase world on the deployed site).
const save = new WorldSave(cfg.seed, world, cfg.cloud);
if (cfg.resetLocal) save.clearLocal();
world.onEdit = (e) => save.record(e);
save.start();
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
const landmarks = new Landmarks();
const chat = new ChatLog();
let simTime = 0;
const agentCtx = {
  world,
  exec: {
    world,
    landmarks,
    bodies: () => [
      ...agents.map((a) => ({ id: a.id, pos: a.body.pos, halfWidth: 0.35, height: 0.95 })),
      ...(player ? [{ id: 'player', pos: player.bodyPos, halfWidth: 0.3, height: 1.8 }] : []),
    ],
  },
  perceive: {
    world,
    landmarks,
    chat,
    clock: {
      get day() {
        return clock.day;
      },
      get clock() {
        return clock.clock;
      },
      get t() {
        return clock.t;
      },
    },
    others: () => agents.map((a) => ({ id: a.id, pos: a.body.pos, doing: a.executor.doing })),
    now: 0,
  },
};
// Brains: Clio (cat) thinks with an LLM via /api/agent/think (MiniMax M3.1 Flash; the server enforces a
// shared daily budget and rate limit). If the API is unavailable Clio falls back to the script.
// The others still run scripted brains (same JSON contract). ?brain=demo forces scripts for everyone.
const llmAgents = new Set(new URLSearchParams(location.search).get('brain') === 'demo' ? [] : ['clio']);
const agents: Agent[] = CAST.map((m, i) => {
  const s = spawns[i]!;
  const home: [number, number, number] = [Math.floor(s.x), Math.floor(s.y), Math.floor(s.z)];
  const mode = m.species === 'cat' || m.species === 'wolf' ? 'gather' : 'explore';
  const script = new DemoBrain(mode, home, Math.random, 25);
  if (llmAgents.has(m.id)) return new Agent(m, s, new LlmBrain(m.id, script), agentCtx); // 6 s between thinks
  return new Agent(m, s, script, agentCtx, 1.5);
});
const views = agents.map((a) => new AgentView(a));
for (const v of views) ctx.scene.add(v.root, v.pathLine);

const params = new URLSearchParams(location.search);
// Shared world clock (1 game day = 20 real minutes). ?time=0.8 freezes it at that time of day (0 = midnight, 0.5 = noon).
const clock = new WorldClock(params.has('time') ? Number(params.get('time')) : null);
const dayNight = new DayNight(clock, env, ctx.scene, ctx.renderer);
ctx.scene.add(dayNight.group);
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
      agents.map((a) => ({ pos: a.body.pos })),
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
  return out.set(
    target.x + Math.cos(a) * orbitRadius,
    SEA_LEVEL + orbitHeight,
    target.z + Math.sin(a) * orbitRadius,
  );
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
      simTime += dt;
      if (!lineup) for (const a of agents) a.tick(dt, simTime);
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
      dayNight.update(cam, world.fires);
      for (const v of views) v.render(alpha, time, !debugEl.hidden);
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
    time: `day ${clock.day} · ${clock.clock}  night ${dayNight.night.toFixed(2)}`,
    save: `${save.status.saved} blocks  cloud ${save.status.cloud}${save.status.pending ? ` (${save.status.pending} pending)` : ''}`,
    chunks: `${s.meshed}/${s.loaded}  queue ${s.meshQueue}  workers ${s.workers}`,
    props: world.terrain.props.length,
    agents: agents.map((a) => `${a.member.name}:${a.executor.doing}`).join(' '),
    landmarks: landmarks.list.length,
    ...Object.fromEntries(
      agents
        .filter((a) => a.brain instanceof LlmBrain)
        .map((a) => {
          const st = (a.brain as LlmBrain).stats;
          return [
            `${a.id} brain`,
            `${st.mode}  calls ${st.calls}  $${st.cost.toFixed(4)}  today $${st.spentToday.toFixed(3)}/${st.budget || '?'}  ${st.lastMs}ms${st.lastError ? `  (${st.lastError})` : ''}`,
          ];
        }),
    ),
    pos: `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
    ...(player
      ? {
          player: `${player.flying ? 'flying' : player.inWater ? 'swimming' : player.body.onGround ? 'ground' : 'air'}  world edits ${world.edits.length}`,
          target: player.target ? `${player.target.block.join(',')} (${player.target.id})` : '-',
        }
      : {}),
    dropped: loop.droppedTicks,
  };
});

loop.start();

// Expose for debugging from DevTools / MCP.
Object.assign(window, {
  __game: { cfg, ctx, world, loop, agents, landmarks, chat, player, input, hotbar, clock, dayNight, save },
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    world.dispose();
    ctx.dispose();
  });
}
