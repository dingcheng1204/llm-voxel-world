-- Live chat between characters and online players.
--   messages.to_id         — null = everyone; otherwise the character id ('clio') or player id ('p-xxxxxx')
--   messages.speaker_name  — display name (players choose theirs); characters use their id
--   messages.speaker_kind  — 'agent' | 'player'
--   realtime               — browsers subscribe to new rows (the chat window)
--   agent_player_say()     — a player's line (validated + rate-limited by /api/chat/say)
--   agent_log_think()      — characters' lines now carry `to`; a direct line is always heard by its target

alter table public.messages add column if not exists to_id text check (char_length(to_id) <= 40);
alter table public.messages add column if not exists speaker_name text check (char_length(speaker_name) <= 40);
alter table public.messages add column if not exists speaker_kind text not null default 'agent'
  check (speaker_kind in ('agent', 'player'));
create index if not exists messages_created_idx on public.messages (created_at desc);
create index if not exists messages_speaker_idx on public.messages (speaker, created_at desc);

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

-- Characters within 16 blocks of a position (from their saved state), plus the target of a direct line.
create or replace function private.listeners(p_except text, p_pos jsonb, p_to text)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct a order by a), '{}') from (
    select s.agent_id as a
      from public.agent_state s
     where s.agent_id <> p_except
       and jsonb_typeof(s.state->'pos') = 'array'
       and jsonb_typeof(p_pos) = 'array'
       and sqrt(power((s.state->'pos'->>0)::float - (p_pos->>0)::float, 2)
              + power((s.state->'pos'->>1)::float - (p_pos->>1)::float, 2)
              + power((s.state->'pos'->>2)::float - (p_pos->>2)::float, 2)) <= 16
    union
    select p_to where p_to is not null and p_to <> p_except
  ) x;
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
  v_to text := nullif(p_payload->>'to', '');
begin
  perform private.check_agent_secret(p_secret);
  insert into public.usage (agent_id, model, purpose, input_tokens, output_tokens, cost_usd)
  values (p_agent, p_model, 'think', p_input_tokens, p_output_tokens, p_cost);
  insert into public.events (agent_id, game_day, kind, payload)
  values (p_agent, coalesce(p_game_day, 0), 'think', coalesce(p_payload, '{}'::jsonb));

  if v_say is not null and jsonb_typeof(v_pos) = 'array' and jsonb_array_length(v_pos) = 3 then
    insert into public.messages (speaker, speaker_name, speaker_kind, text, pos, to_id, heard_by)
    values (
      p_agent, p_agent, 'agent', left(v_say, 500),
      array[(v_pos->>0)::numeric::int, (v_pos->>1)::numeric::int, (v_pos->>2)::numeric::int],
      v_to,
      private.listeners(p_agent, v_pos, v_to)
    );
  end if;
end;
$$;

-- A line from an online player. /api/chat/say validates everything; this enforces the rate limit.
create or replace function public.agent_player_say(
  p_secret text,
  p_player text,
  p_name text,
  p_text text,
  p_to text,
  p_pos int[]
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.messages%rowtype;
  v_pos jsonb := to_jsonb(p_pos);
begin
  perform private.check_agent_secret(p_secret);
  if p_player !~ '^p-[a-z0-9]{6,12}$' then
    raise exception 'bad player id' using errcode = '22023';
  end if;
  if char_length(btrim(p_text)) = 0 or char_length(p_text) > 140 or char_length(p_name) > 16 then
    raise exception 'bad message' using errcode = '22023';
  end if;
  -- at most one line every 2 s and 12 per minute per player
  if exists (select 1 from public.messages where speaker = p_player and created_at > now() - interval '2 seconds')
     or (select count(*) from public.messages where speaker = p_player and created_at > now() - interval '1 minute') >= 12 then
    return json_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into public.messages (speaker, speaker_name, speaker_kind, text, pos, to_id, heard_by)
  values (p_player, p_name, 'player', btrim(p_text), p_pos, nullif(p_to, ''),
          private.listeners(p_player, v_pos, nullif(p_to, '')))
  returning * into v_row;
  return json_build_object('ok', true, 'id', v_row.id, 'heard_by', v_row.heard_by);
end;
$$;
grant execute on function public.agent_player_say(text, text, text, text, text, int[]) to anon, authenticated;

-- Diaries see players by name and who a line was for.
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
      select json_agg(json_build_object('at', m.created_at, 'speaker', coalesce(m.speaker_name, m.speaker), 'text', m.text,
                                        'to', m.to_id)
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
