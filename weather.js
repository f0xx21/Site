const WEATHER_API = "https://api.open-meteo.com/v1/forecast";
const WEATHER_CACHE_KEY = "weatherForecastCache";
const WEATHER_CITY_KEY = "weatherSelectedCity";
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;

const CITIES = {
  rostov: { name: "Ростов-на-Дону", lat: 47.2357, lon: 39.7015 },
  kamenomostskiy: { name: "Каменомостский (Адыгея)", lat: 44.2936, lon: 40.1872 },
  sochi: { name: "Сочи", lat: 43.6028, lon: 39.7342 },
  krasnaya_polyana: { name: "Красная поляна", lat: 43.6786, lon: 40.2073 },
  london: { name: "Лондон", lat: 51.5074, lon: -0.1278 },
  newyork: { name: "Нью-Йорк", lat: 40.7128, lon: -74.006 },
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

function describeWeatherCode(code) {
  const map = {
    0: "Ясно",
    1: "Преимущественно ясно",
    2: "Переменная облачность",
    3: "Пасмурно",
    45: "Туман",
    48: "Изморозь",
    51: "Морось",
    53: "Морось",
    55: "Сильная морось",
    56: "Ледяная морось",
    57: "Ледяная морось",
    61: "Небольшой дождь",
    63: "Дождь",
    65: "Сильный дождь",
    66: "Ледяной дождь",
    67: "Ледяной дождь",
    71: "Небольшой снег",
    73: "Снег",
    75: "Сильный снег",
    77: "Снежная крупа",
    80: "Ливень",
    81: "Ливень",
    82: "Сильный ливень",
    85: "Снегопад",
    86: "Сильный снегопад",
    95: "Гроза",
    96: "Гроза с градом",
    99: "Гроза с градом",
  };
  return map[code] ?? "—";
}

function formatWindSpeed(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${Math.round(ms)} м/с`;
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
  const temp = data.temperature;
  const rounded =
    temp != null && Number.isFinite(temp) ? Math.round(temp) : null;

  weatherTempEl.textContent =
    rounded != null ? `${rounded} °C` : "—";
  weatherDescEl.textContent = describeWeatherCode(data.weatherCode);
  weatherHumidityEl.textContent =
    data.humidity != null ? `${Math.round(data.humidity)} %` : "—";
  weatherWindEl.textContent = formatWindSpeed(data.windSpeed);

  if (data.time) {
    try {
      const timeLabel = new Date(data.time).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      setWeatherStatus(`${cityName} · ${timeLabel}`);
    } catch {
      setWeatherStatus(cityName);
    }
  } else {
    setWeatherStatus(cityName);
  }
}

async function fetchWeather(cityId) {
  const city = CITIES[cityId];
  if (!city) throw new Error("Неизвестный город");

  const params = new URLSearchParams({
    latitude: String(city.lat),
    longitude: String(city.lon),
    current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
    temperature_unit: "celsius",
    wind_speed_unit: "ms",
    timezone: "auto",
  });

  const response = await fetch(`${WEATHER_API}?${params}`);
  if (!response.ok) {
    throw new Error(`Ошибка API: ${response.status}`);
  }

  const json = await response.json();
  const current = json.current;
  if (!current) throw new Error("Нет данных о погоде");

  return {
    temperature: current.temperature_2m,
    humidity: current.relative_humidity_2m,
    weatherCode: current.weather_code,
    windSpeed: current.wind_speed_10m,
    time: current.time,
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
