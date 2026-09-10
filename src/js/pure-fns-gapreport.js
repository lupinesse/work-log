/**
 * @file pure-fns-gapreport.js
 * Gap-report and export-warning helpers: finding undocumented billable work,
 * flagging anomalies (long unbroken blocks, a full day with no break), and
 * rendering the grouped-by-category export body. Split out of
 * pure-fns-export.js (QA 2026-09-07, largest-module finding) — re-exported
 * there via the pure-fns.js barrel. Pure functions with no side-effects and
 * no global state — a leaf ES module (imports only from pure-fns-format.js).
 */

import { isLongRunningTimer } from './pure-fns-format.js';

/* ── Gap report ── */

// Utility entries logged via logUtilEntry() in 03-timer.js — never carry
// documentation, so they'd just be noise in the gap report. Exported so
// pure-fns-weeklyreport.js's buildWeeklyTicketSummary() can reuse the same
// exclusion rather than declaring a second copy.
export const GAP_REPORT_UTILITY_TEXTS = new Set(['☕ Break', '🥪 Lunch', '📅 Meeting']);

/**
 * Finds finished, non-cancelled, billable work entries within
 * `[weekStart, weekEnd)` that have neither a proof link nor a note —
 * candidates for the end-of-week gap report. Uses the same "finished and
 * not cancelled" filter as every other report/aggregation in this codebase
 * ({@link buildRollingSummary}, `findLargestGap` in `11-timeflow.js`,
 * `exportTxt`'s billable summary), plus excludes break/lunch/meeting
 * utility entries which never need documentation.
 *
 * Non-billable entries are never flagged: this is a pure module with no
 * access to the category/task lookups {@link isEntryBillable} needs, so
 * callers resolve billable status themselves and annotate each entry with
 * `_billable` before calling this (see `exportTxt`'s
 * `entriesWithBillingStatus` for the same convention). An entry with no
 * `_billable` property is treated as billable, matching
 * {@link isEntryBillable}'s own "undefined means billable" default.
 *
 * @param {Array<Object>} entries - All log entries, each optionally carrying
 *   a resolved `_billable` flag (`false` excludes it from the report).
 * @param {number} weekStart - Inclusive week-start timestamp in ms (e.g. Monday 00:00).
 * @param {number} weekEnd - Exclusive week-end timestamp in ms (e.g. the following Monday 00:00).
 * @returns {Array<Object>} Matching entries, sorted by `ts` ascending.
 * @example
 * findGapReportEntries(
 *   [{ id: '1', text: 'Fix login', ts: 100, tsEnd: 200, date: '2026-06-01' }],
 *   0, 1000
 * )
 * // → [{ id: '1', text: 'Fix login', ts: 100, tsEnd: 200, date: '2026-06-01' }]
 */
export function findGapReportEntries(entries, weekStart, weekEnd) {
  return (entries || [])
    .filter(
      (entry) =>
        entry.tsEnd &&
        entry.signifier !== 'cancelled' &&
        entry.ts >= weekStart &&
        entry.ts < weekEnd &&
        !GAP_REPORT_UTILITY_TEXTS.has(entry.text) &&
        // `!== false` (not `=== true`): an entry with no _billable property
        // defaults to billable, mirroring isEntryBillable()'s own
        // "undefined means billable" convention.
        entry._billable !== false &&
        !(entry.link && entry.link.trim()) &&
        !(entry.note && entry.note.trim())
    )
    .sort((a, b) => a.ts - b.ts);
}

// The single-block "too long" threshold reuses isLongRunningTimer's own 4h
// default below rather than a third local constant.
/** Day span, in ms, above which a workday is expected to contain a real break. */
const LONG_DAY_SPAN_MS = 6 * 60 * 60000;
/** Untracked time, in ms, below which a long day is flagged as missing a break. */
const MIN_EXPECTED_BREAK_MS = 15 * 60000;

/**
 * Flags anomalies in a day's entries that would otherwise only surface when
 * someone questions the timesheet later: work logged with no way to check it,
 * suspiciously long unbroken stretches, and a full workday with no break-sized
 * gap in it. Surfaced as a warnings section at the end of the plaintext export
 * so the person doing the logging finds the gap before anyone asking about it
 * does. Non-billable entries are never flagged for a missing note/link — see
 * {@link findGapReportEntries} for why the `_billable` flag must already be
 * resolved on each entry before it reaches this function.
 *
 * Pure: the duration formatter is injected (same convention as
 * {@link formatGroupedLines}) so this has no dependency on global state.
 *
 * @param {Array<Object>} dayEntries - All entries for the exported day, each
 *   optionally carrying a resolved `_billable` flag (`false` excludes it from
 *   the missing-note/link check).
 * @param {Object} opts
 * @param {number} [opts.workdaySpanMs=0] - Ended-minus-started span for the day.
 * @param {number} [opts.untrackedMs=0] - `workdaySpanMs` minus total tracked time —
 *   i.e. the implied, unlabelled break/gap time within the day.
 * @param {function(number): string} opts.fmtDuration - Formats a duration in ms.
 * @returns {string[]} Human-readable warning lines; empty when nothing stands out.
 * @example
 * findExportWarnings(
 *   [{ text: 'Fix login', ts: 0, tsEnd: 3600000, signifier: '' }],
 *   { workdaySpanMs: 3600000, untrackedMs: 0, fmtDuration: (ms) => `${ms}ms` }
 * )
 * // → ['No note or link: Fix login']
 */
export function findExportWarnings(dayEntries, opts) {
  const { workdaySpanMs = 0, untrackedMs = 0, fmtDuration } = opts;
  const warnings = [];

  (dayEntries || [])
    .filter(
      (entry) =>
        entry.tsEnd &&
        entry.tsEnd > entry.ts &&
        entry.signifier !== 'cancelled' &&
        !GAP_REPORT_UTILITY_TEXTS.has(entry.text) &&
        entry._billable !== false &&
        !(entry.link && entry.link.trim()) &&
        !(entry.note && entry.note.trim())
    )
    .forEach((entry) => warnings.push(`No note or link: ${entry.text}`));

  (dayEntries || [])
    .filter(
      (entry) =>
        entry.tsEnd && entry.signifier !== 'cancelled' && isLongRunningTimer(entry.tsEnd - entry.ts)
    )
    .forEach((entry) =>
      warnings.push(`Long unbroken block: ${entry.text} (${fmtDuration(entry.tsEnd - entry.ts)})`)
    );

  if (workdaySpanMs >= LONG_DAY_SPAN_MS && untrackedMs < MIN_EXPECTED_BREAK_MS) {
    warnings.push(
      `No break logged despite a ${fmtDuration(workdaySpanMs)} day ` +
        `(only ${fmtDuration(untrackedMs)} untracked)`
    );
  }

  return warnings;
}

/**
 * Renders the grouped-by-category structure into indented text lines: one line
 * per category (with its total), each followed by its indented task lines and,
 * when the task carries tracked sessions, a note, and/or a proof link, further
 * indented sub-lines for each — session time ranges first, then note lines,
 * then a link line — so a task worked in two separate sessions still shows
 * both time ranges instead of only their collapsed total.
 *
 * Pure: the duration/time formatters and category-label resolver are injected
 * so this function has no dependency on global state and can be unit-tested
 * directly.
 *
 * @param {string[]} catOrder   - Category keys in display order.
 * @param {Object}   catGrouped - Grouping produced by {@link groupEntriesByCategory}.
 * @param {function(number): string} fmtDuration  - Formats a duration in ms (e.g. `fmtDurLong`).
 * @param {function(string): string} getCatLabel - Resolves a category key to its label.
 * @param {Object<string, string>} [taskNotes] - Map of lowercased task text to note,
 *   as produced by {@link buildTaskNoteMap}. Omitted tasks render with no note line.
 * @param {Object<string, string>} [taskLinks] - Map of lowercased task text to a
 *   comma-separated link list, as produced by {@link buildEntryLinkMap}. Omitted
 *   tasks render with no link line.
 * @param {function({ts: number, tsEnd: number}): string} [fmtSessionRange] - Formats
 *   one tracked session as a time-range string (e.g. `'09:30–13:00'`). When
 *   omitted, session lines are skipped entirely (e.g. for callers that never
 *   populated `sessions` on their task objects).
 * @returns {string[]} The body lines for the export file.
 */
export function formatGroupedLines(
  catOrder,
  catGrouped,
  fmtDuration,
  getCatLabel,
  taskNotes = {},
  taskLinks = {},
  fmtSessionRange
) {
  const lines = [];
  catOrder.forEach((catKey) => {
    const { totalMs, tasks, taskOrder } = catGrouped[catKey];
    const catTimeStr = totalMs > 0 ? fmtDuration(totalMs) : '--';
    lines.push(`${catTimeStr} - ${getCatLabel(catKey)}`);
    taskOrder.forEach((taskKey) => {
      const { label, totalMs: taskMs, hasTime, sessions } = tasks[taskKey];
      const taskTimeStr = hasTime ? fmtDuration(taskMs) : '--';
      lines.push(`    ${taskTimeStr} - ${label}`);
      if (fmtSessionRange && sessions && sessions.length) {
        sessions.forEach((session) => lines.push(`        ${fmtSessionRange(session)}`));
      }
      const note = taskNotes[taskKey];
      if (note) {
        note
          .split('\n')
          .map((noteLine) => noteLine.trim())
          .filter(Boolean)
          .forEach((noteLine) => lines.push(`        note: ${noteLine}`));
      }
      const link = taskLinks[taskKey];
      if (link) lines.push(`        link: ${link}`);
    });
  });
  return lines;
}
