// Play HUD: hearts + stamina + mode badge above the hotbar, a save-status pill, short toasts
// (knockouts, saves), a red flash when hurt, and the "you fell" screen with a respawn button.
// Plain DOM (styles in index.html), redrawn only when values change.

import type { Mode } from '../player/combat';
import type { Stats } from '../player/equipment';

export class Hud {
  readonly el: HTMLElement;
  private readonly hearts: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly modeEl: HTMLElement;
  private readonly statsEl: HTMLButtonElement;
  private statsKey = '';
  private readonly saveEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly hurtEl: HTMLElement;
  readonly deathEl: HTMLElement;
  private readonly deathCause: HTMLElement;
  private heartsKey = '';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  onRespawn: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'hud';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="hud-row">
        <div class="hearts" aria-label="血量"></div>
        <button type="button" class="mode" title="切換模式（R）"></button>
        <div class="stamina" aria-label="體力"><div class="fill"></div></div>
      </div>
      <button type="button" class="stats" title="裝備（I）"></button>`;
    this.hearts = this.el.querySelector('.hearts')!;
    this.staminaFill = this.el.querySelector('.stamina .fill')!;
    this.modeEl = this.el.querySelector('.mode')!;
    this.statsEl = this.el.querySelector('.stats')!;
    this.saveEl = document.createElement('div');
    this.saveEl.id = 'save-pill';
    this.saveEl.hidden = true;
    this.toastEl = document.createElement('div');
    this.toastEl.id = 'toast';
    this.toastEl.hidden = true;
    this.hurtEl = document.createElement('div');
    this.hurtEl.id = 'hurt';
    this.deathEl = document.createElement('div');
    this.deathEl.id = 'death';
    this.deathEl.hidden = true;
    this.deathEl.innerHTML = `
      <div class="death-card">
        <div class="big">💫</div>
        <h2>你倒下了</h2>
        <p class="cause"></p>
        <p class="note">回到廣場重生，身上的物資會回到最開始的樣子。</p>
        <button type="button" class="go">重生</button>
      </div>`;
    this.deathCause = this.deathEl.querySelector('.cause')!;
    this.deathEl.querySelector('button')!.addEventListener('click', () => this.onRespawn());
    parent.append(this.el, this.saveEl, this.toastEl, this.hurtEl, this.deathEl);
  }

  /** Clicking the mode badge (mostly for touch). */
  set onModeClick(fn: () => void) {
    this.modeEl.onclick = fn;
  }

  /** Clicking the stats pill opens the equipment panel. */
  set onStatsClick(fn: () => void) {
    this.statsEl.onclick = fn;
  }

  /** Weapon + total attack / defense / speed. */
  setStats(weapon: { icon: string; name: string } | null, s: Stats, touch: boolean): void {
    const key = `${weapon?.name}|${s.attack}|${s.defense}|${s.speed}|${touch}`;
    if (key === this.statsKey) return;
    this.statsKey = key;
    const w = weapon ? `${weapon.icon} ${weapon.name}` : '✊ 空手';
    this.statsEl.innerHTML = `<span>${w}</span><span>⚔️ ${s.attack}</span><span>🛡️ ${s.defense}</span><span>👟 ${s.speed.toFixed(1)}</span><span class="bag">🎒${touch ? '' : ' <kbd>I</kbd>'}</span>`;
  }

  setVisible(on: boolean): void {
    this.el.hidden = !on;
  }

  setVitals(hp: number, maxHp: number, stamina: number, maxStamina: number, guarding: boolean): void {
    const key = `${hp}/${maxHp}/${maxStamina}`;
    if (key !== this.heartsKey) {
      this.heartsKey = key;
      // The stamina bar is longer when max stamina has been raised.
      this.staminaFill.parentElement!.style.width = `${Math.round(maxStamina * 1.4)}px`;
      const n = Math.ceil(maxHp / 2);
      let html = '';
      for (let i = 0; i < n; i++) {
        const v = hp - i * 2;
        html += `<span class="heart ${v >= 2 ? 'full' : v === 1 ? 'half' : 'empty'}"></span>`;
      }
      this.hearts.innerHTML = html;
      this.hearts.classList.toggle('low', hp <= 2);
      this.hearts.setAttribute('aria-label', `血量 ${hp}/${maxHp}`);
    }
    this.staminaFill.style.width = `${(stamina / maxStamina) * 100}%`;
    this.staminaFill.parentElement!.classList.toggle('guard', guarding);
  }

  setMode(mode: Mode, touch: boolean): void {
    this.modeEl.textContent = mode === 'combat' ? '⚔️ 戰鬥' : '🔨 一般';
    this.modeEl.dataset.mode = mode;
    this.modeEl.title = touch ? '切換模式' : '切換模式（R）';
    document.body.classList.toggle('combat', mode === 'combat');
  }

  /** Small text at the top: "已存檔 17:08 · 帳號" etc. */
  setSave(text: string, kind: 'ok' | 'warn' | 'busy'): void {
    this.saveEl.hidden = false;
    this.saveEl.textContent = text;
    this.saveEl.dataset.kind = kind;
    this.saveEl.classList.remove('flash');
    void this.saveEl.offsetWidth;
    this.saveEl.classList.add('flash');
  }

  toast(text: string, ms = 3500): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toastEl.hidden = true), ms);
  }

  hurt(blocked: boolean): void {
    this.hurtEl.className = blocked ? 'blocked' : 'hit';
    void this.hurtEl.offsetWidth;
    this.hurtEl.classList.add('on');
  }

  showDeath(cause: string): void {
    this.deathCause.textContent = cause;
    this.deathEl.hidden = false;
  }

  hideDeath(): void {
    this.deathEl.hidden = true;
  }
}
