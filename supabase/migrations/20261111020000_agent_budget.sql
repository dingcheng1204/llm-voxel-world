-- Server-side budget + logging for LLM-driven agents.
-- The Vercel function /api/agent/think calls these RPCs with the public anon key PLUS a shared
-- secret (env AGENT_DB_SECRET). The secret lives in private.settings (schema not exposed to the API),
-- so browsers cannot write usage/events even though the functions are callable.

create schema if not exists private;
revoke all on schema private from anon, authenticated;

create table if not exists private.settings (
  key text primary key,
  value text not null
);
-- The secret itself is inserted out-of-band (never committed):
--   insert into private.settings (key, value) values ('agent_secret', '<random>');

create or replace function private.check_agent_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or not exists (
    select 1 from private.settings where key = 'agent_secret' and value = p_secret
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

-- Spend today (Asia/Taipei) and calls in the last minute — used to enforce the daily budget
-- and a global rate limit no matter how many visitors are online.
create or replace function public.agent_budget(p_secret text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spent numeric;
  v_calls int;
begin
  perform private.check_agent_secret(p_secret);
  select coalesce(sum(cost_usd), 0) into v_spent
    from public.usage
   where created_at >= date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
  select count(*) into v_calls from public.usage where created_at >= now() - interval '1 minute';
  return json_build_object('spent_today', v_spent, 'calls_last_minute', v_calls);
end;
$$;

-- One think = one usage row + one event row (events feed the daily diaries later).
create or replace function public.agent_log_think(
  p_secret text,
  p_agent text,
  p_model text,
  p_input_tokens int,
  p_output_tokens int,
  p_cost numeric,
  p_game_day int,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_agent_secret(p_secret);
  insert into public.usage (agent_id, model, purpose, input_tokens, output_tokens, cost_usd)
  values (p_agent, p_model, 'think', p_input_tokens, p_output_tokens, p_cost);
  insert into public.events (agent_id, game_day, kind, payload)
  values (p_agent, coalesce(p_game_day, 0), 'think', coalesce(p_payload, '{}'::jsonb));
end;
$$;

revoke all on function private.check_agent_secret(text) from public, anon, authenticated;
grant execute on function public.agent_budget(text) to anon, authenticated;
grant execute on function public.agent_log_think(text, text, text, int, int, numeric, int, jsonb) to anon, authenticated;
