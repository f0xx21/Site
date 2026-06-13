alter table public.messages
  add column if not exists nickname text not null default 'Гость'
  check (char_length(nickname) between 1 and 24);
