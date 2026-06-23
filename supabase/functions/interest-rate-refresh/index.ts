const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TE_URL = "https://ru.tradingeconomics.com/country-list/interest-rate";

const TABLE_ROW_RE =
  /<tr>\s*<td[^>]*>\s*<a href='([^']+)'>\s*([\s\S]*?)\s*<\/a><\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td[^>]*><span>([^<]*)<\/span><\/td>\s*<td[^>]*>([^<]*)<\/td>\s*(?:<td[^>]*>\s*([^<]*?)\s*<\/td>)?/g;

const DATA_ARRAY_RE = /var data = (\[[\s\S]*?\]);/;

interface InterestRateRow {
  url: string;
  country: string;
  iso: string | null;
  latest: string;
  previous: string;
  period: string;
  unit: string;
  nextRelease: string;
}

function parseTableRows(html: string): InterestRateRow[] {
  const tableMatch = html.match(
    /<table[^>]*table-heatmap[^>]*>([\s\S]*?)<\/table>/
  );
  if (!tableMatch) return [];

  const rows: InterestRateRow[] = [];
  let match: RegExpExecArray | null;

  while ((match = TABLE_ROW_RE.exec(tableMatch[1])) !== null) {
    rows.push({
      url: match[1],
      country: match[2].trim(),
      iso: null,
      latest: match[3].trim(),
      previous: match[4].trim(),
      period: match[5].trim(),
      unit: match[6].trim() || "%",
      nextRelease: (match[7] || "").trim(),
    });
  }

  return rows;
}

function parseDataArray(html: string): InterestRateRow[] {
  const dataMatch = html.match(DATA_ARRAY_RE);
  if (!dataMatch) return [];

  const items = JSON.parse(dataMatch[1]) as Array<{
    name: string;
    iso: string;
    value: number | null;
    url: string;
  }>;

  return items.map((item) => ({
    url: item.url,
    country: item.name,
    iso: item.iso,
    latest: item.value != null ? String(item.value) : "",
    previous: "",
    period: "",
    unit: "%",
    nextRelease: "",
  }));
}

function parseInterestRatePage(html: string) {
  const tableRows = parseTableRows(html);
  const tableByUrl = new Map(tableRows.map((row) => [row.url, row]));
  const allRows = parseDataArray(html);

  const rows = allRows.map((row) => {
    const enriched = tableByUrl.get(row.url);
    return enriched ? { ...row, ...enriched, iso: row.iso } : row;
  });

  for (const tableRow of tableRows) {
    if (!rows.some((row) => row.url === tableRow.url)) {
      rows.push({ ...tableRow });
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    source: TE_URL,
    rows,
  };
}

async function fetchInterestRates() {
  const response = await fetch(TE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; InterestRateRefresh/1.0)",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`Trading Economics HTTP ${response.status}`);
  }

  const html = await response.text();
  return parseInterestRatePage(html);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await fetchInterestRates();

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
