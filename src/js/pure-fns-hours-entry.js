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

/**
 * Picks the timestamp recorded when a day is ended. Ending today stamps "now".
 * Ending an earlier day stamps the end of its last timed entry, or the end of
 * that calendar day when it has none — "now" would fall on a different day and
 * misreport when the viewed day finished.
 *
 * @param {Date} viewDay - The day being ended.
 * @param {Array<Object>} timedEntries - The ended day's entries, each with `tsEnd`.
 * @param {number} now - Current time as a Unix timestamp (ms).
 * @returns {number} Unix timestamp (ms) to store as the day's end.
 */
export function resolveEodTimestamp(viewDay, timedEntries, now) {
  if (viewDay.toDateString() === new Date(now).toDateString()) return now;
  if (timedEntries.length > 0) return Math.max(...timedEntries.map((entry) => entry.tsEnd));
  const endOfViewDay = new Date(viewDay);
  endOfViewDay.setHours(23, 59, 59, 999);
  return endOfViewDay.getTime();
}

/**
 * Selects the plan tasks to hand over at the end of a day: those dated that day,
 * not done, and actually worked on (a log entry for the same text exists that day).
 *
 * @param {string} dayKey - The ended day, `YYYY-MM-DD`.
 * @param {Array<Object>} entries - All log entries (`date`, `text`).
 * @param {Array<Object>} planTasks - All plan tasks (`date`, `status`, `text`).
 * @returns {Array<Object>} The unfinished tasks worked on that day.
 */
export function selectUnfinishedWorkedTasks(dayKey, entries, planTasks) {
  const normalise = (text) => text.toLowerCase().trim();
  const workedOnDay = new Set(
    entries
      .filter((entry) => entry.date === dayKey && entry.text)
      .map((entry) => normalise(entry.text))
  );
  return planTasks.filter(
    (task) =>
      task.date === dayKey && task.status !== 'done' && workedOnDay.has(normalise(task.text))
  );
}

/**
 * Selects the dev-changelog entries recorded on a given day.
 *
 * @param {Array<Object>} devLog - All dev-changelog entries (`date`).
 * @param {string} dayKey - The ended day, `YYYY-MM-DD`.
 * @returns {Array<Object>} Entries dated that day.
 */
export function selectDevChangesForDay(devLog, dayKey) {
  return devLog.filter((change) => change.date === dayKey);
}
