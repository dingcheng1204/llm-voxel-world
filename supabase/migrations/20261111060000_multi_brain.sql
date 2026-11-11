-- Several LLM characters with different brains.
--   agent_context()   — also returns this character's calls since midnight Pacific (Gemini free-tier day)
--   agent_log_think() — a think that says something also writes a `messages` row, with `heard_by` = the other
--                       server-run characters within 16 blocks (from agent_state). Diaries and the server tick
--                       read conversations from there.
--   agent_mind / agent_state rows for gem.

insert into public.agent_state (agent_id) values ('gem') on conflict do nothing;
insert into public.agent_mind (agent_id) values ('gem') on conflict do nothing;
update public.agents set provider = 'google', model = 'gemini-3.1-flash-lite' where id = 'gem';
update public.agents set provider = 'minimax', model = 'MiniMax-M3.1-Flash' where id = 'clio';

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
               from public.agent_mind m where m.agent_id = p_agent)
  );
end;
$$;

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
declare
  v_say text := nullif(btrim(coalesce(p_payload->>'say', '')), '');
  v_pos jsonb := p_payload->'pos';
begin
  perform private.check_agent_secret(p_secret);
  insert into public.usage (agent_id, model, purpose, input_tokens, output_tokens, cost_usd)
  values (p_agent, p_model, 'think', p_input_tokens, p_output_tokens, p_cost);
  insert into public.events (agent_id, game_day, kind, payload)
  values (p_agent, coalesce(p_game_day, 0), 'think', coalesce(p_payload, '{}'::jsonb));

  if v_say is not null and jsonb_typeof(v_pos) = 'array' and jsonb_array_length(v_pos) = 3 then
    insert into public.messages (speaker, text, pos, heard_by)
    values (
      p_agent,
      left(v_say, 500),
      array[(v_pos->>0)::numeric::int, (v_pos->>1)::numeric::int, (v_pos->>2)::numeric::int],
      coalesce((
        select array_agg(s.agent_id order by s.agent_id)
          from public.agent_state s
         where s.agent_id <> p_agent
           and jsonb_typeof(s.state->'pos') = 'array'
           and sqrt(power((s.state->'pos'->>0)::float - (v_pos->>0)::float, 2)
                  + power((s.state->'pos'->>1)::float - (v_pos->>1)::float, 2)
                  + power((s.state->'pos'->>2)::float - (v_pos->>2)::float, 2)) <= 16
      ), '{}')
    );
  end if;
end;
$$;
