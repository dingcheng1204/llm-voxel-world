-- A character's growing "mind": knowledge notes + evolving interests + goals.
--   agent_learn()     — add one note during the day (from a think's `learn`); deduplicated, rate-limited, capped
--   agent_save_mind() — nightly tidy-up/update written together with the diary
--   agent_context()   — now also returns the mind (one round trip per think)

create table if not exists public.agent_mind (
  agent_id text primary key references public.agents(id) on delete cascade,
  knowledge jsonb not null default '[]'::jsonb,   -- [{text, at}], oldest first
  interests jsonb not null default '[]'::jsonb,   -- ["…"]
  goals jsonb not null default '[]'::jsonb,       -- [{goal, status: new|in_progress|done}]
  updated_at timestamptz not null default now()
);
alter table public.agent_mind enable row level security;
create policy "public read agent mind" on public.agent_mind for select to anon, authenticated using (true);
insert into public.agent_mind (agent_id) values ('clio') on conflict do nothing;

create or replace function public.agent_learn(p_secret text, p_agent text, p_text text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_knowledge jsonb;
  v_last timestamptz;
begin
  perform private.check_agent_secret(p_secret);
  if p_text is null or char_length(p_text) < 4 or char_length(p_text) > 140 then
    return false;
  end if;
  insert into public.agent_mind (agent_id) values (p_agent) on conflict do nothing;
  select knowledge into v_knowledge from public.agent_mind where agent_id = p_agent for update;
  -- duplicate note → ignore
  if exists (select 1 from jsonb_array_elements(v_knowledge) k where k->>'text' = p_text) then
    return false;
  end if;
  -- at most one new note every 3 minutes (the model sometimes "learns" on every think)
  select max((k->>'at')::timestamptz) into v_last from jsonb_array_elements(v_knowledge) k where k ? 'at';
  if v_last is not null and v_last > now() - interval '3 minutes' then
    return false;
  end if;
  v_knowledge := v_knowledge || jsonb_build_array(jsonb_build_object('text', p_text, 'at', now()));
  -- keep the newest 40 (the nightly tidy-up brings it back under 30)
  if jsonb_array_length(v_knowledge) > 40 then
    select jsonb_agg(e order by i) into v_knowledge
      from jsonb_array_elements(v_knowledge) with ordinality as t(e, i)
     where i > jsonb_array_length(v_knowledge) - 40;
  end if;
  update public.agent_mind set knowledge = v_knowledge, updated_at = now() where agent_id = p_agent;
  return true;
end;
$$;
grant execute on function public.agent_learn(text, text, text) to anon, authenticated;

create or replace function public.agent_save_mind(
  p_secret text,
  p_agent text,
  p_knowledge jsonb,
  p_interests jsonb,
  p_goals jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.check_agent_secret(p_secret);
  if jsonb_typeof(p_knowledge) <> 'array' or jsonb_typeof(p_interests) <> 'array' or jsonb_typeof(p_goals) <> 'array' then
    raise exception 'bad mind' using errcode = '22023';
  end if;
  insert into public.agent_mind (agent_id, knowledge, interests, goals, updated_at)
  values (p_agent, p_knowledge, p_interests, p_goals, now())
  on conflict (agent_id) do update
    set knowledge = excluded.knowledge, interests = excluded.interests, goals = excluded.goals, updated_at = now();
  insert into public.events (agent_id, game_day, kind, payload)
  values (p_agent, 0, 'mind', jsonb_build_object('interests', p_interests, 'goals', p_goals,
                                                 'notes', jsonb_array_length(p_knowledge)));
end;
$$;
grant execute on function public.agent_save_mind(text, text, jsonb, jsonb, jsonb) to anon, authenticated;

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
      ) d), '[]'::json),
    'mind', (select json_build_object('knowledge', m.knowledge, 'interests', m.interests, 'goals', m.goals)
               from public.agent_mind m where m.agent_id = p_agent)
  );
end;
$$;

-- Diary input now also carries the current mind (the nightly diary call tidies and updates it).
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
               e.payload->'last_result' as last_result, e.payload->'pos' as pos, e.payload->'area' as area,
               e.payload->'learn' as learn
          from public.events e
         where e.agent_id = p_agent and e.kind = 'think' and e.created_at >= v_from and e.created_at < v_to
      ) r), '[]'::json),
    'messages', coalesce((
      select json_agg(json_build_object('at', m.created_at, 'speaker', m.speaker, 'text', m.text)
                      order by m.created_at)
        from public.messages m
       where m.created_at >= v_from and m.created_at < v_to
         and (m.speaker = p_agent or p_agent = any (m.heard_by))
    ), '[]'::json),
    'mind', (select json_build_object('knowledge', m.knowledge, 'interests', m.interests, 'goals', m.goals)
               from public.agent_mind m where m.agent_id = p_agent)
  );
end;
$$;
