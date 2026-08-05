/**
 * @file pure-fns-validate.js
 * Validators: localStorage schema validators, backup-import validation, and
 * external-API response validators. Split out of pure-fns.js (re-exported
 * there as a barrel). Pure functions with no side-effects, no global state,
 * and no imports — a leaf ES module.
 */

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
 * validEntry({ id: '1', text: 'x', ts: 0, date: '2026-05-25', link: 42 }) // → false (non-string link)
 */
export function validEntry(e) {
  return !!(
    e &&
    typeof e.id === 'string' &&
    typeof e.text === 'string' &&
    typeof e.ts === 'number' &&
    typeof e.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
    (e.link === undefined || typeof e.link === 'string') &&
    (e.note === undefined || typeof e.note === 'string')
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
  const existingIds = new Set(currentEntries.map((entry) => entry.id));
  return backupEntries.filter((entry) => isValid(entry) && !existingIds.has(entry.id));
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
