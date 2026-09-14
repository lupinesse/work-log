/**
 * @file pure-fns-export.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 * Split further (issue: QA 2026-09-07, largest-module finding) into
 * pure-fns-gapreport.test.mjs, pure-fns-weeklyreport.test.mjs, and
 * pure-fns-backup.test.mjs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJiraLabel,
  groupEntriesByCategory,
  buildTimesheetSummaryLine,
  computeDayBounds,
  isWorkdayLikelyOver,
  buildTaskNoteMap,
  buildEntryNoteMap,
  buildEntryLinkMap,
  mergeNoteMaps,
} from '../../src/js/pure-fns.js';

describe('parseJiraLabel', () => {
  it('extracts ticket and name from "KEY-123: text"', () =>
    assert.deepEqual(parseJiraLabel('PROJ-42: Fix login'), {
      ticket: 'PROJ-42',
      name: 'Fix login',
    }));
  it('extracts ticket and name from "KEY-123 text" (space separator)', () =>
    assert.deepEqual(parseJiraLabel('ABC-7 Write docs'), { ticket: 'ABC-7', name: 'Write docs' }));
  it('extracts ticket and name from "KEY-123_text" (underscore separator)', () =>
    assert.deepEqual(parseJiraLabel('PROJ-1_task'), { ticket: 'PROJ-1', name: 'task' }));
  it('extracts ticket and name from "KEY-123-text" (dash separator)', () =>
    assert.deepEqual(parseJiraLabel('PROJ-1-task'), { ticket: 'PROJ-1', name: 'task' }));
  it('returns ticket only when no name follows', () =>
    assert.deepEqual(parseJiraLabel('PROJ-42'), { ticket: 'PROJ-42', name: '' }));
  it('returns null ticket for plain text', () =>
    assert.deepEqual(parseJiraLabel('Write tests'), { ticket: null, name: 'Write tests' }));
  it('does not match lowercase pseudo-keys', () =>
    assert.deepEqual(parseJiraLabel('proj-42: keep'), { ticket: null, name: 'proj-42: keep' }));
  it('returns empty string for empty input', () =>
    assert.deepEqual(parseJiraLabel(''), { ticket: null, name: '' }));
});

describe('groupEntriesByCategory', () => {
  it('groups by category and task, preserving first-seen order', () => {
    const entries = [
      { text: 'A', tag: 'work', ts: 0, tsEnd: 1000 },
      { text: 'B', tag: 'admin', ts: 2000, tsEnd: 3000 },
      { text: 'A', tag: 'work', ts: 4000, tsEnd: 5000 },
    ];
    const { catOrder, catGrouped } = groupEntriesByCategory(entries);
    assert.deepEqual([...catOrder], ['work', 'admin']);
    assert.deepEqual([...catGrouped.work.taskOrder], ['a']);
    assert.equal(catGrouped.work.totalMs, 2000);
    assert.equal(catGrouped.work.tasks.a.totalMs, 2000);
    assert.equal(catGrouped.work.tasks.a.label, 'A');
    assert.equal(catGrouped.work.tasks.a.hasTime, true);
  });

  it('records each tracked entry as its own session, unmerged', () => {
    const entries = [
      { text: 'A', tag: 'work', ts: 0, tsEnd: 1000 },
      { text: 'A', tag: 'work', ts: 2000, tsEnd: 4000 },
    ];
    const { catGrouped } = groupEntriesByCategory(entries);
    assert.deepEqual(
      [...catGrouped.work.tasks.a.sessions],
      [
        { ts: 0, tsEnd: 1000 },
        { ts: 2000, tsEnd: 4000 },
      ]
    );
  });

  it('leaves sessions empty for a task with no tracked time', () => {
    const { catGrouped } = groupEntriesByCategory([{ text: 'X', tag: 'work', ts: 100 }]);
    assert.deepEqual([...catGrouped.work.tasks.x.sessions], []);
  });

  it('treats a missing tag as "other"', () => {
    const { catOrder } = groupEntriesByCategory([{ text: 'X', ts: 0, tsEnd: 10 }]);
    assert.deepEqual([...catOrder], ['other']);
  });

  it('marks entries with no duration as hasTime=false and totalMs=0', () => {
    const { catGrouped } = groupEntriesByCategory([{ text: 'X', tag: 'work', ts: 100 }]);
    assert.equal(catGrouped.work.tasks.x.hasTime, false);
    assert.equal(catGrouped.work.totalMs, 0);
  });

  it('keeps the original-case label from the first occurrence', () => {
    const { catGrouped } = groupEntriesByCategory([
      { text: 'Task One', tag: 'work', ts: 0, tsEnd: 1 },
      { text: 'task one', tag: 'work', ts: 2, tsEnd: 3 },
    ]);
    assert.equal(catGrouped.work.tasks['task one'].label, 'Task One');
  });

  it('returns empty structures for no entries', () => {
    const { catOrder, catGrouped } = groupEntriesByCategory([]);
    assert.equal(catOrder.length, 0);
    assert.equal(Object.keys(catGrouped).length, 0);
  });
});

describe('buildTimesheetSummaryLine', () => {
  const HOUR = 3600000;
  const fmt = (ms) => `${ms}ms`;

  it('joins one "Label (duration)" item per distinct task with "; "', () => {
    const line = buildTimesheetSummaryLine(
      [
        { text: 'AITO-183656', ts: 0, tsEnd: 7 * HOUR },
        { text: '📅 Meeting', ts: 7 * HOUR, tsEnd: 7.5 * HOUR },
      ],
      fmt
    );
    assert.equal(line, `AITO-183656 (${7 * HOUR}ms); 📅 Meeting (${0.5 * HOUR}ms)`);
  });

  it('collapses a task worked in two separate sessions into one full-day total', () => {
    // Regression: two "AITO-183656" sessions with an unrelated "Meeting" entry
    // logged in between must still total to a single summary-line item, not
    // one item per session split by whatever happened between them.
    const line = buildTimesheetSummaryLine(
      [
        { text: 'AITO-183656', ts: 0, tsEnd: 4 * HOUR },
        { text: '📅 Meeting', ts: 4 * HOUR, tsEnd: 4.5 * HOUR, _billable: false },
        { text: 'AITO-183656', ts: 4.5 * HOUR, tsEnd: 7.5 * HOUR },
      ],
      fmt
    );
    assert.equal(line, `AITO-183656 (${7 * HOUR}ms); 📅 Meeting (${0.5 * HOUR}ms, internal)`);
  });

  it('marks non-billable entries as internal', () => {
    const line = buildTimesheetSummaryLine(
      [{ text: '📅 Meeting', ts: 0, tsEnd: HOUR, _billable: false }],
      fmt
    );
    assert.equal(line, `📅 Meeting (${HOUR}ms, internal)`);
  });

  it('does not treat billable (undefined or true) as internal', () => {
    const line = buildTimesheetSummaryLine(
      [{ text: 'A', ts: 0, tsEnd: HOUR, _billable: true }],
      fmt
    );
    assert.equal(line, `A (${HOUR}ms)`);
  });

  it('does not merge the same task text across different categories', () => {
    const line = buildTimesheetSummaryLine(
      [
        { text: 'Standup', tag: 'work', ts: 0, tsEnd: HOUR },
        { text: 'Standup', tag: 'dev', ts: HOUR, tsEnd: 2 * HOUR },
      ],
      fmt
    );
    assert.equal(line, `Standup (${HOUR}ms); Standup (${HOUR}ms)`);
  });

  it('does not merge the same task text across differing billable status', () => {
    const line = buildTimesheetSummaryLine(
      [
        { text: 'A', ts: 0, tsEnd: HOUR, _billable: true },
        { text: 'A', ts: HOUR, tsEnd: 2 * HOUR, _billable: false },
      ],
      fmt
    );
    assert.equal(line, `A (${HOUR}ms); A (${HOUR}ms, internal)`);
  });

  it('keeps the raw text including any Jira key — does not strip it', () => {
    const line = buildTimesheetSummaryLine(
      [{ text: 'PROJ-1: Fix login', ts: 0, tsEnd: HOUR }],
      fmt
    );
    assert.equal(line, `PROJ-1: Fix login (${HOUR}ms)`);
  });

  it('preserves first-seen order of distinct tasks', () => {
    const line = buildTimesheetSummaryLine(
      [
        { text: 'B', ts: HOUR, tsEnd: 2 * HOUR },
        { text: 'A', ts: 0, tsEnd: HOUR },
      ],
      fmt
    );
    assert.equal(line, `B (${HOUR}ms); A (${HOUR}ms)`);
  });

  it('returns an empty string for no entries', () =>
    assert.equal(buildTimesheetSummaryLine([], fmt), ''));
});

describe('computeDayBounds', () => {
  const base = { isViewingToday: false, dayStart: null, activeTimer: null, now: 0 };

  it('uses the supplied day start when viewing today', () => {
    const { dayStartTs } = computeDayBounds([{ ts: 5000 }], [], {
      ...base,
      isViewingToday: true,
      dayStart: 1000,
    });
    assert.equal(dayStartTs, 1000);
  });

  it('falls back to the earliest entry start when no day start is given', () => {
    const { dayStartTs } = computeDayBounds([{ ts: 5000 }, { ts: 2000 }], [], base);
    assert.equal(dayStartTs, 2000);
  });

  it('ignores the day start when not viewing today', () => {
    const { dayStartTs } = computeDayBounds([{ ts: 9000 }], [], {
      ...base,
      isViewingToday: false,
      dayStart: 1000,
    });
    assert.equal(dayStartTs, 9000);
  });

  it('takes the latest tracked end as the day end', () => {
    const timed = [
      { ts: 0, tsEnd: 3000 },
      { ts: 4000, tsEnd: 8000 },
    ];
    const { dayEndTs } = computeDayBounds(timed, timed, base);
    assert.equal(dayEndTs, 8000);
  });

  it('extends the end to a running timer using `now`', () => {
    const entries = [{ id: 't1', ts: 1000 }];
    const { dayEndTs } = computeDayBounds(entries, [], {
      ...base,
      isViewingToday: true,
      activeTimer: { entryId: 't1', paused: false, startTs: 1000 },
      now: 9999,
    });
    assert.equal(dayEndTs, 9999);
  });

  it('uses accumulated time for a paused timer', () => {
    const entries = [{ id: 't1', ts: 1000 }];
    const { dayEndTs } = computeDayBounds(entries, [], {
      ...base,
      isViewingToday: true,
      activeTimer: { entryId: 't1', paused: true, accumulatedMs: 2500 },
      now: 9999,
    });
    assert.equal(dayEndTs, 3500); // start (1000) + accumulated (2500)
  });

  it('returns null bounds for an empty day', () => {
    const { dayStartTs, dayEndTs } = computeDayBounds([], [], base);
    assert.equal(dayStartTs, null);
    assert.equal(dayEndTs, null);
  });
});

describe('isWorkdayLikelyOver', () => {
  const HOUR = 3600000;
  // sodTs is deliberately non-zero: 0 is falsy in JS, and a day-start of
  // exactly the Unix epoch is not a real input (getDayStart() only ever
  // returns null or a real Date.now()-based timestamp) — same convention
  // computeDayBounds() relies on for its own truthy-checked inputs.
  const SOD = 1_000_000;
  const base = { sodTs: SOD, eodTs: null, hasEntriesToday: true, now: SOD + 8 * HOUR };

  it('returns false when the day was never started', () => {
    assert.equal(isWorkdayLikelyOver({ ...base, sodTs: null }), false);
  });

  it('returns false when the day has already been ended', () => {
    assert.equal(isWorkdayLikelyOver({ ...base, eodTs: SOD + 5 * HOUR }), false);
  });

  it('returns false when there are no entries today', () => {
    assert.equal(isWorkdayLikelyOver({ ...base, hasEntriesToday: false }), false);
  });

  it('returns false before the default 8h threshold', () => {
    assert.equal(isWorkdayLikelyOver({ ...base, now: SOD + 7 * HOUR }), false);
  });

  it('returns true exactly at the default 8h threshold', () => {
    assert.equal(isWorkdayLikelyOver({ ...base, now: SOD + 8 * HOUR }), true);
  });

  it('returns true well past the threshold', () => {
    assert.equal(isWorkdayLikelyOver({ ...base, now: SOD + 10 * HOUR }), true);
  });

  it('respects a custom workdayHours', () => {
    assert.equal(isWorkdayLikelyOver({ ...base, now: SOD + 5 * HOUR, workdayHours: 6 }), false);
    assert.equal(isWorkdayLikelyOver({ ...base, now: SOD + 6 * HOUR, workdayHours: 6 }), true);
  });
});

describe('buildTaskNoteMap', () => {
  it('maps a task note by lowercased text for tasks dated the given day', () => {
    const planTasks = [{ id: '1', text: 'Fix Login', date: '2026-06-04', note: 'ticket PROJ-9' }];
    assert.deepEqual(buildTaskNoteMap(planTasks, '2026-06-04'), { 'fix login': 'ticket PROJ-9' });
  });

  it('excludes tasks dated a different day', () => {
    const planTasks = [{ id: '1', text: 'Fix Login', date: '2026-06-03', note: 'ticket PROJ-9' }];
    assert.deepEqual(buildTaskNoteMap(planTasks, '2026-06-04'), {});
  });

  it('excludes tasks with no note, an empty note, or a whitespace-only note', () => {
    const planTasks = [
      { id: '1', text: 'A', date: '2026-06-04' },
      { id: '2', text: 'B', date: '2026-06-04', note: '' },
      { id: '3', text: 'C', date: '2026-06-04', note: '   ' },
    ];
    assert.deepEqual(buildTaskNoteMap(planTasks, '2026-06-04'), {});
  });

  it('trims the note text', () => {
    const planTasks = [{ id: '1', text: 'Fix Login', date: '2026-06-04', note: '  spaced  ' }];
    assert.deepEqual(buildTaskNoteMap(planTasks, '2026-06-04'), { 'fix login': 'spaced' });
  });

  it('returns an empty object for an empty or missing planTasks array', () => {
    assert.deepEqual(buildTaskNoteMap([], '2026-06-04'), {});
    assert.deepEqual(buildTaskNoteMap(undefined, '2026-06-04'), {});
  });
});

describe('buildEntryNoteMap', () => {
  it('maps an entry note by lowercased task text', () => {
    const dayEntries = [{ id: '1', text: 'Fix Login', note: 'reproduced in staging' }];
    assert.deepEqual(buildEntryNoteMap(dayEntries), { 'fix login': 'reproduced in staging' });
  });

  it('excludes entries with no note, an empty note, or a whitespace-only note', () => {
    const dayEntries = [
      { id: '1', text: 'A' },
      { id: '2', text: 'B', note: '' },
      { id: '3', text: 'C', note: '   ' },
    ];
    assert.deepEqual(buildEntryNoteMap(dayEntries), {});
  });

  it('trims the note text', () => {
    const dayEntries = [{ id: '1', text: 'Fix Login', note: '  spaced  ' }];
    assert.deepEqual(buildEntryNoteMap(dayEntries), { 'fix login': 'spaced' });
  });

  it('joins notes from multiple entries sharing the same task text with a newline', () => {
    const dayEntries = [
      { id: '1', text: 'Fix Login', note: 'first pass' },
      { id: '2', text: 'fix login', note: 'second pass' },
    ];
    assert.deepEqual(buildEntryNoteMap(dayEntries), { 'fix login': 'first pass\nsecond pass' });
  });

  it('returns an empty object for an empty or missing entries array', () => {
    assert.deepEqual(buildEntryNoteMap([]), {});
    assert.deepEqual(buildEntryNoteMap(undefined), {});
  });
});

describe('buildEntryLinkMap', () => {
  it('maps an entry link by lowercased task text', () => {
    const dayEntries = [{ id: '1', text: 'Fix Login', link: 'T197797' }];
    assert.deepEqual(buildEntryLinkMap(dayEntries), { 'fix login': 'T197797' });
  });

  it('excludes entries with no link, an empty link, or a whitespace-only link', () => {
    const dayEntries = [
      { id: '1', text: 'A' },
      { id: '2', text: 'B', link: '' },
      { id: '3', text: 'C', link: '   ' },
    ];
    assert.deepEqual(buildEntryLinkMap(dayEntries), {});
  });

  it('trims the link text', () => {
    const dayEntries = [{ id: '1', text: 'Fix Login', link: '  T197797  ' }];
    assert.deepEqual(buildEntryLinkMap(dayEntries), { 'fix login': 'T197797' });
  });

  it('joins distinct links from multiple entries sharing a task text with ", "', () => {
    const dayEntries = [
      { id: '1', text: 'Update test steps', link: 'T197797' },
      { id: '2', text: 'update test steps', link: 'T197805' },
    ];
    assert.deepEqual(buildEntryLinkMap(dayEntries), {
      'update test steps': 'T197797, T197805',
    });
  });

  it('de-duplicates repeated links for the same task', () => {
    const dayEntries = [
      { id: '1', text: 'A', link: 'T1' },
      { id: '2', text: 'A', link: 'T1' },
    ];
    assert.deepEqual(buildEntryLinkMap(dayEntries), { a: 'T1' });
  });

  it('returns an empty object for an empty or missing entries array', () => {
    assert.deepEqual(buildEntryLinkMap([]), {});
    assert.deepEqual(buildEntryLinkMap(undefined), {});
  });
});

describe('mergeNoteMaps', () => {
  it('combines notes for the same key with a newline, `a` first', () => {
    assert.deepEqual(mergeNoteMaps({ x: 'from task' }, { x: 'from entry' }), {
      x: 'from task\nfrom entry',
    });
  });

  it('keeps keys unique to either map', () => {
    assert.deepEqual(mergeNoteMaps({ x: 'task note' }, { y: 'entry note' }), {
      x: 'task note',
      y: 'entry note',
    });
  });

  it('returns a copy of `a` when `b` is empty or missing', () => {
    assert.deepEqual(mergeNoteMaps({ x: 'task note' }, {}), { x: 'task note' });
    assert.deepEqual(mergeNoteMaps({ x: 'task note' }, undefined), { x: 'task note' });
  });

  it('returns `b` when `a` is empty', () => {
    assert.deepEqual(mergeNoteMaps({}, { x: 'entry note' }), { x: 'entry note' });
  });

  it('does not mutate either input map', () => {
    const a = { x: 'task note' };
    const b = { x: 'entry note' };
    mergeNoteMaps(a, b);
    assert.deepEqual(a, { x: 'task note' });
    assert.deepEqual(b, { x: 'entry note' });
  });
});
