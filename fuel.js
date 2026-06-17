const FUEL_REGION_ID = 61;
const FUEL_CHART_ID = "fuelChart";
const FUEL_LEGEND_ID = "fuelLegend";
const FUEL_STATUS_ID = "fuelStatus";
const FUEL_PERIOD_BTN_SELECTOR = ".fuel-period-btn";

const FUEL_TYPES = [
  { id: "ai92", label: "АИ-92", color: "#60a5fa" },
  { id: "ai95", label: "АИ-95", color: "#34d399" },
  { id: "ai100", label: "АИ-100", color: "#c084fc" },
  { id: "diesel", label: "Дизельное топливо", color: "#f87171" },
];

const FUEL_PERIODS = {
  week: { label: "Неделя", days: 7 },
  month: { label: "Месяц", days: 31 },
  year: { label: "Год", days: 365 },
  threeYears: { label: "3 года", days: 3 * 365 },
};

const fuelChartEl = document.getElementById(FUEL_CHART_ID);
const fuelLegendEl = document.getElementById(FUEL_LEGEND_ID);
const fuelStatusEl = document.getElementById(FUEL_STATUS_ID);
const fuelRefreshBtn = document.getElementById("fuelRefreshBtn");
const fuelPeriodBtns = document.querySelectorAll(FUEL_PERIOD_BTN_SELECTOR);

let fuelPayload = null;
let activePeriodId = "month";
let fuelClient = null;

function isFuelConfigured() {
  const url = window.SUPABASE_URL?.trim();
  const key = window.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return false;
  if (url === "https://xxxx.supabase.co") return false;
  if (key === "eyJ..." || key === "sb_publishable_...") return false;
  if (url.includes("/rest/v1")) return false;
  return true;
}

function getFuelClient() {
  if (fuelClient) return fuelClient;

  if (!window.supabase?.createClient) {
    throw new Error("Supabase SDK not loaded");
  }

  if (!isFuelConfigured()) {
    throw new Error("config.js is not configured");
  }

  fuelClient = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
  );

  return fuelClient;
}

function isMissingFuelTable(error) {
  const message = String(error?.message ?? "");
  return (
    error?.code === "42P01" ||
    message.includes("fuel_prices") ||
    message.includes("does not exist")
  );
}

function getFuelErrorMessage(error) {
  if (isMissingFuelTable(error)) {
    return "Выполните supabase-migration-fuel.sql и supabase-fuel-seed.sql в Supabase SQL Editor";
  }

  const message = String(error?.message ?? error ?? "");

  if (
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("Load failed")
  ) {
    return "Нет связи с Supabase — проверьте интернет и config.js";
  }

  if (message.includes("Edge Function")) {
    return "Разверните Edge Function: supabase functions deploy fuel-refresh";
  }

  return message || "Не удалось загрузить данные о топливе";
}

function setFuelStatus(message, type = "") {
  if (!fuelStatusEl) return;
  fuelStatusEl.textContent = message;
  fuelStatusEl.className = "fuel-status" + (type ? ` ${type}` : "");
}

function toFixedPrice(value) {
  return Number(value).toFixed(2);
}

function formatShortDate(isoDate) {
  try {
    return new Date(`${isoDate}T00:00:00`).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return isoDate;
  }
}

function formatAxisLabel(isoDate, periodId, isYearBoundary) {
  try {
    const date = new Date(`${isoDate}T00:00:00`);

    if (periodId === "week" || periodId === "month") {
      return formatShortDate(isoDate);
    }

    if (periodId === "threeYears" && isYearBoundary) {
      return String(date.getFullYear());
    }

    return date.toLocaleDateString("ru-RU", {
      month: "short",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}

function pickAxisLabelIndexes(points, periodId) {
  const indexes = new Set([0, points.length - 1]);

  if (periodId === "week") {
    return points.map((_, index) => index);
  }

  if (periodId === "month") {
    if (points.length > 2) {
      indexes.add(Math.floor((points.length - 1) / 2));
    }
    return [...indexes].sort((a, b) => a - b);
  }

  const seenYears = new Set();

  points.forEach((point, index) => {
    const [year, month] = point.date.split("-");

    if (periodId === "threeYears") {
      if (!seenYears.has(year)) {
        seenYears.add(year);
        indexes.add(index);
      }
      return;
    }

    if (periodId === "year") {
      if (["01", "04", "07", "10"].includes(month)) {
        indexes.add(index);
      }
    }
  });

  const sorted = [...indexes].sort((a, b) => a - b);
  const maxLabels = periodId === "year" ? 8 : 6;

  if (sorted.length <= maxLabels) {
    return sorted;
  }

  const step = Math.ceil(sorted.length / maxLabels);
  return sorted.filter((_, index) => index % step === 0 || index === sorted.length - 1);
}

function isYearBoundary(points, index) {
  if (index === 0) return true;
  return points[index].date.slice(0, 4) !== points[index - 1].date.slice(0, 4);
}

function rowsToPayload(rows) {
  const series = { ai92: [], ai95: [], ai100: [], diesel: [] };
  let latestAt = null;

  for (const row of rows) {
    if (!series[row.product]) continue;

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
    regionId: FUEL_REGION_ID,
    updatedAt: latestAt || new Date().toISOString(),
    series,
    stats: {
      ai92: series.ai92.length,
      ai95: series.ai95.length,
      ai100: series.ai100.length,
      diesel: series.diesel.length,
    },
  };
}

function filterSeriesByPeriod(series, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  return series.filter((point) => point.date >= cutoffIso);
}

function buildDataset(periodId) {
  if (!fuelPayload?.series) return [];

  const period = FUEL_PERIODS[periodId] || FUEL_PERIODS.month;

  return FUEL_TYPES.map((type) => {
    const sourceSeries = fuelPayload.series[type.id] || [];
    const points = filterSeriesByPeriod(sourceSeries, period.days);
    return {
      ...type,
      points,
      values: points.map((point) => point.price),
    };
  }).filter((item) => item.points.length > 0);
}

function buildPolyline(values, minValue, maxValue, width, height, padding) {
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const range = Math.max(maxValue - minValue, 1);
  const stepX = values.length > 1 ? chartWidth / (values.length - 1) : 0;

  return values
    .map((value, index) => {
      const x = padding.left + stepX * index;
      const y = padding.top + ((maxValue - value) / range) * chartHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildXLabels(points, width, height, padding, periodId) {
  if (!points.length) return "";

  const chartWidth = width - padding.left - padding.right;
  const step = points.length > 1 ? chartWidth / (points.length - 1) : 0;
  const labelIndexes = pickAxisLabelIndexes(points, periodId);
  const axisY = height - padding.bottom;

  return labelIndexes
    .map((index) => {
      const x = padding.left + step * index;
      const label = formatAxisLabel(
        points[index].date,
        periodId,
        isYearBoundary(points, index)
      );

      return `
        <line x1="${x.toFixed(2)}" y1="${axisY}" x2="${x.toFixed(2)}" y2="${(axisY + 6).toFixed(2)}" class="fuel-axis-tick"></line>
        <text x="${x.toFixed(2)}" y="${(axisY + 22).toFixed(2)}" class="fuel-axis-label">${label}</text>
      `;
    })
    .join("");
}

function renderFuelLegend(dataset) {
  if (!fuelLegendEl) return;

  fuelLegendEl.innerHTML = dataset
    .map((item) => {
      const current = item.points[item.points.length - 1];
      const sourceLabel = current?.source === "benzup" ? "Benzup" : "Росстат";
      return `
        <li class="fuel-legend-item">
          <span class="fuel-legend-color" style="--fuel-color:${item.color}"></span>
          <span class="fuel-legend-name">${item.label}</span>
          <span class="fuel-legend-price">${toFixedPrice(current?.price ?? 0)} ₽/л</span>
          <span class="fuel-legend-source">${sourceLabel}</span>
        </li>
      `;
    })
    .join("");
}

function renderFuelChart(periodId) {
  if (!fuelChartEl) return;

  const width = 860;
  const height = 360;
  const padding = { top: 24, right: 20, bottom: 56, left: 46 };
  const dataset = buildDataset(periodId);

  if (!dataset.length) {
    fuelChartEl.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" class="fuel-chart-bg"></rect>
      <text x="${width / 2}" y="${height / 2}" class="fuel-chart-empty">Нет данных за выбранный период</text>
    `;
    if (fuelLegendEl) fuelLegendEl.innerHTML = "";
    return;
  }

  const allValues = dataset.flatMap((item) => item.values);
  const minValue = Math.floor(Math.min(...allValues) - 1);
  const maxValue = Math.ceil(Math.max(...allValues) + 1);
  const yTicks = 5;
  const gridStep = (height - padding.top - padding.bottom) / yTicks;
  const valueStep = (maxValue - minValue) / yTicks;
  const timeline = dataset[0].points;

  const gridLines = Array.from({ length: yTicks + 1 }, (_, index) => {
    const y = padding.top + index * gridStep;
    const value = (maxValue - valueStep * index).toFixed(0);
    return `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="fuel-grid-line"></line>
      <text x="${padding.left - 10}" y="${y + 4}" class="fuel-grid-label">${value}</text>
    `;
  }).join("");

  const polylines = dataset
    .map(
      (item) => `
      <polyline
        class="fuel-line"
        points="${buildPolyline(item.values, minValue, maxValue, width, height, padding)}"
        style="--fuel-line-color:${item.color}"
      ></polyline>
    `
    )
    .join("");

  const xLabels = buildXLabels(timeline, width, height, padding, periodId);
  const selectedPeriodLabel = FUEL_PERIODS[periodId]?.label || FUEL_PERIODS.month.label;

  fuelChartEl.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" class="fuel-chart-bg"></rect>
    ${gridLines}
    ${polylines}
    ${xLabels}
  `;
  fuelChartEl.setAttribute(
    "aria-label",
    `График цен на топливо (${selectedPeriodLabel}), Ростовская область`
  );

  renderFuelLegend(dataset);
}

function setActiveFuelPeriod(periodId) {
  activePeriodId = periodId;

  fuelPeriodBtns.forEach((btn) => {
    const isActive = btn.dataset.period === periodId;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });

  renderFuelChart(periodId);
}

function formatUpdatedAt(isoString) {
  if (!isoString) return "";
  try {
    return new Date(isoString).toLocaleString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function renderLoadedFuelData(sourceLabel) {
  const updatedAt = formatUpdatedAt(fuelPayload.updatedAt);
  const pointsCount = fuelPayload.stats?.ai92 || 0;
  setFuelStatus(`Обновлено ${updatedAt} · ${pointsCount} точек · ${sourceLabel}`);
  setActiveFuelPeriod(activePeriodId);
}

function showFuelLoadError(error) {
  setFuelStatus(getFuelErrorMessage(error), "error");
  if (fuelChartEl) {
    fuelChartEl.innerHTML =
      '<text x="50%" y="50%" class="fuel-chart-empty">Данные недоступны</text>';
  }
  if (fuelLegendEl) fuelLegendEl.innerHTML = "";
}

async function fetchFuelRows(client) {
  const { data, error } = await client
    .from("fuel_prices")
    .select("product, price_date, price, source, created_at")
    .eq("region_id", FUEL_REGION_ID)
    .order("price_date", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function loadFuelData() {
  if (!isFuelConfigured()) {
    showFuelLoadError(new Error("Настройте config.js (Supabase URL и ключ)"));
    return;
  }

  setFuelStatus("Загрузка данных…", "loading");

  try {
    const client = getFuelClient();
    const rows = await fetchFuelRows(client);

    if (!rows.length) {
      throw new Error(
        "Таблица fuel_prices пуста — выполните supabase-fuel-seed.sql"
      );
    }

    fuelPayload = rowsToPayload(rows);
    renderLoadedFuelData("Benzup + Росстат (Supabase)");
  } catch (error) {
    showFuelLoadError(error);
  }
}

async function syncFuelData() {
  if (!fuelRefreshBtn) return;

  if (!isFuelConfigured()) {
    showFuelLoadError(new Error("Настройте config.js (Supabase URL и ключ)"));
    return;
  }

  fuelRefreshBtn.disabled = true;
  setFuelStatus("Обновление с Benzup…", "loading");

  try {
    const client = getFuelClient();
    const { data, error } = await client.functions.invoke("fuel-refresh", {
      method: "POST",
      body: {},
    });

    if (error) {
      throw error;
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    fuelPayload = data;
    renderLoadedFuelData("Benzup · только что");
  } catch (error) {
    showFuelLoadError(error);
  } finally {
    fuelRefreshBtn.disabled = false;
  }
}

function initFuelSection() {
  if (!fuelChartEl || !fuelPeriodBtns.length) return;

  fuelPeriodBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      setActiveFuelPeriod(btn.dataset.period);
    });
  });

  if (fuelRefreshBtn) {
    fuelRefreshBtn.addEventListener("click", syncFuelData);
  }

  loadFuelData();
}

window.initFuelSection = initFuelSection;
window.refreshFuelData = loadFuelData;
window.syncFuelData = syncFuelData;

initFuelSection();
