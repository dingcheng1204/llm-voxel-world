// Draws the other online players: their chosen animal, a name tag and a speech bubble, smoothly
// following the positions they broadcast.

import * as THREE from 'three';
import { createModel, type CharacterModel, type PlayerSpecies } from '../agents/species';
import { wrapAngle } from '../agents/AgentBody';
import { Bubble } from '../scene/bubble';
import { createNameTag } from '../scene/nameTag';
import { SPECIES_COLOR, SPECIES_LABEL } from './identity';
import type { Island } from './island';

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
  list(): { id: string; name: string; pos: THREE.Vector3 }[] {
    return [...this.views.entries()].map(([id, v]) => ({ id, name: v.name, pos: v.pos }));
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
