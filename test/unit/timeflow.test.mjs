/**
 * @file timeflow.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pureFns from '../../src/js/pure-fns.js';
import { __dirname } from './_helpers.mjs';

const timeflowSrc = readFileSync(join(__dirname, '../../src/js/11-timeflow.js'), 'utf8');

/**
 * Creates a vm sandbox with the minimal globals that 11-timeflow.js needs
 * for the pure-logic functions (findLargestGap, getFlowView, setFlowView).
 * @param {object} overrides
 */
function loadTimeflowSandbox(overrides = {}) {
  const store = {};
  const sandbox = {
    entries: [],
    viewDate: new Date('2026-05-29T12:00:00'),
    isToday: (d) => d.toDateString() === sandbox.viewDate.toDateString(),
    activeTimer: null,
    fmtDur: (ms) => `${Math.round(ms / 60000)}m`,
    // Use local-time formatting to match the app's `dk` (src/js/pure-fns.js)
    dk: (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },
    getCat: (id) => ({ id, label: id, color: '#888' }),
    isEntryBillable: () => true,
    renderTodayFlow: () => {},
    renderTimeblock: () => {},
    buildDailyLogItems: () => [],
    addLogNote: () => {},
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v;
      },
      removeItem: (k) => {
        delete store[k];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
    },
    document: {
      getElementById: () => null,
    },
    getEodTs: () => null,
    wlLog: { info: () => {}, warn: () => {}, error: () => {} },
    safeCssColor: (c) => c,
    fmtHm: (ts) => String(ts),
    ...overrides,
  };
  vm.createContext(sandbox);
  vm.runInContext(timeflowSrc, sandbox);
  return sandbox;
}

describe('findLargestGap', () => {
  const TODAY = '2026-05-29';

  it('returns null for a past day (not today)', () => {
    const sb = loadTimeflowSandbox();
    sb.viewDate = new Date('2026-05-20T12:00:00');
    sb.isToday = () => false;
    const result = sb.findLargestGap(TODAY);
    assert.equal(result, null);
  });

  it('returns null when there are no entries', () => {
    const sb = loadTimeflowSandbox();
    sb.entries = [];
    assert.equal(sb.findLargestGap(TODAY), null);
  });

  // These four tests use hardcoded `base` timestamps and so would also hit the
  // trailing-gap branch as wall-clock time advances past the fixtures. We
  // explicitly set activeTimer (whose presence suppresses the trailing-gap
  // branch) so each test measures only the internal-gap logic it intends to.
  const TIMER_PRESENT = { entryId: 'dummy', paused: false, startTs: 0 };

  it('returns null when the only gap is < 15 min', () => {
    const base = new Date('2026-05-29T09:00:00').getTime();
    const sb = loadTimeflowSandbox();
    sb.activeTimer = TIMER_PRESENT;
    sb.entries = [
      { date: TODAY, ts: base, tsEnd: base + 30 * 60000, signifier: null },
      { date: TODAY, ts: base + 40 * 60000, tsEnd: base + 70 * 60000, signifier: null },
    ];
    assert.equal(sb.findLargestGap(TODAY), null);
  });

  it('returns the gap when exactly 15 min', () => {
    const base = new Date('2026-05-29T09:00:00').getTime();
    const sb = loadTimeflowSandbox();
    sb.activeTimer = TIMER_PRESENT;
    sb.entries = [
      { date: TODAY, ts: base, tsEnd: base + 30 * 60000, signifier: null },
      { date: TODAY, ts: base + 45 * 60000, tsEnd: base + 75 * 60000, signifier: null },
    ];
    const gap = sb.findLargestGap(TODAY);
    assert.ok(gap !== null, 'should find a gap');
    assert.equal(gap.gapMin, 15);
  });

  it('returns the largest gap when multiple qualify', () => {
    const base = new Date('2026-05-29T09:00:00').getTime();
    const sb = loadTimeflowSandbox();
    sb.activeTimer = TIMER_PRESENT;
    sb.entries = [
      { date: TODAY, ts: base, tsEnd: base + 30 * 60000, signifier: null },
      { date: TODAY, ts: base + 50 * 60000, tsEnd: base + 80 * 60000, signifier: null }, // 20 min gap
      { date: TODAY, ts: base + 120 * 60000, tsEnd: base + 150 * 60000, signifier: null }, // 40 min gap
    ];
    const gap = sb.findLargestGap(TODAY);
    assert.equal(gap.gapMin, 40);
  });

  it('ignores entries with signifier === "cancelled"', () => {
    const base = new Date('2026-05-29T09:00:00').getTime();
    const sb = loadTimeflowSandbox();
    sb.activeTimer = TIMER_PRESENT;
    sb.entries = [
      { date: TODAY, ts: base, tsEnd: base + 30 * 60000, signifier: 'cancelled' },
      { date: TODAY, ts: base + 60 * 60000, tsEnd: base + 90 * 60000, signifier: null },
    ];
    // Cancelled entry has no tsEnd counted — no consecutive pair → null
    assert.equal(sb.findLargestGap(TODAY), null);
  });

  it('returns the trailing gap when the last entry ended ≥ 15 min ago', () => {
    const now = Date.now();
    const sb = loadTimeflowSandbox();
    // Last entry ended 30 minutes ago, no live timer
    sb.entries = [
      {
        date: TODAY,
        ts: now - 60 * 60000,
        tsEnd: now - 30 * 60000,
        signifier: null,
      },
    ];
    sb.activeTimer = null;
    const gap = sb.findLargestGap(TODAY);
    assert.ok(gap !== null, 'should detect trailing gap');
    assert.ok(gap.gapMin >= 30 && gap.gapMin <= 31, `gap was ${gap.gapMin}`);
  });

  it('suppresses the trailing gap while a timer is active', () => {
    const now = Date.now();
    const sb = loadTimeflowSandbox();
    sb.entries = [
      {
        id: 'e1',
        date: TODAY,
        ts: now - 60 * 60000,
        tsEnd: now - 30 * 60000,
        signifier: null,
      },
    ];
    sb.activeTimer = { entryId: 'live', paused: false, startTs: now - 5 * 60000 };
    assert.equal(sb.findLargestGap(TODAY), null);
  });

  it('caps the trailing gap at EOD when the day has been marked as ended', () => {
    const now = Date.now();
    const eodTs = now - 60 * 60000; // EOD was 1 hour ago
    const sb = loadTimeflowSandbox({ getEodTs: () => eodTs });
    // Last entry ended 90 minutes ago; without cap the gap would be 90 min,
    // but EOD was 60 min ago so the capped gap should be ~30 min.
    sb.entries = [
      {
        date: TODAY,
        ts: now - 120 * 60000,
        tsEnd: now - 90 * 60000,
        signifier: null,
      },
    ];
    sb.activeTimer = null;
    const gap = sb.findLargestGap(TODAY);
    assert.ok(gap !== null, 'should still find a gap');
    assert.ok(gap.gapMin >= 29 && gap.gapMin <= 31, `expected ~30 min gap, got ${gap.gapMin}`);
    assert.equal(gap.endTs, eodTs, 'gap end should be EOD, not now');
  });

  it('prefers the trailing gap when it is larger than any internal gap', () => {
    const now = Date.now();
    const sb = loadTimeflowSandbox();
    // 20-min internal gap, 60-min trailing gap
    sb.entries = [
      {
        date: TODAY,
        ts: now - 180 * 60000,
        tsEnd: now - 150 * 60000,
        signifier: null,
      },
      {
        date: TODAY,
        ts: now - 130 * 60000,
        tsEnd: now - 60 * 60000,
        signifier: null,
      },
    ];
    sb.activeTimer = null;
    const gap = sb.findLargestGap(TODAY);
    assert.ok(gap !== null);
    assert.ok(gap.gapMin >= 60, `trailing gap should win, got ${gap.gapMin}`);
  });
});

describe('activeTimerDurationMs', () => {
  it('returns 0 when no timer is active', () => {
    const sb = loadTimeflowSandbox();
    sb.activeTimer = null;
    assert.equal(sb.activeTimerDurationMs({ id: 'e1', ts: Date.now() }), 0);
  });

  it('returns 0 for an unrelated entry', () => {
    const sb = loadTimeflowSandbox();
    sb.activeTimer = { entryId: 'other', paused: false, startTs: Date.now() };
    assert.equal(sb.activeTimerDurationMs({ id: 'e1', ts: Date.now() }), 0);
  });

  it('returns accumulatedMs when paused (does not grow)', () => {
    const sb = loadTimeflowSandbox();
    sb.activeTimer = {
      entryId: 'e1',
      paused: true,
      accumulatedMs: 5 * 60000,
      startTs: Date.now() - 60 * 60000, // would be huge if not honoured
    };
    assert.equal(sb.activeTimerDurationMs({ id: 'e1', ts: Date.now() }), 5 * 60000);
  });

  it('returns elapsed since startTs when running', () => {
    const sb = loadTimeflowSandbox();
    const now = Date.now();
    sb.activeTimer = { entryId: 'e1', paused: false, startTs: now - 90000 };
    const ms = sb.activeTimerDurationMs({ id: 'e1', ts: now - 120000 });
    assert.ok(ms >= 90000 - 200 && ms <= 90000 + 200, `expected ~90000, got ${ms}`);
  });
});

describe('getFlowView / setFlowView', () => {
  it('defaults to "flow" when nothing is stored', () => {
    const sb = loadTimeflowSandbox();
    assert.equal(sb.getFlowView(), 'flow');
  });

  it('returns "log" after setFlowView("log")', () => {
    const sb = loadTimeflowSandbox();
    sb.setFlowView('log');
    assert.equal(sb.getFlowView(), 'log');
  });

  it('returns "blocks" after setFlowView("blocks")', () => {
    const sb = loadTimeflowSandbox();
    sb.setFlowView('blocks');
    assert.equal(sb.getFlowView(), 'blocks');
  });

  it('falls back to "flow" for an unrecognised stored value', () => {
    const sb = loadTimeflowSandbox();
    sb.localStorage.setItem('wl_flow_view', 'unknown');
    assert.equal(sb.getFlowView(), 'flow');
  });
});

describe('stripPct', () => {
  it('returns 0 at the left edge (07:00)', () => {
    const sb = loadTimeflowSandbox();
    assert.equal(sb.stripPct(7 * 60), 0);
  });

  it('returns 100 at the right edge (21:00)', () => {
    const sb = loadTimeflowSandbox();
    assert.equal(sb.stripPct(21 * 60), 100);
  });

  it('returns 50 at the midpoint (14:00)', () => {
    const sb = loadTimeflowSandbox();
    assert.equal(sb.stripPct(14 * 60), 50);
  });

  it('clamps values before 07:00 to 0', () => {
    const sb = loadTimeflowSandbox();
    assert.equal(sb.stripPct(5 * 60), 0);
  });

  it('clamps values after 21:00 to 100', () => {
    const sb = loadTimeflowSandbox();
    assert.equal(sb.stripPct(23 * 60), 100);
  });
});

describe('tsToMins', () => {
  it('returns minutes from midnight in local time', () => {
    const sb = loadTimeflowSandbox();
    const ts = new Date('2026-05-29T09:30:00').getTime();
    assert.equal(sb.tsToMins(ts), 9 * 60 + 30);
  });

  it('handles midnight correctly', () => {
    const sb = loadTimeflowSandbox();
    const ts = new Date('2026-05-29T00:00:00').getTime();
    assert.equal(sb.tsToMins(ts), 0);
  });

  it('handles the last minute of the day', () => {
    const sb = loadTimeflowSandbox();
    const ts = new Date('2026-05-29T23:59:00').getTime();
    assert.equal(sb.tsToMins(ts), 23 * 60 + 59);
  });
});

describe('fmtHm', () => {
  const cases = [
    ['2026-05-29T00:00:00', '00:00'],
    ['2026-05-29T09:05:00', '09:05'],
    ['2026-05-29T14:30:00', '14:30'],
    ['2026-05-29T23:59:00', '23:59'],
  ];
  cases.forEach(([iso, expected]) => {
    it(`formats ${iso} as ${expected}`, () => {
      const sb = loadTimeflowSandbox();
      assert.equal(sb.fmtHm(new Date(iso).getTime()), expected);
    });
  });
});

describe('partitionSessionNotes', () => {
  it('separates session-notes from regular items', () => {
    const sb = loadTimeflowSandbox();
    const allItems = [
      { type: 'entry', entryId: 'e1', ts: 1000 },
      { type: 'session-note', parentEntryId: 'e1', ts: 2000 },
    ];
    const { items, sessionNotesByEntry } = sb.partitionSessionNotes(allItems);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'entry');
    assert.ok(sessionNotesByEntry['e1']);
    assert.equal(sessionNotesByEntry['e1'].length, 1);
  });

  it('groups multiple session-notes under the same parent', () => {
    const sb = loadTimeflowSandbox();
    const allItems = [
      { type: 'session-note', parentEntryId: 'e1', ts: 1000 },
      { type: 'session-note', parentEntryId: 'e1', ts: 2000 },
    ];
    const { items, sessionNotesByEntry } = sb.partitionSessionNotes(allItems);
    assert.equal(items.length, 0);
    assert.equal(sessionNotesByEntry['e1'].length, 2);
  });

  it('discards orphaned session-notes (no parentEntryId) and warns', () => {
    const warnings = [];
    const sb = loadTimeflowSandbox({
      wlLog: { info: () => {}, warn: (m) => warnings.push(m), error: () => {} },
    });
    const allItems = [{ type: 'session-note', parentEntryId: null, id: 'sn-orphan', ts: 1000 }];
    const { items, sessionNotesByEntry } = sb.partitionSessionNotes(allItems);
    assert.equal(items.length, 0);
    assert.deepEqual(Object.keys(sessionNotesByEntry), []);
    assert.ok(
      warnings.some((w) => w.includes('sn-orphan')),
      'warn logged for orphan'
    );
  });

  it('passes non-session-note items through unchanged', () => {
    const sb = loadTimeflowSandbox();
    const entry = { type: 'entry', entryId: 'e2', ts: 500 };
    const note = { type: 'note', ts: 600 };
    const { items } = sb.partitionSessionNotes([entry, note]);
    assert.equal(items.length, 2);
  });

  it('returns empty items and empty lookup for an empty input', () => {
    const sb = loadTimeflowSandbox();
    const { items, sessionNotesByEntry } = sb.partitionSessionNotes([]);
    assert.equal(items.length, 0);
    assert.equal(Object.keys(sessionNotesByEntry).length, 0);
  });
});

describe('buildSessionNotesHtml', () => {
  it('returns empty string for empty array', () => {
    const sb = loadTimeflowSandbox();
    assert.equal(sb.buildSessionNotesHtml([]), '');
  });

  it('wraps notes in <ul class="tf-session-notes">', () => {
    const sb = loadTimeflowSandbox();
    const html = sb.buildSessionNotesHtml([{ ts: 1000, text: 'hello' }]);
    assert.ok(html.includes('tf-session-notes'));
    assert.ok(html.includes('hello'));
  });

  it('renders one <li> per note', () => {
    const sb = loadTimeflowSandbox();
    const html = sb.buildSessionNotesHtml([
      { ts: 1000, text: 'first' },
      { ts: 2000, text: 'second' },
    ]);
    const liCount = (html.match(/<li /g) || []).length;
    assert.equal(liCount, 2);
  });

  it('includes tf-sn-time and tf-sn-text spans', () => {
    const sb = loadTimeflowSandbox();
    const html = sb.buildSessionNotesHtml([{ ts: 9999, text: 'note body' }]);
    assert.ok(html.includes('tf-sn-time'));
    assert.ok(html.includes('tf-sn-text'));
    assert.ok(html.includes('note body'));
  });
});

const carryFileSrc = readFileSync(join(__dirname, '../../src/js/11b-timeblock-carry.js'), 'utf8');

describe('regression #227: autoCarryTasks guard key', () => {
  /**
   * Creates a minimal VM sandbox for autoCarryTasks tests.
   * @param {{ today: string, planTasks: object[], guardAlreadySet?: boolean }} opts
   * @returns {{ sb: object, stored: Map<string, string> }}
   */
  function makeCarrySandbox({ today, planTasks: tasks, guardAlreadySet = false }) {
    const stored = new Map();
    if (guardAlreadySet) stored.set('wl_carried_' + today, '1');

    const sb = {
      localStorage: {
        getItem: (k) => stored.get(k) ?? null,
        setItem: (k, v) => stored.set(k, v),
      },
      wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
      dk: () => today,
      planTasks: tasks.map((t) => ({ ...t })),
      categories: [],
      entries: [],
      savePlan() {
        // no-op — side-effect captured via planTasks reference
      },
      save: () => {},
      render: () => {},
      renderPlan: () => {},
      renderCompleted: () => {},
      getCat: (id) => ({ id, label: id, color: '#888780', billable: true }),
      readCollapseState: () => false,
      writeCollapseState: () => {},
      resolveCarryStatus: pureFns.resolveCarryStatus,
      document: {
        getElementById: () => ({ addEventListener: () => {}, style: {}, textContent: '' }),
        addEventListener: () => {},
      },
    };
    vm.createContext(sb);
    vm.runInContext(carryFileSrc, sb);
    return { sb, stored };
  }

  it('does NOT set the guard key when all past tasks are done', () => {
    const { sb, stored } = makeCarrySandbox({
      today: '2026-06-18',
      planTasks: [
        { id: '1', text: 'Task A', date: '2026-06-17', status: 'done' },
        { id: '2', text: 'Task B', date: '2026-06-17', status: 'done' },
      ],
    });
    vm.runInContext('autoCarryTasks();', sb);
    assert.equal(
      stored.get('wl_carried_2026-06-18'),
      undefined,
      'guard key must not be set when nothing was carried'
    );
  });

  it('does NOT set the guard key when all past tasks are upcoming', () => {
    const { sb, stored } = makeCarrySandbox({
      today: '2026-06-18',
      planTasks: [{ id: '1', text: 'Future task', date: '2026-06-17', status: 'upcoming' }],
    });
    vm.runInContext('autoCarryTasks();', sb);
    assert.equal(stored.get('wl_carried_2026-06-18'), undefined);
  });

  it('does NOT set the guard key when planTasks is empty', () => {
    const { sb, stored } = makeCarrySandbox({ today: '2026-06-18', planTasks: [] });
    vm.runInContext('autoCarryTasks();', sb);
    assert.equal(stored.get('wl_carried_2026-06-18'), undefined);
  });

  it('sets the guard key and carries unfinished tasks when they exist', () => {
    const { sb, stored } = makeCarrySandbox({
      today: '2026-06-18',
      planTasks: [
        { id: '1', text: 'Carry me', date: '2026-06-17', status: 'inprogress' },
        { id: '2', text: 'Done already', date: '2026-06-17', status: 'done' },
      ],
    });
    vm.runInContext('autoCarryTasks();', sb);
    assert.equal(stored.get('wl_carried_2026-06-18'), '1', 'guard key must be set after carry');
    const todayTask = sb.planTasks.find((t) => t.date === '2026-06-18');
    assert.ok(todayTask, 'carried task must exist for today');
    assert.equal(todayTask.text, 'Carry me');
    assert.equal(todayTask.status, 'inprogress');
  });

  it('returns early without changes when guard key is already set', () => {
    const { sb, stored } = makeCarrySandbox({
      today: '2026-06-18',
      planTasks: [{ id: '1', text: 'Not carried', date: '2026-06-17', status: 'todo' }],
      guardAlreadySet: true,
    });
    vm.runInContext('autoCarryTasks();', sb);
    // planTasks length must be unchanged (no new tasks added)
    assert.equal(sb.planTasks.length, 1, 'no tasks should be added when guard is set');
    assert.equal(stored.get('wl_carried_2026-06-18'), '1');
  });
});
