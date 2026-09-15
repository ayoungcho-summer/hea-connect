create table public.open_space_topics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  author_participant_id text not null,
  title text not null check (char_length(title) between 3 and 160),
  category text not null check (category in ('Co-founder Search', 'Hiring & Talent', 'Idea Exchange', 'Marketing & Growth', 'VC & Angel Advice', 'Casual Coffee Chat')),
  session_mode text not null check (session_mode in ('in_person', 'zoom')),
  table_code text check (table_code in ('A', 'B', 'C', 'D')),
  zoom_url text,
  details text not null default '' check (char_length(details) <= 600),
  created_at timestamptz not null default now(),
  check ((session_mode = 'in_person' and table_code is not null and zoom_url is null) or (session_mode = 'zoom' and table_code is null))
);

create table public.open_space_interests (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.open_space_topics(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  participant_id text not null,
  created_at timestamptz not null default now(),
  unique(topic_id, owner_id)
);

create table public.open_space_comments (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.open_space_topics(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  author_participant_id text not null,
  body text not null check (char_length(body) between 1 and 600),
  created_at timestamptz not null default now()
);

create index open_space_topics_created_at_idx on public.open_space_topics (created_at desc);
create index open_space_interests_topic_id_idx on public.open_space_interests (topic_id);
create index open_space_comments_topic_created_at_idx on public.open_space_comments (topic_id, created_at);

alter table public.open_space_topics enable row level security;
alter table public.open_space_interests enable row level security;
alter table public.open_space_comments enable row level security;

create policy "authenticated users can read topics" on public.open_space_topics for select to authenticated using (true);
create policy "owners can create topics" on public.open_space_topics for insert to authenticated with check (owner_id = auth.uid());
create policy "owners can delete topics" on public.open_space_topics for delete to authenticated using (owner_id = auth.uid());
create policy "authenticated users can read interests" on public.open_space_interests for select to authenticated using (true);
create policy "owners can create interests" on public.open_space_interests for insert to authenticated with check (owner_id = auth.uid());
create policy "owners can delete interests" on public.open_space_interests for delete to authenticated using (owner_id = auth.uid());
create policy "authenticated users can read comments" on public.open_space_comments for select to authenticated using (true);
create policy "owners can create comments" on public.open_space_comments for insert to authenticated with check (owner_id = auth.uid());
alter publication supabase_realtime add table public.open_space_topics;
alter publication supabase_realtime add table public.open_space_interests;
alter publication supabase_realtime add table public.open_space_comments;
