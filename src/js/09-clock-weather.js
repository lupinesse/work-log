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
let _lastReminderMinute = -1;

// Auto-break state — set at :50, cleared at :00
let _preBreakEntryId = null; // entry id that was running before the automated break
let _breakEntryId = null; // entry id of the auto-created Break entry

/* ── Water-themed reminders ── */

/**
 * Plays a water-themed audio reminder using the Web Audio API.
 * 'breaktime' plays a short rain sound (8 rustling oscillators).
 * 'worktime' plays a rolling ocean-wave sound (3 deeper tones).
 * Silently skips if Web Audio is unavailable.
 * @param {'breaktime'|'worktime'} type - Which sound to play.
 */
function playWaterReminderSound(type) {
  // type: 'breaktime' (get up, at XX:50) or 'worktime' (return to work, at XX:00)
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    if (type === 'breaktime') {
      // Rain sound: multiple short rustling sounds in quick succession
      // Simulates rain/drizzle
      for (let i = 0; i < 8; i++) {
        setTimeout(() => {
          try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            // Randomized low frequency for rain effect
            osc.frequency.value = 100 + Math.random() * 80;

            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

            osc.start();
            osc.stop(ctx.currentTime + 0.3);
          } catch (e) {}
        }, i * 80);
      }
    } else if (type === 'worktime') {
      // Ocean wave sound: deeper, rolling wave tones
      // Three waves in sequence
      for (let w = 0; w < 3; w++) {
        setTimeout(() => {
          try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            // Deeper frequency for ocean/waves
            osc.frequency.value = 60 + w * 20;

            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

            osc.start();
            osc.stop(ctx.currentTime + 0.6);
          } catch (e) {}
        }, w * 700);
      }
    }
  } catch (e) {}
}

/**
 * Checks the current minute and fires hourly break/return-to-work logic.
 * At minute :50 — stops the active timer, creates a Break entry, starts a
 * 10-minute pomodoro, and enters focus mode.
 * At minute :00 — stops the Break timer (if still running), restarts the
 * pre-break task, and exits focus mode.
 * Runs at most once per clock minute.
 */
function checkReminders() {
  const now = new Date();
  const mins = now.getMinutes();

  // Only check once per minute
  if (mins === _lastReminderMinute) return;
  _lastReminderMinute = mins;

  if (mins === 50) {
    // Break time — stop current timer, create Break entry, play rain sound, enter focus mode
    playWaterReminderSound('breaktime');

    // Remember which entry was running so we can restore it after the break
    _preBreakEntryId = activeTimer ? activeTimer.entryId : null;
    _breakEntryId = null;

    // Stop any active timer
    if (activeTimer) stopTimer();

    // Create a Break entry
    const breakEntry = {
      id: Date.now() + '',
      text: 'Break',
      tag: 'break',
      ts: Date.now(),
      date: dk(new Date()),
    };
    entries.push(breakEntry);
    save();
    _breakEntryId = breakEntry.id;

    // Start timer on Break entry
    startTimer(breakEntry.id);

    // Initialize and start 10-minute pomodoro
    initPomo(10);
    startPomo();

    // Enter focus/emergency mode
    enterEmergency();

    render();
  } else if (mins === 0) {
    // Return to work — play ocean wave sound, then restore pre-break state
    playWaterReminderSound('worktime');

    if (_breakEntryId) {
      // Only stop the break timer if the user hasn't already switched away from it
      if (activeTimer && activeTimer.entryId === _breakEntryId) {
        stopTimer(); // finalizes the Break entry with tsEnd
        // Resume the pre-break task if it still exists in entries
        if (_preBreakEntryId && entries.find((e) => e.id === _preBreakEntryId)) {
          startTimer(_preBreakEntryId);
        }
      }
      // Exit focus mode regardless — it was auto-entered, so auto-exit it
      if (emergencyMode) exitEmergency();
      _preBreakEntryId = null;
      _breakEntryId = null;
      render();
    }
  }
}

tickClock();
setInterval(tickClock, 10000);

/**
 * Updates the live clock display (date, time, ISO week), the time-block
 * "now" line, block notifications, and hourly reminders. Also detects
 * midnight rollover: carries unfinished plan tasks to the new day and
 * re-renders the UI.
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
  checkReminders(); // Check for hourly break reminders
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

// WEATHER_LAT, WEATHER_LON, WEATHER_NAME, JIRA_BASE are defined in 00-config.js

/**
 * Returns HTML for a task text string, converting any leading Jira ticket key
 * (e.g. `AITO-1234`) into a clickable link. The remainder of the text is
 * HTML-escaped and appended.
 * @param {string} text - Raw task text, possibly starting with a Jira key.
 * @returns {string} HTML string.
 */
function jiraTicketHtml(text) {
  const m = text.match(/^([A-Z]+-\d+)([\s:_-]+(.*))?$/s);
  if (!m) return escHtml(text);
  const key = m[1];
  const rest = (m[3] || '').trim();
  const link = `<a class="jira-key-link" href="${JIRA_BASE}/${key}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escHtml(key)}</a>`;
  return rest ? `${link}<span class="jira-key-sep">:</span> ${escHtml(rest)}` : link;
}

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

// Finnish nameday (nimipäivä) — hardcoded official list (University of Helsinki 2020)

/**
 * Calculates moon phase, illumination percentage, and zodiac sign for a date
 * using a simplified version of the Meeus algorithm.
 * @param {Date} date - The date to evaluate.
 * @returns {{emoji: string, phase: string, illum: number, sign: Array.<string>}}
 *   `emoji` = phase emoji, `phase` = phase name, `illum` = illumination (%),
 *   `sign` = [symbol, name] of the current zodiac sign.
 */
function getMoonData(date) {
  const JD = date.getTime() / 86400000 + 2440587.5;
  const D = JD - 2451545.0; // days from J2000
  const toR = (x) => (x * Math.PI) / 180;

  // Moon's ecliptic longitude (simplified Meeus)
  const L = (((218.316 + 13.176396 * D) % 360) + 360) % 360;
  const M = toR((((134.963 + 13.064993 * D) % 360) + 360) % 360);
  const E = toR((((297.85 + 12.190749 * D) % 360) + 360) % 360);
  const lon =
    (((L +
      6.289 * Math.sin(M) -
      1.274 * Math.sin(2 * E - M) +
      0.658 * Math.sin(2 * E) -
      0.214 * Math.sin(2 * M) -
      0.11 * Math.sin(E)) %
      360) +
      360) %
    360;

  // Zodiac sign
  const SIGNS = [
    ['♈', 'Aries'],
    ['♉', 'Taurus'],
    ['♊', 'Gemini'],
    ['♋', 'Cancer'],
    ['♌', 'Leo'],
    ['♍', 'Virgo'],
    ['♎', 'Libra'],
    ['♏', 'Scorpio'],
    ['♐', 'Sagittarius'],
    ['♑', 'Capricorn'],
    ['♒', 'Aquarius'],
    ['♓', 'Pisces'],
  ];
  const sign = SIGNS[Math.floor(lon / 30)];

  // Synodic age → phase emoji + illumination
  const synodicPeriod = 29.530588853;
  const age = (((JD - 2451550.26) % synodicPeriod) + synodicPeriod) % synodicPeriod;
  const illum = Math.round(((1 - Math.cos((2 * Math.PI * age) / synodicPeriod)) / 2) * 100);
  const p = age / synodicPeriod;
  const PHASES = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  const PHASE_NAMES = [
    'New Moon',
    'Waxing Crescent',
    'First Quarter',
    'Waxing Gibbous',
    'Full Moon',
    'Waning Gibbous',
    'Last Quarter',
    'Waning Crescent',
  ];
  const pIdx =
    p < 0.025 || p >= 0.975
      ? 0
      : p < 0.25
        ? 1
        : p < 0.275
          ? 2
          : p < 0.5
            ? 3
            : p < 0.525
              ? 4
              : p < 0.75
                ? 5
                : p < 0.775
                  ? 6
                  : 7;

  return { emoji: PHASES[pIdx], phase: PHASE_NAMES[pIdx], illum, sign };
}

/**
 * Renders today's moon phase, illumination, and zodiac sign into `#liveMoon`.
 * No-ops if the element is absent.
 */
function renderMoon() {
  const el = document.getElementById('liveMoon');
  if (!el) return;
  const { emoji, phase, illum, sign } = getMoonData(new Date());
  el.textContent = `${emoji} ${illum}% ${phase} — ${sign[1]} ${sign[0]}`;
}

// Finnish flag days
const FLAG_DAYS_FIXED = {
  '01-01': "New Year's Day",
  '02-05': 'J.L. Runeberg Day',
  '02-28': 'Kalevala Day',
  '03-19': 'Minna Canth Day',
  '04-09': 'Mikael Agricola Day',
  '04-27': "National Veterans' Day",
  '05-01': 'May Day',
  '05-09': 'Europe Day',
  '05-12': 'J.V. Snellman Day',
  '06-04': 'Flag Day of the Finnish Defence Forces',
  '07-06': 'Eino Leino Day',
  '10-01': 'Miina Sillanpää Day',
  '10-10': 'Aleksis Kivi Day',
  '10-24': 'United Nations Day',
  '11-06': 'Swedish Heritage Day',
  '11-20': "Children's Rights Day",
  '12-06': 'Finnish Independence Day',
  '12-08': 'Jean Sibelius Day',
};

/**
 * Returns an object mapping "MM-DD" strings to Finnish flag-day names for
 * the given year. Combines fixed dates with computed moveable feasts.
 * @param {number} year - The full 4-digit year.
 * @returns {Object<string, string>} Map of "MM-DD" → event name.
 */
function getFlagDays(year) {
  const days = { ...FLAG_DAYS_FIXED };
  // Mother's Day — 2nd Sunday of May
  days[fmtMD(nthWeekday(year, 5, 0, 2))] = "Mother's Day";
  // Kaatuneitten muistopäivä — 3rd Sunday of May
  days[fmtMD(nthWeekday(year, 5, 0, 3))] = 'Kaatuneitten muistopäivä';
  // Midsummer / Finnish Flag Day — Saturday between Jun 20–26
  days[fmtMD(nearestWeekday(new Date(year, 5, 20), 6))] = 'Midsummer / Finnish Flag Day';
  // Father's Day — 2nd Sunday of November
  days[fmtMD(nthWeekday(year, 11, 0, 2))] = "Father's Day";
  // Finnish Nature Day — last Saturday of August
  days[fmtMD(lastWeekday(year, 8, 6))] = 'Finnish Nature Day';
  return days;
}

/**
 * Returns the date of the nth occurrence of a weekday in the given month.
 * @param {number} year    - Full 4-digit year.
 * @param {number} month   - Month (1 = January … 12 = December).
 * @param {number} weekday - Day of week (0 = Sunday … 6 = Saturday).
 * @param {number} n       - 1-based occurrence index (1 = first, 2 = second, …).
 * @returns {Date}
 */
function nthWeekday(year, month, weekday, n) {
  // weekday: 0=Sun..6=Sat, month: 1-12, n: 1-based
  const d = new Date(year, month - 1, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === weekday) {
      count++;
      if (count === n) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
  }
}

/**
 * Returns the date of the last occurrence of a weekday in the given month.
 * @param {number} year    - Full 4-digit year.
 * @param {number} month   - Month (1 = January … 12 = December).
 * @param {number} weekday - Day of week (0 = Sunday … 6 = Saturday).
 * @returns {Date}
 */
function lastWeekday(year, month, weekday) {
  // Last occurrence of weekday (0=Sun..6=Sat) in month (1-12)
  const d = new Date(year, month, 0); // last day of month
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
  return d;
}

/**
 * Returns the first date on or after `from` that falls on the given weekday.
 * @param {Date}   from    - Start date (inclusive).
 * @param {number} weekday - Day of week (0 = Sunday … 6 = Saturday).
 * @returns {Date}
 */
function nearestWeekday(from, weekday) {
  const d = new Date(from);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Formats a Date as a zero-padded "MM-DD" string used as flag-day map keys.
 * @param {Date} d - The date to format.
 * @returns {string} e.g. "06-04" for the 4th of June.
 */
function fmtMD(d) {
  return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * No longer actively used — `fetchCalendarEvents` handles flag-day display.
 * Kept as a no-op stub so call sites don't need to be removed.
 */
function renderFlagDay() {
  // No longer needed — fetchCalendarEvents handles everything
  // Kept as stub for compatibility
}

// Nimipäivärajapinta API token
const NAMEDAY_API_TOKEN = 'ndt_32a4ed60ad8dc72397936afa3af3fd0832e28ef34ed9d6a6bd04927239588f01';
const NAMEDAY_API_BASE = '/api'; // proxied through local server to avoid CORS

/**
 * Fetches today's Finnish and Swedish name days from the Nimipäivärajapinta API
 * and renders them in `#liveNameday`. Falls back to an "API unavailable" note
 * on error.
 */
function fetchNameday() {
  const el = document.getElementById('liveNameday');
  if (!el) return;

  // Fetch both Finnish and Swedish names, show with explicit language labels
  fetch(`${NAMEDAY_API_BASE}/namedays/today`, {
    headers: { Authorization: `Bearer ${NAMEDAY_API_TOKEN}` },
  })
    .then((r) => {
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      return r.json();
    })
    .then((data) => {
      if (data.success && data.name_days_by_type) {
        const finnishNames = (data.name_days_by_type.suomi || []).map((n) => n.name);
        const swedishNames = (data.name_days_by_type.ruotsi || []).map((n) => n.name);

        let display = "🎂 Today's name day: ";

        const SE_FLAG =
          '<svg width="16" height="11" viewBox="0 0 16 11" style="vertical-align:middle;margin:0 2px;border-radius:1px;display:inline-block"><rect width="16" height="11" fill="#006AA7"/><rect x="4" width="2.5" height="11" fill="#FECC02"/><rect y="4" width="16" height="2.5" fill="#FECC02"/></svg>';

        if (finnishNames.length > 0 && swedishNames.length > 0) {
          display += `${finnishNames.slice(0, 2).map(escHtml).join(', ')}`;
          display += ` <span style="font-size:85%;color:var(--text3)">/ ${SE_FLAG}${swedishNames.slice(0, 2).map(escHtml).join(', ')}</span>`;
        } else if (finnishNames.length > 0) {
          display += `${finnishNames.slice(0, 2).map(escHtml).join(', ')}`;
        } else if (swedishNames.length > 0) {
          display += `<span style="font-size:85%;color:var(--text3)">${SE_FLAG}${swedishNames.slice(0, 2).map(escHtml).join(', ')}</span>`;
        } else {
          throw new Error('No name day data');
        }

        el.innerHTML = display;
      } else {
        throw new Error('Invalid API response');
      }
    })
    .catch((err) => {
      console.warn('[wl] Nameday API failed:', err.message);
      el.innerHTML = `<span style="color:#999999;font-size:85%">🎂 (API unavailable)</span>`;
    });
}

/**
 * Fetches today's Finnish flag days, public holidays, and notable days from the
 * Nimipäivärajapinta Typesense API, displaying the first match in `#liveFlagDay`.
 * If today has no event, shows the next upcoming one. Falls back to the hardcoded
 * {@link FLAG_DAYS_FIXED} list if the API is unreachable.
 */
function fetchCalendarEvents() {
  const el = document.getElementById('liveFlagDay');
  if (!el) return;

  const now = new Date();
  const day = now.getDate();
  const mon = now.getMonth() + 1;
  const year = now.getFullYear();
  const FLAG_SVG =
    '<svg width="20" height="13" viewBox="0 0 18 11" style="vertical-align:middle;margin-right:5px;border-radius:1px;display:inline-block"><rect width="18" height="11" fill="#fff"/><rect y="4" width="18" height="3" fill="#003580"/><rect x="5" width="3" height="11" fill="#003580"/></svg>';

  // Hardcoded fallback — always shows something even if API is unreachable
  function showFallback() {
    const todayMD = fmtMD(now);
    const thisYear = getFlagDays(year);
    const nextYear = getFlagDays(year + 1);
    if (thisYear[todayMD]) {
      el.innerHTML = `${FLAG_SVG}<span style="font-weight:500">${escHtml(thisYear[todayMD])}</span>`;
      return;
    }
    const todayFull = `${year}-${todayMD}`;
    const all = [
      ...Object.entries(thisYear).map(([k, v]) => ({ key: `${year}-${k}`, type: 'flag', name: v })),
      ...Object.entries(nextYear).map(([k, v]) => ({
        key: `${year + 1}-${k}`,
        type: 'flag',
        name: v,
      })),
    ].sort((a, b) => a.key.localeCompare(b.key));
    const next = all.find((d) => d.key > todayFull);
    if (next) {
      const dateStr = new Date(next.key + 'T12:00:00').toLocaleDateString('en', {
        month: 'long',
        day: 'numeric',
      });
      el.innerHTML = `${FLAG_SVG}Upcoming: ${dateStr} — <span style="font-weight:500">${escHtml(next.name)}</span>`;
    }
  }

  const apiPost = (collection, body) =>
    fetch(`${NAMEDAY_API_BASE}/typesense/collections/${collection}/documents/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${NAMEDAY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .catch(() => ({ hits: [] }));

  const todayStr = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Check today first, then upcoming if nothing found
  Promise.all([
    apiPost('flag_days', { q: '*', filter_by: `day:=${day} && month:=${mon}`, per_page: 1 }),
    apiPost('holidays', {
      q: '*',
      filter_by: `day:=${day} && month:=${mon} && in_short_list:=true`,
      per_page: 1,
    }),
    apiPost('notable_days', { q: '*', filter_by: `day:=${day} && month:=${mon}`, per_page: 1 }),
  ])
    .then(([flagToday, holidayToday, notableToday]) => {
      // Show today's event if found
      if (flagToday.hits && flagToday.hits.length > 0) {
        el.innerHTML = `${FLAG_SVG}<span style="font-weight:500">${escHtml(flagToday.hits[0].document.name_fi)}</span>`;
        return;
      }
      if (holidayToday.hits && holidayToday.hits.length > 0) {
        el.innerHTML = `📅 <span style="font-weight:500">${escHtml(holidayToday.hits[0].document.name_fi)}</span>`;
        return;
      }
      if (notableToday.hits && notableToday.hits.length > 0) {
        el.innerHTML = `📅 <span style="font-weight:500">${escHtml(notableToday.hits[0].document.name_fi)}</span>`;
        return;
      }

      // Nothing today — find next upcoming event
      return Promise.all([
        apiPost('flag_days', {
          q: '*',
          filter_by: `date:>${todayStr}`,
          sort_by: 'date:asc',
          per_page: 1,
        }),
        apiPost('holidays', {
          q: '*',
          filter_by: `date:>${todayStr} && in_short_list:=true`,
          sort_by: 'date:asc',
          per_page: 1,
        }),
        apiPost('notable_days', {
          q: '*',
          filter_by: `date:>${todayStr}`,
          sort_by: 'date:asc',
          per_page: 1,
        }),
      ]).then(([flagNext, holidayNext, notableNext]) => {
        const events = [];
        if (flagNext.hits && flagNext.hits.length > 0)
          events.push({
            date: flagNext.hits[0].document.date,
            type: 'flag',
            name: flagNext.hits[0].document.name_fi,
          });
        if (holidayNext.hits && holidayNext.hits.length > 0)
          events.push({
            date: holidayNext.hits[0].document.date,
            type: 'calendar',
            name: holidayNext.hits[0].document.name_fi,
          });
        if (notableNext.hits && notableNext.hits.length > 0)
          events.push({
            date: notableNext.hits[0].document.date,
            type: 'calendar',
            name: notableNext.hits[0].document.name_fi,
          });

        if (events.length > 0) {
          const next = events.sort((a, b) => a.date.localeCompare(b.date))[0];
          const dateStr = new Date(next.date + 'T12:00:00').toLocaleDateString('en', {
            month: 'long',
            day: 'numeric',
          });
          const icon = next.type === 'flag' ? FLAG_SVG : '📅 ';
          el.innerHTML = `${icon}Upcoming: ${dateStr} — <span style="font-weight:500">${escHtml(next.name)}</span>`;
        } else {
          showFallback(); // API returned nothing — use hardcoded list
        }
      });
    })
    .catch(() => showFallback());
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
    .then((r) => r.json())
    .then((d) => {
      const temp = Math.round(d.current.temperature_2m);
      const emoji = weatherEmoji(d.current.weather_code);
      document.getElementById('liveWeather').textContent = `${WEATHER_NAME}, ${temp}°C ${emoji}`;

      // Peak rain probability in next 8 hours
      const times = d.hourly.time;
      const probs = d.hourly.precipitation_probability;
      // Find current hour in local time (API times are local)
      const _now = new Date();
      const _pad = (n) => String(n).padStart(2, '0');
      const nowLocalStr = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}T${_pad(_now.getHours())}`;
      const nowIdx = times.findIndex((t) => t.slice(0, 13) === nowLocalStr);
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
      if (d.daily && d.daily.time && d.daily.sunrise) {
        const todayStr = dk(new Date()); // "YYYY-MM-DD"
        const todayIdx = d.daily.time.indexOf(todayStr);
        const yesterdayIdx = todayIdx > 0 ? todayIdx - 1 : -1;
        if (todayIdx !== -1) {
          const parse = (str) => {
            const t = new Date(str);
            return (
              String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
            );
          };
          const rise = parse(d.daily.sunrise[todayIdx]);
          const set_ = parse(d.daily.sunset[todayIdx]);
          const durSec = d.daily.daylight_duration[todayIdx];
          const h = Math.floor(durSec / 3600);
          const m = Math.floor((durSec % 3600) / 60);
          let diffHtml = '';
          if (yesterdayIdx !== -1) {
            const diffMin = Math.round((durSec - d.daily.daylight_duration[yesterdayIdx]) / 60);
            if (diffMin > 0) diffHtml = ` <strong style="color:#1D9E75">+${diffMin} min</strong>`;
            else if (diffMin < 0)
              diffHtml = ` <strong style="color:#E74C3C">${diffMin} min</strong>`;
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
fetchWeather();
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
