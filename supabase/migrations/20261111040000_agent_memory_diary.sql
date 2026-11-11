-- Memory + daily diaries for LLM characters.
--   agent_context()     — budget + rate limit + short-term memory (recent thinks) + long-term (diary one-liners),
--                         one round trip per think (replaces agent_budget in /api/agent/think and the tick)
--   agent_diary_input() — everything that happened on one Asia/Taipei day, for writing the diary
--   agent_save_diary()  — upsert the diary + its one-line memory, log usage
--   pg_cron 'agent-diary' — 23:30 Asia/Taipei (15:30 UTC) → POST /api/agent/diary
-- All need the shared secret (env AGENT_DB_SECRET), like the other agent RPCs.

alter table public.diaries add column if not exists summary text check (char_length(summary) <= 400);

create or replace function public.agent_context(p_secret text, p_agent text, p_recent int default 10)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
begin
  perform private.check_agent_secret(p_secret);
  return json_build_object(
    'spent_today', (select coalesce(sum(cost_usd), 0) from public.usage where created_at >= v_day_start),
    'calls_last_minute', (select count(*) from public.usage
                           where purpose = 'think' and created_at >= now() - interval '1 minute'),
    'recent', coalesce((
      select json_agg(r order by r.at desc) from (
        select e.created_at as at,
               e.payload->'thought' as thought, e.payload->'say' as say, e.payload->'actions' as actions,
               e.payload->'last_result' as last_result, e.payload->'pos' as pos, e.payload->'area' as area
          from public.events e
         where e.agent_id = p_agent and e.kind = 'think' and e.created_at >= now() - interval '24 hours'
         order by e.created_at desc
         limit least(greatest(p_recent, 0), 30) + 1
      ) r), '[]'::json),
    'diaries', coalesce((
      select json_agg(d order by d.date desc) from (
        select x.diary_date as date, x.summary,
               (select count(*) from public.diaries y
                 where y.agent_id = x.agent_id and y.diary_date <= x.diary_date) as day
          from public.diaries x
         where x.agent_id = p_agent and x.summary is not null
         order by x.diary_date desc
         limit 3
      ) d), '[]'::json)
  );
end;
$$;
grant execute on function public.agent_context(text, text, int) to anon, authenticated;

create or replace function public.agent_diary_input(p_secret text, p_agent text, p_date date)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := p_date::timestamp at time zone 'Asia/Taipei';
  v_to timestamptz := (p_date + 1)::timestamp at time zone 'Asia/Taipei';
begin
  perform private.check_agent_secret(p_secret);
  return json_build_object(
    'day', (select count(*) + 1 from public.diaries where agent_id = p_agent and diary_date < p_date),
    'previous', (select json_build_object('date', diary_date, 'content', content_md)
                   from public.diaries where agent_id = p_agent and diary_date < p_date
                  order by diary_date desc limit 1),
    'events', coalesce((
      select json_agg(r order by r.at) from (
        select e.created_at as at,
               e.payload->'thought' as thought, e.payload->'say' as say, e.payload->'actions' as actions,
               e.payload->'last_result' as last_result, e.payload->'pos' as pos, e.payload->'area' as area
          from public.events e
         where e.agent_id = p_agent and e.kind = 'think' and e.created_at >= v_from and e.created_at < v_to
      ) r), '[]'::json),
    'messages', coalesce((
      select json_agg(json_build_object('at', m.created_at, 'speaker', m.speaker, 'text', m.text)
                      order by m.created_at)
        from public.messages m
       where m.created_at >= v_from and m.created_at < v_to
         and (m.speaker = p_agent or p_agent = any (m.heard_by))
    ), '[]'::json)
  );
end;
$$;
grant execute on function public.agent_diary_input(text, text, date) to anon, authenticated;

create or replace function public.agent_save_diary(
  p_secret text,
  p_agent text,
  p_date date,
  p_game_day int,
  p_content text,
  p_summary text,
  p_model text,
  p_input_tokens int,
  p_output_tokens int,
  p_cost numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_agent_secret(p_secret);
  insert into public.diaries (agent_id, diary_date, game_day, content_md, summary, model)
  values (p_agent, p_date, p_game_day, p_content, p_summary, p_model)
  on conflict (agent_id, diary_date) do update
    set game_day = excluded.game_day, content_md = excluded.content_md, summary = excluded.summary,
        model = excluded.model, created_at = now();
  insert into public.usage (agent_id, model, purpose, input_tokens, output_tokens, cost_usd)
  values (p_agent, p_model, 'diary', p_input_tokens, p_output_tokens, p_cost);
  insert into public.events (agent_id, game_day, kind, payload)
  values (p_agent, coalesce(p_game_day, 0), 'diary', json_build_object('date', p_date, 'summary', p_summary)::jsonb);
end;
$$;
grant execute on function public.agent_save_diary(text, text, date, int, text, text, text, int, int, numeric)
  to anon, authenticated;

-- Generic caller for the agent API from pg_cron (base URL + secret from private.settings).
insert into private.settings (key, value)
values ('api_base', 'https://llm-voxel-world.vercel.app')
on conflict (key) do nothing;

create or replace function private.call_agent_api(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := (select value from private.settings where key = 'api_base');
  v_secret text := (select value from private.settings where key = 'agent_secret');
begin
  if v_base is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_base || p_path,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-agent-secret', v_secret),
    timeout_milliseconds := 60000
  );
end;
$$;
revoke all on function private.call_agent_api(text) from public, anon, authenticated;

select cron.unschedule('agent-diary') where exists (select 1 from cron.job where jobname = 'agent-diary');
select cron.schedule('agent-diary', '30 15 * * *', $$select private.call_agent_api('/api/agent/diary')$$);
