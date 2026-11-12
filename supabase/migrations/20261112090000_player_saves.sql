-- Player accounts (Supabase Auth, email + password) and one save per player per world seed:
-- name, animal, position, facing, hp and inventory. Each signed-in player can only read and write
-- their own row (RLS on auth.uid()); guests keep their save in localStorage only.

create table if not exists public.player_saves (
  user_id uuid not null references auth.users (id) on delete cascade,
  seed bigint not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, seed),
  constraint player_saves_size check (octet_length(data::text) < 8000),
  constraint player_saves_object check (jsonb_typeof(data) = 'object')
);

alter table public.player_saves enable row level security;

create policy "own save: read" on public.player_saves
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own save: insert" on public.player_saves
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own save: update" on public.player_saves
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Keep updated_at honest (the client can't backdate it).
create or replace function public.player_saves_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists player_saves_touch on public.player_saves;
create trigger player_saves_touch before insert or update on public.player_saves
  for each row execute function public.player_saves_touch();

revoke all on public.player_saves from anon;
grant select, insert, update on public.player_saves to authenticated;
