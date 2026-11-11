-- Server-run characters: persistent state + a "driver" lease + a once-a-minute tick.
--
-- Exactly one simulator drives a character at a time:
--   * a visible browser tab (thinks every ~6 s, renews a short lease with heartbeats), or
--   * the server tick (/api/agent/tick, called by pg_cron every minute) when no browser holds the lease.
-- Everyone else mirrors `agent_state.state`. Writes go through agent_state_sync() with the shared
-- secret (env AGENT_DB_SECRET), like agent_budget / agent_log_think.

create table if not exists public.agent_state (
  agent_id text primary key references public.agents(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  driver text,
  driver_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.agent_state enable row level security;
create policy "public read agent state" on public.agent_state for select to anon, authenticated using (true);
insert into public.agent_state (agent_id) values ('clio') on conflict do nothing;

-- Claim/renew/release the lease and optionally save state, atomically.
-- Returns { driver: bool, state, updated_at, driver_until }.
create or replace function public.agent_state_sync(
  p_secret text,
  p_agent text,
  p_driver text,
  p_state jsonb,
  p_lease_seconds int,
  p_release boolean default false
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.agent_state%rowtype;
  v_mine boolean;
begin
  perform private.check_agent_secret(p_secret);
  if p_driver is null or char_length(p_driver) > 64 then
    raise exception 'bad driver' using errcode = '22023';
  end if;
  insert into public.agent_state (agent_id) values (p_agent) on conflict do nothing;
  select * into r from public.agent_state where agent_id = p_agent for update;

  v_mine := r.driver is null or r.driver = p_driver or r.driver_until is null or r.driver_until < now();
  if not v_mine then
    return json_build_object('driver', false, 'state', r.state, 'updated_at', r.updated_at,
                             'driver_until', r.driver_until);
  end if;

  update public.agent_state
     set driver = case when p_release then null else p_driver end,
         driver_until = case when p_release then null
                             else now() + make_interval(secs => least(greatest(p_lease_seconds, 5), 120)) end,
         state = coalesce(p_state, state),
         updated_at = case when p_state is null then updated_at else now() end
   where agent_id = p_agent
  returning * into r;
  return json_build_object('driver', true, 'state', r.state, 'updated_at', r.updated_at,
                           'driver_until', r.driver_until);
end;
$$;
grant execute on function public.agent_state_sync(text, text, text, jsonb, int, boolean) to anon, authenticated;

-- Once-a-minute tick: pg_cron → pg_net → POST /api/agent/tick (secret in a header).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

insert into private.settings (key, value)
values ('tick_url', 'https://llm-voxel-world.vercel.app/api/agent/tick')
on conflict (key) do nothing;

create or replace function private.trigger_agent_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := (select value from private.settings where key = 'tick_url');
  v_secret text := (select value from private.settings where key = 'agent_secret');
begin
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-agent-secret', v_secret),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function private.trigger_agent_tick() from public, anon, authenticated;

select cron.unschedule('agent-tick') where exists (select 1 from cron.job where jobname = 'agent-tick');
select cron.schedule('agent-tick', '* * * * *', 'select private.trigger_agent_tick()');
