// Core of POST /api/agent/diary — called by Supabase pg_cron at 23:30 Asia/Taipei
// (migration 20261111040000_agent_memory_diary.sql) with the shared secret in `x-agent-secret`.
// Body (optional): { date?: "YYYY-MM-DD", agentId?: string } — defaults to today (Taipei) and every LLM agent.
//
// Diaries have a reserved budget: they are written even when the daily think budget is used up
// (one call per character per day, ~US$0.001), so memory never has gaps.

import { diaryMessages, parseDiaryReply, type DiaryInput } from '../../src/agents/diary.js';
import { parseMind } from '../../src/agents/mind.js';
import { PERSONAS } from '../../src/agents/personas.js';
import { chatCompletion, config, costOf, extractJson, json, rpc, type ThinkDeps } from './thinkCore.js';
import { safeEqual } from './tickCore.js';

export function taipeiDate(nowMs: number): string {
  return new Date(nowMs + 8 * 3600_000).toISOString().slice(0, 10);
}

export interface DiaryReport {
  agentId: string;
  skipped?: string;
  error?: string;
  day?: number;
  memory?: string;
  /** Interests/goals after tonight's update (or why the update was skipped). */
  interests?: string[];
  goals?: { goal: string; status: string }[];
  notes?: number;
  mindError?: string;
  cost?: number;
}

export async function handleDiary(req: Request, deps: ThinkDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const cfg = config(deps.env);
  if (!cfg.dbSecret) return json({ error: 'not configured' }, 503);
  if (!safeEqual(req.headers.get('x-agent-secret') ?? '', cfg.dbSecret))
    return json({ error: 'forbidden' }, 403);
  const now = deps.now ?? Date.now;
  const body = (await req.json().catch(() => ({}))) as { date?: unknown; agentId?: unknown };
  const date =
    typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : taipeiDate(now());
  const agents = cfg.agents.filter(
    (id) => PERSONAS[id] && (body.agentId === undefined || body.agentId === id),
  );

  const reports: DiaryReport[] = [];
  for (const agentId of agents) {
    const report: DiaryReport = { agentId };
    reports.push(report);
    try {
      const input = await rpc<DiaryInput>(deps, cfg, 'agent_diary_input', {
        p_secret: cfg.dbSecret,
        p_agent: agentId,
        p_date: date,
      });
      if (!input.events?.length) {
        report.skipped = 'nothing happened today';
        continue;
      }
      report.day = Number(input.day) || 1;
      const others = cfg.agents.filter((id) => id !== agentId).map((id) => PERSONAS[id]?.displayName ?? id);
      const messages = diaryMessages(PERSONAS[agentId]!, input, date, others);
      let cost = 0;
      let tokensIn = 0;
      let tokensOut = 0;
      let saved = false;
      for (let attempt = 0; attempt < 2 && !saved; attempt++) {
        const brain = cfg.brains[agentId]!;
        const reply = await chatCompletion(deps, brain, messages, 3000, 45_000);
        if (!reply.ok) {
          report.error = reply.error;
          break;
        }
        cost += costOf(brain, reply.usage);
        tokensIn += reply.usage.prompt_tokens;
        tokensOut += reply.usage.completion_tokens;
        const parsed = parseDiaryReply(extractJson(reply.content), report.day, date);
        if (!parsed.ok) {
          report.error = `invalid diary: ${parsed.error}`;
          messages.push({
            role: 'user',
            content: `Your answer was invalid (${parsed.error}). Reply again with the JSON object only.`,
          });
          continue;
        }
        await rpc(deps, cfg, 'agent_save_diary', {
          p_secret: cfg.dbSecret,
          p_agent: agentId,
          p_date: date,
          p_game_day: report.day,
          p_content: parsed.diary,
          p_summary: parsed.memory,
          p_model: cfg.brains[agentId]!.model,
          p_input_tokens: tokensIn,
          p_output_tokens: tokensOut,
          p_cost: Number(cost.toFixed(6)),
        });
        saved = true;
        report.error = undefined;
        report.memory = parsed.memory;
        if (parsed.mind) {
          // Keep when each surviving note was first learned.
          const before = new Map((parseMind(input.mind)?.knowledge ?? []).map((k) => [k.text, k.at]));
          const stamp = new Date(now()).toISOString();
          await rpc(deps, cfg, 'agent_save_mind', {
            p_secret: cfg.dbSecret,
            p_agent: agentId,
            p_knowledge: parsed.mind.knowledge.map((text) => ({ text, at: before.get(text) ?? stamp })),
            p_interests: parsed.mind.interests,
            p_goals: parsed.mind.goals,
          });
          report.interests = parsed.mind.interests;
          report.goals = parsed.mind.goals;
          report.notes = parsed.mind.knowledge.length;
        } else {
          report.mindError = parsed.mindError;
        }
      }
      report.cost = cost;
    } catch (err) {
      report.error = (err as Error).message;
    }
  }
  return json({ date, reports });
}
