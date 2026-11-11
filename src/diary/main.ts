// Diary reader (/diary): each character's diaries, what is on its mind (notes, interests, goals),
// what it is thinking right now, and recent conversations. Read-only, straight from Supabase's public
// tables with the publishable key (RLS allows SELECT only).

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config/supabase';
import { drawMap, MAP_BOUNDS, renderIslandBase, type MapMarker } from '../ui/islandMap';
import { escapeHtml, renderDiary } from './markdown';
import { formatUsage, type Usage } from './usage';

const SEED = Number(import.meta.env.VITE_WORLD_SEED ?? 20261110);

interface Character {
  id: string;
  name: string;
  species: string;
  brain: string;
  color: string;
}

const CHARACTERS: Character[] = [
  { id: 'clio', name: 'Clio', species: '貓', brain: 'MiniMax', color: 'var(--clio)' },
  { id: 'gem', name: 'Gem', species: '狐狸', brain: 'Gemini', color: 'var(--gem)' },
];

interface Diary {
  agent_id: string;
  diary_date: string;
  game_day: number | null;
  content_md: string;
  summary: string | null;
}
interface Mind {
  agent_id: string;
  knowledge: { text: string; at?: string }[];
  interests: string[];
  goals: { goal: string; status: 'new' | 'in_progress' | 'done' }[];
}
interface State {
  agent_id: string;
  updated_at: string;
  state: {
    thought?: string;
    thoughtAt?: number;
    say?: string | null;
    sayAt?: number | null;
    pos?: number[];
    landmarks?: { name: string; pos: number[]; by: string }[];
  };
}
interface Message {
  speaker: string;
  text: string;
  created_at: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const data = {
  diaries: [] as Diary[],
  minds: new Map<string, Mind>(),
  states: new Map<string, State>(),
  messages: [] as Message[],
  usage: null as Usage | null,
  usageError: '' as string,
};
let highlighted: string | null = null;
let mapBase: HTMLCanvasElement | null = null;
const params = new URLSearchParams(location.search);
let who = CHARACTERS.some((c) => c.id === params.get('who')) ? params.get('who')! : 'clio';
let date: string | null = params.get('date');

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`${path.split('?')[0]} 回應 ${res.status}`);
  return (await res.json()) as T;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return '剛剛';
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  return `${Math.floor(s / 86400)} 天前`;
}

const STATUS: Record<string, string> = { new: '還沒開始', in_progress: '進行中', done: '完成了' };

function renderTabs(): void {
  const nav = document.querySelector<HTMLElement>('.who')!;
  nav.innerHTML = CHARACTERS.map(
    (c) => `<button class="tag" role="tab" data-id="${c.id}" aria-selected="${c.id === who}"
      aria-label="${c.name}（${c.species}，${c.brain}）" style="--tag-color:${c.color}">
      <span class="dot" style="background:${c.color}"></span>${c.name}<small>${c.brain}</small>
    </button>`,
  ).join('');
  nav.querySelectorAll<HTMLButtonElement>('.tag').forEach((b) =>
    b.addEventListener('click', () => {
      who = b.dataset.id!;
      date = null;
      render(true);
    }),
  );
}

function renderNow(pop: boolean): void {
  const c = CHARACTERS.find((x) => x.id === who)!;
  const st = data.states.get(who);
  const s = st?.state ?? {};
  const el = $('now');
  if (!s.thought && !s.say) {
    el.innerHTML = `<p class="muted">${c.name} 還沒開始思考。</p>`;
    return;
  }
  const saidRecently = s.say && s.sayAt && Date.now() - s.sayAt < 30 * 60_000;
  el.innerHTML = `<div class="bubble${pop ? ' pop' : ''}">
      ${s.thought ? escapeHtml(s.thought) : ''}
      ${saidRecently ? `<span class="said">「${escapeHtml(s.say!)}」</span>` : ''}
    </div>
    <p class="now-meta">${c.name} 現在在想的事${st?.updated_at ? `，${ago(Date.parse(st.updated_at))}更新` : ''}</p>`;
}

function renderDiaryPart(): void {
  const mine = data.diaries.filter((d) => d.agent_id === who);
  const c = CHARACTERS.find((x) => x.id === who)!;
  const dates = $('dates');
  const paper = $('paper');
  if (mine.length === 0) {
    dates.innerHTML = '';
    paper.innerHTML = `<p class="empty">${c.name} 還沒有日記。今晚 23:30 會寫第一篇。</p>`;
    return;
  }
  if (!date || !mine.some((d) => d.diary_date === date)) date = mine[0]!.diary_date;
  dates.innerHTML = mine
    .map((d) => {
      const [, m, day] = d.diary_date.split('-');
      return `<button class="date" data-date="${d.diary_date}" aria-pressed="${d.diary_date === date}">
        ${Number(m)}月${Number(day)}日${d.game_day ? `<small> 第${d.game_day}天</small>` : ''}</button>`;
    })
    .join('');
  dates.querySelectorAll<HTMLButtonElement>('.date').forEach((b) =>
    b.addEventListener('click', () => {
      date = b.dataset.date!;
      renderDiaryPart();
      syncUrl();
    }),
  );
  const d = mine.find((x) => x.diary_date === date)!;
  paper.innerHTML =
    renderDiary(d.content_md) +
    (d.summary ? `<p class="remember"><b>想記住的事</b>${escapeHtml(d.summary)}</p>` : '');
}

function renderMind(): void {
  const c = CHARACTERS.find((x) => x.id === who)!;
  const m = data.minds.get(who);
  const interests = m?.interests ?? [];
  const goals = m?.goals ?? [];
  const notes = [...(m?.knowledge ?? [])].reverse();
  $('mind').innerHTML = `
    <div>
      <h2 class="section">最近在意的事</h2>
      ${
        interests.length
          ? `<ul class="chips">${interests.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
          : `<p class="muted">寫完第一篇日記後，${c.name} 會整理出自己最近在意的事。</p>`
      }
    </div>
    <div>
      <h2 class="section">想做的事</h2>
      ${
        goals.length
          ? `<ul class="goals">${goals
              .map(
                (
                  g,
                ) => `<li class="${g.status}"><span class="box" aria-hidden="true">${g.status === 'done' ? '✓' : ''}</span>
                  <span class="text">${escapeHtml(g.goal)}<span class="state">${STATUS[g.status] ?? ''}</span></span></li>`,
              )
              .join('')}</ul>`
          : `<p class="muted">還沒有目標。每晚寫日記時會更新。</p>`
      }
    </div>
    <div>
      <h2 class="section">筆記 <span>${notes.length ? `${notes.length} 則` : ''}</span></h2>
      ${
        notes.length
          ? `<ul class="notes">${notes.map((n) => `<li>${escapeHtml(n.text)}</li>`).join('')}</ul>`
          : `<p class="muted">發現新東西時，${c.name} 會記在這裡。</p>`
      }
    </div>`;
}

function renderTalk(): void {
  const list = data.messages.slice(0, 30);
  $('talk-count').textContent = list.length ? `最近 ${list.length} 句` : '';
  $('talk').innerHTML = list.length
    ? list
        .map((m) => {
          const c = CHARACTERS.find((x) => x.id === m.speaker);
          return `<li><span class="speaker ${c ? c.id : ''}">${escapeHtml(c?.name ?? m.speaker)}</span>
            <span class="line">${escapeHtml(m.text)}<time datetime="${m.created_at}">${ago(Date.parse(m.created_at))}</time></span></li>`;
        })
        .join('')
    : `<li><span></span><p class="muted">還沒有人說話。</p></li>`;
}

function syncUrl(): void {
  const q = new URLSearchParams({ who, ...(date ? { date } : {}) });
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

function render(pop = false): void {
  document.body.dataset.who = who;
  renderTabs();
  renderNow(pop);
  renderDiaryPart();
  renderMind();
  renderTalk();
  renderPlaces();
  linkPlaces();
  renderUsage();
  drawIslandMap();
  syncUrl();
}

// ---- places and the island map ----

interface Place {
  name: string;
  x: number;
  z: number;
  by: string;
}

/** Places named by any character (from the saved character states), newest name wins. */
function places(): Place[] {
  const byName = new Map<string, Place>();
  for (const st of data.states.values()) {
    for (const l of st.state.landmarks ?? []) {
      if (typeof l.name !== 'string' || !Array.isArray(l.pos) || l.pos.length < 3) continue;
      byName.set(l.name, { name: l.name, x: Number(l.pos[0]) + 0.5, z: Number(l.pos[2]) + 0.5, by: l.by });
    }
  }
  return [...byName.values()];
}

const colorOf = (id: string) => (id === 'gem' ? '#4285f4' : id === 'clio' ? '#f2994a' : '#8a94a8');

function renderPlaces(): void {
  const list = places();
  $('place-count').textContent = list.length ? `${list.length} 個` : '';
  $('places').innerHTML = list.length
    ? list
        .map((p) => {
          const who = CHARACTERS.find((c) => c.id === p.by)?.name ?? p.by;
          return `<li><button class="place-chip" data-place="${escapeHtml(p.name)}" aria-pressed="${p.name === highlighted}"
            title="${escapeHtml(who)} 取的名字"><span class="by" style="background:${colorOf(p.by)}"></span>${escapeHtml(p.name)}</button></li>`;
        })
        .join('')
    : `<li class="muted">還沒有取過名字的地方。</li>`;
}

/** Turns place names inside the diary, notes, thought and conversations into buttons that show the map. */
function linkPlaces(): void {
  const names = places()
    .map((p) => p.name)
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (!names.length) return;
  const re = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  for (const root of [$('paper'), $('mind'), $('now'), $('talk')]) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      re.lastIndex = 0;
      if (re.test(n.nodeValue ?? '') && !n.parentElement?.closest('button')) hits.push(n as Text);
    }
    for (const node of hits) {
      const text = node.nodeValue ?? '';
      const frag = document.createDocumentFragment();
      let last = 0;
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        frag.append(text.slice(last, m.index));
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'place';
        b.dataset.place = m[0];
        b.textContent = m[0];
        b.title = '在地圖上看位置';
        frag.append(b);
        last = m.index + m[0].length;
      }
      frag.append(text.slice(last));
      node.replaceWith(frag);
    }
  }
}

function showPlace(name: string): void {
  highlighted = highlighted === name ? null : name;
  renderPlaces();
  drawIslandMap();
  if (highlighted)
    $('map-card').scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
    });
}

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-place]');
  if (el) showPlace(el.dataset.place!);
});

function drawIslandMap(): void {
  if (!mapBase) return;
  const canvas = $<HTMLCanvasElement>('map');
  const avail = Math.max(200, ($('map-card').parentElement!.clientWidth || 400) - 20);
  const scale = Math.min(1.75, avail / MAP_BOUNDS.width);
  const w = Math.round(MAP_BOUNDS.width * scale);
  const h = Math.round(MAP_BOUNDS.height * scale);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const markers: MapMarker[] = places().map((p) => ({
    kind: 'place',
    x: p.x,
    z: p.z,
    label: p.name,
    color: '#3a3550',
    highlight: p.name === highlighted,
  }));
  for (const c of CHARACTERS) {
    const pos = data.states.get(c.id)?.state.pos;
    if (Array.isArray(pos) && pos.length >= 3) {
      markers.push({
        kind: 'character',
        x: Number(pos[0]),
        z: Number(pos[2]),
        label: c.name,
        color: colorOf(c.id),
      });
    }
  }
  drawMap(ctx, mapBase, markers, {
    scale,
    labels: 'people',
    font: '700 14px Huninn, ui-rounded, system-ui, sans-serif',
  });
}

window.addEventListener('resize', () => drawIslandMap());

// ---- today's usage ----

function renderUsage(): void {
  const el = $('usage');
  if (!data.usage) {
    el.innerHTML = `<p class="muted">${data.usageError ? escapeHtml(data.usageError) : '讀取中…'}</p>`;
    return;
  }
  el.innerHTML = formatUsage(data.usage)
    .map(
      (m) => `<article class="meter" style="--c:${colorOf(m.id)}">
        <h3>${escapeHtml(m.title)}<small>${escapeHtml(m.subtitle)}</small></h3>
        <div class="big">${escapeHtml(m.value)}<span>${escapeHtml(m.of)}</span></div>
        <div class="bar${m.ratio >= 1 ? ' over' : ''}" role="meter" aria-valuemin="0" aria-valuemax="100"
          aria-valuenow="${Math.round(Math.min(1, m.ratio) * 100)}" aria-label="${escapeHtml(m.title)}"><i style="--p:${Math.min(100, m.ratio * 100).toFixed(1)}%"></i></div>
        ${m.notes.map((n) => `<p>${escapeHtml(n)}</p>`).join('')}
      </article>`,
    )
    .join('');
}

async function loadUsage(): Promise<void> {
  try {
    const res = await fetch('/api/agent/usage');
    if (!res.ok) throw new Error(String(res.status));
    data.usage = (await res.json()) as Usage;
    data.usageError = '';
  } catch {
    data.usageError = '讀不到今天的用量（本機開發時沒有這個 API）。';
  }
}

function showError(err: unknown): void {
  const el = $('error');
  el.hidden = false;
  el.textContent = `讀不到小島的資料（${(err as Error).message}）。請檢查網路後重新整理。`;
}

async function loadLive(): Promise<void> {
  const [states, messages] = await Promise.all([
    get<State[]>('agent_state?select=agent_id,state,updated_at'),
    get<Message[]>('messages?select=speaker,text,created_at&order=created_at.desc&limit=30'),
  ]);
  data.states = new Map(states.map((s) => [s.agent_id, s]));
  data.messages = messages;
}

async function loadAll(): Promise<void> {
  const [diaries, minds] = await Promise.all([
    get<Diary[]>('diaries?select=agent_id,diary_date,game_day,content_md,summary&order=diary_date.desc'),
    get<Mind[]>('agent_mind?select=agent_id,knowledge,interests,goals'),
    loadLive(),
    loadUsage(),
  ]);
  data.diaries = diaries;
  data.minds = new Map(minds.map((m) => [m.agent_id, m]));
}

render();
// The island picture takes a moment to build; do it after the first paint.
setTimeout(() => {
  mapBase = renderIslandBase(SEED);
  drawIslandMap();
}, 50);
loadAll()
  .then(() => {
    $('error').hidden = true;
    render(true);
  })
  .catch(showError);
setInterval(() => {
  if (document.visibilityState === 'hidden') return;
  loadAll()
    .then(() => {
      $('error').hidden = true;
      render();
    })
    .catch(showError);
}, 30_000);
