import * as THREE from 'three';
import { Bubble } from '../scene/bubble';
import { createNameTag } from '../scene/nameTag';
import type { Agent } from './Agent';
import { wrapAngle } from './AgentBody';
import { createModel, type CharacterModel } from './species';

/** Rendering for one Agent: species model + name tag, plus debug status label and path line. */
export class AgentView {
  readonly root = new THREE.Group();
  private readonly model: CharacterModel;
  private readonly status: THREE.Sprite;
  private readonly statusCanvas = document.createElement('canvas');
  private statusText = '';
  readonly pathLine: THREE.Line;
  private pathRef: unknown = null;
  private readonly speech = new Bubble('speech');
  private readonly thoughtBubble = new Bubble('thought');
  private readonly bubbleY: number;

  constructor(private readonly agent: Agent) {
    const m = agent.member;
    this.model = createModel(m.species);
    this.root.add(this.model.root);
    const tag = createNameTag(m.name, m.brain, m.tagColor);
    tag.position.y = m.species === 'snake' ? 1.15 : 1.75;
    this.root.add(tag);
    this.root.name = m.id;

    this.statusCanvas.width = 512;
    this.statusCanvas.height = 64;
    this.status = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(this.statusCanvas),
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.status.scale.set(3.2, 0.4, 1);
    this.status.position.y = tag.position.y + 0.42;
    this.status.visible = false;
    this.root.add(this.status);

    this.bubbleY = tag.position.y + 0.32;
    this.speech.sprite.position.y = this.bubbleY;
    this.thoughtBubble.sprite.position.y = this.bubbleY;
    this.root.add(this.speech.sprite, this.thoughtBubble.sprite);

    this.pathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(m.tagColor),
        transparent: true,
        opacity: 0.85,
        fog: false,
        depthTest: false,
      }),
    );
    this.pathLine.frustumCulled = false;
    this.pathLine.renderOrder = 4;
    this.pathLine.visible = false;
  }

  render(alpha: number, time: number, debug: boolean): void {
    const b = this.agent.body;
    this.root.position.lerpVectors(b.prevPos, b.pos, alpha);
    this.root.rotation.y = b.prevHeading + wrapAngle(b.heading - b.prevHeading) * alpha;
    this.model.animate(time, b.speed);

    this.updateBubbles();

    this.status.visible = debug;
    this.pathLine.visible = debug;
    if (!debug) return;
    const ex = this.agent.executor;
    const inv = [...ex.inventory].map(([k, v]) => `${k}×${v}`).join(' ');
    this.setStatus(`${ex.doing}${inv ? ` · ${inv}` : ''} · ${this.agent.thought}`);
    if (ex.path !== this.pathRef) {
      this.pathRef = ex.path;
      const pts = ex.path.map(([x, y, z]) => new THREE.Vector3(x + 0.5, y + 0.15, z + 0.5));
      this.pathLine.geometry.dispose();
      this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
  }

  /** Speech for 7 s after `say`; thought bubble for 5 s after each think (LLM brains only). */
  private updateBubbles(): void {
    const now = Date.now();
    const say = this.agent.lastSay;
    const sayAge = say ? (now - say.at) / 1000 : Infinity;
    if (say && sayAge < 7) {
      this.speech.show(say.text, Math.min(1, (7 - sayAge) / 0.6));
    } else {
      this.speech.hide();
    }
    const showsThoughts = (this.agent.brain as { showsThoughts?: boolean }).showsThoughts === true;
    const tAge = (now - this.agent.thoughtAt) / 1000;
    if (showsThoughts && this.agent.thought && tAge < 5) {
      // Stack above the speech bubble when both are visible.
      this.thoughtBubble.sprite.position.y = this.speech.sprite.visible ? this.bubbleY + 1.15 : this.bubbleY;
      this.thoughtBubble.show(this.agent.thought, Math.min(1, (5 - tAge) / 0.6) * 0.95);
    } else {
      this.thoughtBubble.hide();
    }
  }

  private setStatus(text: string): void {
    if (text === this.statusText) return;
    this.statusText = text;
    const c = this.statusCanvas.getContext('2d')!;
    c.clearRect(0, 0, 512, 64);
    c.font = '24px ui-rounded, system-ui, sans-serif';
    const w = Math.min(500, c.measureText(text).width + 24);
    c.fillStyle = 'rgba(29,29,43,0.72)';
    c.beginPath();
    c.roundRect(256 - w / 2, 10, w, 44, 14);
    c.fill();
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, 256, 33, 480);
    (this.status.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }
}
