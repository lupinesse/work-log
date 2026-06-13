/**
 * @file pure-fns-format.js
 * CSS/HTML safety, date/time/duration formatting, and billing time rounding.
 * Split out of pure-fns.js (re-exported there as a barrel). Pure functions with
 * no side-effects, no global state, and no imports — a leaf ES module.
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
  if (c == null) return '#888780';
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
