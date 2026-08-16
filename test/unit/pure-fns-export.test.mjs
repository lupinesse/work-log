/**
 * @file pure-fns-export.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dk,
  parseJiraLabel,
  groupEntriesByCategory,
  buildTimesheetSummaryLine,
  computeDayBounds,
  isWorkdayLikelyOver,
  buildTaskNoteMap,
  buildEntryNoteMap,
  buildEntryLinkMap,
  mergeNoteMaps,
  formatGroupedLines,
  findExportWarnings,
  buildRollingSummary,
  applyBackupRetention,
  buildBackupPayload,
  findGapReportEntries,
  WEEKLY_REPORT_NO_TICKET_KEY,
  buildWeeklyTicketSummary,
  formatWeeklyTicketSummaryText,
} from '../../src/js/pure-fns.js';
import { localMs } from './_helpers.mjs';

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

describe('formatGroupedLines', () => {
  const fmt = (ms) => `${ms}ms`;
  const label = (tag) => `[${tag}]`;

  it('renders a category header line followed by indented task lines', () => {
    const catGrouped = {
      work: {
        totalMs: 3000,
        taskOrder: ['a', 'b'],
        tasks: {
          a: { label: 'Task A', totalMs: 1000, hasTime: true },
          b: { label: 'Task B', totalMs: 2000, hasTime: true },
        },
      },
    };
    const lines = formatGroupedLines(['work'], catGrouped, fmt, label);
    assert.deepEqual([...lines], ['3000ms - [work]', '    1000ms - Task A', '    2000ms - Task B']);
  });

  it('shows -- for categories and tasks with no tracked time', () => {
    const catGrouped = {
      admin: {
        totalMs: 0,
        taskOrder: ['x'],
        tasks: { x: { label: 'Untimed', totalMs: 0, hasTime: false } },
      },
    };
    const lines = formatGroupedLines(['admin'], catGrouped, fmt, label);
    assert.deepEqual([...lines], ['-- - [admin]', '    -- - Untimed']);
  });

  it('returns no lines for an empty category order', () =>
    assert.equal(formatGroupedLines([], {}, fmt, label).length, 0));

  it('appends a note line under a task that has a matching entry in taskNotes', () => {
    const catGrouped = {
      work: {
        totalMs: 1000,
        taskOrder: ['a'],
        tasks: { a: { label: 'Task A', totalMs: 1000, hasTime: true } },
      },
    };
    const lines = formatGroupedLines(['work'], catGrouped, fmt, label, { a: 'waiting on review' });
    assert.deepEqual(
      [...lines],
      ['1000ms - [work]', '    1000ms - Task A', '        note: waiting on review']
    );
  });

  it('renders one note line per non-blank line of a multi-line note', () => {
    const catGrouped = {
      work: {
        totalMs: 1000,
        taskOrder: ['a'],
        tasks: { a: { label: 'Task A', totalMs: 1000, hasTime: true } },
      },
    };
    const lines = formatGroupedLines(['work'], catGrouped, fmt, label, {
      a: 'first point\n\n  second point  ',
    });
    assert.deepEqual(
      [...lines],
      [
        '1000ms - [work]',
        '    1000ms - Task A',
        '        note: first point',
        '        note: second point',
      ]
    );
  });

  it('omits the note line for tasks absent from taskNotes', () => {
    const catGrouped = {
      work: {
        totalMs: 1000,
        taskOrder: ['a'],
        tasks: { a: { label: 'Task A', totalMs: 1000, hasTime: true } },
      },
    };
    const lines = formatGroupedLines(['work'], catGrouped, fmt, label, { b: 'unrelated note' });
    assert.deepEqual([...lines], ['1000ms - [work]', '    1000ms - Task A']);
  });

  it('defaults to no notes when taskNotes is omitted', () => {
    const catGrouped = {
      work: {
        totalMs: 1000,
        taskOrder: ['a'],
        tasks: { a: { label: 'Task A', totalMs: 1000, hasTime: true } },
      },
    };
    const lines = formatGroupedLines(['work'], catGrouped, fmt, label);
    assert.deepEqual([...lines], ['1000ms - [work]', '    1000ms - Task A']);
  });

  it('renders one time-range line per session when fmtSessionRange is given', () => {
    const catGrouped = {
      work: {
        totalMs: 3000,
        taskOrder: ['a'],
        tasks: {
          a: {
            label: 'Task A',
            totalMs: 3000,
            hasTime: true,
            sessions: [
              { ts: 0, tsEnd: 1000 },
              { ts: 2000, tsEnd: 4000 },
            ],
          },
        },
      },
    };
    const fmtRange = (s) => `${s.ts}-${s.tsEnd}`;
    const lines = formatGroupedLines(['work'], catGrouped, fmt, label, {}, {}, fmtRange);
    assert.deepEqual(
      [...lines],
      ['3000ms - [work]', '    3000ms - Task A', '        0-1000', '        2000-4000']
    );
  });

  it('omits session lines when fmtSessionRange is not given, even if sessions exist', () => {
    const catGrouped = {
      work: {
        totalMs: 1000,
        taskOrder: ['a'],
        tasks: {
          a: { label: 'Task A', totalMs: 1000, hasTime: true, sessions: [{ ts: 0, tsEnd: 1000 }] },
        },
      },
    };
    const lines = formatGroupedLines(['work'], catGrouped, fmt, label);
    assert.deepEqual([...lines], ['1000ms - [work]', '    1000ms - Task A']);
  });

  it('appends a link line under a task that has a matching entry in taskLinks', () => {
    const catGrouped = {
      work: {
        totalMs: 1000,
        taskOrder: ['a'],
        tasks: { a: { label: 'Task A', totalMs: 1000, hasTime: true } },
      },
    };
    const lines = formatGroupedLines(
      ['work'],
      catGrouped,
      fmt,
      label,
      {},
      { a: 'T197797, T197805' }
    );
    assert.deepEqual(
      [...lines],
      ['1000ms - [work]', '    1000ms - Task A', '        link: T197797, T197805']
    );
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

describe('findGapReportEntries', () => {
  const WEEK_START = localMs(2026, 6, 1); // Monday
  const WEEK_END = localMs(2026, 6, 8); // following Monday
  const base = {
    id: '1',
    text: 'Fix login',
    ts: localMs(2026, 6, 3, 10, 0),
    tsEnd: localMs(2026, 6, 3, 11, 0),
    date: '2026-06-03',
  };

  it('includes a finished entry with neither a link nor a note', () => {
    assert.deepEqual(findGapReportEntries([base], WEEK_START, WEEK_END), [base]);
  });

  it('excludes an entry with only a link', () => {
    assert.deepEqual(
      findGapReportEntries([{ ...base, link: 'https://confluence/123' }], WEEK_START, WEEK_END),
      []
    );
  });

  it('excludes an entry with only a note', () => {
    assert.deepEqual(
      findGapReportEntries([{ ...base, note: 'did the thing' }], WEEK_START, WEEK_END),
      []
    );
  });

  it('excludes an entry with both a link and a note', () => {
    assert.deepEqual(
      findGapReportEntries(
        [{ ...base, link: 'PROJ-1', note: 'did the thing' }],
        WEEK_START,
        WEEK_END
      ),
      []
    );
  });

  it('excludes an entry whose link/note is whitespace-only', () => {
    assert.deepEqual(
      findGapReportEntries([{ ...base, link: '   ', note: '  ' }], WEEK_START, WEEK_END),
      [{ ...base, link: '   ', note: '  ' }]
    );
  });

  it('excludes a cancelled entry', () => {
    assert.deepEqual(
      findGapReportEntries([{ ...base, signifier: 'cancelled' }], WEEK_START, WEEK_END),
      []
    );
  });

  it('excludes an unfinished entry (no tsEnd)', () => {
    const running = { ...base };
    delete running.tsEnd;
    assert.deepEqual(findGapReportEntries([running], WEEK_START, WEEK_END), []);
  });

  for (const text of ['☕ Break', '🥪 Lunch', '📅 Meeting']) {
    it(`excludes a "${text}" utility entry`, () => {
      assert.deepEqual(findGapReportEntries([{ ...base, text }], WEEK_START, WEEK_END), []);
    });
  }

  it('excludes entries before weekStart', () => {
    assert.deepEqual(
      findGapReportEntries([{ ...base, ts: WEEK_START - 1 }], WEEK_START, WEEK_END),
      []
    );
  });

  it('excludes entries at or after weekEnd', () => {
    assert.deepEqual(findGapReportEntries([{ ...base, ts: WEEK_END }], WEEK_START, WEEK_END), []);
  });

  it('includes an entry exactly at weekStart', () => {
    assert.deepEqual(findGapReportEntries([{ ...base, ts: WEEK_START }], WEEK_START, WEEK_END), [
      { ...base, ts: WEEK_START },
    ]);
  });

  it('sorts matching entries by ts ascending', () => {
    const later = { ...base, id: '2', ts: base.ts + 3600000, tsEnd: base.tsEnd + 3600000 };
    const result = findGapReportEntries([later, base], WEEK_START, WEEK_END);
    assert.deepEqual(
      result.map((e) => e.id),
      ['1', '2']
    );
  });

  it('returns an empty array for an empty or missing entries array', () => {
    assert.deepEqual(findGapReportEntries([], WEEK_START, WEEK_END), []);
    assert.deepEqual(findGapReportEntries(undefined, WEEK_START, WEEK_END), []);
  });

  it('excludes an entry resolved as non-billable, even with no note or link', () => {
    assert.deepEqual(
      findGapReportEntries([{ ...base, _billable: false }], WEEK_START, WEEK_END),
      []
    );
  });

  it('includes an entry with no _billable flag (undefined means billable)', () => {
    assert.deepEqual(findGapReportEntries([base], WEEK_START, WEEK_END), [base]);
  });

  it('includes an entry explicitly resolved as billable', () => {
    assert.deepEqual(findGapReportEntries([{ ...base, _billable: true }], WEEK_START, WEEK_END), [
      { ...base, _billable: true },
    ]);
  });

  it('excludes an entry with a missing ts instead of throwing', () => {
    const noTs = { ...base };
    delete noTs.ts;
    assert.deepEqual(findGapReportEntries([noTs], WEEK_START, WEEK_END), []);
  });

  it('treats a non-boolean falsy _billable (e.g. null) as billable — only strict false excludes', () => {
    assert.deepEqual(findGapReportEntries([{ ...base, _billable: null }], WEEK_START, WEEK_END), [
      { ...base, _billable: null },
    ]);
  });

  it('treats a non-boolean truthy _billable (e.g. a string) as billable', () => {
    assert.deepEqual(findGapReportEntries([{ ...base, _billable: 'yes' }], WEEK_START, WEEK_END), [
      { ...base, _billable: 'yes' },
    ]);
  });
});

describe('findExportWarnings', () => {
  const HOUR = 3600000;
  const fmt = (ms) => `${Math.round(ms / HOUR)}h`;
  const noSpan = { workdaySpanMs: 0, untrackedMs: 0, fmtDuration: fmt };

  it('flags a finished entry with neither a note nor a link', () => {
    const entry = { text: 'Fix login', ts: 0, tsEnd: HOUR };
    assert.deepEqual(findExportWarnings([entry], noSpan), ['No note or link: Fix login']);
  });

  it('does not flag an entry with a link, a note, or both', () => {
    const withLink = { text: 'A', ts: 0, tsEnd: HOUR, link: 'T1' };
    const withNote = { text: 'B', ts: 0, tsEnd: HOUR, note: 'done' };
    assert.deepEqual(findExportWarnings([withLink, withNote], noSpan), []);
  });

  it('does not flag cancelled or unfinished entries, or break/lunch/meeting utility entries', () => {
    const entries = [
      { text: 'Cancelled', ts: 0, tsEnd: HOUR, signifier: 'cancelled' },
      { text: 'Still running', ts: 0 },
      { text: '☕ Break', ts: 0, tsEnd: HOUR },
    ];
    assert.deepEqual(findExportWarnings(entries, noSpan), []);
  });

  it('flags an unbroken block over the 4h long-running-timer threshold', () => {
    const entry = { text: 'Deep work', ts: 0, tsEnd: 5 * HOUR, link: 'T1' };
    assert.deepEqual(findExportWarnings([entry], noSpan), ['Long unbroken block: Deep work (5h)']);
  });

  it('does not flag a block at or under the 4h threshold', () => {
    const entry = { text: 'Deep work', ts: 0, tsEnd: 4 * HOUR, link: 'T1' };
    assert.deepEqual(findExportWarnings([entry], noSpan), []);
  });

  it('flags a long day (>=6h span) with under 15min untracked as missing a break', () => {
    const warnings = findExportWarnings([], {
      workdaySpanMs: 8 * HOUR,
      untrackedMs: 5 * 60000,
      fmtDuration: fmt,
    });
    assert.deepEqual(warnings, ['No break logged despite a 8h day (only 0h untracked)']);
  });

  it('does not flag a long day that already has a break-sized gap', () => {
    const warnings = findExportWarnings([], {
      workdaySpanMs: 8 * HOUR,
      untrackedMs: 30 * 60000,
      fmtDuration: fmt,
    });
    assert.deepEqual(warnings, []);
  });

  it('does not flag a short day even with no untracked time', () => {
    const warnings = findExportWarnings([], {
      workdaySpanMs: 3 * HOUR,
      untrackedMs: 0,
      fmtDuration: fmt,
    });
    assert.deepEqual(warnings, []);
  });

  it('returns an empty array for a clean day with no entries', () => {
    assert.deepEqual(findExportWarnings([], noSpan), []);
  });

  it('does not flag a non-billable entry for a missing note or link', () => {
    const entry = { text: 'Team standup', ts: 0, tsEnd: HOUR, _billable: false };
    assert.deepEqual(findExportWarnings([entry], noSpan), []);
  });

  it('flags an entry with no _billable flag (undefined means billable)', () => {
    const entry = { text: 'Fix login', ts: 0, tsEnd: HOUR };
    assert.deepEqual(findExportWarnings([entry], noSpan), ['No note or link: Fix login']);
  });

  it('does not flag an entry with a missing ts instead of throwing', () => {
    const entry = { text: 'Fix login', tsEnd: HOUR };
    assert.deepEqual(findExportWarnings([entry], noSpan), []);
  });

  it('flags a non-boolean falsy _billable (e.g. null) — only strict false excludes', () => {
    const entry = { text: 'Fix login', ts: 0, tsEnd: HOUR, _billable: null };
    assert.deepEqual(findExportWarnings([entry], noSpan), ['No note or link: Fix login']);
  });

  it('flags a non-boolean truthy _billable (e.g. a string)', () => {
    const entry = { text: 'Fix login', ts: 0, tsEnd: HOUR, _billable: 'yes' };
    assert.deepEqual(findExportWarnings([entry], noSpan), ['No note or link: Fix login']);
  });
});

describe('buildWeeklyTicketSummary', () => {
  const WEEK_START = localMs(2026, 6, 1); // Monday
  const WEEK_END = localMs(2026, 6, 8); // following Monday
  const base = {
    id: '1',
    text: 'PROJ-1: Fix login',
    ts: localMs(2026, 6, 3, 10, 0),
    tsEnd: localMs(2026, 6, 3, 11, 0), // 1h
    date: '2026-06-03',
  };

  it('groups multiple entries sharing the same ticket key into one bucket, summing totalMs', () => {
    const second = { ...base, id: '2', ts: base.tsEnd, tsEnd: base.tsEnd + 1800000 }; // +30m
    const { ticketOrder, grouped } = buildWeeklyTicketSummary([base, second], WEEK_START, WEEK_END);
    assert.deepEqual(ticketOrder, ['PROJ-1']);
    assert.equal(grouped['PROJ-1'].totalMs, 5400000); // 1h30m
  });

  it('sums durations across different days within the week for the same ticket', () => {
    const friday = {
      ...base,
      id: '2',
      ts: localMs(2026, 6, 5, 9, 0),
      tsEnd: localMs(2026, 6, 5, 10, 0), // 1h
      date: '2026-06-05',
    };
    const { grouped } = buildWeeklyTicketSummary([base, friday], WEEK_START, WEEK_END);
    assert.equal(grouped['PROJ-1'].totalMs, 7200000); // 2h
  });

  it('distinguishes different task names under the same ticket, correct first-seen order', () => {
    const other = {
      ...base,
      id: '2',
      text: 'PROJ-1: Write tests',
      ts: base.tsEnd,
      tsEnd: base.tsEnd + 1800000,
    };
    const { grouped } = buildWeeklyTicketSummary([base, other], WEEK_START, WEEK_END);
    assert.deepEqual(grouped['PROJ-1'].nameOrder, ['fix login', 'write tests']);
    assert.equal(grouped['PROJ-1'].names['fix login'].totalMs, 3600000);
    assert.equal(grouped['PROJ-1'].names['write tests'].totalMs, 1800000);
    assert.equal(grouped['PROJ-1'].names['fix login'].label, 'Fix login');
  });

  it('dedupes task names within a ticket case-insensitively', () => {
    const upper = {
      ...base,
      id: '2',
      text: 'PROJ-1: FIX LOGIN',
      ts: base.tsEnd,
      tsEnd: base.tsEnd + 1800000,
    };
    const { grouped } = buildWeeklyTicketSummary([base, upper], WEEK_START, WEEK_END);
    assert.deepEqual(grouped['PROJ-1'].nameOrder, ['fix login']);
    assert.equal(grouped['PROJ-1'].names['fix login'].totalMs, 5400000);
  });

  it('groups entries with no parseable ticket key under WEEKLY_REPORT_NO_TICKET_KEY, sub-grouped by task text', () => {
    const untracked = { ...base, id: '2', text: 'Team sync prep' };
    const { ticketOrder, grouped } = buildWeeklyTicketSummary([untracked], WEEK_START, WEEK_END);
    assert.deepEqual(ticketOrder, [WEEKLY_REPORT_NO_TICKET_KEY]);
    assert.deepEqual(grouped[WEEKLY_REPORT_NO_TICKET_KEY].nameOrder, ['team sync prep']);
  });

  it('excludes a cancelled entry', () => {
    const { ticketOrder } = buildWeeklyTicketSummary(
      [{ ...base, signifier: 'cancelled' }],
      WEEK_START,
      WEEK_END
    );
    assert.deepEqual(ticketOrder, []);
  });

  it('excludes an unfinished entry (no tsEnd)', () => {
    const running = { ...base };
    delete running.tsEnd;
    assert.deepEqual(buildWeeklyTicketSummary([running], WEEK_START, WEEK_END).ticketOrder, []);
  });

  for (const text of ['☕ Break', '🥪 Lunch', '📅 Meeting']) {
    it(`excludes a "${text}" utility entry`, () => {
      const { ticketOrder } = buildWeeklyTicketSummary([{ ...base, text }], WEEK_START, WEEK_END);
      assert.deepEqual(ticketOrder, []);
    });
  }

  it('excludes entries before weekStart', () => {
    const { ticketOrder } = buildWeeklyTicketSummary(
      [{ ...base, ts: WEEK_START - 1 }],
      WEEK_START,
      WEEK_END
    );
    assert.deepEqual(ticketOrder, []);
  });

  it('includes an entry exactly at weekStart', () => {
    const { ticketOrder } = buildWeeklyTicketSummary(
      [{ ...base, ts: WEEK_START, tsEnd: WEEK_START + 3600000 }],
      WEEK_START,
      WEEK_END
    );
    assert.deepEqual(ticketOrder, ['PROJ-1']);
  });

  it('excludes entries at or after weekEnd', () => {
    const { ticketOrder } = buildWeeklyTicketSummary(
      [{ ...base, ts: WEEK_END, tsEnd: WEEK_END + 3600000 }],
      WEEK_START,
      WEEK_END
    );
    assert.deepEqual(ticketOrder, []);
  });

  it('collects distinct, trimmed notes per ticket, first-seen order, blank ones omitted', () => {
    const withNote = { ...base, note: '  did the thing  ' };
    const dupeNote = {
      ...base,
      id: '2',
      note: 'did the thing',
      ts: base.tsEnd,
      tsEnd: base.tsEnd + 60000,
    };
    const blankNote = {
      ...base,
      id: '3',
      note: '   ',
      ts: base.tsEnd + 60000,
      tsEnd: base.tsEnd + 120000,
    };
    const { grouped } = buildWeeklyTicketSummary(
      [withNote, dupeNote, blankNote],
      WEEK_START,
      WEEK_END
    );
    assert.deepEqual(grouped['PROJ-1'].notes, ['did the thing']);
  });

  it('collects distinct, trimmed links per ticket, first-seen order, blank ones omitted', () => {
    const withLink = { ...base, link: '  https://x/1  ' };
    const dupeLink = {
      ...base,
      id: '2',
      link: 'https://x/1',
      ts: base.tsEnd,
      tsEnd: base.tsEnd + 60000,
    };
    const blankLink = {
      ...base,
      id: '3',
      link: '   ',
      ts: base.tsEnd + 60000,
      tsEnd: base.tsEnd + 120000,
    };
    const { grouped } = buildWeeklyTicketSummary(
      [withLink, dupeLink, blankLink],
      WEEK_START,
      WEEK_END
    );
    assert.deepEqual(grouped['PROJ-1'].links, ['https://x/1']);
  });

  it('sorts ticketOrder by totalMs descending across multiple tickets', () => {
    const small = { ...base, id: '2', text: 'PROJ-2: Small task', tsEnd: base.ts + 600000 }; // 10m
    const big = {
      ...base,
      id: '3',
      text: 'PROJ-3: Big task',
      ts: base.tsEnd,
      tsEnd: base.tsEnd + 7200000,
    }; // 2h
    const { ticketOrder } = buildWeeklyTicketSummary([base, small, big], WEEK_START, WEEK_END);
    assert.deepEqual(ticketOrder, ['PROJ-3', 'PROJ-1', 'PROJ-2']);
  });

  it("always sorts the no-ticket bucket last, even when its total exceeds every ticket's", () => {
    const untracked = {
      ...base,
      id: '2',
      text: 'Huge untracked task',
      ts: base.tsEnd,
      tsEnd: base.tsEnd + 36000000, // 10h — far larger than PROJ-1's 1h
    };
    const { ticketOrder } = buildWeeklyTicketSummary([base, untracked], WEEK_START, WEEK_END);
    assert.deepEqual(ticketOrder, ['PROJ-1', WEEKLY_REPORT_NO_TICKET_KEY]);
  });

  it('returns empty ticketOrder/grouped for an empty or missing entries array', () => {
    assert.deepEqual(buildWeeklyTicketSummary([], WEEK_START, WEEK_END), {
      ticketOrder: [],
      grouped: {},
    });
    assert.deepEqual(buildWeeklyTicketSummary(undefined, WEEK_START, WEEK_END), {
      ticketOrder: [],
      grouped: {},
    });
  });

  it('never surfaces a ticket key with zero matching entries in the target week', () => {
    const outsideWeek = { ...base, ts: WEEK_START - 1, tsEnd: WEEK_START };
    const { ticketOrder, grouped } = buildWeeklyTicketSummary([outsideWeek], WEEK_START, WEEK_END);
    assert.deepEqual(ticketOrder, []);
    assert.equal(grouped['PROJ-1'], undefined);
  });
});

describe('formatWeeklyTicketSummaryText', () => {
  const fmtDuration = (ms) => `${Math.round(ms / 60000)}m`;

  it('renders one ticket header line with its total via the injected formatter', () => {
    const grouped = {
      'PROJ-1': { totalMs: 3600000, nameOrder: [], names: {}, notes: [], links: [] },
    };
    assert.deepEqual(formatWeeklyTicketSummaryText(['PROJ-1'], grouped, fmtDuration), [
      'PROJ-1 — 60m',
    ]);
  });

  it('renders each name bullet with its own subtotal, in nameOrder', () => {
    const grouped = {
      'PROJ-1': {
        totalMs: 5400000,
        nameOrder: ['fix login', 'write tests'],
        names: {
          'fix login': { label: 'Fix login', totalMs: 3600000 },
          'write tests': { label: 'Write tests', totalMs: 1800000 },
        },
        notes: [],
        links: [],
      },
    };
    assert.deepEqual(formatWeeklyTicketSummaryText(['PROJ-1'], grouped, fmtDuration), [
      'PROJ-1 — 90m',
      '    60m - Fix login',
      '    30m - Write tests',
    ]);
  });

  // Regression: a bare-ticket entry (no description after the ticket key,
  // e.g. logged as just "PROJ-42") produces an empty label from
  // parseJiraLabel() — this must not render as a dangling "- " with no name.
  it('omits the trailing dash when a name bullet has an empty label (bare ticket entry)', () => {
    const grouped = {
      'PROJ-1': {
        totalMs: 5400000,
        nameOrder: [''],
        names: {
          '': { label: '', totalMs: 5400000 },
        },
        notes: [],
        links: [],
      },
    };
    assert.deepEqual(formatWeeklyTicketSummaryText(['PROJ-1'], grouped, fmtDuration), [
      'PROJ-1 — 90m',
      '    90m',
    ]);
  });

  it('renders note:/link: lines only when present', () => {
    const grouped = {
      'PROJ-1': {
        totalMs: 3600000,
        nameOrder: [],
        names: {},
        notes: ['did the thing'],
        links: ['https://x/1'],
      },
    };
    assert.deepEqual(formatWeeklyTicketSummaryText(['PROJ-1'], grouped, fmtDuration), [
      'PROJ-1 — 60m',
      '    note: did the thing',
      '    link: https://x/1',
    ]);
  });

  it('renders the no-ticket bucket with the "No ticket" label', () => {
    const grouped = {
      [WEEKLY_REPORT_NO_TICKET_KEY]: {
        totalMs: 1800000,
        nameOrder: [],
        names: {},
        notes: [],
        links: [],
      },
    };
    assert.deepEqual(
      formatWeeklyTicketSummaryText([WEEKLY_REPORT_NO_TICKET_KEY], grouped, fmtDuration),
      ['No ticket — 30m']
    );
  });

  it('produces one blank-line-separated block per ticket in ticketOrder order', () => {
    const grouped = {
      'PROJ-1': { totalMs: 60000, nameOrder: [], names: {}, notes: [], links: [] },
      'PROJ-2': { totalMs: 120000, nameOrder: [], names: {}, notes: [], links: [] },
    };
    assert.deepEqual(formatWeeklyTicketSummaryText(['PROJ-1', 'PROJ-2'], grouped, fmtDuration), [
      'PROJ-1 — 1m',
      '',
      'PROJ-2 — 2m',
    ]);
  });

  it('returns an empty lines array for empty ticketOrder/grouped', () => {
    assert.deepEqual(formatWeeklyTicketSummaryText([], {}, fmtDuration), []);
  });
});

describe('buildRollingSummary', () => {
  /** Builds a minimal valid entry for testing. */
  function makeEntry(dateKey, text, tsStart, tsEnd, signifier = '') {
    return {
      id: `e-${Math.random()}`,
      date: dateKey,
      text,
      ts: tsStart,
      tsEnd,
      signifier,
      tag: 'work',
    };
  }

  const EMOJI_REMOTE = '🏠';
  const getEmoji = () => EMOJI_REMOTE;
  const getSod = () => null;
  const getEod = () => null;

  it('returns one row per date key', () => {
    const rows = buildRollingSummary(['2026-06-04', '2026-06-03'], {
      entries: [],
      getDayStartTs: getSod,
      getDayEodTs: getEod,
      getLocationEmoji: getEmoji,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].dateKey, '2026-06-04');
    assert.equal(rows[1].dateKey, '2026-06-03');
  });

  it('sums totalMs from completed non-cancelled entries on the right day', () => {
    const entries = [
      makeEntry('2026-06-04', 'Task A', localMs(2026, 6, 4, 9, 0), localMs(2026, 6, 4, 10, 0)),
      makeEntry('2026-06-04', 'Task B', localMs(2026, 6, 4, 11, 0), localMs(2026, 6, 4, 11, 30)),
      makeEntry('2026-06-03', 'Task C', localMs(2026, 6, 3, 9, 0), localMs(2026, 6, 3, 10, 0)),
    ];
    const [row] = buildRollingSummary(['2026-06-04'], {
      entries,
      getDayStartTs: getSod,
      getDayEodTs: getEod,
      getLocationEmoji: getEmoji,
    });
    assert.equal(row.totalMs, 90 * 60 * 1000); // 1h + 30m
  });

  it('excludes cancelled entries from totalMs', () => {
    const entries = [
      makeEntry('2026-06-04', 'Good', localMs(2026, 6, 4, 9, 0), localMs(2026, 6, 4, 10, 0)),
      makeEntry(
        '2026-06-04',
        'Bad',
        localMs(2026, 6, 4, 10, 0),
        localMs(2026, 6, 4, 11, 0),
        'cancelled'
      ),
    ];
    const [row] = buildRollingSummary(['2026-06-04'], {
      entries,
      getDayStartTs: getSod,
      getDayEodTs: getEod,
      getLocationEmoji: getEmoji,
    });
    assert.equal(row.totalMs, 60 * 60 * 1000);
  });

  it('excludes entries with no tsEnd', () => {
    const entries = [
      {
        id: 'e1',
        date: '2026-06-04',
        text: 'Live',
        ts: localMs(2026, 6, 4, 9, 0),
        tsEnd: null,
        signifier: '',
        tag: 'work',
      },
    ];
    const [row] = buildRollingSummary(['2026-06-04'], {
      entries,
      getDayStartTs: getSod,
      getDayEodTs: getEod,
      getLocationEmoji: getEmoji,
    });
    assert.equal(row.totalMs, 0);
    assert.equal(row.topTasks.length, 0);
  });

  it('returns topTasks sorted descending by duration, max 3', () => {
    const base = localMs(2026, 6, 4, 8, 0);
    const entries = [
      makeEntry('2026-06-04', 'Short', base, base + 15 * 60000),
      makeEntry('2026-06-04', 'Long', base, base + 120 * 60000),
      makeEntry('2026-06-04', 'Medium', base, base + 60 * 60000),
      makeEntry('2026-06-04', 'Tiny', base, base + 5 * 60000),
    ];
    const [row] = buildRollingSummary(['2026-06-04'], {
      entries,
      getDayStartTs: getSod,
      getDayEodTs: getEod,
      getLocationEmoji: getEmoji,
    });
    assert.equal(row.topTasks.length, 3);
    assert.equal(row.topTasks[0].text, 'Long');
    assert.equal(row.topTasks[1].text, 'Medium');
    assert.equal(row.topTasks[2].text, 'Short');
  });

  it('aggregates multiple entries with the same text', () => {
    const base = localMs(2026, 6, 4, 9, 0);
    const entries = [
      makeEntry('2026-06-04', 'Repeat', base, base + 30 * 60000),
      makeEntry('2026-06-04', 'Repeat', base + 60 * 60000, base + 90 * 60000),
    ];
    const [row] = buildRollingSummary(['2026-06-04'], {
      entries,
      getDayStartTs: getSod,
      getDayEodTs: getEod,
      getLocationEmoji: getEmoji,
    });
    assert.equal(row.topTasks.length, 1);
    assert.equal(row.topTasks[0].text, 'Repeat');
    assert.equal(row.topTasks[0].totalMs, 60 * 60000);
  });

  it('passes through sodTs and eodTs from injected getters', () => {
    const sod = localMs(2026, 6, 4, 8, 30);
    const eod = localMs(2026, 6, 4, 17, 0);
    const [row] = buildRollingSummary(['2026-06-04'], {
      entries: [],
      getDayStartTs: (k) => (k === '2026-06-04' ? sod : null),
      getDayEodTs: (k) => (k === '2026-06-04' ? eod : null),
      getLocationEmoji: getEmoji,
    });
    assert.equal(row.sodTs, sod);
    assert.equal(row.eodTs, eod);
  });

  it('uses the emoji returned by getLocationEmoji', () => {
    const [row] = buildRollingSummary(['2026-06-04'], {
      entries: [],
      getDayStartTs: getSod,
      getDayEodTs: getEod,
      getLocationEmoji: (k) => (k === '2026-06-04' ? '🏢' : '🏠'),
    });
    assert.equal(row.locationEmoji, '🏢');
  });

  it('returns an empty array for an empty dateKeys list', () => {
    const rows = buildRollingSummary([], {
      entries: [],
      getDayStartTs: getSod,
      getDayEodTs: getEod,
      getLocationEmoji: getEmoji,
    });
    assert.deepEqual(rows, []);
  });

  it('gives a day with no entries totalMs=0 and topTasks=[]', () => {
    const [row] = buildRollingSummary(['2026-06-04'], {
      entries: [],
      getDayStartTs: getSod,
      getDayEodTs: getEod,
      getLocationEmoji: getEmoji,
    });
    assert.equal(row.totalMs, 0);
    assert.deepEqual(row.topTasks, []);
  });
});

describe('applyBackupRetention', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date('2026-06-09T12:00:00Z').getTime();

  function makeEntry(daysAgo) {
    const d = new Date(now - daysAgo * DAY_MS);
    return { date: dk(d), ts: d.getTime() };
  }

  it('keeps entries within the retention window', () => {
    const e = makeEntry(30);
    const { kept, dropped } = applyBackupRetention([e], 90, now);
    assert.equal(kept.length, 1);
    assert.equal(dropped, 0);
  });

  it('drops entries older than the retention window', () => {
    const old = makeEntry(91);
    const { kept, dropped } = applyBackupRetention([old], 90, now);
    assert.equal(kept.length, 0);
    assert.equal(dropped, 1);
  });

  it('keeps an entry exactly on the cutoff boundary', () => {
    const boundary = makeEntry(90);
    const { kept, dropped } = applyBackupRetention([boundary], 90, now);
    assert.equal(kept.length, 1);
    assert.equal(dropped, 0);
  });

  it('drops entries with a missing date field', () => {
    const noDate = { ts: now - DAY_MS };
    const { kept, dropped } = applyBackupRetention([noDate], 90, now);
    assert.equal(kept.length, 0);
    assert.equal(dropped, 1);
  });

  it('drops entries with an unparseable date field', () => {
    const bad = { date: 'not-a-date', ts: now };
    const { kept, dropped } = applyBackupRetention([bad], 90, now);
    assert.equal(kept.length, 0);
    assert.equal(dropped, 1);
  });

  it('handles a mixed array correctly', () => {
    const entries = [makeEntry(10), makeEntry(95), makeEntry(50), { ts: now }];
    const { kept, dropped } = applyBackupRetention(entries, 90, now);
    assert.equal(kept.length, 2);
    assert.equal(dropped, 2);
  });

  it('returns empty arrays when given an empty array', () => {
    const { kept, dropped } = applyBackupRetention([], 90, now);
    assert.deepEqual(kept, []);
    assert.equal(dropped, 0);
  });

  it('does not mutate the input array', () => {
    const entries = [makeEntry(10), makeEntry(95)];
    const copy = [...entries];
    applyBackupRetention(entries, 90, now);
    assert.deepEqual(entries, copy);
  });
});

describe('buildBackupPayload', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = new Date('2026-06-09T12:00:00Z').getTime();

  /** A dated record `daysAgo` before `now`, tagged with `id` for identity checks. */
  function rec(id, daysAgo) {
    return { id, date: dk(new Date(now - daysAgo * DAY_MS)) };
  }

  it('trims every time-series array to the retention window', () => {
    const state = {
      entries: [rec('e-new', 5), rec('e-old', 40)],
      planTasks: [rec('t-new', 5), rec('t-old', 40)],
      blocks: [rec('b-new', 5), rec('b-old', 40)],
      devLog: [rec('d-new', 5), rec('d-old', 40)],
      distractions: [rec('x-new', 5), rec('x-old', 40)],
    };
    const { payload } = buildBackupPayload(state, 21, now);
    assert.deepEqual(
      payload.entries.map((r) => r.id),
      ['e-new']
    );
    assert.deepEqual(
      payload.planTasks.map((r) => r.id),
      ['t-new']
    );
    assert.deepEqual(
      payload.blocks.map((r) => r.id),
      ['b-new']
    );
    assert.deepEqual(
      payload.devLog.map((r) => r.id),
      ['d-new']
    );
    assert.deepEqual(
      payload.distractions.map((r) => r.id),
      ['x-new']
    );
  });

  it('keeps categories, qpHidden, and pomoLog whole (not date-filtered)', () => {
    const state = {
      categories: [{ id: 'c1' }, { id: 'c2' }],
      qpHidden: ['a', 'b', 'c'],
      // pomoLog is capped at source, so old-dated records must survive here
      pomoLog: [rec('p-old', 400)],
    };
    const { payload } = buildBackupPayload(state, 21, now);
    assert.equal(payload.categories.length, 2);
    assert.deepEqual(payload.qpHidden, ['a', 'b', 'c']);
    assert.equal(payload.pomoLog.length, 1);
  });

  it('reports per-array dropped counts, omitting arrays that dropped nothing', () => {
    const state = {
      entries: [rec('e-new', 5)],
      planTasks: [rec('t-old', 40), rec('t-old2', 50)],
      blocks: [rec('b-old', 40)],
    };
    const { dropped } = buildBackupPayload(state, 21, now);
    assert.equal(dropped.entries, undefined);
    assert.equal(dropped.planTasks, 2);
    assert.equal(dropped.blocks, 1);
  });

  it('keeps future-dated records (e.g. upcoming tasks) inside the window', () => {
    const state = { planTasks: [rec('t-future', -7)] };
    const { payload, dropped } = buildBackupPayload(state, 21, now);
    assert.deepEqual(
      payload.planTasks.map((r) => r.id),
      ['t-future']
    );
    assert.equal(dropped.planTasks, undefined);
  });

  it('tolerates missing arrays without throwing', () => {
    const { payload, dropped } = buildBackupPayload({}, 21, now);
    assert.deepEqual(payload.entries, []);
    assert.deepEqual(payload.planTasks, []);
    assert.deepEqual(payload.categories, []);
    assert.deepEqual(payload.qpHidden, []);
    assert.equal(payload.version, '1');
    assert.equal(payload.retentionDays, 21);
    assert.deepEqual(dropped, {});
  });

  it('tolerates explicit null values for individual state properties', () => {
    const state = {
      entries: null,
      categories: null,
      planTasks: null,
      blocks: null,
      pomoLog: null,
      devLog: null,
      distractions: null,
      qpHidden: null,
    };
    let payload;
    let dropped;
    assert.doesNotThrow(() => {
      ({ payload, dropped } = buildBackupPayload(state, 21, now));
    });
    // Every array coerces to an empty array; nothing is dropped.
    assert.deepEqual(payload.entries, []);
    assert.deepEqual(payload.categories, []);
    assert.deepEqual(payload.planTasks, []);
    assert.deepEqual(payload.blocks, []);
    assert.deepEqual(payload.pomoLog, []);
    assert.deepEqual(payload.devLog, []);
    assert.deepEqual(payload.distractions, []);
    assert.deepEqual(payload.qpHidden, []);
    assert.deepEqual(dropped, {});
  });

  it('stamps the export timestamp from the supplied clock', () => {
    const { payload } = buildBackupPayload({}, 21, now);
    assert.equal(payload.exported, new Date(now).toISOString());
  });

  it('does not mutate the supplied qpHidden array', () => {
    const qpHidden = ['a', 'b'];
    const { payload } = buildBackupPayload({ qpHidden }, 21, now);
    payload.qpHidden.push('c');
    assert.deepEqual(qpHidden, ['a', 'b']);
  });
});
