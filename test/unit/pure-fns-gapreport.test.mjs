/**
 * @file pure-fns-gapreport.test.mjs
 * Split out of pure-fns-export.test.mjs (QA 2026-09-07, largest-module
 * finding), mirroring the corresponding src/js/pure-fns-*.js split.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatGroupedLines,
  findExportWarnings,
  findGapReportEntries,
} from '../../src/js/pure-fns.js';
import { localMs } from './_helpers.mjs';

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
