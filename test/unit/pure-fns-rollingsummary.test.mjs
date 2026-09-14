/**
 * @file pure-fns-rollingsummary.test.mjs
 * Split out of pure-fns-export.test.mjs (QA 2026-09-07, largest-module
 * finding), mirroring the corresponding src/js/pure-fns-*.js split.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRollingSummary } from '../../src/js/pure-fns.js';
import { localMs } from './_helpers.mjs';

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
