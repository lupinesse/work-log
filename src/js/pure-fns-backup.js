/**
 * @file pure-fns-backup.js
 * Backup retention and JSON-backup payload construction. Split out of
 * pure-fns-export.js (QA 2026-09-07, largest-module finding) — re-exported
 * there via the pure-fns.js barrel. Pure functions with no side-effects and
 * no global state — a leaf ES module (imports only from pure-fns-format.js).
 */

import { dk } from './pure-fns-format.js';

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

/**
 * Builds the JSON-backup payload with the retention window applied to *every*
 * time-series array, so the backup file size stays bounded over time.
 *
 * Previously only `entries` was trimmed while `planTasks`, `blocks`, `devLog`,
 * and `distractions` were bundled in full — those grow every day (carried
 * tasks, per-day time blocks, appended distraction/dev-log records) and were
 * the reason "21-day" backups kept getting bigger. Each of those arrays carries
 * a `YYYY-MM-DD` `date` field, so they prune through the same window as
 * `entries`.
 *
 * Non-time-series data is intentionally kept whole: `categories` and `qpHidden`
 * are small reference sets with no date, and `pomoLog` is already capped at
 * source (100 records) so it needs no further trimming here.
 *
 * Kept pure (no `localStorage`, no ambient clock) so the bounded-size guarantee
 * is unit-testable — the caller supplies the current state and the clock.
 *
 * @param {object} state - Current application state arrays.
 * @param {Array}  [state.entries] - Log entries (dated; trimmed).
 * @param {Array}  [state.categories] - Category definitions (undated; kept whole).
 * @param {Array}  [state.planTasks] - Plan/board tasks (dated; trimmed).
 * @param {Array}  [state.blocks] - Time blocks (dated; trimmed).
 * @param {Array}  [state.pomoLog] - Pomodoro log (capped at source; kept whole).
 * @param {Array}  [state.devLog] - Dev-changelog entries (dated; trimmed).
 * @param {Array}  [state.distractions] - Distraction records (dated; trimmed).
 * @param {Array}  [state.qpHidden] - Hidden quick-pick ids (undated; kept whole).
 * @param {number} retentionDays - How many days back to keep for dated arrays.
 * @param {number} nowMs - Current time as a Unix timestamp in milliseconds.
 * @returns {{ payload: object, dropped: Object<string, number> }} The backup
 *   payload object and a per-array count of records excluded from it (only
 *   arrays that dropped at least one record are included). The count folds
 *   together records that aged out of the window and records dropped for a
 *   missing/malformed `date` — both are legitimately excluded, so they are not
 *   distinguished here.
 * @example
 * buildBackupPayload({ entries, planTasks, blocks }, 21, Date.now())
 * // → { payload: { version: '1', entries: [...], planTasks: [...], ... }, dropped: { blocks: 4 } }
 */
export function buildBackupPayload(state, retentionDays, nowMs) {
  const dropped = {};
  const trim = (arr, label) => {
    const { kept, dropped: n } = applyBackupRetention(arr || [], retentionDays, nowMs);
    if (n > 0) dropped[label] = n;
    return kept;
  };
  const payload = {
    version: '1',
    exported: new Date(nowMs).toISOString(),
    retentionDays,
    entries: trim(state.entries, 'entries'),
    categories: state.categories || [],
    planTasks: trim(state.planTasks, 'planTasks'),
    blocks: trim(state.blocks, 'blocks'),
    pomoLog: state.pomoLog || [],
    devLog: trim(state.devLog, 'devLog'),
    distractions: trim(state.distractions, 'distractions'),
    qpHidden: [...(state.qpHidden || [])],
  };
  return { payload, dropped };
}
