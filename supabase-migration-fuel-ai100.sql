-- Add AI-100 product support (run if fuel_prices already exists without ai100)

alter table public.fuel_prices
  drop constraint if exists fuel_prices_product_check;

alter table public.fuel_prices
  add constraint fuel_prices_product_check
  check (product in ('ai92', 'ai95', 'ai100', 'petrol', 'diesel'));
