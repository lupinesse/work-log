/**
 * @file pure-fns-weeklyreport.test.mjs
 * Split out of pure-fns-export.test.mjs (QA 2026-09-07, largest-module
 * finding), mirroring the corresponding src/js/pure-fns-*.js split.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEKLY_REPORT_NO_TICKET_KEY,
  buildWeeklyTicketSummary,
  formatWeeklyTicketSummaryText,
} from '../../src/js/pure-fns.js';
import { localMs } from './_helpers.mjs';

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
