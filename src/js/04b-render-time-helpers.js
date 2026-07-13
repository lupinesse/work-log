/* ── Render: inline time-editor helpers ── */

/** Closes every open inline time-editor panel and restores the display spans. */
function closeAllEditors() {
  document.querySelectorAll('.etime-editor.open').forEach((el) => el.classList.remove('open'));
  document.querySelectorAll('.etime-display').forEach((el) => (el.style.display = ''));
}
/**
 * Converts a Unix timestamp (ms) to an HH:MM string suitable for an
 * `<input type="time">` value.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @returns {string} Local time formatted as "HH:MM".
 */
function toTimeInput(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
/**
 * Replaces the hours/minutes of a base timestamp with values parsed from a
 * "HH:MM" string, returning the resulting timestamp in milliseconds.
 * @param {number} baseTsMs - Base Unix timestamp (ms) that supplies the date.
 * @param {string} timeStr  - Time string in "HH:MM" format.
 * @returns {number} New Unix timestamp (ms) with the updated time.
 */
function applyTime(baseTsMs, timeStr) {
  const d = new Date(baseTsMs),
    [hh, mm] = timeStr.split(':').map(Number);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}
/**
 * Builds an HTML `<span class="etime-dur">` containing the human-readable
 * duration between two timestamps.  Returns an empty string if the duration
 * is zero or negative.
 * @param {number} tsStart - Start Unix timestamp (ms).
 * @param {number} tsEnd   - End Unix timestamp (ms).
 * @returns {string} HTML string, or '' if duration ≤ 0.
 */
function durLabel(tsStart, tsEnd) {
  const mins = Math.round((tsEnd - tsStart) / 60000);
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60),
    m = mins % 60;
  return `<span class="etime-dur">${h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`}</span>`;
}
