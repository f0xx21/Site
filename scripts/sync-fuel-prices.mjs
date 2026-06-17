/**
 * Sync fuel prices for Rostov region from:
 * - Benzup / OMT-Consult regional index API (daily)
 * - Rosstat weekly consumer fuel price reports (historical)
 *
 * Usage: node scripts/sync-fuel-prices.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "node:https";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "fuel-data", "rostov.json");

const ROSTOV_REGION_ID = 61;
const ROSTOV_REGION_NAME = "Ростовская область";
const BENZUP_API = "https://api.omt-consult.ru/index/regional";
const ROSSTAT_NEWS_BASE = "https://rosstat.gov.ru/central-news";
const ROSSTAT_MEDIA_BASE = "https://rosstat.gov.ru";
const MAX_NEWS_PAGES = 120;
const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;

const MONTHS_RU = {
  января: 0,
  февраля: 1,
  марта: 2,
  апреля: 3,
  мая: 4,
  июня: 5,
  июля: 6,
  августа: 7,
  сентября: 8,
  октября: 9,
  ноября: 10,
  декабря: 11,
};

const BENZUP_PRODUCTS = {
  A0920: "ai92",
  A0950: "ai95",
  A0980: "ai100",
  D0DT0: "diesel",
};

function parsePrice(value) {
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseRussianDate(text) {
  const match = String(text).match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (!match) return null;

  const day = Number(match[1]);
  const month = MONTHS_RU[match[2].toLowerCase()];
  const year = Number(match[3]);
  if (month == null || !Number.isFinite(day) || !Number.isFinite(year)) return null;

  return new Date(Date.UTC(year, month, day));
}

function emptySeries() {
  return { ai92: [], ai95: [], ai100: [], petrol: [], diesel: [] };
}

function upsertPoint(series, key, point) {
  const list = series[key];
  const index = list.findIndex((item) => item.date === point.date);
  if (index >= 0) {
    list[index] = { ...list[index], ...point };
    return;
  }
  list.push(point);
  list.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchText(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const allowInsecureTls =
      parsedUrl.hostname.endsWith("rosstat.gov.ru") ||
      parsedUrl.hostname.endsWith("gks.ru");

    const request = client.get(
      url,
      {
        headers: { Accept: "text/html,application/json" },
        ...(allowInsecureTls ? { rejectUnauthorized: false } : {}),
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          fetchText(new URL(response.headers.location, url).href).then(resolve).catch(reject);
          return;
        }

        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode || "unknown"} for ${url}`));
          response.resume();
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve(body));
      }
    );

    request.on("error", reject);
  });
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}

async function fetchBenzupRostov() {
  const json = await fetchJson(BENZUP_API);
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

function extractFuelReportLinks(html) {
  const links = new Map();
  const pattern =
    /href="([^"]*\/storage\/mediabank\/\d+_[^"]+\.html)"[^>]*>[^<]*нефтепродукт/gi;

  for (const match of html.matchAll(pattern)) {
    const href = match[1].startsWith("http")
      ? match[1]
      : `${ROSSTAT_MEDIA_BASE}${match[1]}`;
    links.set(href, true);
  }

  return [...links.keys()];
}

async function collectRosstatReportUrls() {
  const urls = new Set();

  for (let page = 1; page <= MAX_NEWS_PAGES; page += 1) {
    const pageUrl = page === 1 ? ROSSTAT_NEWS_BASE : `${ROSSTAT_NEWS_BASE}?page=${page}`;
    let html;

    try {
      html = await fetchText(pageUrl);
    } catch (error) {
      console.warn(`Skip news page ${page}: ${error.message}`);
      break;
    }

    const found = extractFuelReportLinks(html);
    if (!found.length) {
      if (page > 3) break;
      continue;
    }

    found.forEach((url) => urls.add(url));
    process.stdout.write(`\rRosstat pages: ${page}, reports: ${urls.size}`);
  }

  process.stdout.write("\n");
  return [...urls];
}

function parseRosstatReport(html, reportUrl) {
  const titleMatch = html.match(/на\s+(\d{1,2}\s+[а-яё]+\s+\d{4})\s+года/i);
  const titleDate = titleMatch ? parseRussianDate(titleMatch[1]) : null;
  if (!titleDate) return null;

  const regionPattern =
    /Ростовская область<\/span>[\s\S]*?<span class="text-T\d+">([\d,]+)<\/span>[\s\S]*?<span class="text-T\d+">([\d,]+)<\/span>[\s\S]*?<span class="text-T\d+">([\d,]+)<\/span>[\s\S]*?<span class="text-T\d+">([\d,]+)<\/span>[\s\S]*?<span class="text-T\d+">([\d,]+)<\/span>/i;

  const rowMatch = html.match(regionPattern);
  if (!rowMatch) return null;

  const [petrol, ai92, ai95, ai100, diesel] = rowMatch.slice(1).map(parsePrice);
  if ([petrol, ai92, ai95, ai100, diesel].some((value) => value == null)) return null;

  return {
    date: formatDateISO(titleDate),
    values: { petrol, ai92, ai95, ai100, diesel },
    source: "rosstat",
    reportUrl,
  };
}

async function loadRosstatHistory() {
  const reportUrls = await collectRosstatReportUrls();
  const cutoff = Date.now() - THREE_YEARS_MS;
  const series = emptySeries();
  let parsed = 0;

  for (const reportUrl of reportUrls) {
    try {
      const html = await fetchText(reportUrl);
      const report = parseRosstatReport(html, reportUrl);
      if (!report) continue;

      const reportTime = Date.parse(`${report.date}T00:00:00Z`);
      if (!Number.isFinite(reportTime) || reportTime < cutoff) continue;

      for (const key of Object.keys(report.values)) {
        upsertPoint(series, key, {
          date: report.date,
          price: report.values[key],
          source: report.source,
        });
      }
      parsed += 1;
    } catch (error) {
      console.warn(`Skip report ${reportUrl}: ${error.message}`);
    }
  }

  console.log(`Parsed Rosstat reports: ${parsed}`);
  return series;
}

function mergeBenzupPoint(series, benzupPoint) {
  for (const [key, price] of Object.entries(benzupPoint.values)) {
    if (price == null) continue;
    upsertPoint(series, key, {
      date: benzupPoint.date,
      price,
      source: benzupPoint.source,
    });
  }
}

function trimSeries(series, periodDays) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - periodDays);
  const cutoffIso = formatDateISO(cutoff);

  const trimmed = emptySeries();
  for (const key of Object.keys(series)) {
    trimmed[key] = series[key].filter((point) => point.date >= cutoffIso);
  }
  return trimmed;
}

async function main() {
  console.log("Fetching Benzup regional index...");
  const benzupPoint = await fetchBenzupRostov();
  console.log("Benzup today:", benzupPoint);

  console.log("Loading Rosstat weekly history...");
  const series = await loadRosstatHistory();
  mergeBenzupPoint(series, benzupPoint);

  const payload = {
    region: ROSTOV_REGION_NAME,
    regionId: ROSTOV_REGION_ID,
    updatedAt: new Date().toISOString(),
    sources: {
      current: {
        name: "Benzup / OMT-Consult",
        url: BENZUP_API,
        description: "Ежедневные региональные индексы розничных цен на АЗС",
      },
      history: {
        name: "Росстат",
        url: ROSSTAT_NEWS_BASE,
        description: "Еженедельный мониторинг средних потребительских цен",
      },
    },
    series,
    stats: {
      ai92: series.ai92.length,
      ai95: series.ai95.length,
      petrol: series.petrol.length,
      diesel: series.diesel.length,
    },
    periods: {
      month: trimSeries(series, 31),
      year: trimSeries(series, 365),
      threeYears: series,
    },
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Saved ${OUTPUT}`);
  console.log("Points:", payload.stats);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
