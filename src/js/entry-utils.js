/**
 * @file entry-utils.js — Entry timestamp and view helpers (LEAF MODULE).
 *
 * Stateless entry accessors extracted from `02-utils.js` (issue #336,
 * extraction #18). Both functions depend only on leaf-module state accessors
 * and pure formatting helpers, making them fully unit-testable without a DOM
 * environment.
 */
import { getEntries, getViewDate } from './state.js';
import { dk, roundToNearest30 } from './pure-fns.js';

/**
 * Returns a rounded start timestamp that does not overlap any existing entry
 * for today. Rounds `Date.now()` to the nearest 30-minute boundary, then
 * takes the maximum of that value and the latest `tsEnd` among today's
 * completed entries, preventing new entries from appearing to start before
 * a prior entry's end time.
 * @returns {number} Unix timestamp in milliseconds.
 */
export function safeRoundedStart() {
  const ts = roundToNearest30(Date.now());
  const todayKey = dk(new Date());
  const lastEnd = getEntries()
    .filter((entry) => entry.date === todayKey && entry.tsEnd)
    .reduce((max, entry) => Math.max(max, entry.tsEnd), 0);
  return Math.max(ts, lastEnd);
}

/**
 * Returns entries for the currently viewed date, sorted newest-first by
 * start time (`ts`) — not by insertion order. This keeps retroactively
 * added entries (e.g. filling in a missed morning slot after the day is
 * already logged) positioned correctly rather than jumping to the top or
 * staying at the bottom based on when they were typed in.
 * @returns {Array<object>}
 */
export function viewEntries() {
  return getEntries()
    .filter((entry) => entry.date === dk(getViewDate()))
    .slice()
    .sort((entryA, entryB) => entryB.ts - entryA.ts);
}
