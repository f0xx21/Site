create table public.messages (
  id bigint generated always as identity primary key,
  nickname text not null default 'Гость' check (char_length(nickname) between 1 and 24),
  text text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;

create policy "Anyone can read messages"
  on public.messages for select using (true);

create policy "Anyone can send messages"
  on public.messages for insert with check (true);

alter publication supabase_realtime add table public.messages;
