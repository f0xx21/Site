const API_URL = "https://open.er-api.com/v6/latest/USD";
const CACHE_KEY = "currencyConverterRates";
const CACHE_TIME_KEY = "currencyConverterFetchedAt";
const CACHE_TTL_MS = 60 * 60 * 1000;
const SUPPORTED_CURRENCIES = ["EUR", "USD", "RUB", "CNY"];

const amountInput = document.getElementById("amount");
const percentInput = document.getElementById("percent");
const percentTotalEl = document.querySelector(".percent-total-value");
const percentDetailEl = document.getElementById("percentDetail");
const fromSelect = document.getElementById("fromCurrency");
const toSelect = document.getElementById("toCurrency");
const swapBtn = document.getElementById("swapBtn");
const refreshBtn = document.getElementById("refreshBtn");
const resultEl = document.querySelector(".result-value");
const rateInfoEl = document.getElementById("rateInfo");
const statusEl = document.getElementById("statusText");

let rates = null;
let lastUpdatedUtc = null;
let debounceTimer = null;

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = "status" + (type ? ` ${type}` : "");
}

function readCache() {
  try {
    const cachedRates = localStorage.getItem(CACHE_KEY);
    const fetchedAt = localStorage.getItem(CACHE_TIME_KEY);
    if (!cachedRates || !fetchedAt) return null;

    const parsed = JSON.parse(cachedRates);
    const age = Date.now() - Number(fetchedAt);
    return {
      rates: parsed.rates,
      lastUpdatedUtc: parsed.lastUpdatedUtc,
      fetchedAt: Number(fetchedAt),
      expired: age >= CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

function writeCache(ratesData, updatedUtc) {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ rates: ratesData, lastUpdatedUtc: updatedUtc })
  );
  localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
}

function formatDateUtc(isoString) {
  if (!isoString) return "неизвестно";
  try {
    return new Date(isoString).toLocaleString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    });
  } catch {
    return isoString;
  }
}

function parseAmount(value) {
  const normalized = String(value).trim().replace(",", ".");
  if (normalized === "" || normalized === ".") return 0;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function parsePercent(value) {
  const normalized = String(value).trim().replace(",", ".");
  if (normalized === "" || normalized === ".") return 0;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function calcWithPercent(amount, percent) {
  return amount * (1 + percent / 100);
}

function getDecimals(currency) {
  return currency === "RUB" || currency === "CNY" ? 2 : 4;
}

function formatNumber(value, currency) {
  const decimals = getDecimals(currency);
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function convert(amount, from, to) {
  if (!rates || amount === null) return null;
  const rateFrom = rates[from];
  const rateTo = rates[to];
  if (rateFrom == null || rateTo == null) return null;
  return amount * (rateTo / rateFrom);
}

function getCrossRate(from, to) {
  if (!rates) return null;
  const rateFrom = rates[from];
  const rateTo = rates[to];
  if (rateFrom == null || rateTo == null) return null;
  return rateTo / rateFrom;
}

function renderPercent() {
  const amount = parseAmount(amountInput.value);
  const percent = parsePercent(percentInput.value);

  if (amount === null) {
    percentTotalEl.textContent = "Некорректная сумма";
    percentDetailEl.textContent = "—";
    return;
  }

  if (percent === null) {
    percentTotalEl.textContent = "Некорректный процент";
    percentDetailEl.textContent = "—";
    return;
  }

  const total = calcWithPercent(amount, percent);
  const addition = amount * (percent / 100);

  percentTotalEl.textContent = formatNumber(total, fromSelect.value);

  if (percent === 0) {
    percentDetailEl.textContent = "Без надбавки";
  } else {
    const percentLabel = percent.toLocaleString("ru-RU", {
      maximumFractionDigits: 2,
    });
    percentDetailEl.textContent = `+${formatNumber(addition, fromSelect.value)} (${percentLabel}%)`;
  }
}

function render() {
  const amount = parseAmount(amountInput.value);
  const from = fromSelect.value;
  const to = toSelect.value;

  renderPercent();

  if (!rates) {
    resultEl.textContent = "—";
    rateInfoEl.textContent = "—";
    return;
  }

  if (amount === null) {
    resultEl.textContent = "Некорректная сумма";
    rateInfoEl.textContent = "—";
    return;
  }

  const converted = convert(amount, from, to);
  const crossRate = getCrossRate(from, to);

  if (converted === null || crossRate === null) {
    resultEl.textContent = "—";
    rateInfoEl.textContent = "Курс недоступен";
    return;
  }

  resultEl.textContent = `${formatNumber(converted, to)} ${to}`;
  rateInfoEl.textContent = `1 ${from} = ${formatNumber(crossRate, to)} ${to}`;
}

async function loadRates(force = false) {
  const cache = readCache();

  if (!force && cache && !cache.expired) {
    rates = cache.rates;
    lastUpdatedUtc = cache.lastUpdatedUtc;
    setStatus(`Курсы обновлены: ${formatDateUtc(lastUpdatedUtc)}`);
    render();
    return;
  }

  if (!force && cache && cache.expired) {
    rates = cache.rates;
    lastUpdatedUtc = cache.lastUpdatedUtc;
    render();
  }

  setStatus("Загрузка курсов…", "loading");
  refreshBtn.disabled = true;

  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (data.result !== "success" || !data.rates) {
      throw new Error("Некорректный ответ API");
    }

    const filtered = {};
    for (const code of SUPPORTED_CURRENCIES) {
      if (data.rates[code] == null) {
        throw new Error(`Курс ${code} недоступен`);
      }
      filtered[code] = data.rates[code];
    }

    rates = filtered;
    lastUpdatedUtc = data.time_last_update_utc || new Date().toISOString();
    writeCache(rates, lastUpdatedUtc);
    setStatus(`Курсы обновлены: ${formatDateUtc(lastUpdatedUtc)}`);
    render();
  } catch (err) {
    if (cache) {
      rates = cache.rates;
      lastUpdatedUtc = cache.lastUpdatedUtc;
      setStatus(
        `Офлайн: используются кэшированные курсы (${formatDateUtc(lastUpdatedUtc)})`,
        "error"
      );
      render();
    } else {
      setStatus(
        `Не удалось загрузить курсы: ${err.message}. Проверьте интернет.`,
        "error"
      );
    }
  } finally {
    refreshBtn.disabled = false;
  }
}

function swapCurrencies() {
  const temp = fromSelect.value;
  fromSelect.value = toSelect.value;
  toSelect.value = temp;
  render();
}

function onAmountInput() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(render, 150);
}

function filterAmountInput(event) {
  const allowed = /[0-9.,]/;
  if (!allowed.test(event.key) && !event.ctrlKey && !event.metaKey) {
    if (event.key.length === 1) event.preventDefault();
  }
}

amountInput.addEventListener("input", onAmountInput);
amountInput.addEventListener("keydown", filterAmountInput);
percentInput.addEventListener("input", onAmountInput);
percentInput.addEventListener("keydown", filterAmountInput);
fromSelect.addEventListener("change", render);
toSelect.addEventListener("change", render);
swapBtn.addEventListener("click", swapCurrencies);
refreshBtn.addEventListener("click", () => loadRates(true));

loadRates();
