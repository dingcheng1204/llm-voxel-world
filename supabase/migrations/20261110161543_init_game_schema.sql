-- LLM Voxel World core schema (docs/BLUEPRINT.md §5).
-- Browsers only READ public tables with the publishable key; all writes go through
-- server code (edge function / Vercel functions) using the service role.

create table public.agents (
  id text primary key,
  display_name text not null,
  species text not null,
  provider text not null,
  model text not null,
  persona jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.events (
  id bigint generated always as identity primary key,
  agent_id text references public.agents(id) on delete cascade,
  game_day int not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_agent_created_idx on public.events (agent_id, created_at);

create table public.messages (
  id bigint generated always as identity primary key,
  speaker text not null,
  text text not null check (char_length(text) <= 500),
  pos int[],
  heard_by text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index messages_created_idx on public.messages (created_at);

create table public.diaries (
  id bigint generated always as identity primary key,
  agent_id text not null references public.agents(id) on delete cascade,
  diary_date date not null,
  game_day int,
  content_md text not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (agent_id, diary_date)
);

create table public.world_edits (
  seed bigint not null,
  x int not null check (x between -96 and 95),
  y int not null check (y between 0 and 63),
  z int not null check (z between -144 and 143),
  block_id smallint not null check (block_id between 0 and 255),
  by text not null default 'player' check (char_length(by) <= 32),
  updated_at timestamptz not null default now(),
  primary key (seed, x, y, z)
);
create index world_edits_seed_updated_idx on public.world_edits (seed, updated_at);

create table public.usage (
  id bigint generated always as identity primary key,
  agent_id text references public.agents(id) on delete set null,
  model text not null,
  purpose text not null,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10, 5),
  created_at timestamptz not null default now()
);

alter table public.agents enable row level security;
alter table public.events enable row level security;
alter table public.messages enable row level security;
alter table public.diaries enable row level security;
alter table public.world_edits enable row level security;
alter table public.usage enable row level security;

-- Public, read-only data for the game client.
create policy "public read agents" on public.agents for select to anon, authenticated using (true);
create policy "public read messages" on public.messages for select to anon, authenticated using (true);
create policy "public read diaries" on public.diaries for select to anon, authenticated using (true);
create policy "public read world edits" on public.world_edits for select to anon, authenticated using (true);
-- events and usage: no policies → only the service role can access them.

insert into public.agents (id, display_name, species, provider, model) values
  ('clio', 'Clio', 'cat', 'anthropic', 'tbd'),
  ('gem', 'Gem', 'fox', 'google', 'tbd'),
  ('pip', 'Pip', 'wolf', 'openai', 'tbd'),
  ('rook', 'Rook', 'snake', 'xai', 'tbd');
