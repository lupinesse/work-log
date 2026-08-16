/**
 * @file monthlylog.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname } from './_helpers.mjs';

/**
 * Loads 19-monthlylog.js into a VM sandbox so its function declarations
 * become sandbox properties. The file expects browser globals at parse
 * time (`document`, etc.) and reads module-level state from globals
 * (`viewDate`, `_mlYear`, `_mlMonth`) — we stub the minimum needed.
 *
 * @returns {Object} Populated VM sandbox.
 */
function loadMonthlyLogSandbox() {
  const monthlySrc = readFileSync(join(__dirname, '../../src/js/19-monthlylog.js'), 'utf8');
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
    getReflectionForDate: () => null,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    console,
  };
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
