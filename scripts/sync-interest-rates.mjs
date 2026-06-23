/**
 * Fetches interest rate data from Trading Economics and writes data/interest-rates.json.
 * Run: node scripts/sync-interest-rates.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const TE_URL = "https://ru.tradingeconomics.com/country-list/interest-rate";
const OUTPUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "interest-rates.json");

const TABLE_ROW_RE =
  /<tr>\s*<td[^>]*>\s*<a href='([^']+)'>\s*([\s\S]*?)\s*<\/a><\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td[^>]*><span>([^<]*)<\/span><\/td>\s*<td[^>]*>([^<]*)<\/td>\s*(?:<td[^>]*>\s*([^<]*?)\s*<\/td>)?/g;

const DATA_ARRAY_RE = /var data = (\[[\s\S]*?\]);/;

function parseTableRows(html) {
  const tableMatch = html.match(/<table[^>]*table-heatmap[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) return [];

  const rows = [];
  let match;

  while ((match = TABLE_ROW_RE.exec(tableMatch[1])) !== null) {
    rows.push({
      url: match[1],
      country: match[2].trim(),
      latest: match[3].trim(),
      previous: match[4].trim(),
      period: match[5].trim(),
      unit: match[6].trim() || "%",
      nextRelease: (match[7] || "").trim(),
    });
  }

  return rows;
}

function parseDataArray(html) {
  const dataMatch = html.match(DATA_ARRAY_RE);
  if (!dataMatch) return [];

  return JSON.parse(dataMatch[1]).map((item) => ({
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

export function parseInterestRatePage(html) {
  const tableRows = parseTableRows(html);
  const tableByUrl = new Map(tableRows.map((row) => [row.url, row]));
  const allRows = parseDataArray(html);

  const rows = allRows.map((row) => {
    const enriched = tableByUrl.get(row.url);
    return enriched ? { ...row, ...enriched, iso: row.iso } : row;
  });

  for (const tableRow of tableRows) {
    if (!rows.some((row) => row.url === tableRow.url)) {
      rows.push({ ...tableRow, iso: null });
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    source: TE_URL,
    rows,
  };
}

async function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; InterestRateSync/1.0)",
            Accept: "text/html",
          },
        },
        (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(`Trading Economics HTTP ${response.statusCode}`));
            response.resume();
            return;
          }

          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          response.on("error", reject);
        }
      )
      .on("error", reject);
  });
}

async function main() {
  const html = await fetchHtml(TE_URL);
  const payload = parseInterestRatePage(html);

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Saved ${payload.rows.length} rows to ${OUTPUT_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
