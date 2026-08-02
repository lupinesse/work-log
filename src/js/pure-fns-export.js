/**
 * @file pure-fns-export.js
 * Entry/export/summary helpers: billable-export grouping and merging, day
 * bounds, grouped-line formatting, rolling summary, and backup retention.
 * Split out of pure-fns.js (re-exported there as a barrel). Pure functions
 * with no side-effects and no global state — a leaf ES module (imports only
 * from pure-fns-format.js).
 */

import { dk } from './pure-fns-format.js';

/* ── Export grouping ── */

/**
 * Removes a leading Jira issue key (e.g. `ABC-123: ` or `ABC-123 `) from a task
 * label, leaving the human-readable summary. Used when building the pasteable
 * billable summary so issue keys do not clutter the client-facing line.
 * @param {string} text - The raw task label.
 * @returns {string} The label with any leading Jira key stripped and trimmed.
 * @example
 * stripJiraPrefix('PROJ-42: Fix login')  // → 'Fix login'
 * stripJiraPrefix('Write tests')         // → 'Write tests'
 */
export function stripJiraPrefix(text) {
  if (!text || typeof text !== 'string') return text ?? '';
  return text.replace(/^[A-Z][A-Z0-9]*-\d+[:\s]\s*/, '').trim();
}

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
 *   `{ totalMs, tasks: { [taskKey]: { label, totalMs, hasTime } }, taskOrder }`.
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
      catGrouped[catKey].tasks[taskKey] = { label: entry.text, totalMs: 0, hasTime: false };
    }
    if (entry.tsEnd && entry.tsEnd > entry.ts) {
      const ms = entry.tsEnd - entry.ts;
      catGrouped[catKey].totalMs += ms;
      catGrouped[catKey].tasks[taskKey].totalMs += ms;
      catGrouped[catKey].tasks[taskKey].hasTime = true;
    }
  });
  return { catOrder, catGrouped };
}

/**
 * Merges same-task entries that are separated by no more than `gapMs` into a
 * single block, carrying the merged end time on a `_end` property.
 *
 * Two entries merge only when they share the same task text *and* the same
 * category (`tag`, with a missing tag normalised to `other`). Category is part
 * of the key so that two adjacent entries with the same label but different
 * categories are not collapsed — otherwise the later category would be lost from
 * the exported billable summary, which reads `tag` from the merged block.
 *
 * Rationale for the gap: the default 30-minute window matches the billing
 * rounding unit — splitting a task at a gap shorter than one slot would produce
 * two entries that each round to the same half-hour anyway, while making the
 * summary harder to read. Input is not mutated; entries are sorted by start time first.
 *
 * @param {Array<Object>} entries - Entries to merge (each with `ts`, optional `tsEnd`, `text`, `tag`).
 * @param {number} [gapMs=1800000] - Maximum gap, in ms, to bridge (default 30 min).
 * @returns {Array<Object>} New entry objects, each with a `_end` timestamp.
 */
export function mergeAdjacentEntries(entries, gapMs = 30 * 60000) {
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  const out = [];
  for (const entry of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.text.toLowerCase() === entry.text.toLowerCase() &&
      (prev.tag || 'other') === (entry.tag || 'other') &&
      entry.ts - (prev._end || prev.ts) <= gapMs
    ) {
      prev._end = Math.max(prev._end || prev.ts, entry.tsEnd || entry.ts);
    } else {
      out.push({ ...entry, _end: entry.tsEnd || entry.ts });
    }
  }
  return out;
}

/**
 * Builds the parts of the pasteable billable summary from merged billable
 * entries. Categorised tasks are grouped as `Category (task1, task2)`;
 * uncategorised tasks (no tag or `other`) are listed bare. Order of first
 * appearance is preserved and duplicate task names are de-duplicated.
 *
 * @param {Array<Object>} mergedEntries - Output of {@link mergeAdjacentEntries}.
 * @param {function(string): string} getCatLabel - Resolves a category key to its
 *   display label. Injected so this function stays free of global state.
 * @returns {string[]} Summary parts, ready to be joined with `, `.
 */
export function buildBillableSummaryParts(mergedEntries, getCatLabel) {
  const summaryOrder = [];
  const summaryGroups = {};
  const summaryUngrouped = [];
  mergedEntries.forEach((entry) => {
    const taskName = stripJiraPrefix(entry.text);
    if (!entry.tag || entry.tag === 'other') {
      if (!summaryUngrouped.includes(taskName)) summaryUngrouped.push(taskName);
    } else {
      if (!summaryGroups[entry.tag]) {
        summaryOrder.push(entry.tag);
        summaryGroups[entry.tag] = { label: getCatLabel(entry.tag), tasks: [] };
      }
      if (!summaryGroups[entry.tag].tasks.includes(taskName)) {
        summaryGroups[entry.tag].tasks.push(taskName);
      }
    }
  });
  return [
    ...summaryOrder.map(
      (key) => `${summaryGroups[key].label} (${summaryGroups[key].tasks.join(', ')})`
    ),
    ...summaryUngrouped,
  ];
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
 * Renders the grouped-by-category structure into indented text lines: one line
 * per category (with its total), each followed by its indented task lines and,
 * when the task carries a note, one or more further-indented `note:` lines.
 *
 * Pure: the duration formatter and category-label resolver are injected so this
 * function has no dependency on global state and can be unit-tested directly.
 *
 * @param {string[]} catOrder   - Category keys in display order.
 * @param {Object}   catGrouped - Grouping produced by {@link groupEntriesByCategory}.
 * @param {function(number): string} fmtDuration  - Formats a duration in ms (e.g. `fmtDurLong`).
 * @param {function(string): string} getCatLabel - Resolves a category key to its label.
 * @param {Object<string, string>} [taskNotes] - Map of lowercased task text to note,
 *   as produced by {@link buildTaskNoteMap}. Omitted tasks render with no note line.
 * @returns {string[]} The body lines for the export file.
 */
export function formatGroupedLines(catOrder, catGrouped, fmtDuration, getCatLabel, taskNotes = {}) {
  const lines = [];
  catOrder.forEach((catKey) => {
    const { totalMs, tasks, taskOrder } = catGrouped[catKey];
    const catTimeStr = totalMs > 0 ? fmtDuration(totalMs) : '--';
    lines.push(`${catTimeStr} - ${getCatLabel(catKey)}`);
    taskOrder.forEach((taskKey) => {
      const { label, totalMs: taskMs, hasTime } = tasks[taskKey];
      const taskTimeStr = hasTime ? fmtDuration(taskMs) : '--';
      lines.push(`    ${taskTimeStr} - ${label}`);
      const note = taskNotes[taskKey];
      if (note) {
        note
          .split('\n')
          .map((noteLine) => noteLine.trim())
          .filter(Boolean)
          .forEach((noteLine) => lines.push(`        note: ${noteLine}`));
      }
    });
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
      (e) => e.date === dateKey && e.tsEnd && e.signifier !== 'cancelled'
    );
    const totalMs = dayEntries.reduce((sum, e) => sum + (e.tsEnd - e.ts), 0);

    // Aggregate by task text; case-preserving, case-sensitive key so "Fix bug" and
    // "fix bug" remain separate entries (they were logged as distinct tasks).
    const byText = {};
    for (const e of dayEntries) {
      const key = e.text || '(untitled)';
      byText[key] = (byText[key] || 0) + (e.tsEnd - e.ts);
    }
    const topTasks = Object.entries(byText)
      .sort((a, b) => b[1] - a[1])
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
