import * as THREE from 'three';
import type { AgentBody } from './AgentBody';

/**
 * Placeholder "brain" until the LLM loop lands (ROADMAP phase 4): wander around a home area.
 * It drives the body through the same interface an LLM-driven executor will use (set a target).
 */
export class WanderBrain {
  private wait = 0;

  constructor(
    private readonly body: AgentBody,
    private readonly home: { x: number; z: number },
    private readonly radius: number,
    private readonly rand: () => number = Math.random,
  ) {}

  tick(dt: number): void {
    if (this.body.target) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = 2 + this.rand() * 5; // pause, look around, then go somewhere new
    const a = this.rand() * Math.PI * 2;
    const r = Math.sqrt(this.rand()) * this.radius;
    this.body.target = new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
  }
}
