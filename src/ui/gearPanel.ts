// Equipment panel (I key / 🎒): the three slots (weapon, armor, shoes), the character's totals, and
// the gear bag. Click a bag item to equip it (the old one goes back into the bag); click an equipped
// item to take it off. Plain DOM; styles in index.html.

import { BAG_SIZE, BASE_STATS, GEAR, type Equipment, type GearDef, type GearSlot } from '../player/equipment';

const SLOT_LABEL: Record<GearSlot, string> = { weapon: '武器', armor: '防具', shoes: '鞋子' };

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function statLine(g: GearDef): string {
  const parts: string[] = [];
  if (g.weapon)
    parts.push(g.weapon.kind === 'magic' ? `🪄 魔法 ${g.weapon.range} 格` : `近戰 ${g.weapon.range} 格`);
  if (g.stats.attack) parts.push(`⚔️ +${g.stats.attack}`);
  if (g.stats.defense) parts.push(`🛡️ +${g.stats.defense}`);
  if (g.stats.speed) parts.push(`👟 ${g.stats.speed > 0 ? '+' : ''}${g.stats.speed}`);
  if (g.weapon?.stamina) parts.push(`每次 ${g.weapon.stamina} 體力`);
  return parts.join('・');
}

export class GearPanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  onClose: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly gear: Equipment,
    private readonly limits: () => { maxHp: number; maxStamina: number },
  ) {
    this.el = document.createElement('div');
    this.el.id = 'gear';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="gear-card" role="dialog" aria-label="裝備">
        <div class="gear-head"><h2>🎒 裝備</h2><button type="button" class="close" aria-label="關閉">✕</button></div>
        <div class="gear-body"></div>
        <p class="gear-tip">攻擊、防禦、速度都由裝備決定；愛心和體力上限只有特別的道具或事件才會增加。晚上打倒史萊姆有機會撿到裝備。</p>
      </div>`;
    this.body = this.el.querySelector('.gear-body')!;
    this.el.querySelector('.close')!.addEventListener('click', () => this.onClose());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.onClose();
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-bag],[data-slot]');
      if (!t) return;
      if (t.dataset.bag !== undefined) this.gear.equip(Number(t.dataset.bag));
      else this.gear.unequip(t.dataset.slot as GearSlot);
    });
    parent.append(this.el);
    const prev = gear.onChange;
    gear.onChange = () => {
      prev();
      if (!this.el.hidden) this.render();
    };
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(): void {
    this.render();
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  private render(): void {
    const s = this.gear.stats;
    const { maxHp, maxStamina } = this.limits();
    const slot = (k: GearSlot) => {
      const g = this.gear.get(k);
      return `<button type="button" class="gslot${g ? '' : ' empty'}" data-slot="${k}" title="${g ? '點一下卸下' : ''}">
        <span class="lbl">${SLOT_LABEL[k]}</span>
        <span class="ico">${g ? g.icon : '·'}</span>
        <b>${g ? esc(g.name) : '沒有'}</b>
        <small>${g ? esc(statLine(g)) : ''}</small>
      </button>`;
    };
    let bag = '';
    for (let i = 0; i < BAG_SIZE; i++) {
      const id = this.gear.bag[i];
      const g = id ? GEAR[id] : undefined;
      bag += g
        ? `<button type="button" class="gbag" data-bag="${i}" title="${esc(g.note)}"><span class="ico">${g.icon}</span><b>${esc(g.name)}</b><small>${SLOT_LABEL[g.slot]}・${esc(statLine(g))}</small></button>`
        : `<div class="gbag empty"></div>`;
    }
    this.body.innerHTML = `
      <div class="gslots">${slot('weapon')}${slot('armor')}${slot('shoes')}</div>
      <div class="gtotals">
        <span>❤️ ${maxHp / 2} 顆</span><span>⚡ ${maxStamina}</span>
        <span>⚔️ ${s.attack} <small>(基本 ${BASE_STATS.attack})</small></span>
        <span>🛡️ ${s.defense} <small>(基本 ${BASE_STATS.defense})</small></span>
        <span>👟 ${s.speed.toFixed(1)} <small>(基本 ${BASE_STATS.speed})</small></span>
      </div>
      <h3>裝備袋 <small>點一下換上</small></h3>
      <div class="gbags">${bag}</div>`;
  }
}
