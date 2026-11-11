// Turns /api/agent/usage into the diary page's meters (pure, so it is easy to test).

export interface Usage {
  spentToday: number;
  dailyBudget: number;
  budgetResetsIn: number;
  agents: {
    id: string;
    provider: string;
    model: string;
    enabled: boolean;
    callsToday: number;
    thinksToday: number;
    costToday: number;
    callsPtDay: number;
    maxPerDay: number | null;
    capResetsIn: number | null;
    lastCallAt: string | null;
  }[];
}

export interface Meter {
  id: string;
  title: string;
  subtitle: string;
  value: string;
  of: string;
  /** 0..1+ (≥ 1 = used up). */
  ratio: number;
  notes: string[];
}

const NAMES: Record<string, string> = { clio: 'Clio', gem: 'Gem' };
const PROVIDERS: Record<string, string> = { minimax: 'MiniMax', google: 'Gemini' };
/** Google's free-tier requests per day for Gemini 3.1 Flash-Lite. */
const GEMINI_FREE_RPD = 500;

export function duration(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} 小時 ${m % 60} 分` : `${h} 小時`;
}

/** Taipei clock time of a moment, e.g. "下午 4:00". */
function taipeiClock(ms: number): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}

const money = (v: number) => `$${v < 10 ? v.toFixed(2) : v.toFixed(1)}`;

export function formatUsage(u: Usage, now = Date.now()): Meter[] {
  const freeAgents = u.agents.filter((a) => a.enabled && a.costToday === 0 && a.maxPerDay !== null);
  return u.agents
    .filter((a) => a.enabled)
    .map((a) => {
      const name = NAMES[a.id] ?? a.id;
      const title = `${name} · ${PROVIDERS[a.provider] ?? a.provider}`;
      if (a.maxPerDay !== null) {
        // Free tier: counted in calls per Pacific day.
        const limit = a.provider === 'google' ? GEMINI_FREE_RPD : a.maxPerDay;
        const resetAt = now + (a.capResetsIn ?? 0) * 1000;
        const used = a.callsPtDay >= a.maxPerDay;
        return {
          id: a.id,
          title,
          subtitle: '免費額度',
          value: `第 ${a.callsPtDay} 次`,
          of: ` ／ 每天 ${limit} 次`,
          ratio: a.callsPtDay / a.maxPerDay,
          notes: [
            used
              ? `今天的額度用完了，${name} 先休息，${duration(a.capResetsIn ?? 0)}後（${taipeiClock(resetAt)}）醒來。`
              : `${duration(a.capResetsIn ?? 0)}後重置（台灣時間${taipeiClock(resetAt)}）。`,
            ...(limit !== a.maxPerDay ? [`我們用到第 ${a.maxPerDay} 次就停，留一點給重試。`] : []),
          ],
        };
      }
      // Paid: USD against the shared daily budget.
      const over = u.spentToday >= u.dailyBudget;
      const shared =
        freeAgents.length > 0
          ? `預算是共用的，${freeAgents.map((f) => NAMES[f.id] ?? f.id).join('、')} 免費，所以都是 ${name} 用的。`
          : '預算是所有角色共用的。';
      return {
        id: a.id,
        title,
        subtitle: `今天想了 ${a.thinksToday} 次`,
        value: money(a.costToday),
        of: ` ／ 每日預算 ${money(u.dailyBudget)}`,
        ratio: u.dailyBudget > 0 ? u.spentToday / u.dailyBudget : 1,
        notes: [
          over
            ? `今天的預算用完了，${name} 先休息，${duration(u.budgetResetsIn)}後（午夜 12 點）醒來。`
            : `${duration(u.budgetResetsIn)}後重置（每天午夜 12 點）。`,
          shared,
        ],
      };
    });
}
