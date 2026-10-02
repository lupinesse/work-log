/**
 * @file entry-billable.js — Billable-status helpers for log entries (LEAF MODULE).
 *
 * Extracted from `05-entries.js` and `02-utils.js` (issue #336, extraction #19).
 * Both functions depend on category and plan-task lookups, so they are not pure;
 * they live in their own leaf module imported at the top of the built bundle so
 * the concatenated files can call them from shared scope.
 */
import { getPlanTasks } from './state.js';
import { getCat } from './cat-utils.js';
import { roundToNearest30 } from './pure-fns.js';

/**
 * Determines whether a log entry is billable, using a three-tier lookup:
 * 1. The entry's own `billable` flag (if explicitly set).
 * 2. The matching plan task's `billable` flag.
 * 3. The category default.
 *
 * Assumption: entries and tasks where `billable` is `undefined` are treated as
 * billable by default. This preserves backward compatibility with data created
 * before the billable flag was introduced — older entries must not silently
 * disappear from billing reports after an upgrade.
 * If the default should change to non-billable, a migration of existing
 * localStorage data is required (see DATA.md § wl_entries).
 *
 * @param {Object} entry - Log entry object.
 * @returns {boolean} True if the entry should be counted as billable.
 * @example
 * isEntryBillable({ text: 'Write report', tag: 'work' })                   // → true (category default)
 * isEntryBillable({ text: 'Write report', tag: 'work', billable: false })  // → false (explicit flag)
 * isEntryBillable({ text: 'Write report', signifier: 'cancelled' })        // → false (cancelled)
 */
export function isEntryBillable(entry) {
  if (entry.signifier === 'cancelled') return false;
  if (entry.billable !== undefined) return entry.billable;
  const task = getPlanTasks().find(
    (planTask) => planTask.text.toLowerCase().trim() === entry.text.toLowerCase().trim()
  );
  // `!== false` (not `=== true`) — undefined means billable (see Assumption above).
  if (task) return task.billable !== false;
  // Same `!== false` convention for categories — undefined → billable.
  return getCat(entry.tag || 'other').billable !== false;
}

/**
 * Rounds `ts` to the nearest 30-minute mark only when `entry` is billable.
 * Non-billable entries keep their exact timestamps for accurate reporting.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @param {Object|null} entry - Work-log entry; if null or undefined, always rounds.
 * @returns {number} Timestamp, conditionally rounded.
 * @example
 * roundToNearest30IfBillable(1000 * 60 * 47, null)                      // → rounded (null always rounds)
 * roundToNearest30IfBillable(1000 * 60 * 47, { billable: false })       // → exact ts (non-billable)
 * roundToNearest30IfBillable(1000 * 60 * 47, { billable: true })        // → rounded (billable)
 */
export function roundToNearest30IfBillable(ts, entry) {
  // Assumption: non-billable entries keep exact timestamps for accurate time reporting.
  // Billable entries are rounded because clients are invoiced in 30-minute increments.
  // Changing this requires updating the export format in 05-entries.js and DATA.md.
  if (entry && !isEntryBillable(entry)) return ts;
  return roundToNearest30(ts);
}
