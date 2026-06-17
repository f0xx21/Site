create table if not exists public.fuel_prices (
  id bigint generated always as identity primary key,
  region_id integer not null default 61,
  product text not null check (product in ('ai92', 'ai95', 'ai100', 'diesel')),
  price_date date not null,
  price numeric(7, 2) not null,
  source text not null check (source in ('benzup', 'rosstat')),
  created_at timestamptz not null default now(),
  unique (region_id, product, price_date)
);

create index if not exists fuel_prices_region_date_idx
  on public.fuel_prices (region_id, price_date desc);

alter table public.fuel_prices enable row level security;

create policy "Anyone can read fuel prices"
  on public.fuel_prices for select using (true);

-- Edge Function fuel-refresh uses service role to upsert prices.
