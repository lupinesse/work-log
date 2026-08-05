/* ── Live clock + weather ── */

/**
 * Returns the ISO 8601 week number for a given date.
 * @param {Date} d - The date to evaluate.
 * @returns {number} ISO week number (1–53).
 */
function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}
/**
 * Returns the total number of ISO weeks in a given year (52 or 53).
 * Uses the fact that Dec 28 is always in the last ISO week.
 * @param {number} year - The full 4-digit year.
 * @returns {number} 52 or 53.
 */
function totalISOWeeks(year) {
  return getISOWeek(new Date(year, 11, 28)); // Dec 28 is always in last ISO week
}

let _lastTickDate = dk(new Date());

tickClock();
setInterval(tickClock, 10000);

/**
 * Updates the live clock display (date, time, ISO week), the time-block
 * "now" line, and block notifications. Also detects midnight rollover:
 * carries unfinished plan tasks to the new day and re-renders the UI.
 */
function tickClock() {
  const now = new Date();
  const weekday = now.toLocaleDateString('en', { weekday: 'long' });
  const month = now.toLocaleDateString('en', { month: 'long' });
  const day = now.getDate();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('liveDate').textContent = `${weekday}, ${month} ${day}`;
  document.getElementById('liveTime').textContent = `${hh}:${mm}`;
  const w = getISOWeek(now);
  const total = totalISOWeeks(now.getFullYear());
  document.getElementById('liveWeek').textContent = `Week ${w}/${total}`;
  positionNowLine();
  checkBlockNotifications();
  updateHeaderTracking();
  // Detect midnight rollover — carry tasks and re-render
  const todayKey = dk(now);
  if (todayKey !== _lastTickDate) {
    _lastTickDate = todayKey;
    autoCarryTasks();
    patchCarriedTasks();
    viewDate = new Date();
    renderSodBtn();
    renderEodBtn();
    checkPomoWeeklyClear();
    render();
  }
}

/**
 * No-op: the header tracked-total and pace bar were removed in the top-zone
 * redesign (ITEM 1). Kept so tickClock() and tickTimer() call sites remain
 * unchanged.
 */
function updateHeaderTracking() {
  // Tracking display now lives in the Hero Card — no header elements to update.
}

// WEATHER_LAT, WEATHER_LON, WEATHER_NAME, JIRA_BASE are defined in 00-config.js
// weatherEmoji/fetchWeather split to 09a-weather.js; moon/flag-day/nameday
// almanac split to 09b-almanac.js. Both are invoked from this file's eager
// bootstrap sequence below, which stays here since it also kicks off several
// unrelated renders on load.

/**
 * Returns HTML for a task text string, converting any leading Jira ticket key
 * (e.g. `AITO-1234`) into a clickable link. The remainder of the text is
 * HTML-escaped and appended.
 * @param {string} text - Raw task text, possibly starting with a Jira key.
 * @returns {string} HTML string.
 */
function jiraTicketHtml(text) {
  // Anchored on ^…$; [\s:_-]+ and .* overlap on whitespace but cannot catastrophically backtrack.
  // eslint-disable-next-line security/detect-unsafe-regex
  const m = text.match(/^([A-Z]+-\d+)([\s:_-]+(.*))?$/);
  if (!m) return escHtml(text);
  const key = m[1];
  const rest = (m[3] || '').trim();
  const link = `<a class="jira-key-link" href="${JIRA_BASE}/${key}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escHtml(key)}</a>`;
  return rest ? `${link}<span class="jira-key-sep">:</span> ${escHtml(rest)}` : link;
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

fetchNameday();
fetchCalendarEvents();
renderMoon();
renderFlagDay();
renderDistractionCount();
renderSodBtn();
renderEodBtn();
renderFolderStatus();
loadChimeSetting();
setInterval(fetchWeather, 10 * 60 * 1000); // refresh every 10 min
