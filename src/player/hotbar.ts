import { BLOCKS } from '../world/blocks';
import { labelOf, SLOTS, type Inventory, type Stack } from './inventory';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * 1–9 / mouse-wheel hotbar rendered as DOM (cheap, crisp, no extra draw calls).
 * Shows the inventory's 9 slots with their counts; empty slots stay selectable (placing does nothing).
 */
export class Hotbar {
  selected = 0;
  private readonly slots: HTMLElement[] = [];
  private readonly label: HTMLElement;

  constructor(
    el: HTMLElement,
    readonly inventory: Inventory,
  ) {
    el.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'hotbar-row';
    for (let i = 0; i < SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      row.appendChild(slot);
      this.slots.push(slot);
    }
    this.label = document.createElement('div');
    this.label.className = 'hotbar-label';
    el.append(this.label, row);
    const prev = inventory.onChange;
    inventory.onChange = () => {
      prev();
      this.refresh();
    };
    this.refresh();
    this.select(0);
  }

  /** The selected stack, or null if that slot is empty. */
  get current(): Stack | null {
    return this.inventory.slots[this.selected] ?? null;
  }

  /** Redraw all slots from the inventory. */
  refresh(): void {
    this.slots.forEach((slot, i) => {
      const s = this.inventory.slots[i];
      const key = `${s?.id ?? 0}:${s?.count ?? 0}`;
      if (slot.dataset.key === key) return;
      slot.dataset.key = key;
      slot.innerHTML = `<span class="key">${i + 1}</span>`;
      slot.classList.toggle('empty', !s);
      slot.title = s ? labelOf(s.id) : '空';
      if (!s) return;
      const def = BLOCKS[s.id]!;
      const cube = document.createElement('div');
      cube.className = 'cube';
      cube.style.setProperty('--top', hex(def.colors.top));
      cube.style.setProperty('--side', hex(def.colors.side));
      const n = document.createElement('span');
      n.className = 'count';
      n.textContent = String(s.count);
      slot.append(cube, n);
    });
  }

  select(i: number): void {
    const n = SLOTS;
    this.selected = ((i % n) + n) % n;
    this.slots.forEach((s, k) => s.classList.toggle('active', k === this.selected));
    this.flash(this.current ? labelOf(this.current.id) : '空格');
  }

  /** Show a short message above the hotbar (block name, "背包滿了", …). */
  flash(text: string): void {
    this.label.textContent = text;
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
