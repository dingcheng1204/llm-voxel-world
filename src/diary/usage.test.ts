import { describe, expect, it } from 'vitest';
import { duration, formatUsage, type Usage } from './usage';

const base: Usage = {
  spentToday: 0.2146,
  dailyBudget: 0.5,
  budgetResetsIn: 7 * 3600 + 29 * 60,
  agents: [
    {
      id: 'clio',
      provider: 'minimax',
      model: 'MiniMax-M3.1-Flash',
      enabled: true,
      callsToday: 541,
      thinksToday: 530,
      costToday: 0.2146,
      callsPtDay: 57,
      maxPerDay: null,
      capResetsIn: null,
      lastCallAt: null,
    },
    {
      id: 'gem',
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      enabled: true,
      callsToday: 121,
      thinksToday: 120,
      costToday: 0,
      callsPtDay: 20,
      maxPerDay: 470,
      capResetsIn: 23 * 3600 + 29 * 60,
      lastCallAt: null,
    },
  ],
};
// 2026-11-11 16:31 Taipei.
const NOW = Date.UTC(2026, 10, 11, 8, 31);

describe('formatUsage', () => {
  it('shows Clio in dollars against the budget and Gem as the Nth free call', () => {
    const [clio, gem] = formatUsage(base, NOW);
    expect(clio).toMatchObject({ title: 'Clio · MiniMax', value: '$0.21', of: ' ／ 每日預算 $0.50' });
    expect(clio!.ratio).toBeCloseTo(0.4292, 3);
    expect(clio!.notes[0]).toBe('7 小時 29 分後重置（每天午夜 12 點）。');
    expect(clio!.notes[1]).toContain('Gem 免費');
    expect(gem).toMatchObject({ title: 'Gem · Gemini', value: '第 20 次', of: ' ／ 每天 500 次' });
    expect(gem!.ratio).toBeCloseTo(20 / 470);
    expect(gem!.notes[0]).toMatch(/^23 小時 29 分後重置（台灣時間下午\s?4:00）。$/);
    expect(gem!.notes[1]).toContain('第 470 次就停');
  });

  it('says when a character is resting because the limit is used up', () => {
    const u: Usage = {
      ...base,
      spentToday: 0.61,
      agents: base.agents.map((a) =>
        a.id === 'gem' ? { ...a, callsPtDay: 470 } : { ...a, costToday: 0.61 },
      ),
    };
    const [clio, gem] = formatUsage(u, NOW);
    expect(clio!.ratio).toBeGreaterThan(1);
    expect(clio!.notes[0]).toContain('預算用完了');
    expect(gem!.ratio).toBe(1);
    expect(gem!.notes[0]).toContain('額度用完了');
  });

  it('skips characters that are switched off', () => {
    const u = { ...base, agents: base.agents.map((a) => (a.id === 'gem' ? { ...a, enabled: false } : a)) };
    expect(formatUsage(u, NOW).map((m) => m.id)).toEqual(['clio']);
  });
});

describe('duration', () => {
  it('reads naturally', () => {
    expect(duration(30)).toBe('1 分鐘');
    expect(duration(45 * 60)).toBe('45 分鐘');
    expect(duration(3 * 3600)).toBe('3 小時');
    expect(duration(3 * 3600 + 5 * 60)).toBe('3 小時 5 分');
  });
});
