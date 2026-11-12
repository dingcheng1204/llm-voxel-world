// On-screen controls for phones and tablets.
//  - Left part of the screen: a joystick appears where the thumb lands (walk; push all the way = sprint).
//  - Anywhere else on the screen: drag to look around.
//  - Buttons on the right: jump (hold to swim up / fly up), break, place; fly toggle.
//  - Top left: pause and chat. Hotbar slots can be tapped.
// Everything feeds the same Input the keyboard and mouse use.

import type { Input } from './input';
import type { Hotbar } from './hotbar';

/** Max distance (px) the knob travels from the joystick centre. */
const STICK_RADIUS = 52;
const DEADZONE = 0.14;
/** Touch drag px → mouse-equivalent px (touch needs more rotation per pixel than a mouse). */
const LOOK_GAIN = 2.1;

/** Joystick offset (screen px, y down) → movement (forward, right), each −1..1, with a dead zone. */
export function stickVector(dx: number, dy: number, radius = STICK_RADIUS): { fwd: number; side: number } {
  const len = Math.hypot(dx, dy);
  if (len === 0) return { fwd: 0, side: 0 };
  const mag = Math.min(1, len / radius);
  if (mag < DEADZONE) return { fwd: 0, side: 0 };
  // Rescale so movement starts from 0 just outside the dead zone.
  const k = (mag - DEADZONE) / (1 - DEADZONE) / len;
  return { fwd: -dy * k, side: dx * k };
}

/** Is this a phone/tablet (no fine pointer)? `?touch=1` forces touch controls for testing. */
export function wantsTouch(search = location.search): boolean {
  const q = new URLSearchParams(search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  // The main pointer is a finger (phones, tablets). Touch laptops report a fine pointer and keep the mouse.
  return matchMedia('(pointer: coarse)').matches;
}

/** Keep receiving a finger's moves even if it slides off the element (never fatal if the browser refuses). */
function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* pointer no longer active */
  }
}

export interface TouchCallbacks {
  onPause(): void;
  onChat(): void;
  onMode(): void;
  onView(): void;
  onGear(): void;
}

export class TouchControls {
  readonly el: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private readonly lookIds = new Map<number, { x: number; y: number }>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly input: Input,
    hotbar: Hotbar,
    hotbarEl: HTMLElement,
    private readonly cb: TouchCallbacks,
  ) {
    input.touchMode = true;
    document.body.classList.add('touch');
    this.el = document.createElement('div');
    this.el.id = 'touch';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="stick" aria-hidden="true"><div class="knob"></div></div>
      <div class="touch-top">
        <button type="button" data-act="pause" aria-label="暫停">❚❚</button>
        <button type="button" data-act="chat" aria-label="聊天">💬</button>
        <button type="button" data-act="view" aria-label="切換視角">👁</button>
        <button type="button" data-act="gear" aria-label="裝備">🎒</button>
        <button type="button" data-act="mode" class="mode" aria-label="切換戰鬥模式">⚔️</button>
      </div>
      <div class="touch-btns">
        <button type="button" data-hold="fly" data-slot="c" class="small" aria-label="飛行開關">飛</button>
        <button type="button" data-hold="Mouse2" data-slot="b" aria-label="放方塊">放</button>
        <button type="button" data-hold="Mouse0" data-slot="a" aria-label="挖方塊">挖</button>
        <button type="button" data-hold="Space" class="jump" aria-label="跳">跳</button>
      </div>`;
    document.body.append(this.el);
    this.base = this.el.querySelector('.stick')!;
    this.knob = this.el.querySelector('.knob')!;

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.moveTo(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));

    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-hold]')) {
      const press = (down: boolean) => {
        const code = b.dataset.hold!;
        b.classList.toggle('on', down);
        if (code === 'fly') {
          this.input.hold('KeyF', down);
        } else if (code.startsWith('Mouse')) {
          this.input.holdButton(Number(code.slice(5)), down);
        } else {
          this.input.hold(code, down);
        }
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(b, e.pointerId);
        press(true);
      });
      const release = () => press(false);
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    this.el.querySelector('[data-act=pause]')!.addEventListener('click', () => this.cb.onPause());
    this.el.querySelector('[data-act=chat]')!.addEventListener('click', () => this.cb.onChat());
    this.el.querySelector('[data-act=mode]')!.addEventListener('click', () => this.cb.onMode());
    this.el.querySelector('[data-act=view]')!.addEventListener('click', () => this.cb.onView());
    this.el.querySelector('[data-act=gear]')!.addEventListener('click', () => this.cb.onGear());

    // Tap a hotbar slot to pick that block.
    hotbarEl.classList.add('tappable');
    hotbarEl.addEventListener('pointerdown', (e) => {
      const slot = (e.target as HTMLElement).closest('.slot');
      if (!slot) return;
      e.preventDefault();
      const i = [...hotbarEl.querySelectorAll('.slot')].indexOf(slot);
      if (i >= 0) hotbar.select(i);
    });
  }

  /** Fullscreen on joining where the browser allows it (Android; iPhone Safari does not). */
  enterFullscreen(): void {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      const p = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.();
      (p as Promise<void> | undefined)?.catch?.(() => {});
    } catch {
      /* not allowed here */
    }
  }

  /** Combat mode: dig → attack, place → guard, fly → dodge. */
  setMode(mode: 'build' | 'combat'): void {
    const combat = mode === 'combat';
    const set = (sel: string, text: string, label: string, hold?: string) => {
      const b = this.el.querySelector<HTMLButtonElement>(sel)!;
      b.textContent = text;
      b.setAttribute('aria-label', label);
      if (hold) b.dataset.hold = hold;
    };
    this.reset();
    set('.touch-btns [data-slot=a]', combat ? '攻擊' : '挖', combat ? '攻擊' : '挖方塊');
    // Combat: attack = LMB, guard = hold E, dodge = RMB (same as the keyboard and mouse).
    set(
      '.touch-btns [data-slot=b]',
      combat ? '防禦' : '放',
      combat ? '防禦（按住）' : '放方塊',
      combat ? 'KeyE' : 'Mouse2',
    );
    set(
      '.touch-btns [data-slot=c]',
      combat ? '閃避' : '飛',
      combat ? '閃避' : '飛行開關',
      combat ? 'Mouse2' : 'fly',
    );
    this.el.classList.toggle('combat', combat);
    this.el.querySelector('[data-act=mode]')!.textContent = combat ? '🔨' : '⚔️';
  }

  /** Shown while playing. */
  setVisible(on: boolean): void {
    this.el.hidden = !on;
    if (!on) this.reset();
  }

  private inStickZone(x: number, y: number): boolean {
    return x < window.innerWidth * 0.42 && y > window.innerHeight * 0.3;
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' || !this.input.locked) return;
    e.preventDefault();
    capture(this.canvas, e.pointerId);
    if (this.stickId === null && this.inStickZone(e.clientX, e.clientY)) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.knob.style.transform = 'translate(0px, 0px)';
      this.base.classList.add('on');
    } else {
      this.lookIds.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }

  private moveTo(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, STICK_RADIUS / len);
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const v = stickVector(dx, dy);
      this.input.move.fwd = v.fwd;
      this.input.move.side = v.side;
      this.base.classList.toggle('sprint', Math.hypot(v.fwd, v.side) > 0.97);
      return;
    }
    const last = this.lookIds.get(e.pointerId);
    if (!last) return;
    this.input.addLook((e.clientX - last.x) * LOOK_GAIN, (e.clientY - last.y) * LOOK_GAIN);
    last.x = e.clientX;
    last.y = e.clientY;
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.input.move.fwd = 0;
      this.input.move.side = 0;
      this.base.classList.remove('on', 'sprint');
    }
    this.lookIds.delete(e.pointerId);
  }

  private reset(): void {
    this.stickId = null;
    this.lookIds.clear();
    this.input.move.fwd = 0;
    this.input.move.side = 0;
    this.base.classList.remove('on', 'sprint');
    for (const b of this.el.querySelectorAll('.on')) b.classList.remove('on');
  }
}
