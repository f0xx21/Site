import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BENZUP_API = "https://api.omt-consult.ru/index/regional";
const ROSTOV_REGION_ID = 61;

const BENZUP_PRODUCTS = {
  A0920: "ai92",
  A0950: "ai95",
  D0DT0: "diesel",
};

function parsePrice(value) {
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function formatDateISO(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function fetchBenzupRostov() {
  const response = await fetch(BENZUP_API, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Benzup API error: HTTP ${response.status}`);
  }

  const json = await response.json();
  const rows = (json.result || []).filter((row) => row.region_id === ROSTOV_REGION_ID);
  const today = formatDateISO(new Date());
  const values = {};

  for (const row of rows) {
    const key = BENZUP_PRODUCTS[row.product];
    if (!key) continue;
    values[key] = parsePrice(row.index);
  }

  if (values.ai92 != null && values.ai95 != null) {
    values.petrol = Number(((values.ai92 + values.ai95) / 2).toFixed(2));
  }

  return { date: today, values, source: "benzup" };
}

function rowsToPayload(rows) {
  const series = { ai92: [], ai95: [], petrol: [], diesel: [] };
  let latestAt = null;

  for (const row of rows) {
    series[row.product].push({
      date: row.price_date,
      price: Number(row.price),
      source: row.source,
    });

    if (!latestAt || row.created_at > latestAt) {
      latestAt = row.created_at;
    }
  }

  for (const key of Object.keys(series)) {
    series[key].sort((a, b) => a.date.localeCompare(b.date));
  }

  return {
    region: "Ростовская область",
    regionId: ROSTOV_REGION_ID,
    updatedAt: latestAt || new Date().toISOString(),
    series,
    stats: {
      ai92: series.ai92.length,
      ai95: series.ai95.length,
      petrol: series.petrol.length,
      diesel: series.diesel.length,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase environment is not configured");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const benzupPoint = await fetchBenzupRostov();

    const upsertRows = Object.entries(benzupPoint.values)
      .filter(([, price]) => price != null)
      .map(([product, price]) => ({
        region_id: ROSTOV_REGION_ID,
        product,
        price_date: benzupPoint.date,
        price,
        source: benzupPoint.source,
      }));

    const { error: upsertError } = await supabase
      .from("fuel_prices")
      .upsert(upsertRows, { onConflict: "region_id,product,price_date" });

    if (upsertError) {
      throw upsertError;
    }

    const { data, error } = await supabase
      .from("fuel_prices")
      .select("product, price_date, price, source, created_at")
      .eq("region_id", ROSTOV_REGION_ID)
      .order("price_date", { ascending: true });

    if (error) {
      throw error;
    }

    const payload = rowsToPayload(data || []);

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
