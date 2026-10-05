/**
 * @file pure-fns-hours-entry.js
 * Builds the single daily entry that "End day" submits to the external hours
 * system. Pure functions with no side-effects and no global
 * state — a leaf ES module with no dependencies of its own.
 */

/** Milliseconds in one hour, for converting tracked time to timesheet hours. */
const MS_PER_HOUR = 3600000;

/**
 * Builds the draft timesheet description in the house style: one
 * `activity (task, task)` group per category in first-seen order, groups
 * comma-separated, no durations — e.g.
 * `ticket review (AITO-1, AITO-2), meeting (FUAT bi-daily)`. The activity
 * wording a person writes by hand ("UAT preparation and test design") is not
 * in the log, so the category label stands in for it and the caller offers the
 * draft for editing. Task labels keep their Jira key because that is what a
 * reader checks against the ticket; they are de-duplicated case-insensitively
 * within a group so a task worked in two blocks appears once.
 *
 * @param {Array<Object>} timedEntries - The day's tracked entries (`text`, optional
 *   `tag`); a missing `tag` is treated as `other`.
 * @param {function(string): string} categoryLabel - Maps a category id to its
 *   display label (e.g. `getCatLabel`). Injected to keep this module state-free.
 * @returns {string} The draft description, or `''` when there are no entries.
 * @example
 * buildTimesheetDescription(
 *   [{ text: 'AITO-1', tag: 'review' }, { text: 'AITO-2', tag: 'review' }, { text: 'FUAT', tag: 'meeting' }],
 *   (id) => id
 * )
 * // → 'review (AITO-1, AITO-2), meeting (FUAT)'
 */
export function buildTimesheetDescription(timedEntries, categoryLabel) {
  const groups = new Map();
  timedEntries.forEach((entry) => {
    const text = (entry.text || '').trim();
    if (!text) return;
    const tag = entry.tag || 'other';
    if (!groups.has(tag)) groups.set(tag, new Map());
    const tasks = groups.get(tag);
    if (!tasks.has(text.toLowerCase())) tasks.set(text.toLowerCase(), text);
  });
  return [...groups]
    .map(([tag, tasks]) => `${categoryLabel(tag)} (${[...tasks.values()].join(', ')})`)
    .join(', ');
}

/**
 * Builds the one whole-day timesheet entry: the date, total tracked hours
 * (rounded to two decimals, as timesheet forms take decimal hours) and the
 * description from {@link buildTimesheetDescription}. All tracked time counts,
 * billable or internal, because the timesheet records the full working day.
 *
 * @param {string} dateKey - Day being submitted, `YYYY-MM-DD`.
 * @param {Array<Object>} timedEntries - The day's entries (`text`, optional `tag`,
 *   `ts`, `tsEnd`) with a positive tracked duration.
 * @param {function(string): string} categoryLabel - Category id → display label.
 * @returns {{date: string, hours: number, description: string}|null} The entry,
 *   or `null` when nothing was tracked (so the caller can skip submitting).
 */
export function buildTimesheetDayPayload(dateKey, timedEntries, categoryLabel) {
  const totalMs = timedEntries.reduce((sum, entry) => sum + (entry.tsEnd - entry.ts), 0);
  if (totalMs <= 0) return null;
  return {
    date: dateKey,
    hours: Math.round((totalMs / MS_PER_HOUR) * 100) / 100,
    description: buildTimesheetDescription(timedEntries, categoryLabel),
  };
}

/**
 * Checks a timesheet entry before it is sent anywhere. Shared by the browser
 * form and scripts/lib/eod-automation.mjs so both reject the same inputs.
 *
 * @param {Object} entry - Candidate entry with `date` (`YYYY-MM-DD`), `hours`
 *   (number, > 0 and ≤ 24) and `description` (non-blank string).
 * @returns {string|null} A message naming the first problem, or `null` when valid.
 */
export function findTimesheetEntryProblem(entry) {
  if (typeof entry?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    return 'Timesheet entry needs a date in YYYY-MM-DD format';
  }
  if (!Number.isFinite(entry.hours) || entry.hours <= 0 || entry.hours > 24) {
    return 'Timesheet entry needs hours greater than 0 and at most 24';
  }
  if (typeof entry.description !== 'string' || !entry.description.trim()) {
    return 'Timesheet entry needs a non-empty description';
  }
  return null;
}
