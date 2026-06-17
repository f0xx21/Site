-- Remove averaged petrol series from fuel_prices

delete from public.fuel_prices where product = 'petrol';

alter table public.fuel_prices
  drop constraint if exists fuel_prices_product_check;

alter table public.fuel_prices
  add constraint fuel_prices_product_check
  check (product in ('ai92', 'ai95', 'ai100', 'diesel'));
