/**
 * @file pure-fns-export.js
 * Billable-export grouping and merging helpers: entries grouped by
 * category/task, the pasteable timesheet summary line, day bounds, and the
 * per-task note/link lookups the export body renders. The gap report,
 * weekly report draft, rolling summary, and backup helpers that used to live
 * here moved out to their own leaf modules (QA 2026-09-07, largest-module
 * finding) — see pure-fns-gapreport.js, pure-fns-weeklyreport.js,
 * pure-fns-rollingsummary.js, and pure-fns-backup.js. All are re-exported
 * together via the pure-fns.js barrel. Pure functions with no side-effects
 * and no global state — a leaf ES module with no dependencies of its own.
 */

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
