// Chat window: live lines from characters and online players, who is online, and a box to talk.
//   - "Gem → Clio" for a line to one listener, "Gem → 所有人" for everyone
//   - collapsible (remembers), scrollable, keeps the newest MAX_LINES lines (older ones are removed)
//   - T or Enter opens the input (leaves mouse-look), Enter sends, Esc closes

import type { LiveMessage } from '../multiplayer/island';

export const MAX_LINES = 150;
const HIDDEN_KEY = 'voxel:chat-hidden';

export interface ChatPeople {
  /** Display name for a character or player id (null if unknown). */
  nameOf(id: string): string | null;
  colorOf(id: string): string;
  /** Who can be picked as a listener, in order (characters first). */
  targets(): { id: string; label: string }[];
  /** Roster line: everyone online + the characters. */
  onlineSummary(): { count: number; text: string };
  meId: string;
}

export interface ChatCallbacks {
  send(text: string, to: string | null): Promise<{ ok: boolean; error?: string }>;
  /** The player wants to type: leave pointer lock without showing the pause screen. */
  startTyping(): void;
  /** Done typing (sent or cancelled) — `resume` when Enter sent the line. */
  stopTyping(resume: boolean): void;
  /** The input lost focus (on phones: the keyboard was dismissed without sending). */
  blurred?(): void;
}

const pad = (n: number) => String(n).padStart(2, '0');
function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class ChatWindow {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly roster: HTMLElement;
  private readonly count: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly target: HTMLSelectElement;
  private readonly status: HTMLElement;
  private readonly pill: HTMLButtonElement;
  private readonly seen = new Set<number>();
  /** Names learned from lines (players who already left still show by name). */
  private readonly names = new Map<string, string>();
  private unread = 0;
  private hidden: boolean;
  private sending = false;

  constructor(
    parent: HTMLElement,
    private readonly people: ChatPeople,
    private readonly cb: ChatCallbacks,
  ) {
    this.hidden = safeGet(HIDDEN_KEY) === '1';
    this.el = document.createElement('section');
    this.el.className = 'chat';
    this.el.setAttribute('aria-label', '聊天');
    this.el.innerHTML = `
      <header class="chat-head">
        <strong>聊天</strong>
        <button type="button" class="chat-online" aria-expanded="false" title="誰在線上">線上 <span class="chat-count">1</span></button>
        <button type="button" class="chat-hide" title="隱藏聊天">隱藏</button>
      </header>
      <p class="chat-roster" hidden></p>
      <ol class="chat-list" aria-live="polite"></ol>
      <form class="chat-form" autocomplete="off">
        <label class="sr">說給誰聽</label>
        <select class="chat-to" aria-label="說給誰聽"></select>
        <input class="chat-input" maxlength="140" placeholder="按 T 開始說話" aria-label="訊息" />
        <button type="submit" class="chat-send">送出</button>
      </form>
      <p class="chat-status" role="status"></p>`;
    this.pill = document.createElement('button');
    this.pill.type = 'button';
    this.pill.className = 'chat-pill';
    parent.append(this.el, this.pill);

    this.list = this.el.querySelector('.chat-list')!;
    this.roster = this.el.querySelector('.chat-roster')!;
    this.count = this.el.querySelector('.chat-count')!;
    this.input = this.el.querySelector('.chat-input')!;
    this.target = this.el.querySelector('.chat-to')!;
    this.status = this.el.querySelector('.chat-status')!;

    const onlineBtn = this.el.querySelector<HTMLButtonElement>('.chat-online')!;
    onlineBtn.addEventListener('click', () => {
      this.roster.hidden = !this.roster.hidden;
      onlineBtn.setAttribute('aria-expanded', String(!this.roster.hidden));
    });
    this.el.querySelector('.chat-hide')!.addEventListener('click', () => this.setHidden(true));
    this.pill.addEventListener('click', () => this.setHidden(false));
    this.el.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit(true);
    });
    this.input.addEventListener('focus', () => this.cb.startTyping());
    this.input.addEventListener('blur', () => this.cb.blurred?.());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        this.input.blur();
        this.cb.stopTyping(false);
      }
    });
    this.applyHidden();
    this.refreshPeople();
  }

  /** T / Enter from the game: open the box and focus the input. */
  open(): void {
    if (this.hidden) this.setHidden(false);
    this.input.focus();
  }

  get typing(): boolean {
    return document.activeElement === this.input;
  }

  /** Online players or characters changed. */
  refreshPeople(): void {
    const s = this.people.onlineSummary();
    this.count.textContent = String(s.count);
    this.roster.textContent = s.text;
    const keep = this.target.value || 'all';
    const opts = [{ id: 'all', label: '所有人' }, ...this.people.targets()];
    this.target.innerHTML = opts.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
    this.target.value = opts.some((o) => o.id === keep) ? keep : 'all';
    this.updatePill();
  }

  add(m: LiveMessage): void {
    if (this.seen.has(m.id)) return;
    this.seen.add(m.id);
    if (m.speaker_name && m.speaker_kind === 'player') this.names.set(m.speaker, m.speaker_name);
    const nearBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40;
    const li = document.createElement('li');
    const mine = m.speaker === this.people.meId;
    if (mine) li.className = 'mine';
    const from = mine ? '你' : (this.people.nameOf(m.speaker) ?? m.speaker_name ?? m.speaker);
    const to = m.to_id
      ? m.to_id === this.people.meId
        ? '你'
        : (this.people.nameOf(m.to_id) ?? this.names.get(m.to_id) ?? '某位玩家')
      : '所有人';
    li.innerHTML = `<time datetime="${esc(m.created_at)}">${hhmm(m.created_at)}</time>
      <span class="who" style="color:${esc(this.people.colorOf(m.speaker))}">${esc(from)}</span>
      <span class="arrow" aria-label="對">→</span>
      <span class="to${m.to_id ? ' direct' : ''}">${esc(to)}</span><span class="text">${esc(m.text)}</span>`;
    this.list.append(li);
    // Auto-clear: keep only the newest MAX_LINES lines.
    while (this.list.children.length > MAX_LINES) this.list.firstElementChild?.remove();
    if (this.seen.size > MAX_LINES * 4) this.seen.clear();
    if (nearBottom || mine) this.list.scrollTop = this.list.scrollHeight;
    if (this.hidden && !mine) {
      this.unread++;
      this.updatePill();
    }
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  private async submit(resume: boolean): Promise<void> {
    const text = this.input.value.trim();
    if (!text) {
      this.input.blur();
      this.cb.stopTyping(resume);
      return;
    }
    if (this.sending) return;
    this.sending = true;
    const to = this.target.value === 'all' ? null : this.target.value;
    const r = await this.cb.send(text, to);
    this.sending = false;
    if (r.ok) {
      this.input.value = '';
      this.setStatus('');
      this.input.blur();
      this.cb.stopTyping(resume);
    } else {
      this.setStatus(r.error ?? '訊息沒有送出');
    }
  }

  private setHidden(h: boolean): void {
    this.hidden = h;
    if (!h) this.unread = 0;
    safeSet(HIDDEN_KEY, h ? '1' : '0');
    this.applyHidden();
    if (!h) this.list.scrollTop = this.list.scrollHeight;
  }

  private applyHidden(): void {
    this.el.hidden = this.hidden;
    this.pill.hidden = !this.hidden;
    this.updatePill();
  }

  private updatePill(): void {
    this.pill.textContent = this.unread
      ? `聊天（${this.unread} 則新訊息）`
      : `聊天・線上 ${this.count.textContent}`;
  }
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
