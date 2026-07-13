/* ── Weather ── */

// WEATHER_LAT, WEATHER_LON, WEATHER_NAME are defined in 00-config.js

/**
 * Maps a WMO weather interpretation code to a representative emoji.
 * @param {number} code - WMO weather code (0 = clear sky, 95+ = thunderstorm).
 * @returns {string} A single weather emoji character.
 */
function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 1) return '🌤️';
  if (code <= 2) return '⛅';
  if (code <= 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 55) return '🌦️';
  if (code <= 65) return '🌧️';
  if (code <= 75) return '❄️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '🌨️';
  return '⛈️';
}

/**
 * Fetches current weather, hourly precipitation probability, and sunrise/sunset
 * data from the Open-Meteo API for the configured location ({@link WEATHER_LAT},
 * {@link WEATHER_LON}) and populates `#liveWeather`, `#liveRain`, and
 * `#liveSunrise`. No-ops gracefully on `file:` protocol or network error.
 */
function fetchWeather() {
  if (location.protocol === 'file:') {
    document.getElementById('liveWeather').textContent =
      `${WEATHER_NAME} — open via localhost for weather`;
    return;
  }
  fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}&current=temperature_2m,weather_code&hourly=precipitation_probability&daily=sunrise,sunset,daylight_duration&timezone=Europe%2FHelsinki&past_days=1&forecast_days=2`
  )
    .then((response) => response.json())
    .then((weatherData) => {
      if (!validWeatherResponse(weatherData)) {
        wlLog.warn('fetchWeather: unexpected response shape', weatherData);
        throw new Error('fetchWeather: invalid response shape');
      }
      const temp = Math.round(weatherData.current.temperature_2m);
      const emoji = weatherEmoji(weatherData.current.weather_code);
      document.getElementById('liveWeather').textContent = `${WEATHER_NAME}, ${temp}°C ${emoji}`;

      // Peak rain probability in next 8 hours
      const times = weatherData.hourly.time;
      const probs = weatherData.hourly.precipitation_probability;
      // Find current hour in local time (API times are local)
      const _now = new Date();
      const _pad = (num) => String(num).padStart(2, '0');
      const nowLocalStr = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}T${_pad(_now.getHours())}`;
      const nowIdx = times.findIndex((time) => time.slice(0, 13) === nowLocalStr);
      if (nowIdx === -1) return;

      const windowStart = nowIdx + 1; // start from next hour — current hour may already be past
      const window = probs.slice(windowStart, windowStart + 9);
      const peak = Math.max(...window);
      const peakOff = window.indexOf(peak);
      const peakTime = new Date(times[windowStart + peakOff]);
      const hh = String(peakTime.getHours()).padStart(2, '0');
      const mm = String(peakTime.getMinutes()).padStart(2, '0');

      document.getElementById('liveRain').textContent =
        peak > 0 ? `${peak}% chance of rain at ${hh}:${mm}` : 'No rain expected';

      // Sunrise / sunset / day length
      if (weatherData.daily && weatherData.daily.time && weatherData.daily.sunrise) {
        const todayStr = dk(new Date()); // "YYYY-MM-DD"
        const todayIdx = weatherData.daily.time.indexOf(todayStr);
        const yesterdayIdx = todayIdx > 0 ? todayIdx - 1 : -1;
        if (todayIdx !== -1) {
          const parse = (str) => {
            const t = new Date(str);
            return (
              String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
            );
          };
          const rise = parse(weatherData.daily.sunrise[todayIdx]);
          const set_ = parse(weatherData.daily.sunset[todayIdx]);
          const durSec = weatherData.daily.daylight_duration[todayIdx];
          const h = Math.floor(durSec / 3600);
          const m = Math.floor((durSec % 3600) / 60);
          let diffHtml = '';
          if (yesterdayIdx !== -1) {
            const diffMin = Math.round(
              (durSec - weatherData.daily.daylight_duration[yesterdayIdx]) / 60
            );
            if (diffMin > 0)
              diffHtml = ` <strong style="color:var(--sig-event)">+${diffMin} min</strong>`;
            else if (diffMin < 0)
              diffHtml = ` <strong style="color:var(--sig-overtime)">${diffMin} min</strong>`;
          }
          document.getElementById('liveSunrise').innerHTML =
            `🌅 ${rise} | 🌇 ${set_} | ☀️ ${h}h ${m}min${diffHtml}`;
        }
      }
    })
    .catch(() => {
      document.getElementById('liveWeather').textContent = WEATHER_NAME;
    });
}
// Load location from server config before the first weather fetch.
// Falls back to the defaults in 00-config.js when the server is not running.
fetch('/api/config')
  .then((response) => (response.ok ? response.json() : null))
  .then((cfg) => {
    if (!cfg) return;
    if (typeof cfg.weatherLat === 'number') WEATHER_LAT = cfg.weatherLat;
    if (typeof cfg.weatherLon === 'number') WEATHER_LON = cfg.weatherLon;
    if (cfg.weatherName) WEATHER_NAME = cfg.weatherName;
    // Mark that the API server responded — read by wlLog.config() in 07-lifecycle.js
    // to record which environment the app is running in.
    localStorage.setItem('wl_api_ok', '1');
  })
  .catch(() => {
    localStorage.removeItem('wl_api_ok');
  })
  .finally(() => fetchWeather());

setInterval(fetchWeather, 10 * 60 * 1000); // refresh every 10 min
