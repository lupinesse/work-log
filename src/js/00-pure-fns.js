/**
 * @file 00-pure-fns.js
 * Pure functions with no side-effects and no dependencies on global state.
 * Extracted here so they can be imported by Node unit tests without a browser.
 *
 * In the browser build these declarations become globals inside the IIFE.
 * In Node (require / test runner) the module.exports block at the bottom exports them.
 */

/* ── CSS / HTML safety ── */

/**
 * Returns `c` if it is a safe CSS colour (hex or hsl()), otherwise returns a neutral fallback.
 * Prevents malformed user-supplied colour values from breaking layout or injecting CSS.
 * @param {string} c
 * @returns {string} A safe CSS colour string.
 * @example
 * safeCssColor('#7B61FF')      // → '#7B61FF'
 * safeCssColor('hsl(200,60%,50%)') // → 'hsl(200,60%,50%)'
 * safeCssColor('red')          // → '#888780'  (name blocked)
 * safeCssColor('')             // → '#888780'
 */
function safeCssColor(c) {
  // Allow hex (#rgb, #rrggbb, #rrggbbaa) and hsl() only — block anything else
  return /^(#[0-9a-fA-F]{3,8}|hsl\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*\))$/.test(String(c))
    ? c
    : '#888780';
}

/**
 * Escapes a string for safe insertion as HTML text content.
 * @param {string} s
 * @returns {string}
 * @example
 * escHtml('<b>bold</b>')   // → '&lt;b&gt;bold&lt;/b&gt;'
 * escHtml('a & b')         // → 'a &amp; b'
 * escHtml('"quoted"')      // → '&quot;quoted&quot;'
 * escHtml(42)              // → '42'
 */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Date / time formatting ── */

/**
 * Formats a Date as YYYY-MM-DD using UTC (toISOString).
 * Note: uses UTC midnight, not local midnight — callers near midnight in UTC+ zones
 * should be aware that this may return the previous calendar day.
 * @param {Date} d
 * @returns {string} e.g. '2026-05-25'
 */
function dk(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Formats a Unix timestamp as HH:MM in 24-hour local time.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @returns {string} e.g. '09:30'
 * @example
 * fmtTime(new Date('2026-05-25T09:05:00').getTime()) // → '09:05'
 * fmtTime(new Date('2026-05-25T14:30:00').getTime()) // → '14:30'
 */
function fmtTime(ts) {
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
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600),
    mm = Math.floor((s % 3600) / 60),
    ss = s % 60;
  if (hh > 0)
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/* ── Billing time rounding ── */

/**
 * Rounds a duration up to the nearest 30-minute slot, with a minimum of 30 min.
 * Used for billing time estimates — even a 1-second task costs one half-hour slot.
 *
 * Assumption: billing granularity is 30 minutes and the minimum billable unit is
 * 30 minutes. Changing this assumption requires updating both this function and
 * any UI that displays billable totals (04-render.js renderBillableBar).
 *
 * @param {number} ms - Duration in milliseconds.
 * @returns {number} Duration rounded up to nearest 30-min slot, in milliseconds.
 * @example
 * roundUp30(0)                    // → 1_800_000  (30 min — minimum)
 * roundUp30(1)                    // → 1_800_000  (1 ms still costs one slot)
 * roundUp30(30 * 60 * 1000)       // → 1_800_000  (exactly 30 min stays at 30 min)
 * roundUp30(30 * 60 * 1000 + 1)   // → 3_600_000  (30 min + 1 ms rounds up to 60 min)
 */
function roundUp30(ms) {
  const SLOT = 30 * 60 * 1000;
  return Math.max(SLOT, Math.ceil(ms / SLOT) * SLOT);
}

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
function roundToNearest30(ts) {
  const d = new Date(ts);
  const m = d.getMinutes();
  const blockStart = Math.floor(m / 30) * 30; // 0 or 30
  const withinBlock = m - blockStart; // 0–29
  // withinBlock <= 15 → keep blockStart (rounds down / tie goes down)
  // withinBlock >  15 → advance to blockStart + 30
  const roundedMins = withinBlock <= 15 ? blockStart : blockStart + 30;
  const result = new Date(d);
  result.setSeconds(0, 0);
  result.setMinutes(roundedMins % 60);
  if (roundedMins >= 60) result.setHours(d.getHours() + 1);
  return result.getTime();
}

/* ── Schema validators ── */
// These are used by 01-state.js load() to strip malformed records from localStorage.
// They are pure: each validates only its argument with no side-effects.

/**
 * Returns true if `e` is a well-formed work-log entry safe to load from localStorage.
 * @param {*} e - Candidate value parsed from JSON.
 * @returns {boolean}
 * @example
 * validEntry({ id: '1', text: 'Write report', ts: 1234567890, date: '2026-05-25' }) // → true
 * validEntry(null)                           // → false
 * validEntry({ id: 1, text: 'x', ts: 0, date: '2026-05-25' }) // → false (numeric id)
 * validEntry({ id: '1', text: 'x', ts: 0, date: '25-05-2026' }) // → false (wrong date format)
 */
function validEntry(e) {
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
 * @returns {boolean}
 */
function validCategory(c) {
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
 * @returns {boolean}
 * @example
 * validPlanTask({ id: 'pk1', text: 'Build form', date: '2026-05-25', status: 'todo' }) // → true
 * validPlanTask({ id: 'pk1', text: 'x', date: '2026-05-25', status: 'finished' }) // → false (unknown status)
 * validPlanTask(null) // → false
 */
function validPlanTask(t) {
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
 * @returns {boolean}
 */
function validBlock(b) {
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
 * @returns {boolean}
 * @example
 * validTimer({ entryId: 'e1', startTs: 1234567890 })              // → true  (running)
 * validTimer({ entryId: 'e1', paused: true, accumulatedMs: 900000 }) // → true  (paused)
 * validTimer({ entryId: 'e1' })                                   // → false (neither running nor paused)
 * validTimer(null)                                                 // → false
 */
function validTimer(t) {
  if (!t || typeof t.entryId !== 'string') return false;
  // Running timer: startTs is a number (when the current run started)
  // Paused timer:  startTs is null, accumulatedMs holds the work time so far
  if (t.paused === true) return typeof t.accumulatedMs === 'number';
  return typeof t.startTs === 'number';
}

/**
 * Returns true if `e` is a valid Pomodoro session log entry.
 * @param {*} e - Candidate value.
 * @returns {boolean}
 */
function validPomoEntry(e) {
  return !!(e && typeof e.ts === 'number' && typeof e.mins === 'number');
}

// ── CommonJS export (Node / unit tests only) ─────────────────────────────────
// In the browser IIFE, `module` is not defined so typeof returns 'undefined' and
// this block is skipped — functions remain as globals in the closure.
if (typeof module !== 'undefined') {
  module.exports = {
    safeCssColor,
    escHtml,
    dk,
    fmtTime,
    fmtElapsed,
    roundUp30,
    roundToNearest30,
    validEntry,
    validCategory,
    validPlanTask,
    validBlock,
    validTimer,
    validPomoEntry,
  };
}
