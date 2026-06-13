/**
 * @file pure-fns.js
 * Pure functions with no side-effects and no dependencies on global state.
 * Extracted here so they can be imported directly by other modules and by tests.
 */

/* ── CSS / HTML safety ── */

/**
 * Returns `c` if it is a safe CSS colour (hex or hsl()), otherwise returns a neutral fallback.
 * Prevents malformed user-supplied colour values from breaking layout or injecting CSS.
 * @param {string} c - CSS colour string to validate.
 * @returns {string} A safe CSS colour string.
 * @example
 * safeCssColor('#7B61FF')      // → '#7B61FF'
 * safeCssColor('hsl(200,60%,50%)') // → 'hsl(200,60%,50%)'
 * safeCssColor('red')          // → '#888780'  (name blocked)
 * safeCssColor('')             // → '#888780'
 */
export function safeCssColor(c) {
  // Allow hex (#rgb, #rrggbb, #rrggbbaa) and hsl() only — block anything else
  return /^(#[0-9a-fA-F]{3,8}|hsl\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*\))$/.test(String(c))
    ? c
    : '#888780';
}

/**
 * Escapes a string for safe insertion as HTML text content.
 * @param {string} s - Raw string to escape.
 * @returns {string} HTML-escaped string safe for insertion into the DOM.
 * @example
 * escHtml('<b>bold</b>')   // → '&lt;b&gt;bold&lt;/b&gt;'
 * escHtml('a & b')         // → 'a &amp; b'
 * escHtml('"quoted"')      // → '&quot;quoted&quot;'
 * escHtml(42)              // → '42'
 */
export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Date / time formatting ── */

/**
 * Formats a Date as YYYY-MM-DD using local calendar date.
 * Uses local date components (getFullYear / getMonth / getDate) so the returned
 * string always matches the date the user sees on their clock, regardless of timezone.
 * @param {Date} d - Date to format.
 * @returns {string} e.g. '2026-05-26'
 * @example
 * dk(new Date(2026, 4, 26, 12, 0, 0))  // → '2026-05-26'  (noon local)
 * dk(new Date(2026, 11, 31, 23, 59, 0)) // → '2026-12-31' (11 PM local)
 * dk(new Date(2026, 0, 1, 0, 0, 0))    // → '2026-01-01'  (midnight local)
 */
export function dk(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Formats a Unix timestamp as HH:MM in 24-hour local time.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @returns {string} e.g. '09:30'
 * @example
 * fmtTime(new Date('2026-05-25T09:05:00').getTime()) // → '09:05'
 * fmtTime(new Date('2026-05-25T14:30:00').getTime()) // → '14:30'
 */
export function fmtTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/**
 * Formats a duration in milliseconds as a compact time string.
 * @param {number} ms - Duration in milliseconds.
 * @returns {string} 'MM:SS' for durations under an hour; 'HH:MM:SS' otherwise.
 * @example
 * fmtElapsed(0)              // → '00:00'
 * fmtElapsed(90 * 1000)      // → '01:30'
 * fmtElapsed(3600 * 1000)    // → '01:00:00'
 * fmtElapsed(5461 * 1000)    // → '01:31:01'
 */
export function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600),
    mm = Math.floor((s % 3600) / 60),
    ss = s % 60;
  if (hh > 0)
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Formats a duration in milliseconds as a compact human-readable string ("Xh Ym").
 * Used throughout the UI for tracked-time display in the timeline, chart, and plan.
 * @param {number} ms - Duration in milliseconds.
 * @returns {string} e.g. '1h 30m', '45m', '2h'
 * @example
 * fmtDur(0)                  // → '0m'
 * fmtDur(45 * 60 * 1000)     // → '45m'
 * fmtDur(90 * 60 * 1000)     // → '1h 30m'
 * fmtDur(120 * 60 * 1000)    // → '2h'
 */
export function fmtDur(ms) {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/**
 * Formats a past timestamp as a relative "ago" string for the last-note reference line.
 * Uses an injected `now` parameter so it is fully unit-testable without mocking Date.now.
 * @param {number} ts  - Unix timestamp in milliseconds of the past event.
 * @param {number} [now] - Current time in ms; defaults to Date.now().
 * @returns {string} 'just now' | 'X min ago' | 'Xh ago'
 * @example
 * fmtAgo(Date.now() - 30000)          // → 'just now'
 * fmtAgo(Date.now() - 2 * 60000)      // → '2 min ago'
 * fmtAgo(Date.now() - 90 * 60000)     // → '1h ago'
 */
export function fmtAgo(ts, now = Date.now()) {
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

/**
 * Formats a duration in milliseconds as a human-readable string using the
 * long "min" suffix.  Used in plaintext exports where readability matters more
 * than compactness.
 * @param {number} ms - Duration in milliseconds.
 * @returns {string} e.g. '1h 30min', '45min', '2h'
 * @example
 * fmtDurLong(0)                 // → '0min'
 * fmtDurLong(45 * 60 * 1000)    // → '45min'
 * fmtDurLong(90 * 60 * 1000)    // → '1h 30min'
 * fmtDurLong(120 * 60 * 1000)   // → '2h'
 */
export function fmtDurLong(ms) {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
}

/* ── Billing time rounding ── */

/**
 * Rounds a timestamp to the nearest 30-minute clock mark.
 *
 * Tie-breaking rule (at exactly 15 min into a 30-min slot): rounds DOWN.
 * Rationale: conservative for billing — a task must exceed the midpoint of the slot
 * before the next slot is claimed.
 *
 * Assumption: rounding ties (exactly 15 min past a slot start) are resolved in
 * favour of the earlier slot to avoid inflating billable time. This matches the
 * intent documented in DATA.md under wl_entries.ts.
 *
 * @param {number} ts - Unix timestamp in milliseconds.
 * @returns {number} Rounded Unix timestamp in milliseconds.
 */
export function roundToNearest30(ts) {
  const d = new Date(ts);
  const m = d.getMinutes();
  const blockStart = Math.floor(m / 30) * 30; // 0 or 30
  const withinBlock = m - blockStart; // 0–29
  // withinBlock <= 15 → keep blockStart (rounds down / tie goes down)
  // withinBlock >  15 → advance to blockStart + 30
  const roundedMins = withinBlock <= 15 ? blockStart : blockStart + 30;
  const result = new Date(d);
  result.setSeconds(0, 0);
  if (roundedMins >= 60) {
    if (d.getHours() === 23) {
      // Clamp to 23:30 — don't cross the day boundary
      result.setMinutes(30);
    } else {
      result.setMinutes(0);
      result.setHours(d.getHours() + 1);
    }
  } else {
    result.setMinutes(roundedMins);
  }
  return result.getTime();
}

/* ── Schema validators ── */
// These are used by 01-state.js load() to strip malformed records from localStorage.
// They are pure: each validates only its argument with no side-effects.

/**
 * Returns true if `e` is a well-formed work-log entry safe to load from localStorage.
 * @param {*} e - Candidate value parsed from JSON.
 * @returns {boolean} True if the entry is well-formed.
 * @example
 * validEntry({ id: '1', text: 'Write report', ts: 1234567890, date: '2026-05-25' }) // → true
 * validEntry(null)                           // → false
 * validEntry({ id: 1, text: 'x', ts: 0, date: '2026-05-25' }) // → false (numeric id)
 * validEntry({ id: '1', text: 'x', ts: 0, date: '25-05-2026' }) // → false (wrong date format)
 */
export function validEntry(e) {
  return !!(
    e &&
    typeof e.id === 'string' &&
    typeof e.text === 'string' &&
    typeof e.ts === 'number' &&
    typeof e.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.date)
  );
}

/**
 * Returns true if `c` is a well-formed category object.
 * @param {*} c - Candidate value parsed from JSON.
 * @returns {boolean} True if the category is well-formed.
 */
export function validCategory(c) {
  return !!(
    c &&
    typeof c.id === 'string' &&
    typeof c.label === 'string' &&
    typeof c.color === 'string'
  );
}

/**
 * Returns true if `t` is a well-formed plan task with a recognised status value.
 * @param {*} t - Candidate value parsed from JSON.
 * @returns {boolean} True if the plan task is well-formed.
 * @example
 * validPlanTask({ id: 'pk1', text: 'Build form', date: '2026-05-25', status: 'todo' }) // → true
 * validPlanTask({ id: 'pk1', text: 'x', date: '2026-05-25', status: 'finished' }) // → false (unknown status)
 * validPlanTask(null) // → false
 */
export function validPlanTask(t) {
  return !!(
    t &&
    typeof t.id === 'string' &&
    typeof t.text === 'string' &&
    typeof t.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
    ['todo', 'inprogress', 'done', 'pending', 'blocked', 'upcoming'].includes(t.status)
  );
}

/**
 * Returns true if `b` is a well-formed timeblock record.
 * @param {*} b - Candidate value parsed from JSON.
 * @returns {boolean} True if the timeblock is well-formed.
 */
export function validBlock(b) {
  return !!(
    b &&
    typeof b.id === 'string' &&
    typeof b.date === 'string' &&
    typeof b.slot === 'number' &&
    typeof b.duration === 'number' &&
    typeof b.text === 'string'
  );
}

/**
 * Returns true if `t` is a resumable timer state.
 * Handles both running (startTs is set) and paused (paused=true, accumulatedMs is set) forms.
 * @param {*} t - Candidate value parsed from JSON.
 * @returns {boolean} True if the timer state is well-formed.
 * @example
 * validTimer({ entryId: 'e1', startTs: 1234567890 })              // → true  (running)
 * validTimer({ entryId: 'e1', paused: true, accumulatedMs: 900000 }) // → true  (paused)
 * validTimer({ entryId: 'e1' })                                   // → false (neither running nor paused)
 * validTimer(null)                                                 // → false
 */
export function validTimer(t) {
  if (!t || typeof t.entryId !== 'string') return false;
  // Running timer: startTs is a number (when the current run started)
  // Paused timer:  startTs is null, accumulatedMs holds the work time so far
  if (t.paused === true) return typeof t.accumulatedMs === 'number';
  return typeof t.startTs === 'number';
}

/**
 * Returns true if `e` is a valid Pomodoro session log entry.
 * @param {*} e - Candidate value.
 * @returns {boolean} True if the Pomodoro entry is well-formed.
 */
export function validPomoEntry(e) {
  return !!(e && typeof e.ts === 'number' && typeof e.mins === 'number');
}

/* ── Backup import validation ── */

/**
 * Validates a parsed JSON backup object created by `exportBackup()`.
 *
 * Separated from the import flow so the validation logic can be unit-tested
 * without any browser APIs. `importBackup()` calls this before writing to
 * localStorage.
 *
 * @param {*} backup - Parsed backup object (typically from `JSON.parse`).
 * @returns {{ valid: boolean, error: (string|undefined) }}
 *   `{ valid: true }` when the backup is usable;
 *   `{ valid: false, error: string }` with a human-readable reason otherwise.
 * @example
 * validateBackupFile({ version: '1', entries: [], categories: [], planTasks: [] })
 *   // → { valid: true }
 * validateBackupFile(null)
 *   // → { valid: false, error: 'Not a valid backup object.' }
 * validateBackupFile({ version: '2', entries: [], categories: [], planTasks: [] })
 *   // → { valid: false, error: 'Unrecognised backup version "2"...' }
 * validateBackupFile({ version: '1', entries: [], categories: [] })
 *   // → { valid: false, error: '...missing required field "planTasks".' }
 */
export function validateBackupFile(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    return { valid: false, error: 'Not a valid backup object.' };
  }
  if (backup.version !== '1') {
    return {
      valid: false,
      error: `Unrecognised backup version "${backup.version}". Only version 1 is supported.`,
    };
  }
  for (const key of ['entries', 'categories', 'planTasks']) {
    if (!Array.isArray(backup[key])) {
      return { valid: false, error: `Invalid backup — missing required field "${key}".` };
    }
  }
  return { valid: true };
}

/**
 * Returns entries from `backupEntries` that are both schema-valid and absent
 * from `currentEntries` (compared by `id`). Pure: no side-effects, no browser
 * APIs.
 *
 * Separated from the import flow so the deduplication logic can be
 * unit-tested independently of localStorage and the File API.
 * `mergeBackupEntries()` calls this before writing to localStorage.
 *
 * @param {Array<Object>} currentEntries - Entries already in the local store.
 * @param {Array<Object>} backupEntries  - Entries from the backup file.
 * @param {function(Object): boolean} isValid - Entry-schema predicate (e.g. `validEntry`).
 * @returns {Array<Object>} Valid entries from `backupEntries` whose `id` does
 *   not appear in `currentEntries`.
 */
export function filterNewBackupEntries(currentEntries, backupEntries, isValid) {
  const existingIds = new Set(currentEntries.map((e) => e.id));
  return backupEntries.filter((e) => isValid(e) && !existingIds.has(e.id));
}

/* ── External API response validators ── */
// Pure validators for shapes received from external data sources.
// Each function returns a boolean; callers are responsible for logging and
// providing safe fallbacks when validation fails.

/**
 * Returns true if `data` is a well-formed Open-Meteo forecast response
 * containing the fields that `fetchWeather()` reads.
 *
 * Required shape:
 * - `data.current.temperature_2m` — number
 * - `data.current.weather_code`   — number
 * - `data.hourly.time`                      — array
 * - `data.hourly.precipitation_probability` — array
 *
 * The `daily` block is optional (used only when present).
 *
 * @param {*} data - Value parsed from the Open-Meteo JSON response.
 * @returns {boolean} True if the response is a usable forecast object.
 * @example
 * validWeatherResponse({
 *   current: { temperature_2m: 15, weather_code: 3 },
 *   hourly: { time: ['2026-05-28T00:00'], precipitation_probability: [10] },
 * }) // → true
 * validWeatherResponse(null)                  // → false
 * validWeatherResponse({ current: {} })       // → false  (missing hourly)
 * validWeatherResponse({ hourly: { time: [], precipitation_probability: [] } })
 *   // → false  (missing current)
 */
export function validWeatherResponse(data) {
  return !!(
    data &&
    typeof data === 'object' &&
    data.current &&
    typeof data.current.temperature_2m === 'number' &&
    typeof data.current.weather_code === 'number' &&
    data.hourly &&
    Array.isArray(data.hourly.time) &&
    Array.isArray(data.hourly.precipitation_probability)
  );
}

/**
 * Returns true if `meeting` is a well-formed Outlook calendar event object
 * as returned by the PowerShell `/api/calendar` endpoint.
 *
 * Required fields: `subject` (string), `start` (string), `end` (string).
 * Optional fields (`joinUrl`, `account`) are not validated here — their
 * absence is handled gracefully by `renderCalStrip`.
 *
 * @param {*} meeting - Candidate meeting object from the calendar API response.
 * @returns {boolean} True if the meeting object is well-formed.
 * @example
 * validCalendarMeeting({ subject: 'Standup', start: '2026-05-28T09:00', end: '2026-05-28T09:30' })
 *   // → true
 * validCalendarMeeting(null)                   // → false
 * validCalendarMeeting({ subject: 'x' })       // → false  (missing start/end)
 * validCalendarMeeting({ subject: 42, start: '2026-05-28T09:00', end: '2026-05-28T09:30' })
 *   // → false  (subject not a string)
 */
export function validCalendarMeeting(meeting) {
  return !!(
    meeting &&
    typeof meeting === 'object' &&
    typeof meeting.subject === 'string' &&
    typeof meeting.start === 'string' &&
    typeof meeting.end === 'string'
  );
}

/**
 * Returns true if `row` — a single object produced by `parseCSV()` — contains
 * at least the key and summary columns that `jiraParseAndRender()` expects.
 *
 * The Jira CSV export uses several possible column names for the same field
 * (matching the lenient lookup in `jiraParseAndRender`):
 * - Key column: `Issue key`, `Key`, or `Issue Key`
 * - Summary column: `Summary` or `summary`
 *
 * A row that has neither column set (e.g. from a semicolon-delimited file
 * parsed as single-column rows) fails validation and triggers a warning.
 *
 * @param {*} row - Single row object from `parseCSV()`.
 * @returns {boolean} True if the row has the key and summary fields Jira import needs.
 * @example
 * validJiraCsvRow({ 'Issue key': 'AITO-1', Summary: 'Fix login bug', Status: 'Open' })
 *   // → true
 * validJiraCsvRow({ Key: 'PROJ-2', Summary: 'Add dark mode', Status: 'To Do' })
 *   // → true
 * validJiraCsvRow({})                           // → false  (no key or summary)
 * validJiraCsvRow({ 'Issue key': 'AITO-1' })    // → false  (missing summary)
 * validJiraCsvRow({ Summary: 'Fix login bug' }) // → false  (missing key)
 */
export function validJiraCsvRow(row) {
  if (!row || typeof row !== 'object') return false;
  const hasKey = !!(
    (row['Issue key'] || '').trim() ||
    (row['Key'] || '').trim() ||
    (row['Issue Key'] || '').trim()
  );
  const hasSummary = !!((row['Summary'] || '').trim() || (row['summary'] || '').trim());
  return hasKey && hasSummary;
}

// ── Rapid-capture inline token grammar ───────────────────────────────────────

/**
 * Signifier shortcode map for quick-capture inline tokens.
 * Maps `!<shortcode>` tokens to signifier values used on entry objects.
 * Unmapped tokens are left in the text unchanged.
 * @type {Object<string, string>}
 */
const RAPID_SIG_SHORTCUTS = {
  event: 'event',
  ev: 'event',
  e: 'event',
  flagged: 'flagged',
  flag: 'flagged',
  f: 'flagged',
  star: 'flagged',
  migrated: 'migrated',
  migrate: 'migrated',
  m: 'migrated',
  cancelled: 'cancelled',
  cancel: 'cancelled',
  x: 'cancelled',
  drop: 'cancelled',
  overtime: 'overtime',
  ot: 'overtime',
};

/**
 * Resolves a `>date` shorthand token to a YYYY-MM-DD date key.
 * Supported tokens: 'today', 'tomorrow', exact 'YYYY-MM-DD', and weekday abbreviations
 * 'mon'–'sun' (resolves to the next occurrence, never today).
 *
 * @param {string} token - Raw date token (without the leading `>`).
 * @param {Date} [now] - Reference date for relative resolution; defaults to new Date().
 * @returns {string|null} Resolved date key, or null if the token is unrecognised.
 */
function resolveRapidDate(token, now) {
  const ref = now || new Date();
  const t = token.toLowerCase();

  if (t === 'today') return dk(ref);

  if (t === 'tomorrow') {
    const d = new Date(ref);
    d.setDate(d.getDate() + 1);
    return dk(d);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;

  const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const idx = DOW.indexOf(t.slice(0, 3));
  if (idx >= 0) {
    const d = new Date(ref);
    const diff = (idx - d.getDay() + 7) % 7 || 7; // always NEXT occurrence
    d.setDate(d.getDate() + diff);
    return dk(d);
  }

  return null;
}

/**
 * Parses inline shorthand tokens from a raw quick-capture input string and
 * returns a clean text plus structured token values.
 *
 * Supported tokens (each stripped from the returned `text`):
 * - `#<cat>`  — Category: matched against category ids and labels (case-insensitive;
 *               prefix match as fallback). Last occurrence wins.
 * - `!<sig>`  — Signifier shortcode (see RAPID_SIG_SHORTCUTS). Last occurrence wins.
 * - `><date>` — Date pointer: today, tomorrow, YYYY-MM-DD, or weekday mon–sun
 *               (next occurrence). Last occurrence wins.
 *
 * Unrecognised tokens are left in the text unchanged so the user sees them and can
 * correct them without data being silently discarded.
 *
 * @param {string} raw - Raw input text that may contain inline shorthand tokens.
 * @param {Array<{id: string, label: string}>} cats - Available categories for `#` resolution.
 * @param {Date} [now] - Reference date for relative date resolution; defaults to new Date().
 * @returns {{ text: string, tag: string|null, signifier: string|null, date: string|null }}
 */
export function parseRapidTokens(raw, cats, now) {
  let text = raw;
  let tag = null;
  let signifier = null;
  let date = null;

  // ── #category ──────────────────────────────────────────────────────────────
  text = text.replace(/#([\w-]+)/g, function (match, tok) {
    const lower = tok.toLowerCase();
    const catArr = cats || [];
    // Exact id match → label match → id-prefix match → label-prefix match
    const resolved =
      catArr.find((c) => c.id.toLowerCase() === lower) ||
      catArr.find((c) => c.label.toLowerCase() === lower) ||
      catArr.find((c) => c.id.toLowerCase().startsWith(lower)) ||
      catArr.find((c) => c.label.toLowerCase().startsWith(lower)) ||
      null;
    if (resolved) {
      tag = resolved.id;
      return '';
    }
    return match; // unrecognised — leave in text
  });

  // ── !signifier ─────────────────────────────────────────────────────────────
  text = text.replace(/!(\w+)/g, function (match, tok) {
    const key = tok.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(RAPID_SIG_SHORTCUTS, key)) {
      signifier = RAPID_SIG_SHORTCUTS[key];
      return '';
    }
    return match; // unrecognised — leave in text
  });

  // ── >date ──────────────────────────────────────────────────────────────────
  text = text.replace(/>([A-Za-z0-9-]+)/g, function (match, tok) {
    const resolved = resolveRapidDate(tok, now);
    if (resolved) {
      date = resolved;
      return '';
    }
    return match; // unrecognised — leave in text
  });

  // Collapse extra whitespace produced by token removal
  text = text.replace(/\s{2,}/g, ' ').trim();

  return { text, tag, signifier, date };
}

/* ── Export grouping ── */

/**
 * Removes a leading Jira issue key (e.g. `ABC-123: ` or `ABC-123 `) from a task
 * label, leaving the human-readable summary. Used when building the pasteable
 * billable summary so issue keys do not clutter the client-facing line.
 * @param {string} text - The raw task label.
 * @returns {string} The label with any leading Jira key stripped and trimmed.
 * @example
 * stripJiraPrefix('PROJ-42: Fix login')  // → 'Fix login'
 * stripJiraPrefix('Write tests')         // → 'Write tests'
 */
export function stripJiraPrefix(text) {
  return text.replace(/^[A-Z][A-Z0-9]*-\d+[:\s]\s*/, '').trim();
}

/**
 * Groups a day's log entries by category and, within each category, by task
 * (case-insensitively), preserving first-seen order. Accumulates tracked time
 * (where `tsEnd > ts`) per task and per category.
 *
 * Pure data transform — reads only entry fields and performs no formatting, so
 * the caller decides how to render the durations and labels.
 *
 * @param {Array<Object>} dayEntries - Entries for the viewed day.
 * @returns {{catOrder: string[], catGrouped: Object}} `catOrder` is the list of
 *   category keys in first-seen order; `catGrouped[catKey]` is
 *   `{ totalMs, tasks: { [taskKey]: { label, totalMs, hasTime } }, taskOrder }`.
 */
export function groupEntriesByCategory(dayEntries) {
  const catOrder = [];
  const catGrouped = {};
  dayEntries.forEach((entry) => {
    const catKey = entry.tag || 'other';
    const taskKey = entry.text.toLowerCase();
    if (!catGrouped[catKey]) {
      catOrder.push(catKey);
      catGrouped[catKey] = { totalMs: 0, tasks: {}, taskOrder: [] };
    }
    if (!catGrouped[catKey].tasks[taskKey]) {
      catGrouped[catKey].taskOrder.push(taskKey);
      catGrouped[catKey].tasks[taskKey] = { label: entry.text, totalMs: 0, hasTime: false };
    }
    if (entry.tsEnd && entry.tsEnd > entry.ts) {
      const ms = entry.tsEnd - entry.ts;
      catGrouped[catKey].totalMs += ms;
      catGrouped[catKey].tasks[taskKey].totalMs += ms;
      catGrouped[catKey].tasks[taskKey].hasTime = true;
    }
  });
  return { catOrder, catGrouped };
}

/**
 * Merges same-task entries that are separated by no more than `gapMs` into a
 * single block, carrying the merged end time on a `_end` property.
 *
 * Two entries merge only when they share the same task text *and* the same
 * category (`tag`, with a missing tag normalised to `other`). Category is part
 * of the key so that two adjacent entries with the same label but different
 * categories are not collapsed — otherwise the later category would be lost from
 * the exported billable summary, which reads `tag` from the merged block.
 *
 * Rationale for the gap: the default 30-minute window matches the billing
 * rounding unit — splitting a task at a gap shorter than one slot would produce
 * two entries that each round to the same half-hour anyway, while making the
 * summary harder to read. Input is not mutated; entries are sorted by start time first.
 *
 * @param {Array<Object>} entries - Entries to merge (each with `ts`, optional `tsEnd`, `text`, `tag`).
 * @param {number} [gapMs=1800000] - Maximum gap, in ms, to bridge (default 30 min).
 * @returns {Array<Object>} New entry objects, each with a `_end` timestamp.
 */
export function mergeAdjacentEntries(entries, gapMs = 30 * 60000) {
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  const out = [];
  for (const entry of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.text.toLowerCase() === entry.text.toLowerCase() &&
      (prev.tag || 'other') === (entry.tag || 'other') &&
      entry.ts - (prev._end || prev.ts) <= gapMs
    ) {
      prev._end = Math.max(prev._end || prev.ts, entry.tsEnd || entry.ts);
    } else {
      out.push({ ...entry, _end: entry.tsEnd || entry.ts });
    }
  }
  return out;
}

/**
 * Builds the parts of the pasteable billable summary from merged billable
 * entries. Categorised tasks are grouped as `Category (task1, task2)`;
 * uncategorised tasks (no tag or `other`) are listed bare. Order of first
 * appearance is preserved and duplicate task names are de-duplicated.
 *
 * @param {Array<Object>} mergedEntries - Output of {@link mergeAdjacentEntries}.
 * @param {function(string): string} getCatLabel - Resolves a category key to its
 *   display label. Injected so this function stays free of global state.
 * @returns {string[]} Summary parts, ready to be joined with `, `.
 */
export function buildBillableSummaryParts(mergedEntries, getCatLabel) {
  const summaryOrder = [];
  const summaryGroups = {};
  const summaryUngrouped = [];
  mergedEntries.forEach((entry) => {
    const taskName = stripJiraPrefix(entry.text);
    if (!entry.tag || entry.tag === 'other') {
      if (!summaryUngrouped.includes(taskName)) summaryUngrouped.push(taskName);
    } else {
      if (!summaryGroups[entry.tag]) {
        summaryOrder.push(entry.tag);
        summaryGroups[entry.tag] = { label: getCatLabel(entry.tag), tasks: [] };
      }
      if (!summaryGroups[entry.tag].tasks.includes(taskName)) {
        summaryGroups[entry.tag].tasks.push(taskName);
      }
    }
  });
  return [
    ...summaryOrder.map(
      (key) => `${summaryGroups[key].label} (${summaryGroups[key].tasks.join(', ')})`
    ),
    ...summaryUngrouped,
  ];
}

/**
 * Computes the day's start and end timestamps for the plaintext export header.
 *
 * Start: the supplied day start (today only) or, failing that, the earliest
 * entry start. End: the latest tracked end among timed entries, extended by the
 * active timer's effective end so "Ended:" reflects work still in progress.
 *
 * Pure: all environmental inputs (day start, the active timer, the current time)
 * are injected via `opts` so the function can be unit-tested without globals.
 *
 * @param {Array<Object>} dayEntries   - All entries for the viewed day.
 * @param {Array<Object>} timedEntries - Entries with a real tracked duration (`tsEnd`).
 * @param {Object} opts                - Injected environment.
 * @param {boolean} opts.isViewingToday - Whether the viewed day is today.
 * @param {number|null} opts.dayStart   - Configured day-start ts, or null if not today.
 * @param {Object|null} opts.activeTimer - The running/paused timer, or null.
 * @param {number} opts.now             - Current time in ms (`Date.now()`).
 * @returns {{dayStartTs: (number|null), dayEndTs: (number|null)}} Day bounds in ms.
 */
export function computeDayBounds(dayEntries, timedEntries, opts) {
  const { isViewingToday, dayStart, activeTimer, now } = opts;
  let dayStartTs = isViewingToday ? dayStart : null;
  if (!dayStartTs && dayEntries.length) {
    dayStartTs = Math.min(...dayEntries.map((entry) => entry.ts));
  }
  let dayEndTs = timedEntries.length ? Math.max(...timedEntries.map((entry) => entry.tsEnd)) : null;
  // Factor in the active timer's effective end so "Ended:" reflects live work
  if (activeTimer && isViewingToday) {
    const timerEntry = dayEntries.find((entry) => entry.id === activeTimer.entryId);
    if (timerEntry) {
      const liveEnd = activeTimer.paused
        ? timerEntry.ts + (activeTimer.accumulatedMs || 0) // paused → start + accumulated
        : Math.max(now, activeTimer.startTs || timerEntry.ts); // running → now (or startTs if test setup is ahead of wall clock)
      dayEndTs = dayEndTs ? Math.max(dayEndTs, liveEnd) : liveEnd;
    }
  }
  return { dayStartTs, dayEndTs };
}

/**
 * Renders the grouped-by-category structure into indented text lines: one line
 * per category (with its total), each followed by its indented task lines.
 *
 * Pure: the duration formatter and category-label resolver are injected so this
 * function has no dependency on global state and can be unit-tested directly.
 *
 * @param {string[]} catOrder   - Category keys in display order.
 * @param {Object}   catGrouped - Grouping produced by {@link groupEntriesByCategory}.
 * @param {function(number): string} fmtDuration  - Formats a duration in ms (e.g. `fmtDurLong`).
 * @param {function(string): string} getCatLabel - Resolves a category key to its label.
 * @returns {string[]} The body lines for the export file.
 */
export function formatGroupedLines(catOrder, catGrouped, fmtDuration, getCatLabel) {
  const lines = [];
  catOrder.forEach((catKey) => {
    const { totalMs, tasks, taskOrder } = catGrouped[catKey];
    const catTimeStr = totalMs > 0 ? fmtDuration(totalMs) : '--';
    lines.push(`${catTimeStr} - ${getCatLabel(catKey)}`);
    taskOrder.forEach((taskKey) => {
      const { label, totalMs: taskMs, hasTime } = tasks[taskKey];
      const taskTimeStr = hasTime ? fmtDuration(taskMs) : '--';
      lines.push(`    ${taskTimeStr} - ${label}`);
    });
  });
  return lines;
}

/**
 * Determines the carry-forward status a today-task should adopt based on its
 * most recent past peer, implementing the following rules:
 *
 * - `pending` or `blocked` prev overrides `todo` or `inprogress` today — the
 *   task is still blocked so the blocking state wins.
 * - `upcoming` prev overrides **only** a `todo` today — a todo placeholder
 *   created from an even-older copy should reflect the more recent intent to
 *   defer. It must NOT override `inprogress`, because the user explicitly
 *   started the task and a reload must not undo that.
 * - `inprogress` prev promotes a `todo` today — the task was already being
 *   worked on and the carry placeholder should show that.
 *
 * Returns `null` when no change is needed.
 *
 * @param {{ status: string, text: string }} todayTask - Today's task object.
 * @param {{ status: string, text: string, date: string }} prev - Most recent
 *   past task with the same text (case-insensitive).
 * @returns {string|null} The new status to apply, or `null` for no change.
 * @example
 * resolveCarryStatus({ status: 'todo' }, { status: 'upcoming' }) // → 'upcoming'
 * resolveCarryStatus({ status: 'inprogress' }, { status: 'upcoming' }) // → null
 * resolveCarryStatus({ status: 'todo' }, { status: 'pending' })  // → 'pending'
 */
export function resolveCarryStatus(todayTask, prev) {
  const prevIsBlocking = prev.status === 'pending' || prev.status === 'blocked';
  const todayIsTodo = todayTask.status === 'todo';
  const todayIsActive = todayIsTodo || todayTask.status === 'inprogress';

  if (prevIsBlocking && todayIsActive) return prev.status;

  if (prev.status === 'upcoming' && todayIsTodo) return 'upcoming';

  if (todayIsTodo && prev.status === 'inprogress') return 'inprogress';

  return null;
}

/* ── Work location ── */

/**
 * Work-location presets keyed by their stored id. Each entry carries the emoji
 * and human-readable label shown in the date-nav header. The first key is the
 * default applied to any day with no stored location.
 * @type {Readonly<Record<string, { emoji: string, label: string }>>}
 */
export const WORK_LOCATIONS = Object.freeze({
  remote: { emoji: '🏠', label: 'Remote' },
  office: { emoji: '🏢', label: 'Office' },
});

/** Location id used for any day that has no stored value. */
const DEFAULT_WORK_LOCATION = 'remote';

/**
 * Resolves the stored work location for a given day, falling back to the
 * default when the day is unset or holds an unknown value.
 * @param {Record<string, string>} map - Date-key → location-id map.
 * @param {string} dateKey - Day key in YYYY-MM-DD form (see {@link dk}).
 * @returns {string} A valid location id present in {@link WORK_LOCATIONS}.
 * @example
 * locationFor({ '2026-06-03': 'office' }, '2026-06-03') // → 'office'
 * locationFor({}, '2026-06-03')                         // → 'remote'
 * locationFor({ '2026-06-03': 'bogus' }, '2026-06-03')  // → 'remote'
 */
export function locationFor(map, dateKey) {
  const stored = map && map[dateKey];
  return Object.prototype.hasOwnProperty.call(WORK_LOCATIONS, stored)
    ? stored
    : DEFAULT_WORK_LOCATION;
}

/**
 * Returns the next location id when toggling, cycling through the keys of
 * {@link WORK_LOCATIONS}. With the two presets this flips Remote ↔ Office.
 * An unrecognised `loc` (indexOf → -1) is treated as "before the first" and
 * wraps to the first location, so the toggle always recovers to a valid state.
 * @param {string} loc - Current location id.
 * @returns {string} The following location id (wraps around).
 * @example
 * nextLocation('remote') // → 'office'
 * nextLocation('office') // → 'remote'
 * nextLocation('bogus')  // → 'remote'  (unknown input recovers to the first)
 */
export function nextLocation(loc) {
  const ids = Object.keys(WORK_LOCATIONS);
  const idx = ids.indexOf(loc);
  return ids[(idx + 1) % ids.length];
}

/* ── Rolling summary ── */

/**
 * Computes a rolling per-day summary for a set of date keys.
 *
 * All data dependencies are injected so the function is pure and unit-testable
 * without any browser globals or localStorage access.
 *
 * @param {string[]} dateKeys - Date keys (YYYY-MM-DD) to summarise, most recent first.
 * @param {object} opts
 * @param {object[]} opts.entries - All work-log entries.
 * @param {Function} opts.getDayStartTs - `(dateKey: string) => number|null` — SOD timestamp.
 * @param {Function} opts.getDayEodTs - `(dateKey: string) => number|null` — EOD timestamp.
 * @param {Function} opts.getLocationEmoji - `(dateKey: string) => string` — location emoji char.
 * @returns {Array<{
 *   dateKey: string,
 *   locationEmoji: string,
 *   sodTs: number|null,
 *   eodTs: number|null,
 *   totalMs: number,
 *   topTasks: Array<{text: string, totalMs: number}>
 * }>}
 * @example
 * buildRollingSummary(['2026-06-04'], {
 *   entries: [{ date: '2026-06-04', text: 'Write code', ts: 1000, tsEnd: 4600000, signifier: '' }],
 *   getDayStartTs: () => 1000,
 *   getDayEodTs: () => null,
 *   getLocationEmoji: () => '🏠',
 * })
 * // → [{ dateKey: '2026-06-04', locationEmoji: '🏠', sodTs: 1000, eodTs: null,
 * //      totalMs: 4599000, topTasks: [{ text: 'Write code', totalMs: 4599000 }] }]
 */
export function buildRollingSummary(dateKeys, opts) {
  const { entries, getDayStartTs, getDayEodTs, getLocationEmoji } = opts;
  return dateKeys.map((dateKey) => {
    const dayEntries = entries.filter(
      (e) => e.date === dateKey && e.tsEnd && e.signifier !== 'cancelled'
    );
    const totalMs = dayEntries.reduce((sum, e) => sum + (e.tsEnd - e.ts), 0);

    // Aggregate by task text; case-preserving, case-sensitive key so "Fix bug" and
    // "fix bug" remain separate entries (they were logged as distinct tasks).
    const byText = {};
    for (const e of dayEntries) {
      const key = e.text || '(untitled)';
      byText[key] = (byText[key] || 0) + (e.tsEnd - e.ts);
    }
    const topTasks = Object.entries(byText)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([text, ms]) => ({ text, totalMs: ms }));

    return {
      dateKey,
      locationEmoji: getLocationEmoji(dateKey),
      sodTs: getDayStartTs(dateKey),
      eodTs: getDayEodTs(dateKey),
      totalMs,
      topTasks,
    };
  });
}

/**
 * Filters an entries array to those whose `date` field falls within the
 * retention window (today minus `retentionDays`, inclusive). Entries with a
 * missing or unparseable date are excluded to keep backups clean.
 *
 * The cutoff is computed from `nowMs` so the function stays pure and testable.
 *
 * @param {Array<{date: (string|undefined)}>} entries - Raw entries array from localStorage.
 * @param {number} retentionDays - How many days back to keep (e.g. 90).
 * @param {number} nowMs - Current time as a Unix timestamp in milliseconds.
 * @returns {{ kept: Array, dropped: number }} The filtered entries and count of dropped ones.
 * @example
 * applyBackupRetention(entries, 90, Date.now())
 * // → { kept: [...], dropped: 12 }
 */
export function applyBackupRetention(entries, retentionDays, nowMs) {
  // Compare as YYYY-MM-DD strings (lexicographic = chronological) to avoid
  // the UTC-midnight parse problem: new Date('2026-03-11') is UTC midnight,
  // which can be earlier than a cutoff derived from local-time arithmetic.
  const cutoffDate = dk(new Date(nowMs - retentionDays * 24 * 60 * 60 * 1000));
  const kept = [];
  let dropped = 0;
  for (const e of entries) {
    if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || e.date < cutoffDate) {
      dropped++;
    } else {
      kept.push(e);
    }
  }
  return { kept, dropped };
}
