-- Conversation rules: agent_context() also returns the lines this character said or heard in the last
-- 6 minutes; /api/agent/think turns them into a conversation state (src/agents/chatRules.ts) and mutes a
-- character that should wait for an answer or is in its 60 s cooldown.

create or replace function public.agent_context(p_secret text, p_agent text, p_recent int default 10)
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
    'calls_last_minute', (select count(*) from public.usage
                           where purpose = 'think' and created_at >= now() - interval '1 minute'),
    'agent_calls_pt_day', (select count(*) from public.usage where agent_id = p_agent and created_at >= v_pt_start),
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
      ) d), '[]'::json),
    'mind', (select json_build_object('knowledge', m.knowledge, 'interests', m.interests, 'goals', m.goals)
               from public.agent_mind m where m.agent_id = p_agent),
    'chat', coalesce((
      select json_agg(json_build_object('at', m.created_at, 'speaker', m.speaker, 'text', m.text,
                                        'heard_by', m.heard_by) order by m.created_at)
        from public.messages m
       where m.created_at >= now() - interval '6 minutes'
         and (m.speaker = p_agent or p_agent = any (m.heard_by))
    ), '[]'::json)
  );
end;
$$;

