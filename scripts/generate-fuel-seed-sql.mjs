import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const input = path.join(__dirname, "..", "fuel-data", "rostov.json");
const output = path.join(__dirname, "..", "supabase-fuel-seed.sql");

const payload = JSON.parse(fs.readFileSync(input, "utf8"));
const values = [];

for (const product of ["ai92", "ai95", "ai100", "diesel"]) {
  for (const point of payload.series[product] || []) {
    values.push(
      `(61, '${product}', '${point.date}', ${Number(point.price).toFixed(2)}, '${point.source}')`
    );
  }
}

const sql = `-- Seed fuel history for Rostov region (generated from fuel-data/rostov.json)
-- Run after supabase-migration-fuel.sql

insert into public.fuel_prices (region_id, product, price_date, price, source)
values
${values.join(",\n")}
on conflict (region_id, product, price_date) do update
set price = excluded.price,
    source = excluded.source;
`;

fs.writeFileSync(output, sql, "utf8");
console.log(`Wrote ${values.length} rows to ${output}`);
