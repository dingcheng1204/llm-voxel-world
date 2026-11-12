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
import { AgentSync } from './agents/sync';
import { CAST } from './agents/cast';
import { ChatLog, Landmarks } from './agents/worldState';
import { Hotbar } from './player/hotbar';
import { TouchControls, wantsTouch } from './player/touch';
import { Input } from './player/input';
import { PlayerController, type Hittable } from './player/controller';
import { Inventory, STARTER_KIT } from './player/inventory';
import { Bolts } from './player/bolts';
import { GEAR, STARTER_GEAR } from './player/equipment';
import { GearPanel } from './ui/gearPanel';
import { Slimes, SLIME } from './monsters/slimes';
import { Hud } from './ui/hud';
import { Account } from './save/account';
import { SaveManager, type SaveStatus } from './save/saveManager';
import type { PlayerSaveData } from './save/playerSave';
import { acceptHit } from './multiplayer/pvp';
import { B } from './world/blocks';
import { SEA_LEVEL } from './world/coords';
import { WorldSave } from './world/persistence';
import { World } from './world/world';
import {
  checkName,
  loadIdentity,
  newPlayerId,
  saveIdentity,
  SPECIES_COLOR,
  SPECIES_LABEL,
  type Identity,
} from './multiplayer/identity';
import { Island, type LiveMessage } from './multiplayer/island';
import { RemotePlayers } from './multiplayer/RemotePlayers';
import { createModel, PLAYER_SPECIES, type PlayerSpecies } from './agents/species';
import { createNameTag } from './scene/nameTag';
import { ChatWindow } from './ui/chat';
import { SiteGhosts } from './scene/sites';
import { blueprint } from './world/blueprints';
import { Minimap } from './ui/minimap';
import { isScriptPlace, type MapMarker } from './ui/islandMap';

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
      const x = plaza.x - 4.6 + i * 2.3;
      const z = plaza.z + 7;
      return { x, y: world.terrain.heightAt(x, z) + 1, z };
    })
  : world.terrain.spawnPoints(CAST.length);
// The human player: a name and an animal (snake / tiger / monkey), chosen when joining.
let me: Identity = loadIdentity() ?? { id: newPlayerId(), name: '', species: 'tiger' };
let joined = false;
let remote: RemotePlayers | null = null;

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
    // Characters see each other and the players (this one and everyone else online).
    others: () => [
      ...agents.map((a) => ({ id: a.id, pos: a.body.pos, doing: a.executor.doing })),
      ...(player && joined ? [{ id: me.id, name: me.name, pos: player.bodyPos, doing: 'player' }] : []),
      ...(remote ? remote.list().map((r) => ({ id: r.id, name: r.name, pos: r.pos, doing: 'player' })) : []),
    ],
    now: 0,
    areaAt: (x: number, z: number) => world.terrain.biomeAt(x, z),
  },
};
// Brains: Clio (cat) thinks with an LLM via /api/agent/think (MiniMax M3.1 Flash; the server enforces a
// shared daily budget and rate limit). If the API is unavailable Clio falls back to the script.
// The others still run scripted brains (same JSON contract). ?brain=demo forces scripts for everyone.
// Seconds between LLM thinks while a tab drives the character (Gem's Gemini free tier allows 500 calls a day).
const LLM_THINK_GAP: Record<string, number> = { clio: 6, gem: 20 };
const llmAgents = new Set(
  new URLSearchParams(location.search).get('brain') === 'demo' ? [] : Object.keys(LLM_THINK_GAP),
);
const scripts = new Map<string, DemoBrain>();
const agents: Agent[] = CAST.map((m, i) => {
  const s = spawns[i]!;
  const home: [number, number, number] = [Math.floor(s.x), Math.floor(s.y), Math.floor(s.z)];
  const mode = m.species === 'cat' || m.species === 'wolf' ? 'gather' : 'explore';
  const script = new DemoBrain(mode, home, Math.random, 25);
  scripts.set(m.id, script);
  if (llmAgents.has(m.id)) return new Agent(m, s, new LlmBrain(m.id, script), agentCtx, LLM_THINK_GAP[m.id]);
  return new Agent(m, s, script, agentCtx, 1.5);
});
// Server-run characters are shared by everyone and keep living when nobody watches: the visible tab
// holding the lease drives (LLM_THINK_GAP); other tabs mirror; otherwise the server tick runs them
// (Clio every minute, Gem every 4 minutes).
// Only a tab whose game loop is really running may drive (see agents/sync.ts).
let lastUpdateAt = 0;
const simulating = () => document.visibilityState !== 'hidden' && performance.now() - lastUpdateAt < 2000;
const syncs = new Map<string, AgentSync>();
const llmBrains = new Map<string, LlmBrain>();
for (const a of agents) {
  if (!(a.brain instanceof LlmBrain)) continue;
  const brain = a.brain;
  // Not server-run (provider key missing) → the character keeps its script, thinking every 1.5 s.
  const sync = new AgentSync(
    a,
    landmarks,
    brain,
    undefined,
    undefined,
    undefined,
    simulating,
    scripts.get(a.id),
    1.5,
  );
  brain.clientId = sync.clientId;
  brain.onLostLease = () => sync.lostLease();
  syncs.set(a.id, sync);
  llmBrains.set(a.id, brain);
  sync.start();
}
save.saveBy = (by) => by === 'player' || syncs.get(by)?.role === 'driver';
const views = agents.map((a) => new AgentView(a));
for (const v of views) ctx.scene.add(v.root, v.pathLine);
// Building sites the characters planned: translucent blocks still to place, with a sign above.
const siteGhosts = new SiteGhosts(
  world,
  landmarks.sites,
  (id) => agents.find((a) => a.id === id)?.member.name ?? id,
  (id) => agents.find((a) => a.id === id)?.member.tagColor ?? '#5b6b86',
);
ctx.scene.add(siteGhosts.group);
// ?lineup=1 also stands up the three animals players can pick, to check the models.
const lineupModels = lineup
  ? PLAYER_SPECIES.map((sp, i) => {
      const m = createModel(sp);
      const x = plaza.x - 4.6 + (CAST.length + i) * 2.3;
      const z = plaza.z + 7;
      m.root.position.set(x, world.terrain.heightAt(x, z) + 1, z);
      const tag = createNameTag(SPECIES_LABEL[sp], '玩家', SPECIES_COLOR[sp]);
      tag.position.y = sp === 'snake' ? 1.15 : 1.75;
      m.root.add(tag);
      ctx.scene.add(m.root);
      return m;
    })
  : [];

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
const inventory = new Inventory();
const hotbar = new Hotbar(hotbarEl, inventory);
// Night slimes (local to this player; the plaza is a safe zone).
const slimes = new Slimes(world, plaza);
ctx.scene.add(slimes.group);
// Magic bolts (mine can hit; other players' are drawn only).
const bolts = new Bolts();
ctx.scene.add(bolts.group);
/** Other players I can hit: only those in combat mode (and only while I am too — see pvp.ts). */
const pvpTargets = (): Hittable[] =>
  (remote?.list() ?? [])
    .filter((r) => r.combat?.mode === 'combat' && !r.combat.dead)
    .map((r) => ({
      id: r.id,
      x: r.pos.x,
      y: r.pos.y,
      z: r.pos.z,
      hit: (dmg: number, _x: number, _z: number, kind: 'melee' | 'magic') => island?.sendHit(r.id, dmg, kind),
    }));
const player = demo
  ? null
  : new PlayerController(
      world,
      input,
      hotbar,
      ctx.camera,
      { x: plaza.x + 0.5, z: plaza.z + 5.5 },
      () => agents.map((a) => ({ pos: a.body.pos })),
      () => [...slimes.targets(), ...pvpTargets()],
      bolts,
    );
player?.setSpecies(me.species);
const hud = new Hud(document.body);
// ---- Joining, live players and chat (deployed site only: needs Supabase Realtime + /api/chat/say) ----
let island: Island | null = null;
let chatWindow: ChatWindow | null = null;
let typing = false;
let touch: TouchControls | null = null;
const nameCache = new Map<string, string>();
// ---- Accounts and saves: one save per player (position, facing, hp, inventory) ----
const account = cfg.cloud && player ? new Account() : null;
let deadScreen = false;
const saves = new SaveManager(cfg.seed, account, (): PlayerSaveData | null => {
  if (!player || !joined) return null;
  // Dead (or reloading on the death screen): the save is already the respawned state.
  const dead = player.dead;
  const sp = player.spawnPoint;
  const b = player.bodyPos;
  return {
    v: 1,
    playerId: me.id,
    name: me.name,
    species: me.species,
    pos: dead ? [sp.x, sp.y, sp.z] : [b.x, b.y, b.z],
    yaw: player.yaw,
    hp: dead ? player.vitals.maxHp : Math.max(1, Math.round(player.vitals.hp)),
    maxHp: player.vitals.maxHp,
    maxStamina: player.vitals.maxStamina,
    inventory: dead ? STARTER_KIT.map((s) => ({ ...s })) : inventory.toJSON(),
    gear: dead ? { ...STARTER_GEAR, bag: [] } : player.equipment.toJSON(),
    savedAt: Date.now(),
  };
});
/** A save waiting to be applied when the player enters the island. */
let pendingSave: PlayerSaveData | null = player ? saves.loadGuest() : null;
let lastPvp: { by: string; at: number } | null = null;
const lastHitFrom = new Map<string, number>();
// Minimap (top right): you, the characters, other players and the places the characters named.
const minimap = player
  ? new Minimap(document.body, cfg.seed, () => {
      const out: MapMarker[] = landmarks.list
        .filter((l) => !isScriptPlace(l.name))
        .map((l) => ({
          kind: 'place',
          x: l.pos[0] + 0.5,
          z: l.pos[2] + 0.5,
          label: l.name,
          color: '#3a3550',
        }));
      for (const site of landmarks.sites.active()) {
        out.push({
          kind: 'site',
          x: site.origin[0] + 1.5,
          z: site.origin[2] + 1.5,
          label: blueprint(site.blueprint)?.name ?? site.blueprint,
          color: agents.find((a) => a.id === site.by)?.member.tagColor ?? '#5b6b86',
        });
      }
      for (const a of agents) {
        out.push({
          kind: 'character',
          x: a.body.pos.x,
          z: a.body.pos.z,
          label: a.member.name,
          color: a.member.tagColor,
        });
      }
      for (const r of remote?.list() ?? []) {
        const sp = island?.players.get(r.id)?.species;
        out.push({
          kind: 'player',
          x: r.pos.x,
          z: r.pos.z,
          label: r.name,
          color: sp ? SPECIES_COLOR[sp] : '#5b6b86',
        });
      }
      if (player) {
        const b = player.bodyPos;
        // Facing direction (−sin yaw, −cos yaw) in x/z → canvas angle.
        const heading = Math.atan2(-Math.cos(player.yaw), -Math.sin(player.yaw));
        out.push({
          kind: 'me',
          x: b.x,
          z: b.z,
          label: me.name || '你',
          color: SPECIES_COLOR[me.species],
          heading,
        });
      }
      return out;
    })
  : null;
if (player) {
  ctx.scene.add(player.object);
  const playOverlay = document.getElementById('play-overlay')!;
  const crosshair = document.getElementById('crosshair')!;
  const form = document.getElementById('join') as HTMLFormElement;
  const nameInput = document.getElementById('join-name') as HTMLInputElement;
  const errorEl = document.getElementById('join-error')!;
  const goBtn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const saveRow = document.getElementById('save-row')!;
  const saveWhen = document.getElementById('save-when')!;
  playOverlay.hidden = false;
  hotbarEl.hidden = false;
  const showIdentity = () => {
    nameInput.value = me.name;
    form.querySelector<HTMLInputElement>(`input[name=species][value=${me.species}]`)!.checked = true;
    if (me.name) goBtn.textContent = '繼續';
  };
  // A guest save in this browser: resume as that name and animal.
  if (pendingSave)
    me = { ...me, id: pendingSave.playerId, name: pendingSave.name, species: pendingSave.species };
  showIdentity();
  player.setSpecies(me.species);

  /** Put the player where a save says, with its inventory and hp (and its name/animal). */
  const applySave = (data: PlayerSaveData) => {
    me = { ...me, name: data.name, species: data.species, ...(joined ? {} : { id: data.playerId }) };
    saveIdentity(me);
    showIdentity();
    player.setSpecies(me.species);
    player.teleport(data.pos[0], data.pos[1], data.pos[2], data.yaw);
    inventory.set(data.inventory);
    if (data.gear) player.equipment.set(data.gear);
    else player.equipment.reset();
    player.vitals.maxHp = data.maxHp;
    player.vitals.maxStamina = data.maxStamina;
    player.vitals.reset(data.hp);
    if (joined) {
      island?.setIdentity(me);
      chatWindow?.refreshPeople();
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = checkName(nameInput.value);
    if (!n.ok) {
      errorEl.textContent = n.error;
      nameInput.focus();
      return;
    }
    const species = (new FormData(form).get('species') as PlayerSpecies) ?? 'tiger';
    errorEl.textContent = '';
    const changed = n.name !== me.name || species !== me.species;
    me = { ...me, name: n.name, species: PLAYER_SPECIES.includes(species) ? species : 'tiger' };
    saveIdentity(me);
    player.setSpecies(me.species);
    goBtn.textContent = '繼續';
    if (!joined) {
      if (pendingSave) {
        const p = pendingSave;
        pendingSave = null;
        applySave({ ...p, name: me.name, species: me.species });
      } else {
        player.vitals.reset();
      }
      joined = true;
      saveRow.hidden = false;
      startIsland();
      minimap?.show();
      touch?.enterFullscreen();
      saves.start();
    } else if (changed) {
      island?.setIdentity(me);
      chatWindow?.refreshPeople();
    }
    input.requestLock();
  });

  // ---- Account box (email + password) ----
  const acctBox = document.getElementById('account')!;
  const acctForm = document.getElementById('acct-form') as HTMLFormElement;
  const acctEmail = document.getElementById('acct-email') as HTMLInputElement;
  const acctPass = document.getElementById('acct-pass') as HTMLInputElement;
  const acctMsg = document.getElementById('acct-msg')!;
  const acctOut = acctBox.querySelector<HTMLElement>('.acct-out')!;
  const acctIn = acctBox.querySelector<HTMLElement>('.acct-in')!;
  const acctWho = document.getElementById('acct-who')!;
  const acctBtns = acctBox.querySelectorAll<HTMLButtonElement>('button');
  const say = (text: string, err = false) => {
    acctMsg.textContent = text;
    acctMsg.classList.toggle('err', err);
  };
  const fmtTime = (t: number) =>
    new Date(t).toLocaleString('zh-TW', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const busy = (on: boolean) => acctBtns.forEach((b) => (b.disabled = on));
  /** After signing in (or a restored session): load the account's save, or store the current progress. */
  const afterSignIn = async (fresh: boolean) => {
    try {
      const data = await saves.loadBest();
      if (data) {
        if (joined) {
          applySave(data);
          hud.toast(`📂 已讀取存檔（${fmtTime(data.savedAt)}）`);
          say(`已讀取 ${fmtTime(data.savedAt)} 的存檔`);
        } else {
          pendingSave = data;
          me = { ...me, id: data.playerId, name: data.name, species: data.species };
          showIdentity();
          player.setSpecies(me.species);
          say(`找到 ${fmtTime(data.savedAt)} 的存檔，按「繼續」回到上次的地方`);
        }
      } else if (joined) {
        await saves.save('login');
        say('帳號還沒有存檔，已把目前的進度存進去');
      } else {
        say(fresh ? '帳號建好了！進入小島後會自動存檔' : '帳號還沒有存檔，進入小島後會自動存檔');
      }
    } catch {
      say('讀不到雲端存檔，等一下再試', true);
    }
  };
  if (account) {
    acctBox.hidden = false;
    const renderAccount = () => {
      const email = account.email;
      acctOut.hidden = !!email;
      acctIn.hidden = !email;
      acctWho.textContent = email ?? '';
    };
    account.onChange = renderAccount;
    void account.ready.then(() => {
      renderAccount();
      if (account.userId) void afterSignIn(false);
    });
    const submit = async (act: 'login' | 'signup') => {
      busy(true);
      say(act === 'login' ? '登入中…' : '建立帳號中…');
      const r =
        act === 'login'
          ? await account.signIn(acctEmail.value, acctPass.value)
          : await account.signUp(acctEmail.value, acctPass.value);
      busy(false);
      if (!r.ok) return say(r.error, true);
      acctPass.value = '';
      if (r.message) return say(r.message);
      await afterSignIn(act === 'signup');
    };
    acctForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void submit('login');
    });
    acctForm.querySelector('[data-act=signup]')!.addEventListener('click', () => void submit('signup'));
    document.getElementById('acct-logout')!.addEventListener('click', async () => {
      if (joined) await saves.save('manual');
      await account.signOut();
      say('已登出。之後的進度只存在這台電腦。');
    });
  }

  // ---- Saving ----
  const saveText = (st: SaveStatus) =>
    st.at ? `已存檔 ${fmtTime(st.at)}・${st.where === 'cloud' ? '帳號' : '這台電腦'}` : '';
  saves.onStatus = (st, reason) => {
    if (st.saving) return hud.setSave('💾 存檔中…', 'busy');
    saveWhen.textContent = st.error ?? saveText(st);
    if (reason === 'manual' || reason === 'login' || st.error)
      hud.setSave(st.error ? `⚠️ ${st.error}` : `💾 ${saveText(st)}`, st.error ? 'warn' : 'ok');
  };
  document.getElementById('save-now')!.addEventListener('click', () => void saves.save('manual'));

  // ---- Health, death and respawn ----
  const syncMode = () => {
    hud.setMode(player.mode, !!touch);
    touch?.setMode(player.mode);
  };
  player.onModeChange = syncMode;
  hud.onModeClick = () => player.setMode(player.mode === 'build' ? 'combat' : 'build');
  player.onHurt = (r) => hud.hurt(r.blocked || r.dodged);
  player.onDeath = (cause) => {
    deadScreen = true;
    if (lastPvp && performance.now() - lastPvp.at < 1500) island?.sendKo(lastPvp.by);
    lastPvp = null;
    hud.showDeath(cause);
    input.release();
    void saves.save('respawn'); // the save is now "back at the plaza with the starter kit"
  };
  hud.onRespawn = () => {
    player.respawn();
    inventory.reset();
    player.equipment.reset();
    bolts.clear();
    player.vitals.reset();
    slimes.clear();
    deadScreen = false;
    hud.hideDeath();
    input.requestLock();
  };
  // Slimes bite; defeating one drops a toy block.
  const toys = [B.toy_red, B.toy_orange, B.toy_yellow, B.toy_blue];
  slimes.onBite = (s) => player.hurt(SLIME.damage, { from: { x: s.x, z: s.z } }, '被史萊姆咬了');
  // Gear a slime may drop (chance per kill) — the only way to find new equipment for now.
  const DROPS: [string, number][] = [
    ['magic_twig', 0.08],
    ['wood_sword', 0.05],
    ['leather_boots', 0.03],
    ['stone_shield', 0.02],
    ['crystal_wand', 0.01],
    ['stone_sword', 0.01],
  ];
  slimes.onKill = () => {
    let roll = Math.random();
    for (const [id, p] of DROPS) {
      if (roll < p) {
        const g = GEAR[id]!;
        if (player.equipment.give(id))
          hud.toast(`✨ 史萊姆掉了 ${g.icon} ${g.name}！按 I 打開裝備換上`, 5000);
        else hud.toast(`✨ 史萊姆掉了 ${g.icon} ${g.name}，但裝備袋滿了`);
        return;
      }
      roll -= p;
    }
    const toy = toys[Math.floor(Math.random() * toys.length)]!;
    if (inventory.add(toy, 1)) hotbar.flash('打倒史萊姆！撿到一個玩具方塊');
    else hotbar.flash('打倒史萊姆！（背包滿了）');
  };
  player.onCast = (o, d, range) => island?.sendShot([o.x, o.y, o.z], [d.x, d.y, d.z], range);

  // ---- Equipment panel (I / 🎒) ----
  let gearOpen = false;
  const gearPanel = new GearPanel(document.body, player.equipment, () => ({
    maxHp: player.vitals.maxHp,
    maxStamina: player.vitals.maxStamina,
  }));
  const openGear = () => {
    if (gearOpen || deadScreen) return;
    gearOpen = true;
    gearPanel.show();
    input.release();
  };
  const closeGear = () => {
    if (!gearOpen) return;
    gearOpen = false;
    gearPanel.hide();
    input.requestLock();
  };
  gearPanel.onClose = closeGear;
  hud.onStatsClick = openGear;
  window.addEventListener('keydown', (e) => {
    if (gearOpen && (e.code === 'Escape' || e.code === 'KeyI')) {
      e.preventDefault();
      closeGear();
    }
  });
  Object.assign(window, { __gear: { open: openGear, close: closeGear, panel: gearPanel } });
  syncMode();

  // Phones / tablets: on-screen joystick, look by dragging, buttons (no pointer lock).
  touch = wantsTouch()
    ? new TouchControls(ctx.renderer.domElement, input, hotbar, hotbarEl, {
        onPause: () => input.release(),
        onChat: () => chatWindow?.open(),
        onMode: () => player.setMode(player.mode === 'build' ? 'combat' : 'build'),
        onView: () => player.setView(player.view === 'first' ? 'third' : 'first'),
        onGear: () => openGear(),
      })
    : null;
  syncMode();
  input.onLockChange = (locked) => {
    playOverlay.hidden = locked || typing || deadScreen || gearOpen;
    crosshair.hidden = !locked;
    touch?.setVisible(locked && !typing);
    hud.setVisible(joined && (locked || deadScreen || gearOpen));
    if (!locked && joined && !deadScreen && !gearOpen) void saves.save('auto');
  };
  // T or Enter while playing opens the chat box; K saves; M toggles the map.
  window.addEventListener('keydown', (e) => {
    if (!input.locked || typing) return;
    if (e.code === 'KeyM' && !e.repeat) {
      minimap?.toggle();
      return;
    }
    if (e.code === 'KeyK' && !e.repeat) {
      void saves.save('manual');
      return;
    }
    if (e.code === 'KeyI' && !e.repeat) {
      e.preventDefault();
      openGear();
      return;
    }
    if (!chatWindow) return;
    if (e.code === 'KeyT' || e.code === 'Enter') {
      e.preventDefault();
      chatWindow.open();
    }
  });
}

function startIsland(): void {
  const people = {
    get meId() {
      return me.id;
    },
    nameOf(id: string): string | null {
      if (id === me.id) return me.name;
      const a = agents.find((x) => x.id === id);
      if (a) return a.member.name;
      return island?.players.get(id)?.name ?? nameCache.get(id) ?? null;
    },
    colorOf(id: string): string {
      const a = agents.find((x) => x.id === id);
      if (a) return a.member.tagColor;
      const sp = id === me.id ? me.species : island?.players.get(id)?.species;
      return sp ? SPECIES_COLOR[sp] : '#5b6b86';
    },
    targets() {
      return [
        ...agents.filter((a) => llmBrains.has(a.id)).map((a) => ({ id: a.id, label: a.member.name })),
        ...[...(island?.players.values() ?? [])].map((p) => ({
          id: p.id,
          label: `${p.name}（${SPECIES_LABEL[p.species]}）`,
        })),
      ];
    },
    onlineSummary() {
      const players = [
        `${me.name}（${SPECIES_LABEL[me.species]}，你）`,
        ...[...(island?.players.values() ?? [])].map((p) => `${p.name}（${SPECIES_LABEL[p.species]}）`),
      ];
      const chars = agents.filter((a) => llmBrains.has(a.id)).map((a) => a.member.name);
      return { count: players.length, text: `玩家：${players.join('、')}；角色：${chars.join('、')}` };
    },
  };
  chatWindow = new ChatWindow(document.body, people, {
    send: async (text, to) => {
      if (!island || island.status !== 'online') return { ok: false, error: '還沒連上小島，稍等一下' };
      const b = player!.bodyPos;
      return island.say(text, to, [b.x, b.y, b.z]);
    },
    startTyping: () => {
      typing = true;
      touch?.setVisible(false);
      input.release();
    },
    stopTyping: (resume) => {
      typing = false;
      if (resume) {
        input.requestLock();
        touch?.setVisible(input.locked);
      } else document.getElementById('play-overlay')!.hidden = input.locked;
    },
    // Phones have no Esc: dismissing the keyboard (tapping outside the box) goes back to playing.
    blurred: () => {
      if (!touch || !typing) return;
      setTimeout(() => {
        if (!typing || chatWindow?.typing) return;
        typing = false;
        input.requestLock();
        touch?.setVisible(true);
      }, 150);
    },
  });

  if (!cfg.cloud) {
    chatWindow.setStatus('本機開發模式沒有連線聊天（網址加 ?cloud=1 可連到線上小島）。');
    return;
  }
  island = new Island(me, cfg.seed);
  remote = new RemotePlayers(ctx.scene, island);
  island.onRoster = () => chatWindow?.refreshPeople();
  island.onStatus = (st) =>
    chatWindow?.setStatus(st === 'online' ? '' : st === 'offline' ? '連線中斷，正在重新連線…' : '連線中…');
  island.onMessage = (m) => onLiveMessage(m);
  // PvP: a hit someone landed on me (judged here — see pvp.ts), and knockouts.
  island.onHit = (e) => {
    if (!player || player.dead) return;
    const attacker = island?.players.get(e.from);
    const now = performance.now();
    const dmg = acceptHit({
      myMode: player.mode,
      myPos: player.bodyPos,
      attacker,
      dmg: e.dmg,
      kind: e.kind,
      lastHitAt: lastHitFrom.get(e.from),
      now,
    });
    if (!dmg || !attacker?.pos) return;
    lastHitFrom.set(e.from, now);
    lastPvp = { by: e.from, at: now };
    player.hurt(dmg, { from: attacker.pos }, `被 ${attacker.name} 打倒了`);
  };
  island.onKo = (victim, by) => {
    const name = (id: string) => (id === me.id ? '你' : (island?.players.get(id)?.name ?? '某人'));
    if (victim === me.id) return; // the death screen already says it
    hud.toast(by === me.id ? `⚔️ 你打倒了 ${name(victim)}！` : `⚔️ ${name(by)} 打倒了 ${name(victim)}`);
  };
  island.onShot = (e) => {
    const o = new THREE.Vector3(...e.origin);
    if (player && o.distanceTo(player.bodyPos) > 60) return;
    bolts.fire(o, new THREE.Vector3(...e.dir), e.range, 0, false);
  };
  island.start();
  island
    .recentMessages(40)
    .then((list) => {
      for (const m of list) if (m.speaker_name) nameCache.set(m.speaker, m.speaker_name);
      list.forEach((m) => chatWindow?.add(m));
    })
    .catch(() => chatWindow?.setStatus('讀不到之前的聊天紀錄'));
}

/** A new chat line from anyone: show it, let nearby characters hear it, wake up whoever it was for. */
function onLiveMessage(m: LiveMessage): void {
  if (m.speaker_name) nameCache.set(m.speaker, m.speaker_name);
  chatWindow?.add(m);
  const pos = (Array.isArray(m.pos) && m.pos.length === 3 ? m.pos : [0, 0, 0]) as [number, number, number];
  if (m.speaker_kind === 'player') {
    if (m.speaker !== me.id) remote?.say(m.speaker, m.text);
  } else if (syncs.get(m.speaker)?.role === 'driver') {
    return; // this tab simulated that line itself — it is already in the local chat log
  }
  chat.say({
    from: m.speaker,
    name: m.speaker_name ?? undefined,
    to: m.to_id,
    text: m.text,
    pos,
    t: simTime,
    clock: clock.clock,
  });
  const target = m.to_id ? agents.find((a) => a.id === m.to_id) : undefined;
  if (target && syncs.get(target.id)?.role === 'driver') target.poke();
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
      if (player && joined) {
        const b = player.bodyPos;
        slimes.tick(dt, dayNight.night, { x: b.x, y: b.y, z: b.z, alive: !player.dead });
      }
      bolts.tick(dt, world, () => [...slimes.targets(), ...pvpTargets()]);
      simTime += dt;
      lastUpdateAt = performance.now();
      if (!lineup) for (const a of agents) a.tick(dt, simTime);
    },
    render(alpha, frameDt) {
      const time = t + alpha / cfg.tickRate;
      if (player) {
        player.render(alpha, time, frameDt);
        slimes.render(alpha, time);
        bolts.render(time);
        const v = player.vitals;
        hud.setVitals(v.hp, v.maxHp, v.stamina, v.maxStamina, player.guarding);
        hud.setStats(player.equipment.weaponDef, player.equipment.stats, !!touch);
      } else {
        cam.position.lerpVectors(prev, next, alpha);
        cam.lookAt(target);
      }
      world.update(cam.position);
      // Props appear once the terrain under them exists (no floating palms while loading).
      if (!props.visible && world.stats.meshed === world.stats.total) props.visible = true;
      fire.sync(world.fireVersion, world.fires);
      fire.update(time);
      env.update(time, cam);
      dayNight.update(cam, world.fires);
      for (const v of views) v.render(alpha, time, !debugEl.hidden);
      remote?.update(frameDt, time);
      siteGhosts.update(time, performance.now());
      minimap?.update(performance.now());
      for (const m of lineupModels) m.animate(time, 0);
      if (player && island) {
        const b = player.bodyPos;
        island.sendPosition(b.x, b.y, b.z, player.yaw + Math.PI, {
          hp: player.vitals.hp,
          mode: player.mode,
          guard: player.guarding,
          swings: player.swings,
          dead: player.dead,
        });
      }
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
    online: island ? `${island.status}  players ${island.players.size + 1}` : 'not joined',
    ...Object.fromEntries(
      agents
        .filter((a) => llmBrains.has(a.id))
        .map((a) => {
          const st = llmBrains.get(a.id)!.stats;
          const role = syncs.get(a.id)?.role ?? 'local';
          return [
            `${a.id} brain`,
            `${role}  ${st.mode}  calls ${st.calls}  $${st.cost.toFixed(4)}  today $${st.spentToday.toFixed(3)}/${st.budget || '?'}  ${st.lastMs}ms${st.lastError ? `  (${st.lastError})` : ''}`,
          ];
        }),
    ),
    pos: `${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
    ...(player
      ? {
          player: `${player.flying ? 'flying' : player.inWater ? 'swimming' : player.body.onGround ? 'ground' : 'air'}  world edits ${world.edits.length}`,
          combat: `${player.mode}  hp ${player.vitals.hp}  stamina ${player.vitals.stamina.toFixed(0)}  view ${player.view}  slimes ${slimes.list.length}`,
          target: player.target ? `${player.target.block.join(',')} (${player.target.id})` : '-',
        }
      : {}),
    dropped: loop.droppedTicks,
  };
});

loop.start();

// Expose for debugging from DevTools / MCP.
Object.assign(window, {
  __game: {
    cfg,
    ctx,
    world,
    loop,
    agents,
    landmarks,
    chat,
    player,
    input,
    hotbar,
    inventory,
    slimes,
    bolts,
    saves,
    account,
    hud,
    clock,
    dayNight,
    save,
    syncs,
    get island() {
      return island;
    },
    get chatWindow() {
      return chatWindow;
    },
    minimap,
    siteGhosts,
  },
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    loop.stop();
    world.dispose();
    siteGhosts.dispose();
    ctx.dispose();
  });
}
