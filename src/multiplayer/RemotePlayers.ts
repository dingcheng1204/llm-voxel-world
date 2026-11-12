// Draws the other online players: their chosen animal, a name tag and a speech bubble, smoothly
// following the positions they broadcast.

import * as THREE from 'three';
import { createModel, type CharacterModel, type PlayerSpecies } from '../agents/species';
import { wrapAngle } from '../agents/AgentBody';
import { Bubble } from '../scene/bubble';
import { createNameTag } from '../scene/nameTag';
import { SPECIES_COLOR, SPECIES_LABEL } from './identity';
import type { Island, RemoteCombat } from './island';
import { lowPolyMaterial, painted } from '../scene/lowpoly';

const SPEECH_SECONDS = 7;
/** Hide a player we haven't heard from in this long (tab in background, network hiccup). */
const STALE_MS = 12_000;

class RemoteView {
  readonly root = new THREE.Group();
  readonly model: CharacterModel;
  readonly pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  private readonly speech = new Bubble('speech');
  private speechUntil = 0;
  private line = '';
  private readonly hpBar: THREE.Sprite;
  private readonly hpCanvas = document.createElement('canvas');
  private hpKey = '';
  private readonly shield: THREE.Mesh;
  private lastSwings = -1;
  private swingAnim = 0;
  combat: RemoteCombat | null = null;

  constructor(
    readonly name: string,
    readonly species: PlayerSpecies,
  ) {
    this.model = createModel(species);
    this.root.add(this.model.root);
    const tag = createNameTag(name, `玩家・${SPECIES_LABEL[species]}`, SPECIES_COLOR[species]);
    tag.position.y = species === 'snake' ? 1.15 : 1.75;
    this.root.add(tag);
    this.speech.sprite.position.y = tag.position.y + 0.32;
    this.root.add(this.speech.sprite);
    // Health bar (only shown in combat mode) just above the name tag.
    this.hpCanvas.width = 128;
    this.hpCanvas.height = 24;
    this.hpBar = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(this.hpCanvas),
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.hpBar.scale.set(0.9, 0.17, 1);
    this.hpBar.position.y = tag.position.y + 0.36;
    this.hpBar.renderOrder = 2;
    this.hpBar.visible = false;
    this.root.add(this.hpBar);
    this.speech.sprite.position.y += 0.2;
    const disc = new THREE.CylinderGeometry(0.34, 0.34, 0.07, 9);
    disc.rotateX(Math.PI / 2);
    this.shield = new THREE.Mesh(painted(disc, 0xd9a35f, 0.1), lowPolyMaterial());
    this.shield.position.set(0, 0.55, 0.62);
    this.shield.visible = false;
    this.root.add(this.shield);
  }

  private drawHp(c: RemoteCombat): void {
    const key = `${c.hp}`;
    if (key === this.hpKey) return;
    this.hpKey = key;
    const g = this.hpCanvas.getContext('2d')!;
    g.clearRect(0, 0, 128, 24);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath();
    g.roundRect(0, 0, 128, 24, 12);
    g.fill();
    g.font = '16px system-ui';
    g.textBaseline = 'middle';
    g.fillText('⚔️', 4, 13);
    g.fillStyle = '#e3e8f0';
    g.beginPath();
    g.roundRect(26, 7, 96, 10, 5);
    g.fill();
    g.fillStyle = c.hp > 10 ? '#5bc95b' : c.hp > 5 ? '#f2b33d' : '#e8574a';
    g.beginPath();
    g.roundRect(26, 7, Math.max(0, (96 * c.hp) / 20), 10, 5);
    g.fill();
    (this.hpBar.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }

  /** Combat state from the latest position update. */
  setCombat(c: RemoteCombat, dt: number): void {
    this.combat = c;
    if (this.lastSwings >= 0 && c.swings !== this.lastSwings) this.swingAnim = 0.25;
    this.lastSwings = c.swings;
    this.swingAnim = Math.max(0, this.swingAnim - dt);
    this.hpBar.visible = c.mode === 'combat';
    if (this.hpBar.visible) this.drawHp(c);
    this.shield.visible = c.guard && !c.dead;
    const s = this.swingAnim > 0 ? Math.sin((1 - this.swingAnim / 0.25) * Math.PI) : 0;
    this.model.root.position.z = s * 0.35;
    this.model.root.rotation.x = s * 0.25;
    this.model.root.rotation.z = c.dead ? Math.PI / 2 : 0;
  }

  say(text: string, now: number): void {
    this.line = text;
    this.speech.show(text);
    this.speechUntil = now + SPEECH_SECONDS * 1000;
  }

  update(
    target: { x: number; y: number; z: number; heading: number },
    dt: number,
    time: number,
    now: number,
  ): void {
    const before = this.pos.clone();
    const k = 1 - Math.exp(-dt * 10);
    if (this.pos.distanceTo(new THREE.Vector3(target.x, target.y, target.z)) > 12) {
      this.pos.set(target.x, target.y, target.z); // teleported / just appeared
    } else {
      this.pos.lerp(new THREE.Vector3(target.x, target.y, target.z), k);
    }
    this.heading += wrapAngle(target.heading - this.heading) * k;
    this.speed = Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / Math.max(dt, 1e-3);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    this.model.animate(time, this.speed);
    if (now > this.speechUntil) this.speech.hide();
    else this.speech.show(this.line, Math.min(1, (this.speechUntil - now) / 1000));
  }

  dispose(): void {
    this.model.dispose();
    this.shield.geometry.dispose();
    this.root.traverse((o) => {
      const m = (o as THREE.Sprite).material as THREE.SpriteMaterial | undefined;
      if (m?.map) m.map.dispose();
      m?.dispose?.();
    });
  }
}

export class RemotePlayers {
  private readonly views = new Map<string, RemoteView>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly island: Island,
  ) {}

  /** Positions for perception (characters see players too). */
  list(): { id: string; name: string; pos: THREE.Vector3; combat: RemoteCombat | null }[] {
    return [...this.views.entries()].map(([id, v]) => ({ id, name: v.name, pos: v.pos, combat: v.combat }));
  }

  say(playerId: string, text: string): void {
    this.views.get(playerId)?.say(text, performance.now());
  }

  update(dt: number, time: number): void {
    const now = performance.now();
    for (const [id, p] of this.island.players) {
      let v = this.views.get(id);
      const visible = p.pos && now - p.seenAt < STALE_MS;
      if (v && (!visible || v.name !== p.name || v.species !== p.species)) {
        this.remove(id);
        v = undefined;
      }
      if (!visible) continue;
      if (!v) {
        v = new RemoteView(p.name, p.species);
        v.pos.set(p.pos!.x, p.pos!.y, p.pos!.z);
        this.views.set(id, v);
        this.scene.add(v.root);
      }
      v.update(p.pos!, dt, time, now);
      v.setCombat(p.combat, dt);
    }
    for (const id of [...this.views.keys()]) if (!this.island.players.has(id)) this.remove(id);
  }

  private remove(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.root);
    v.dispose();
    this.views.delete(id);
  }
}
