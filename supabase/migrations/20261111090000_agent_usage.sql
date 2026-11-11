-- Usage summary for the diary page's cost panel (served through /api/agent/usage, which adds the limits
-- from the Vercel env). Aggregates only — no prompts or tokens per call leave the database.
--   taipei day  = the shared USD budget day (resets at 00:00 Asia/Taipei)
--   pacific day = Gemini free-tier day (resets at 00:00 America/Los_Angeles = 16:00 or 15:00 Taipei)

create or replace function public.agent_usage(p_secret text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
  v_pt_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
begin
  perform private.check_agent_secret(p_secret);
  return json_build_object(
    'spent_today', (select coalesce(sum(cost_usd), 0) from public.usage where created_at >= v_day_start),
    'agents', coalesce((
      select json_agg(a order by a.agent_id) from (
        select u.agent_id,
               count(*) filter (where u.created_at >= v_day_start) as calls_today,
               coalesce(sum(u.cost_usd) filter (where u.created_at >= v_day_start), 0) as cost_today,
               count(*) filter (where u.created_at >= v_day_start and u.purpose = 'think') as thinks_today,
               count(*) filter (where u.created_at >= v_pt_start) as calls_pt_day,
               max(u.created_at) as last_call_at
          from public.usage u
         where u.agent_id is not null and u.created_at >= least(v_day_start, v_pt_start)
         group by u.agent_id
      ) a), '[]'::json)
  );
end;
$$;

revoke all on function public.agent_usage(text) from public;
grant execute on function public.agent_usage(text) to anon, authenticated;
