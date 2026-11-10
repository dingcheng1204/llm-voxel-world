import { B, BLOCKS } from '../world/blocks';

export interface HotbarItem {
  id: number;
  label: string;
}

export const DEFAULT_HOTBAR: readonly HotbarItem[] = [
  { id: B.grass, label: '草' },
  { id: B.dirt, label: '土' },
  { id: B.stone, label: '石頭' },
  { id: B.log, label: '原木' },
  { id: B.planks, label: '木板' },
  { id: B.brick, label: '磚' },
  { id: B.toy_yellow, label: '玩具方塊' },
  { id: B.water, label: '水' },
  { id: B.fire, label: '火' },
];

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** 1–9 / mouse-wheel hotbar rendered as DOM (cheap, crisp, no extra draw calls). */
export class Hotbar {
  selected = 0;
  private readonly slots: HTMLElement[] = [];
  private readonly label: HTMLElement;

  constructor(
    el: HTMLElement,
    readonly items: readonly HotbarItem[] = DEFAULT_HOTBAR,
  ) {
    el.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'hotbar-row';
    items.forEach((item, i) => {
      const def = BLOCKS[item.id]!;
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML = `<span class="key">${i + 1}</span>`;
      const cube = document.createElement('div');
      cube.className = 'cube';
      cube.style.setProperty('--top', hex(def.colors.top));
      cube.style.setProperty('--side', hex(def.colors.side));
      slot.appendChild(cube);
      slot.title = item.label;
      row.appendChild(slot);
      this.slots.push(slot);
    });
    this.label = document.createElement('div');
    this.label.className = 'hotbar-label';
    el.append(this.label, row);
    this.select(0);
  }

  get current(): HotbarItem {
    return this.items[this.selected]!;
  }

  select(i: number): void {
    const n = this.items.length;
    this.selected = ((i % n) + n) % n;
    this.slots.forEach((s, k) => s.classList.toggle('active', k === this.selected));
    this.label.textContent = this.current.label;
    this.label.classList.remove('flash');
    void this.label.offsetWidth; // restart the fade animation
    this.label.classList.add('flash');
  }

  /** Handles Digit1–9 presses and wheel steps. */
  handle(presses: string[], wheel: number): void {
    for (const p of presses) {
      const m = /^Digit([1-9])$/.exec(p);
      if (m) this.select(Number(m[1]) - 1);
    }
    if (wheel !== 0) this.select(this.selected + wheel);
  }
}
