const CACHE_KEY = "interestRateData";
const CACHE_TIME_KEY = "interestRateFetchedAt";
const CACHE_TTL_MS = 60 * 60 * 1000;
const STATIC_DATA_URL = "data/interest-rates.json";
const TE_BASE_URL = "https://ru.tradingeconomics.com";

const rateTableBody = document.getElementById("rateTableBody");
const rateStatusEl = document.getElementById("rateStatus");
const rateRefreshBtn = document.getElementById("rateRefreshBtn");
const rateSearchInput = document.getElementById("rateSearch");
const rateTableEl = document.getElementById("rateTable");
const rateSortBtns = document.querySelectorAll("[data-rate-sort]");

let ratePayload = null;
let activeSort = { key: "latest", direction: "asc" };
let rateClient = null;

function isRateConfigured() {
  const url = window.SUPABASE_URL?.trim();
  const key = window.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return false;
  if (url === "https://xxxx.supabase.co") return false;
  if (key === "eyJ..." || key === "sb_publishable_...") return false;
  if (url.includes("/rest/v1")) return false;
  return true;
}

function getRateClient() {
  if (rateClient) return rateClient;

  if (!window.supabase?.createClient) {
    throw new Error("Supabase SDK not loaded");
  }

  if (!isRateConfigured()) {
    throw new Error("config.js is not configured");
  }

  rateClient = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
  );

  return rateClient;
}

function setRateStatus(message, type = "") {
  if (!rateStatusEl) return;
  rateStatusEl.textContent = message;
  rateStatusEl.className = "rate-status" + (type ? ` ${type}` : "");
}

function readCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    const fetchedAt = localStorage.getItem(CACHE_TIME_KEY);
    if (!cached || !fetchedAt) return null;

    const age = Date.now() - Number(fetchedAt);
    return {
      payload: JSON.parse(cached),
      expired: age >= CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
  } catch {
    // ignore quota / private mode
  }
}

function parseRateValue(value) {
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function formatRateValue(value) {
  if (value === "" || value == null) return "—";
  const num = parseRateValue(value);
  if (num == null) return String(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, "");
}

function formatUpdatedAt(isoString) {
  if (!isoString) return "неизвестно";
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

function getFilteredRows() {
  if (!ratePayload?.rows) return [];

  const query = String(rateSearchInput?.value ?? "")
    .trim()
    .toLowerCase();

  if (!query) return [...ratePayload.rows];

  return ratePayload.rows.filter((row) =>
    row.country.toLowerCase().includes(query)
  );
}

function compareRows(a, b, key) {
  if (key === "country") {
    return a.country.localeCompare(b.country, "ru");
  }

  if (key === "latest" || key === "previous") {
    const aNum = parseRateValue(a[key]);
    const bNum = parseRateValue(b[key]);
    const aVal = aNum == null ? Number.POSITIVE_INFINITY : aNum;
    const bVal = bNum == null ? Number.POSITIVE_INFINITY : bNum;
    return aVal - bVal;
  }

  if (key === "period" || key === "nextRelease") {
    return String(a[key] ?? "").localeCompare(String(b[key] ?? ""), "ru");
  }

  return 0;
}

function sortRows(rows) {
  const sorted = [...rows];
  const { key, direction } = activeSort;
  const factor = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => compareRows(a, b, key) * factor);
  return sorted;
}

function updateSortIndicators() {
  rateSortBtns.forEach((btn) => {
    const isActive = btn.dataset.rateSort === activeSort.key;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-sort", isActive ? activeSort.direction + "ending" : "none");
  });
}

function renderRateTable() {
  if (!rateTableBody) return;

  const rows = sortRows(getFilteredRows());
  rateTableBody.replaceChildren();

  if (!rows.length) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 6;
    emptyCell.className = "rate-table-empty";
    emptyCell.textContent = rateSearchInput?.value?.trim()
      ? "Ничего не найдено"
      : "Нет данных";
    emptyRow.appendChild(emptyCell);
    rateTableBody.appendChild(emptyRow);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");

    const countryCell = document.createElement("td");
    countryCell.className = "rate-table-country";
    const link = document.createElement("a");
    link.href = `${TE_BASE_URL}${row.url}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = row.country;
    countryCell.appendChild(link);

    const latestCell = document.createElement("td");
    latestCell.className = "rate-table-num";
    latestCell.textContent = formatRateValue(row.latest);

    const previousCell = document.createElement("td");
    previousCell.className = "rate-table-num";
    previousCell.textContent = formatRateValue(row.previous);

    const periodCell = document.createElement("td");
    periodCell.className = "rate-table-period";
    periodCell.textContent = row.period || "—";

    const unitCell = document.createElement("td");
    unitCell.className = "rate-table-unit";
    unitCell.textContent = row.unit || "%";

    const nextCell = document.createElement("td");
    nextCell.className = "rate-table-next";
    nextCell.textContent = row.nextRelease || "—";

    tr.append(countryCell, latestCell, previousCell, periodCell, unitCell, nextCell);
    rateTableBody.appendChild(tr);
  }

  updateSortIndicators();
}

function renderRateMeta() {
  if (!ratePayload) return;

  const count = ratePayload.rows?.length ?? 0;
  const updated = formatUpdatedAt(ratePayload.updatedAt);
  setRateStatus(`Стран: ${count} · обновлено ${updated}`);
}

async function fetchFromEdgeFunction() {
  const client = getRateClient();
  const { data, error } = await client.functions.invoke("interest-rate-refresh");

  if (error) {
    throw new Error(error.message || "Edge Function interest-rate-refresh failed");
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  if (!data?.rows?.length) {
    throw new Error("Пустой ответ от interest-rate-refresh");
  }

  return data;
}

async function fetchFromStaticFile() {
  const response = await fetch(STATIC_DATA_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Не удалось загрузить ${STATIC_DATA_URL}`);
  }

  const data = await response.json();

  if (!data?.rows?.length) {
    throw new Error("Файл данных пуст");
  }

  return data;
}

function getRateErrorMessage(error) {
  const message = String(error?.message ?? error ?? "");

  if (
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("Load failed")
  ) {
    return "Нет связи с сервером — проверьте интернет";
  }

  if (message.includes("Edge Function") || message.includes("interest-rate-refresh")) {
    return "Разверните Edge Function: supabase functions deploy interest-rate-refresh";
  }

  return message || "Не удалось загрузить ключевые ставки";
}

async function loadRateData({ force = false } = {}) {
  if (!force) {
    const cache = readCache();
    if (cache?.payload?.rows?.length) {
      ratePayload = cache.payload;
      renderRateTable();
      renderRateMeta();

      if (!cache.expired) {
        return ratePayload;
      }
    }
  }

  setRateStatus("Загрузка данных…", "loading");

  try {
    let data;

    if (isRateConfigured()) {
      try {
        data = await fetchFromEdgeFunction();
      } catch (edgeError) {
        console.warn("Edge function failed, falling back to static file:", edgeError);
        data = await fetchFromStaticFile();
      }
    } else {
      data = await fetchFromStaticFile();
    }

    ratePayload = data;
    writeCache(data);
    renderRateTable();
    renderRateMeta();
    return data;
  } catch (error) {
    const cache = readCache();
    if (cache?.payload?.rows?.length) {
      ratePayload = cache.payload;
      renderRateTable();
      renderRateMeta();
      setRateStatus(`Кэш · ${getRateErrorMessage(error)}`, "error");
      return ratePayload;
    }

    setRateStatus(getRateErrorMessage(error), "error");
    throw error;
  }
}

function handleSortClick(event) {
  const key = event.currentTarget.dataset.rateSort;
  if (!key) return;

  if (activeSort.key === key) {
    activeSort.direction = activeSort.direction === "asc" ? "desc" : "asc";
  } else {
    activeSort = { key, direction: key === "country" ? "asc" : "asc" };
  }

  renderRateTable();
}

rateSortBtns.forEach((btn) => {
  btn.addEventListener("click", handleSortClick);
});

rateSearchInput?.addEventListener("input", () => {
  renderRateTable();
});

rateRefreshBtn?.addEventListener("click", () => {
  loadRateData({ force: true }).catch(() => {});
});

window.refreshRateData = () => {
  loadRateData({ force: false }).catch(() => {});
};

loadRateData().catch(() => {});
