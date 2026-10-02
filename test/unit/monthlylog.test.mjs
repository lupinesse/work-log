/**
 * @file monthlylog.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname, createDom } from './_helpers.mjs';

const monthlySrc = readFileSync(join(__dirname, '../../src/js/19-monthlylog.js'), 'utf8');

/**
 * Builds the `YYYY-MM` month prefix for the given year and 0-based month.
 * @param {number} year - Full year.
 * @param {number} month - Month index, 0-based.
 * @returns {string}
 */
function monthPrefix(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Loads 19-monthlylog.js into a VM sandbox so its function declarations
 * become sandbox properties. The file expects browser globals at parse
 * time (`document`, etc.) and reads module-level state from globals
 * (`viewDate`, `_mlYear`, `_mlMonth`) — we stub the minimum needed.
 *
 * @returns {Object} Populated VM sandbox.
 */
function loadMonthlyLogSandbox() {
  const sandbox = {
    document: { getElementById: () => null, addEventListener: () => {} },
    entries: [],
    planTasks: [],
    viewDate: new Date(),
    render: () => {},
    fmtDur: () => '',
    escHtml: (s) => String(s),
    getCatLabel: () => '',
    isEntryBillable: () => false,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    console,
  };
  sandbox.getEntries = () => sandbox.entries;
  sandbox.getPlanTasks = () => sandbox.planTasks;
  vm.createContext(sandbox);
  vm.runInContext(monthlySrc, sandbox);
  return sandbox;
}

describe('calcMonthSummaryStats', () => {
  const PREFIX = '2026-05';
  // Stub predicate: an entry is billable when its tag === 'work'.
  const billableByTag = (e) => e.tag === 'work';

  it('returns zeros and null topTag for empty input', () => {
    const { calcMonthSummaryStats } = loadMonthlyLogSandbox();
    const stats = calcMonthSummaryStats([], PREFIX, billableByTag);
    assert.equal(stats.totalMs, 0);
    assert.equal(stats.billableMs, 0);
    assert.equal(stats.topTag, null);
  });

  it('filters out entries from other months', () => {
    const { calcMonthSummaryStats } = loadMonthlyLogSandbox();
    const data = [
      { date: '2026-05-10', tag: 'work', ts: 0, tsEnd: 1000 },
      { date: '2026-04-30', tag: 'work', ts: 0, tsEnd: 9_999_999 },
    ];
    const stats = calcMonthSummaryStats(data, PREFIX, billableByTag);
    assert.equal(stats.totalMs, 1000, 'only May entry counted');
  });

  it('excludes entries with no tsEnd (timer still running)', () => {
    const { calcMonthSummaryStats } = loadMonthlyLogSandbox();
    const data = [
      { date: '2026-05-10', tag: 'work', ts: 0, tsEnd: 1000 },
      { date: '2026-05-10', tag: 'work', ts: 0 }, // running
    ];
    const stats = calcMonthSummaryStats(data, PREFIX, billableByTag);
    assert.equal(stats.totalMs, 1000);
  });

  it("excludes entries with signifier === 'cancelled'", () => {
    const { calcMonthSummaryStats } = loadMonthlyLogSandbox();
    const data = [
      { date: '2026-05-10', tag: 'work', ts: 0, tsEnd: 1000 },
      { date: '2026-05-10', tag: 'work', ts: 0, tsEnd: 5000, signifier: 'cancelled' },
    ];
    const stats = calcMonthSummaryStats(data, PREFIX, billableByTag);
    assert.equal(stats.totalMs, 1000);
  });

  it('only counts entries passing isBillable in billableMs', () => {
    const { calcMonthSummaryStats } = loadMonthlyLogSandbox();
    const data = [
      { date: '2026-05-10', tag: 'work', ts: 0, tsEnd: 2000 },
      { date: '2026-05-11', tag: 'admin', ts: 0, tsEnd: 3000 },
    ];
    const stats = calcMonthSummaryStats(data, PREFIX, billableByTag);
    assert.equal(stats.totalMs, 5000);
    assert.equal(stats.billableMs, 2000, 'only work-tag entry is billable');
  });

  it('topTag is the tag with the largest total duration', () => {
    const { calcMonthSummaryStats } = loadMonthlyLogSandbox();
    const data = [
      { date: '2026-05-10', tag: 'work', ts: 0, tsEnd: 1000 },
      { date: '2026-05-11', tag: 'admin', ts: 0, tsEnd: 5000 },
      { date: '2026-05-12', tag: 'work', ts: 0, tsEnd: 2000 },
    ];
    const stats = calcMonthSummaryStats(data, PREFIX, billableByTag);
    assert.equal(stats.topTag, 'admin', 'admin has 5000ms vs work 3000ms');
  });
});

describe('calcMonthTaskCounts', () => {
  const PREFIX = '2026-05';

  it('returns zero counts for empty input', () => {
    const { calcMonthTaskCounts } = loadMonthlyLogSandbox();
    const counts = calcMonthTaskCounts([], PREFIX);
    assert.equal(counts.open, 0);
    assert.equal(counts.done, 0);
    assert.equal(counts.migrated, 0);
  });

  it('filters tasks by month prefix', () => {
    const { calcMonthTaskCounts } = loadMonthlyLogSandbox();
    const data = [
      { date: '2026-05-01', status: 'todo' },
      { date: '2026-04-30', status: 'todo' },
    ];
    const counts = calcMonthTaskCounts(data, PREFIX);
    assert.equal(counts.open, 1, 'April task ignored');
  });

  it('counts open as status !== done', () => {
    const { calcMonthTaskCounts } = loadMonthlyLogSandbox();
    const data = [
      { date: '2026-05-01', status: 'todo' },
      { date: '2026-05-02', status: 'inprogress' },
      { date: '2026-05-03', status: 'pending' },
      { date: '2026-05-04', status: 'done' },
    ];
    const counts = calcMonthTaskCounts(data, PREFIX);
    assert.equal(counts.open, 3, 'todo + inprogress + pending');
    assert.equal(counts.done, 1);
  });

  it("counts migrated by signifier === 'migrated' OR _migrated flag", () => {
    const { calcMonthTaskCounts } = loadMonthlyLogSandbox();
    const data = [
      { date: '2026-05-01', status: 'todo', signifier: 'migrated' },
      { date: '2026-05-02', status: 'todo', _migrated: true },
      { date: '2026-05-03', status: 'todo' },
    ];
    const counts = calcMonthTaskCounts(data, PREFIX);
    assert.equal(counts.migrated, 2, 'both BuJo and programmatic markers count');
  });
});

// ── buildMonthlyCalendarHtml — WCAG keyboard and label tests ──────────────────

describe('buildMonthlyCalendarHtml — day cells are keyboard-operable buttons', () => {
  // May 2026: 31 days, starts on a Friday (offset 4)
  const YEAR = 2026;
  const MONTH = 4; // May (0-indexed)
  const PREFIX = monthPrefix(YEAR, MONTH);

  it('renders every day cell as a <button> element (WCAG 2.1.1 Keyboard)', () => {
    const { buildMonthlyCalendarHtml } = loadMonthlyLogSandbox();
    const html = buildMonthlyCalendarHtml(YEAR, MONTH, PREFIX);
    const { window } = createDom(`<div>${html}</div>`);
    const cells = [...window.document.querySelectorAll('.ml-cell')];
    assert.ok(cells.length > 0, 'at least one day cell rendered');
    assert.ok(
      cells.every((c) => c.tagName === 'BUTTON'),
      'all .ml-cell elements must be <button> for native keyboard access'
    );
  });

  it('day cell buttons have type="button" to avoid accidental form submission', () => {
    const { buildMonthlyCalendarHtml } = loadMonthlyLogSandbox();
    const html = buildMonthlyCalendarHtml(YEAR, MONTH, PREFIX);
    const { window } = createDom(`<div>${html}</div>`);
    const cells = [...window.document.querySelectorAll('button.ml-cell')];
    assert.ok(
      cells.every((c) => c.getAttribute('type') === 'button'),
      'type="button" present on every day cell'
    );
  });

  it('day cell aria-label includes the day number (WCAG 4.1.2)', () => {
    const { buildMonthlyCalendarHtml } = loadMonthlyLogSandbox();
    const html = buildMonthlyCalendarHtml(YEAR, MONTH, PREFIX);
    const { window } = createDom(`<div>${html}</div>`);
    const cell = window.document.querySelector('.ml-cell[data-date="2026-05-01"]');
    assert.ok(cell, 'day 1 cell present');
    const label = cell.getAttribute('aria-label') ?? '';
    assert.ok(label.length > 0, 'aria-label must not be empty');
    assert.match(label, /\b1\b/, 'aria-label includes the day number 1');
  });

  it('day cell aria-label includes logged hours (WCAG 4.1.2)', () => {
    const { buildMonthlyCalendarHtml } = loadMonthlyLogSandbox();
    const html = buildMonthlyCalendarHtml(YEAR, MONTH, PREFIX);
    const { window } = createDom(`<div>${html}</div>`);
    const cell = window.document.querySelector('.ml-cell[data-date="2026-05-15"]');
    assert.ok(cell, 'day 15 cell present');
    // Sandbox has no entries → 0.0h for every cell.
    assert.match(cell.getAttribute('aria-label') ?? '', /0\.0h/, 'zero hours reflected in label');
  });

  it('day cells are keyboard-operable: click triggers setViewDate with correct date', () => {
    // Load the full module into a jsdom window context so event bindings work.
    const dom = createDom(
      '<div id="mlCalendar"></div><div id="mlSummary"></div><div id="mlTasks"></div>'
    );
    const ctx = dom.getInternalVMContext();

    ctx.entries = [];
    ctx.getEntries = () => ctx.entries;
    ctx.planTasks = [];
    ctx.getPlanTasks = () => ctx.planTasks;
    ctx.viewDate = new dom.window.Date();
    ctx.fmtDur = () => '';
    ctx.escHtml = (s) => String(s);
    ctx.getCatLabel = () => '';
    ctx.isEntryBillable = () => false;
    ctx.wlLog = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };
    ctx.console = console;

    let capturedDate = null;
    ctx.setViewDate = (d) => {
      capturedDate = d;
    };
    ctx.setFlowView = () => {};
    ctx.render = () => {};

    vm.runInContext(monthlySrc, ctx);
    ctx.renderMonthlyLog = () => {}; // prevent full re-render during tests

    const calEl = dom.window.document.getElementById('mlCalendar');
    ctx.renderMonthlyCalendar(calEl, YEAR, MONTH, PREFIX);

    const cell = dom.window.document.querySelector('.ml-cell[data-date="2026-05-10"]');
    assert.ok(cell, 'day 10 cell is in the DOM after render');
    cell.click();
    assert.ok(capturedDate !== null, 'setViewDate called on cell click');
    assert.match(capturedDate.toISOString(), /^2026-05-10/, 'navigates to May 10');

    dom.window.close();
  });
});

describe('buildMonthlyCalendarHtml — prev/next buttons have accessible names', () => {
  it('mlPrev aria-label names the previous month (WCAG 4.1.2)', () => {
    const { buildMonthlyCalendarHtml } = loadMonthlyLogSandbox();
    // May 2026 → prev is April 2026
    const html = buildMonthlyCalendarHtml(2026, 4, monthPrefix(2026, 4));
    const { window } = createDom(`<div>${html}</div>`);
    const btn = window.document.getElementById('mlPrev');
    assert.ok(btn, 'mlPrev button rendered');
    const label = btn.getAttribute('aria-label') ?? '';
    const expected = new Date(2026, 3, 1).toLocaleString('default', {
      month: 'long',
      year: 'numeric',
    });
    assert.ok(label.includes(expected), `aria-label "${label}" must include "${expected}"`);
  });

  it('mlNext aria-label names the next month (WCAG 4.1.2)', () => {
    const { buildMonthlyCalendarHtml } = loadMonthlyLogSandbox();
    // May 2026 → next is June 2026
    const html = buildMonthlyCalendarHtml(2026, 4, monthPrefix(2026, 4));
    const { window } = createDom(`<div>${html}</div>`);
    const btn = window.document.getElementById('mlNext');
    assert.ok(btn, 'mlNext button rendered');
    const label = btn.getAttribute('aria-label') ?? '';
    const expected = new Date(2026, 5, 1).toLocaleString('default', {
      month: 'long',
      year: 'numeric',
    });
    assert.ok(label.includes(expected), `aria-label "${label}" must include "${expected}"`);
  });

  it('month wrap: prev label is correct at January year boundary', () => {
    const { buildMonthlyCalendarHtml } = loadMonthlyLogSandbox();
    // January 2027 → prev is December 2026
    const html = buildMonthlyCalendarHtml(2027, 0, monthPrefix(2027, 0));
    const { window } = createDom(`<div>${html}</div>`);
    const btn = window.document.getElementById('mlPrev');
    const label = btn?.getAttribute('aria-label') ?? '';
    const expected = new Date(2026, 11, 1).toLocaleString('default', {
      month: 'long',
      year: 'numeric',
    });
    assert.ok(label.includes(expected), `year wrap: label "${label}" must include "${expected}"`);
  });
});
