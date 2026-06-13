const WEATHER_API = "https://wttr.in";
const WEATHER_CACHE_KEY = "weatherForecastCacheV2";
const WEATHER_CITY_KEY = "weatherSelectedCity";
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;

const CITIES = {
  rostov: { name: "Ростов-на-Дону", wttrLocation: "Rostov-on-Don" },
  moscow: { name: "Москва", wttrLocation: "Moscow" },
  kamenomostskiy: { name: "Каменомостский (Адыгея)", wttrLocation: "Kamennomostskiy,Adygea" },
  sochi: { name: "Сочи", wttrLocation: "Sochi" },
  krasnaya_polyana: { name: "Красная поляна", wttrLocation: "Krasnaya Polyana,Russia" },
  london: { name: "Лондон", wttrLocation: "London" },
  newyork: { name: "Нью-Йорк", wttrLocation: "New York" },
};

const WEATHER_CODE_RU = {
  113: "Ясно",
  116: "Переменная облачность",
  119: "Облачно",
  122: "Пасмурно",
  143: "Туман",
  176: "Местами дождь",
  179: "Местами мокрый снег",
  182: "Местами дождь со снегом",
  185: "Местами ледяная морось",
  200: "Гроза",
  227: "Метель",
  230: "Метель",
  248: "Туман",
  260: "Изморозь",
  263: "Местами слабая морось",
  266: "Слабая морось",
  281: "Ледяная морось",
  284: "Сильная ледяная морось",
  293: "Небольшой дождь",
  296: "Небольшой дождь",
  299: "Умеренный дождь",
  302: "Сильный дождь",
  305: "Сильный дождь",
  308: "Ливень",
  311: "Ледяной дождь",
  314: "Сильный ледяной дождь",
  317: "Дождь со снегом",
  320: "Дождь со снегом",
  323: "Местами слабый снег",
  326: "Слабый снег",
  329: "Сильный снег",
  332: "Слабый снег",
  335: "Сильный снег",
  338: "Сильный снег",
  350: "Ледяной дождь",
  353: "Небольшой ливень",
  356: "Ливень",
  359: "Сильный ливень",
  362: "Небольшой ливень со снегом",
  365: "Ливень со снегом",
  368: "Слабый снег",
  371: "Сильный снег",
  374: "Небольшой ливень с градом",
  377: "Ливень с градом",
  386: "Местами гроза",
  389: "Гроза",
  392: "Местами слабый снег с грозой",
  395: "Сильный снег с грозой",
};

const WEATHER_PHRASE_RU = {
  clear: "Ясно",
  sunny: "Солнечно",
  "partly cloudy": "Переменная облачность",
  cloudy: "Облачно",
  overcast: "Пасмурно",
  mist: "Туман",
  fog: "Туман",
  "patchy rain nearby": "Местами дождь",
  "patchy rain possible": "Возможен дождь",
  "patchy light drizzle": "Местами слабая морось",
  "light drizzle": "Слабая морось",
  "light rain": "Небольшой дождь",
  "light rain shower": "Небольшой ливень",
  "light rain showers": "Небольшой ливень",
  "moderate rain": "Дождь",
  "heavy rain": "Сильный дождь",
  "light snow": "Слабый снег",
  "heavy snow": "Сильный снег",
  "thundery outbreaks possible": "Возможна гроза",
  "patchy light rain with thunder": "Местами гроза с дождём",
};

const weatherCitySelect = document.getElementById("weatherCity");
const weatherTempEl = document.getElementById("weatherTemp");
const weatherDescEl = document.getElementById("weatherDesc");
const weatherHumidityEl = document.getElementById("weatherHumidity");
const weatherWindEl = document.getElementById("weatherWind");
const weatherStatusEl = document.getElementById("weatherStatus");

function setWeatherStatus(message, type = "") {
  weatherStatusEl.textContent = message;
  weatherStatusEl.className = "weather-status" + (type ? ` ${type}` : "");
}

function formatWindSpeed(kmh) {
  const num = Number(kmh);
  if (!Number.isFinite(num)) return "—";
  return `${Math.round(num / 3.6)} м/с`;
}

function formatObservationTime(raw) {
  if (!raw) return "";

  const match = String(raw).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return String(raw).trim();

  let hours = Number(match[1]);
  const minutes = match[2];
  const meridiem = match[3].toUpperCase();

  if (meridiem === "PM" && hours !== 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;

  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

function isRussianText(value) {
  return /[а-яё]/i.test(String(value));
}

function translateWeatherDescription(current) {
  const code = Number(current?.weatherCode);
  if (Number.isFinite(code) && WEATHER_CODE_RU[code]) {
    return WEATHER_CODE_RU[code];
  }

  const langRu = current?.lang_ru?.[0]?.value?.trim();
  if (langRu && isRussianText(langRu)) {
    return langRu;
  }

  const english = (current?.weatherDesc?.[0]?.value || langRu || "").trim();
  if (!english) return "—";

  const normalized = english.toLowerCase().replace(/\s+/g, " ");
  if (WEATHER_PHRASE_RU[normalized]) {
    return WEATHER_PHRASE_RU[normalized];
  }

  return english;
}

function readWeatherCache(cityId) {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (cache.cityId !== cityId) return null;
    if (Date.now() - cache.fetchedAt >= WEATHER_CACHE_TTL_MS) return null;
    return cache.data;
  } catch {
    return null;
  }
}

function writeWeatherCache(cityId, data) {
  localStorage.setItem(
    WEATHER_CACHE_KEY,
    JSON.stringify({ cityId, data, fetchedAt: Date.now() })
  );
}

function renderWeather(data, cityName) {
  const temp = Number(data.temperature);
  const rounded = Number.isFinite(temp) ? Math.round(temp) : null;

  weatherTempEl.textContent = rounded != null ? `${rounded} °C` : "—";
  weatherDescEl.textContent = data.description || "—";
  weatherHumidityEl.textContent =
    data.humidity != null ? `${Math.round(data.humidity)} %` : "—";
  weatherWindEl.textContent = formatWindSpeed(data.windSpeedKmh);

  const timeLabel = formatObservationTime(data.time);
  if (timeLabel) {
    setWeatherStatus(`${cityName} · ${timeLabel}`);
  } else {
    setWeatherStatus(cityName);
  }
}

async function fetchWeather(cityId) {
  const city = CITIES[cityId];
  if (!city) throw new Error("Неизвестный город");

  const location = encodeURIComponent(city.wttrLocation);
  const url = `${WEATHER_API}/${location}?format=j1&lang=ru`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Ошибка API: ${response.status}`);
  }

  const json = await response.json();
  const current = json.current_condition?.[0];
  if (!current) throw new Error("Нет данных о погоде");

  return {
    temperature: current.temp_C,
    humidity: current.humidity,
    description: translateWeatherDescription(current),
    windSpeedKmh: current.windspeedKmph,
    time: current.observation_time,
  };
}

async function loadWeather(cityId, forceRefresh = false) {
  const city = CITIES[cityId];
  if (!city) return;

  if (!forceRefresh) {
    const cached = readWeatherCache(cityId);
    if (cached) {
      renderWeather(cached, city.name);
      return;
    }
  }

  setWeatherStatus("Загрузка…", "loading");

  try {
    const data = await fetchWeather(cityId);
    writeWeatherCache(cityId, data);
    renderWeather(data, city.name);
  } catch {
    setWeatherStatus("Не удалось загрузить погоду", "error");
    weatherTempEl.textContent = "—";
    weatherDescEl.textContent = "—";
    weatherHumidityEl.textContent = "—";
    weatherWindEl.textContent = "—";
  }
}

function initWeather() {
  if (!weatherCitySelect) return;

  const savedCity = localStorage.getItem(WEATHER_CITY_KEY);
  if (savedCity && CITIES[savedCity]) {
    weatherCitySelect.value = savedCity;
  }

  const cityId = weatherCitySelect.value;
  loadWeather(cityId);

  weatherCitySelect.addEventListener("change", () => {
    const selected = weatherCitySelect.value;
    localStorage.setItem(WEATHER_CITY_KEY, selected);
    loadWeather(selected, true);
  });
}

initWeather();
