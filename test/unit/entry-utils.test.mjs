/**
 * @file entry-utils.test.mjs
 * Tests for src/js/entry-utils.js (leaf ES module extracted as part of
 * issue #336, extraction #18): safeRoundedStart(), viewEntries().
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { safeRoundedStart, viewEntries } from '../../src/js/entry-utils.js';
import { setEntries, setViewDate } from '../../src/js/state.js';
import { dk, roundToNearest30 } from '../../src/js/pure-fns.js';

beforeEach(() => {
  setEntries([]);
  setViewDate(new Date());
});

describe('safeRoundedStart', () => {
  it('returns a value >= roundToNearest30(Date.now()) when there are no entries', () => {
    const before = roundToNearest30(Date.now());
    const result = safeRoundedStart();
    const after = roundToNearest30(Date.now());
    // result must be within the range [before, after] since it calls roundToNearest30(Date.now()) internally
    assert.ok(result >= before, `expected result ${result} >= before ${before}`);
    assert.ok(result <= after || result === before, `expected result ${result} <= after ${after}`);
  });

  it('returns roundToNearest30(Date.now()) when no today entries have tsEnd', () => {
    const todayKey = dk(new Date());
    // Entry without tsEnd (timer still running)
    setEntries([{ date: todayKey, ts: Date.now() - 3600000 }]);
    const before = roundToNearest30(Date.now());
    const result = safeRoundedStart();
    const after = roundToNearest30(Date.now());
    assert.ok(result >= before);
    assert.ok(result <= after || result === before);
  });

  it('returns lastEnd when a completed entry ends after the current rounded time', () => {
    const todayKey = dk(new Date());
    // A future tsEnd that is definitely past the current rounded time
    const futureEnd = Date.now() + 7200000; // 2 hours in the future
    setEntries([{ date: todayKey, ts: Date.now() - 3600000, tsEnd: futureEnd }]);
    const result = safeRoundedStart();
    assert.equal(result, futureEnd);
  });

  it('takes the maximum tsEnd when there are multiple completed entries today', () => {
    const todayKey = dk(new Date());
    const now = Date.now();
    const laterEnd = now + 7200000;
    const earlierEnd = now + 3600000;
    setEntries([
      { date: todayKey, ts: now - 7200000, tsEnd: earlierEnd },
      { date: todayKey, ts: now - 3600000, tsEnd: laterEnd },
    ]);
    const result = safeRoundedStart();
    assert.equal(result, laterEnd);
  });

  it('ignores entries from other dates when computing lastEnd', () => {
    const todayKey = dk(new Date());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = dk(yesterday);
    const futureEnd = Date.now() + 7200000;
    setEntries([
      // Yesterday's entry with a huge tsEnd — must not influence today's result
      { date: yesterdayKey, ts: Date.now() - 90000000, tsEnd: futureEnd + 999999 },
      // Today's entry with a modest tsEnd
      { date: todayKey, ts: Date.now() - 3600000, tsEnd: futureEnd },
    ]);
    const result = safeRoundedStart();
    assert.equal(result, futureEnd);
  });

  it('returns roundToNearest30(Date.now()) when all today entries have no tsEnd', () => {
    const todayKey = dk(new Date());
    setEntries([
      { date: todayKey, ts: Date.now() - 3600000 }, // no tsEnd
      { date: todayKey, ts: Date.now() - 1800000 }, // no tsEnd
    ]);
    const before = roundToNearest30(Date.now());
    const result = safeRoundedStart();
    const after = roundToNearest30(Date.now());
    assert.ok(result >= before);
    assert.ok(result <= after || result === before);
  });
});

describe('viewEntries', () => {
  it('returns an empty array when there are no entries', () => {
    assert.deepEqual(viewEntries(), []);
  });

  it('returns only entries for the currently viewed date', () => {
    const today = new Date();
    const todayKey = dk(today);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = dk(yesterday);
    setViewDate(today);
    setEntries([
      { date: todayKey, ts: 1000 },
      { date: yesterdayKey, ts: 2000 },
    ]);
    const result = viewEntries();
    assert.equal(result.length, 1);
    assert.equal(result[0].date, todayKey);
  });

  it('returns an empty array when no entries match the viewed date', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    setViewDate(yesterday);
    const todayKey = dk(new Date());
    setEntries([{ date: todayKey, ts: 1000 }]);
    assert.deepEqual(viewEntries(), []);
  });

  it('sorts entries newest-first by ts', () => {
    const today = new Date();
    setViewDate(today);
    const todayKey = dk(today);
    setEntries([
      { date: todayKey, ts: 1000 },
      { date: todayKey, ts: 3000 },
      { date: todayKey, ts: 2000 },
    ]);
    const result = viewEntries();
    assert.equal(result[0].ts, 3000);
    assert.equal(result[1].ts, 2000);
    assert.equal(result[2].ts, 1000);
  });

  it('does not mutate the original entries array order', () => {
    const today = new Date();
    setViewDate(today);
    const todayKey = dk(today);
    const entries = [
      { date: todayKey, ts: 1000 },
      { date: todayKey, ts: 3000 },
      { date: todayKey, ts: 2000 },
    ];
    setEntries(entries);
    viewEntries();
    // Original array must retain insertion order
    assert.equal(entries[0].ts, 1000);
    assert.equal(entries[1].ts, 3000);
    assert.equal(entries[2].ts, 2000);
  });

  it('returns the correct view when setViewDate is changed between calls', () => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const todayKey = dk(today);
    const yesterdayKey = dk(yesterday);
    setEntries([
      { date: todayKey, ts: 1000 },
      { date: yesterdayKey, ts: 2000 },
    ]);
    setViewDate(today);
    assert.equal(viewEntries().length, 1);
    assert.equal(viewEntries()[0].date, todayKey);
    setViewDate(yesterday);
    assert.equal(viewEntries().length, 1);
    assert.equal(viewEntries()[0].date, yesterdayKey);
  });
});
