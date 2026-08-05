/**
 * @file pure-fns-export.js
 * Entry/export/summary helpers: billable-export grouping and merging, day
 * bounds, grouped-line formatting, rolling summary, and backup retention.
 * Split out of pure-fns.js (re-exported there as a barrel). Pure functions
 * with no side-effects and no global state — a leaf ES module (imports only
 * from pure-fns-format.js).
 */

import { dk, isLongRunningTimer } from './pure-fns-format.js';

/* ── Export grouping ── */

/**
 * Parses a task label into its Jira issue key and human-readable name.
 * Returns `ticket: null` when the label carries no leading Jira key.
 * @param {string} label - Raw task label, e.g. `'PROJ-42: Fix login'` or `'Write tests'`.
 * @returns {{ ticket: string|null, name: string }} Parsed parts.
 * @example
 * parseJiraLabel('PROJ-42: Fix login') // → { ticket: 'PROJ-42', name: 'Fix login' }
 * parseJiraLabel('Write tests')        // → { ticket: null, name: 'Write tests' }
 */
export function parseJiraLabel(label) {
  if (!label || typeof label !== 'string') return { ticket: null, name: label ?? '' };
  // eslint-disable-next-line security/detect-unsafe-regex -- linear match on a short task label: the [\s:_-]+ and .* groups are adjacent, not nested, so there is no catastrophic backtracking
  const m = label.match(/^([A-Z][A-Z0-9]*-\d+)([\s:_-]+(.*))?$/);
  if (!m) return { ticket: null, name: label };
  return { ticket: m[1], name: (m[3] || '').trim() };
}

/**
 * Groups a day's log entries by category and, within each category, by task
 * (case-insensitively), preserving first-seen order. Accumulates tracked time
 * (where `tsEnd > ts`) per task and per category.
 *
 * Pure data transform — reads only entry fields and performs no formatting, so
 * the caller decides how to render the durations and labels.
 *
 * @param {Array<Object>} dayEntries - Entries for the viewed day.
 * @returns {{catOrder: string[], catGrouped: Object}} `catOrder` is the list of
 *   category keys in first-seen order; `catGrouped[catKey]` is
 *   `{ totalMs, tasks: { [taskKey]: { label, totalMs, hasTime, sessions } }, taskOrder }`.
 *   `sessions` is the task's individual tracked `{ts, tsEnd}` pairs, in
 *   encounter order — kept separate (not merged) so a task worked in two
 *   sessions still shows both time ranges rather than one collapsed total.
 */
export function groupEntriesByCategory(dayEntries) {
  const catOrder = [];
  const catGrouped = {};
  dayEntries.forEach((entry) => {
    const catKey = entry.tag || 'other';
    const taskKey = entry.text.toLowerCase();
    if (!catGrouped[catKey]) {
      catOrder.push(catKey);
      catGrouped[catKey] = { totalMs: 0, tasks: {}, taskOrder: [] };
    }
    if (!catGrouped[catKey].tasks[taskKey]) {
      catGrouped[catKey].taskOrder.push(taskKey);
      catGrouped[catKey].tasks[taskKey] = {
        label: entry.text,
        totalMs: 0,
        hasTime: false,
        sessions: [],
      };
    }
    if (entry.tsEnd && entry.tsEnd > entry.ts) {
      const ms = entry.tsEnd - entry.ts;
      catGrouped[catKey].totalMs += ms;
      catGrouped[catKey].tasks[taskKey].totalMs += ms;
      catGrouped[catKey].tasks[taskKey].hasTime = true;
      catGrouped[catKey].tasks[taskKey].sessions.push({ ts: entry.ts, tsEnd: entry.tsEnd });
    }
  });
  return { catOrder, catGrouped };
}

/**
 * Builds the pasteable end-of-day summary line: one semicolon-separated
 * `Label (duration)` item per distinct task, each carrying its *full-day*
 * total — not per-session — so a task worked in two separate blocks (e.g.
 * 09:30–13:00 and 13:30–16:00) still collapses to one line with one total,
 * matching how a Jira worklog is checked against a ticket. The per-session
 * breakdown lives in the report body instead (see {@link formatGroupedLines}'s
 * `sessions` rendering) — this line's job is the checkable total, not the
 * timeline. Distinct tasks are kept in first-seen order; entries are grouped
 * by task text, category (`tag`, missing normalised to `other`), and
 * `_billable` status combined, so a task worked once billable and once
 * internal renders as two line items rather than one status silently
 * overwriting the other.
 *
 * Non-billable items are suffixed `, internal` so the billable/internal split
 * — already visible in the header totals — is also checkable at the level of
 * an individual line item.
 *
 * Unlike the grouped report body (whose task labels feed a client-facing
 * read), this line keeps the entry's raw text, Jira key included: the line's
 * job is proving logged hours against ticket worklogs, so the ticket key is
 * exactly the part that must stay visible.
 *
 * @param {Array<Object>} timedEntries - Timed entries (`ts`, `tsEnd`, `text`,
 *   optional `tag`), each optionally carrying a `_billable` flag (`false`
 *   renders as internal; anything else, including absent, renders as billable).
 * @param {function(number): string} fmtDuration - Formats a duration in ms
 *   (e.g. `fmtDurLong`). Injected so this function stays free of global state.
 * @returns {string} The summary line, or `''` when there are no entries.
 * @example
 * buildTimesheetSummaryLine(
 *   [
 *     { text: 'AITO-183656', ts: 0, tsEnd: 4 * 3600000 },
 *     { text: '📅 Meeting', ts: 4 * 3600000, tsEnd: 4.5 * 3600000, _billable: false },
 *     { text: 'AITO-183656', ts: 4.5 * 3600000, tsEnd: 7.5 * 3600000 },
 *   ],
 *   fmtDurLong
 * )
 * // → 'AITO-183656 (7h); 📅 Meeting (30min, internal)'
 */
export function buildTimesheetSummaryLine(timedEntries, fmtDuration) {
  const order = [];
  const totals = {};
  timedEntries.forEach((entry) => {
    const key = `${entry.tag || 'other'} ${entry.text.toLowerCase()} ${entry._billable}`;
    if (!totals[key]) {
      order.push(key);
      totals[key] = { text: entry.text, billable: entry._billable, ms: 0 };
    }
    totals[key].ms += entry.tsEnd - entry.ts;
  });
  return order
    .map((key) => {
      const { text, billable, ms } = totals[key];
      const suffix = billable === false ? ', internal' : '';
      return `${text} (${fmtDuration(ms)}${suffix})`;
    })
    .join('; ');
}

/**
 * Computes the day's start and end timestamps for the plaintext export header.
 *
 * Start: the supplied day start (today only) or, failing that, the earliest
 * entry start. End: the latest tracked end among timed entries, extended by the
 * active timer's effective end so "Ended:" reflects work still in progress.
 *
 * Pure: all environmental inputs (day start, the active timer, the current time)
 * are injected via `opts` so the function can be unit-tested without globals.
 *
 * @param {Array<Object>} dayEntries   - All entries for the viewed day.
 * @param {Array<Object>} timedEntries - Entries with a real tracked duration (`tsEnd`).
 * @param {Object} opts                - Injected environment.
 * @param {boolean} opts.isViewingToday - Whether the viewed day is today.
 * @param {number|null} opts.dayStart   - Configured day-start ts, or null if not today.
 * @param {Object|null} opts.activeTimer - The running/paused timer, or null.
 * @param {number} opts.now             - Current time in ms (`Date.now()`).
 * @returns {{dayStartTs: (number|null), dayEndTs: (number|null)}} Day bounds in ms.
 */
export function computeDayBounds(dayEntries, timedEntries, opts) {
  const { isViewingToday, dayStart, activeTimer, now } = opts;
  let dayStartTs = isViewingToday ? dayStart : null;
  if (!dayStartTs && dayEntries.length) {
    dayStartTs = Math.min(...dayEntries.map((entry) => entry.ts));
  }
  let dayEndTs = timedEntries.length ? Math.max(...timedEntries.map((entry) => entry.tsEnd)) : null;
  // Factor in the active timer's effective end so "Ended:" reflects live work
  if (activeTimer && isViewingToday) {
    const timerEntry = dayEntries.find((entry) => entry.id === activeTimer.entryId);
    if (timerEntry) {
      const liveEnd = activeTimer.paused
        ? timerEntry.ts + (activeTimer.accumulatedMs || 0) // paused → start + accumulated
        : Math.max(now, activeTimer.startTs || timerEntry.ts); // running → now (or startTs if test setup is ahead of wall clock)
      dayEndTs = dayEndTs ? Math.max(dayEndTs, liveEnd) : liveEnd;
    }
  }
  return { dayStartTs, dayEndTs };
}

/**
 * Returns true if today's workday looks like it may be over and hasn't been
 * exported yet: the day was started, has at least one entry, hasn't already
 * been ended, and `workdayHours` have passed since it started. Used to show
 * a reminder nudging the user toward "end the day" (which triggers the real
 * export) — this function only decides whether to nudge, it never exports
 * or ends the day itself.
 *
 * Pure: all environmental inputs (day-start/day-end timestamps, whether
 * today has entries, the current time) are injected via `opts` so the
 * function can be unit-tested without touching localStorage or Date.now(),
 * matching {@link computeDayBounds}'s style.
 *
 * @param {Object} opts
 * @param {number|null} opts.sodTs - Today's day-start timestamp (ms), or null if not started.
 * @param {number|null} opts.eodTs - Today's day-end timestamp (ms), or null if not yet ended.
 * @param {boolean} opts.hasEntriesToday - Whether at least one entry exists for today.
 * @param {number} opts.now - Current time in ms.
 * @param {number} [opts.workdayHours=8] - Hours after day-start to consider the day likely over.
 * @returns {boolean} True if the reminder should be shown.
 * @example
 * isWorkdayLikelyOver({ sodTs: 1000, eodTs: null, hasEntriesToday: true, now: 1000 + 8 * 3600000 })
 * // → true (exactly 8h after day-start)
 * isWorkdayLikelyOver({ sodTs: 1000, eodTs: null, hasEntriesToday: true, now: 1000 + 7 * 3600000 })
 * // → false (only 7h in)
 * isWorkdayLikelyOver({ sodTs: null, eodTs: null, hasEntriesToday: true, now: 999999 })
 * // → false (day never started)
 */
export function isWorkdayLikelyOver({ sodTs, eodTs, hasEntriesToday, now, workdayHours = 8 }) {
  if (!sodTs || eodTs || !hasEntriesToday) return false;
  return now >= sodTs + workdayHours * 60 * 60 * 1000;
}

/**
 * Builds a lookup of task notes for a single day, keyed by lowercased task
 * text so it lines up with the task keys produced by
 * {@link groupEntriesByCategory}. Only tasks dated `dateKey` with a non-blank
 * `note` are included.
 *
 * Task/entry linkage is by date + case-insensitive text match — the same
 * convention `addEntry` and `flatSort` already use to find a task's plan row —
 * because plan tasks and log entries share no `taskId` field.
 *
 * @param {Array<Object>} planTasks - All plan/board tasks.
 * @param {string} dateKey - The exported day's date key (YYYY-MM-DD).
 * @returns {Object<string, string>} Map of lowercased task text to trimmed note.
 * @example
 * buildTaskNoteMap(
 *   [{ text: 'Fix login', date: '2026-06-04', note: 'waiting on staging creds' }],
 *   '2026-06-04'
 * )
 * // → { 'fix login': 'waiting on staging creds' }
 */
export function buildTaskNoteMap(planTasks, dateKey) {
  const notes = {};
  (planTasks || []).forEach((task) => {
    if (task.date !== dateKey) return;
    const note = task.note && task.note.trim();
    if (!note) return;
    notes[task.text.toLowerCase()] = note;
  });
  return notes;
}

/**
 * Builds a lookup of entry-level notes for a single day, keyed by lowercased
 * task text so it lines up with {@link buildTaskNoteMap} and the task keys
 * produced by {@link groupEntriesByCategory}. Entry notes are written at the
 * time the work happens (unlike a plan task's note, which describes the task
 * in general), so multiple entries sharing a task text each contribute their
 * own note line rather than overwriting one another.
 *
 * @param {Array<Object>} dayEntries - Entries for the exported day.
 * @returns {Object<string, string>} Map of lowercased task text to
 *   newline-joined notes, one line per entry that carries a note.
 * @example
 * buildEntryNoteMap([{ text: 'Fix login', note: 'reproduced in staging' }])
 * // → { 'fix login': 'reproduced in staging' }
 */
export function buildEntryNoteMap(dayEntries) {
  const notes = {};
  (dayEntries || []).forEach((entry) => {
    const note = entry.note && entry.note.trim();
    if (!note) return;
    const key = entry.text.toLowerCase();
    notes[key] = notes[key] ? `${notes[key]}\n${note}` : note;
  });
  return notes;
}

/**
 * Combines two task-keyed note maps — e.g. plan-task notes and entry notes —
 * into one, concatenating notes for the same key with a newline so both
 * survive as separate `note:` lines in the exported text (see
 * {@link formatGroupedLines}, which splits each map value on `\n`).
 *
 * @param {Object<string, string>} a - First note map (rendered first).
 * @param {Object<string, string>} b - Second note map, appended after `a`.
 * @returns {Object<string, string>} Combined map.
 * @example
 * mergeNoteMaps({ x: 'from task' }, { x: 'from entry' })
 * // → { x: 'from task\nfrom entry' }
 */
export function mergeNoteMaps(a, b) {
  const merged = { ...a };
  Object.entries(b || {}).forEach(([key, note]) => {
    merged[key] = merged[key] ? `${merged[key]}\n${note}` : note;
  });
  return merged;
}

/**
 * Builds a lookup of proof links for a single day, keyed by lowercased task
 * text so it lines up with {@link buildEntryNoteMap} and the task keys
 * produced by {@link groupEntriesByCategory}. Unlike notes (free text, one
 * line per entry), links are short reference codes — Zephyr keys, Confluence
 * pages, ticket URLs — so multiple links for the same task are deduplicated
 * and joined onto a single comma-separated line rather than one per entry.
 *
 * @param {Array<Object>} dayEntries - Entries for the exported day.
 * @returns {Object<string, string>} Map of lowercased task text to a
 *   comma-separated, deduplicated list of that task's proof links.
 * @example
 * buildEntryLinkMap([
 *   { text: 'Update test steps', link: 'T197797' },
 *   { text: 'Update test steps', link: 'T197805' },
 * ])
 * // → { 'update test steps': 'T197797, T197805' }
 */
export function buildEntryLinkMap(dayEntries) {
  const linksByTask = {};
  (dayEntries || []).forEach((entry) => {
    const link = entry.link && entry.link.trim();
    if (!link) return;
    const key = entry.text.toLowerCase();
    if (!linksByTask[key]) linksByTask[key] = [];
    if (!linksByTask[key].includes(link)) linksByTask[key].push(link);
  });
  return Object.fromEntries(
    Object.entries(linksByTask).map(([key, links]) => [key, links.join(', ')])
  );
}

/* ── Gap report ── */

// Utility entries logged via logUtilEntry() in 03-timer.js — never carry
// documentation, so they'd just be noise in the gap report.
const GAP_REPORT_UTILITY_TEXTS = new Set(['☕ Break', '🥪 Lunch', '📅 Meeting']);

/**
 * Finds finished, non-cancelled work entries within `[weekStart, weekEnd)`
 * that have neither a proof link nor a note — candidates for the
 * end-of-week gap report. Uses the same "finished and not cancelled" filter
 * as every other report/aggregation in this codebase ({@link buildRollingSummary},
 * `findLargestGap` in `11-timeflow.js`, `exportTxt`'s billable summary), plus
 * excludes break/lunch/meeting utility entries which never need documentation.
 *
 * @param {Array<Object>} entries - All log entries.
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
        !(entry.link && entry.link.trim()) &&
        !(entry.note && entry.note.trim())
    )
    .sort((entryA, entryB) => entryA.ts - entryB.ts);
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
 * does.
 *
 * Pure: the duration formatter is injected (same convention as
 * {@link formatGroupedLines}) so this has no dependency on global state.
 *
 * @param {Array<Object>} dayEntries - All entries for the exported day.
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

/* ── Weekly report draft ── */

/** Sentinel ticket key for entries whose text carries no parseable Jira prefix. */
export const WEEKLY_REPORT_NO_TICKET_KEY = '__no_ticket__';

/**
 * Groups a week's finished, non-cancelled, non-utility entries by Jira ticket
 * key (via {@link parseJiraLabel}), then by task name within each ticket —
 * the data layer behind the weekly report draft. Entries with no parseable
 * ticket prefix fall into the {@link WEEKLY_REPORT_NO_TICKET_KEY} bucket,
 * sub-grouped by their own task text so untracked work stays legible rather
 * than collapsing into one opaque blob.
 *
 * Uses the same "finished, not cancelled, in-window" filter as
 * {@link findGapReportEntries} (whose `GAP_REPORT_UTILITY_TEXTS` exclusion
 * it also reuses — break/lunch/meeting entries never belong in a status
 * report any more than they belong in the gap report).
 *
 * @param {Array<Object>} entries - All log entries.
 * @param {number} weekStart - Inclusive week-start timestamp in ms (e.g. Monday 00:00).
 * @param {number} weekEnd - Exclusive week-end timestamp in ms (e.g. the following Monday 00:00).
 * @returns {{
 *   ticketOrder: string[],
 *   grouped: Object<string, {
 *     totalMs: number,
 *     nameOrder: string[],
 *     names: Object<string, {label: string, totalMs: number}>,
 *     notes: string[],
 *     links: string[]
 *   }>
 * }} `ticketOrder` lists real ticket keys sorted by total time descending,
 *   with the no-ticket bucket (if present) always last regardless of its
 *   total — it is a catch-all, not a reportable line item.
 * @example
 * buildWeeklyTicketSummary(
 *   [{ id: '1', text: 'PROJ-1: Fix login', ts: 100, tsEnd: 3700, date: '2026-06-01' }],
 *   0, 604800000
 * )
 * // → { ticketOrder: ['PROJ-1'], grouped: { 'PROJ-1': { totalMs: 3600, ... } } }
 */
export function buildWeeklyTicketSummary(entries, weekStart, weekEnd) {
  const grouped = {};
  (entries || [])
    .filter(
      (entry) =>
        entry.tsEnd &&
        entry.signifier !== 'cancelled' &&
        entry.ts >= weekStart &&
        entry.ts < weekEnd &&
        !GAP_REPORT_UTILITY_TEXTS.has(entry.text)
    )
    .forEach((entry) => {
      const { ticket, name } = parseJiraLabel(entry.text);
      const ticketKey = ticket || WEEKLY_REPORT_NO_TICKET_KEY;
      const nameKey = name.toLowerCase();
      const ms = entry.tsEnd - entry.ts;

      if (!grouped[ticketKey]) {
        grouped[ticketKey] = { totalMs: 0, nameOrder: [], names: {}, notes: [], links: [] };
      }
      const bucket = grouped[ticketKey];

      if (!bucket.names[nameKey]) {
        bucket.nameOrder.push(nameKey);
        bucket.names[nameKey] = { label: name, totalMs: 0 };
      }
      bucket.totalMs += ms;
      bucket.names[nameKey].totalMs += ms;

      const note = entry.note && entry.note.trim();
      if (note && !bucket.notes.includes(note)) bucket.notes.push(note);
      const link = entry.link && entry.link.trim();
      if (link && !bucket.links.includes(link)) bucket.links.push(link);
    });

  const ticketOrder = Object.keys(grouped)
    .filter((key) => key !== WEEKLY_REPORT_NO_TICKET_KEY)
    .sort((ticketKeyA, ticketKeyB) => grouped[ticketKeyB].totalMs - grouped[ticketKeyA].totalMs);
  // The no-ticket bucket is a catch-all grouping, not a reportable ticket —
  // it always sorts last regardless of its total time, even if that time
  // exceeds a real ticket's.
  if (grouped[WEEKLY_REPORT_NO_TICKET_KEY]) ticketOrder.push(WEEKLY_REPORT_NO_TICKET_KEY);

  return { ticketOrder, grouped };
}

/**
 * Renders the structure produced by {@link buildWeeklyTicketSummary} into
 * text lines: one header line per ticket (with its total), each followed by
 * an indented bullet per distinct task name (with its own subtotal) and any
 * collected `note:`/`link:` lines — same indentation convention as
 * {@link formatGroupedLines}. Ticket blocks are separated by a blank line.
 *
 * Pure: the duration formatter is injected so this has no dependency on
 * global state and can be unit-tested directly.
 *
 * @param {string[]} ticketOrder - Ticket keys in display order.
 * @param {Object} grouped - Grouping produced by {@link buildWeeklyTicketSummary}.
 * @param {function(number): string} fmtDuration - Formats a duration in ms (e.g. `fmtDurLong`).
 * @returns {string[]} The report body lines; empty when `ticketOrder` is empty.
 */
export function formatWeeklyTicketSummaryText(ticketOrder, grouped, fmtDuration) {
  const lines = [];
  ticketOrder.forEach((ticketKey, index) => {
    if (index > 0) lines.push('');
    const { totalMs, nameOrder, names, notes, links } = grouped[ticketKey];
    const ticketLabel = ticketKey === WEEKLY_REPORT_NO_TICKET_KEY ? 'No ticket' : ticketKey;
    lines.push(`${ticketLabel} — ${fmtDuration(totalMs)}`);
    nameOrder.forEach((nameKey) => {
      const { label, totalMs: nameMs } = names[nameKey];
      lines.push(label ? `    ${fmtDuration(nameMs)} - ${label}` : `    ${fmtDuration(nameMs)}`);
    });
    notes.forEach((note) => lines.push(`    note: ${note}`));
    links.forEach((link) => lines.push(`    link: ${link}`));
  });
  return lines;
}

/* ── Rolling summary ── */

/**
 * Computes a rolling per-day summary for a set of date keys.
 *
 * All data dependencies are injected so the function is pure and unit-testable
 * without any browser globals or localStorage access.
 *
 * @param {string[]} dateKeys - Date keys (YYYY-MM-DD) to summarise, most recent first.
 * @param {object} opts
 * @param {object[]} opts.entries - All work-log entries.
 * @param {Function} opts.getDayStartTs - `(dateKey: string) => number|null` — SOD timestamp.
 * @param {Function} opts.getDayEodTs - `(dateKey: string) => number|null` — EOD timestamp.
 * @param {Function} opts.getLocationEmoji - `(dateKey: string) => string` — location emoji char.
 * @returns {Array<{
 *   dateKey: string,
 *   locationEmoji: string,
 *   sodTs: number|null,
 *   eodTs: number|null,
 *   totalMs: number,
 *   topTasks: Array<{text: string, totalMs: number}>
 * }>}
 * @example
 * buildRollingSummary(['2026-06-04'], {
 *   entries: [{ date: '2026-06-04', text: 'Write code', ts: 1000, tsEnd: 4600000, signifier: '' }],
 *   getDayStartTs: () => 1000,
 *   getDayEodTs: () => null,
 *   getLocationEmoji: () => '🏠',
 * })
 * // → [{ dateKey: '2026-06-04', locationEmoji: '🏠', sodTs: 1000, eodTs: null,
 * //      totalMs: 4599000, topTasks: [{ text: 'Write code', totalMs: 4599000 }] }]
 */
export function buildRollingSummary(dateKeys, opts) {
  const { entries, getDayStartTs, getDayEodTs, getLocationEmoji } = opts;
  return dateKeys.map((dateKey) => {
    const dayEntries = entries.filter(
      (entry) => entry.date === dateKey && entry.tsEnd && entry.signifier !== 'cancelled'
    );
    const totalMs = dayEntries.reduce((sum, entry) => sum + (entry.tsEnd - entry.ts), 0);

    // Aggregate by task text; case-preserving, case-sensitive key so "Fix bug" and
    // "fix bug" remain separate entries (they were logged as distinct tasks).
    const byText = {};
    for (const e of dayEntries) {
      const key = e.text || '(untitled)';
      byText[key] = (byText[key] || 0) + (e.tsEnd - e.ts);
    }
    const topTasks = Object.entries(byText)
      .sort((pairA, pairB) => pairB[1] - pairA[1])
      .slice(0, 3)
      .map(([text, ms]) => ({ text, totalMs: ms }));

    return {
      dateKey,
      locationEmoji: getLocationEmoji(dateKey),
      sodTs: getDayStartTs(dateKey),
      eodTs: getDayEodTs(dateKey),
      totalMs,
      topTasks,
    };
  });
}

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
