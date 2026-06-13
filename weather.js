const WEATHER_API = "https://wttr.in";
const WEATHER_CACHE_KEY = "weatherForecastCache";
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

  if (data.time) {
    setWeatherStatus(`${cityName} · ${data.time}`);
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

  const description =
    current.lang_ru?.[0]?.value ||
    current.weatherDesc?.[0]?.value ||
    "—";

  return {
    temperature: current.temp_C,
    humidity: current.humidity,
    description,
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
