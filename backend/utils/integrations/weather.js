/** Open-Meteo forecast for the facility (free, no key). Cached so the dashboard doesn't call it on every view. */
const CACHE_MS = 20 * 60 * 1000;
let cache = { key: '', at: 0, data: null };

const CODES = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};
const label = (code) => CODES[code] || 'Mixed';

async function getForecast(lat, lng) {
  const key = `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
  if (cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.data;

  const qs = new URLSearchParams({
    latitude: String(lat), longitude: String(lng), timezone: 'Asia/Manila', forecast_days: '4',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Object.assign(new Error('The weather service is unavailable right now'), { status: 502 });
  const w = await r.json();

  const data = {
    hourly: w.hourly.time.map((t, i) => ({
      time: t, temp: Math.round(w.hourly.temperature_2m[i]),
      rain: w.hourly.precipitation_probability[i], summary: label(w.hourly.weather_code[i]),
    })),
    daily: w.daily.time.map((d, i) => ({
      date: d, max: Math.round(w.daily.temperature_2m_max[i]), min: Math.round(w.daily.temperature_2m_min[i]),
      rain: w.daily.precipitation_probability_max[i], summary: label(w.daily.weather_code[i]),
    })),
  };
  cache = { key, at: Date.now(), data };
  return data;
}

/**
 * Where to forecast: the pinned facility, or Metro Manila (marked approximate) until an admin pins it.
 * Returns { lat, lng, label, approximate }.
 */
function forecastLocation(settings) {
  if (settings && settings.facilityLat != null && settings.facilityLng != null) {
    return { lat: settings.facilityLat, lng: settings.facilityLng, label: settings.facilityAddress || 'the facility', approximate: false };
  }
  return { lat: 14.5995, lng: 120.9842, label: 'Metro Manila', approximate: true };
}

module.exports = { getForecast, forecastLocation };
