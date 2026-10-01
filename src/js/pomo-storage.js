// ── pomo-storage.js — Pomodoro session log storage helpers ──
//
// Leaf ES module: read + write the pomodoro session log from localStorage.
// Extracted from 08-pomodoro.js (issue #336, extraction #14).

import { STORE_POMO_LOG } from './app-constants.js';
import { validPomoEntry } from './pure-fns-validate.js';
import { wlLog } from './logger.js';

/**
 * @typedef {Object} PomoSessionEntry
 * @property {number} ts - Unix timestamp ms when the session was logged.
 * @property {number} mins - Duration of the session in minutes.
 * @property {string|null} task - Task name linked to the session, or null if none.
 */

/**
 * Reads and validates the pomodoro session log from localStorage.
 * Invalid records are dropped and reported via `wlLog.warn`.
 * @returns {PomoSessionEntry[]} Validated session log entries, newest first.
 */
export function pomoGetLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_POMO_LOG) || '[]');
    const all = Array.isArray(raw) ? raw : [];
    const valid = all.filter(validPomoEntry);
    if (valid.length < all.length)
      wlLog.warn(`pomoGetLog: dropped ${all.length - valid.length} invalid pomodoro record(s)`, {
        total: all.length,
        kept: valid.length,
      });
    return valid;
  } catch (err) {
    wlLog.error('pomoGetLog: failed to parse pomodoro log', err);
    return [];
  }
}

/**
 * Prepends a new session entry to the pomodoro log and persists it.
 * The log is capped at 100 entries (oldest are dropped).
 * @param {PomoSessionEntry} session - The session entry to record.
 */
export function pomoSaveSession(session) {
  const log = pomoGetLog();
  log.unshift(session);
  localStorage.setItem(STORE_POMO_LOG, JSON.stringify(log.slice(0, 100)));
}
