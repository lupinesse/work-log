/**
 * @file pure-fns-epics.test.mjs
 * Unit tests for the epic staleness/archiving helpers (pure-fns-epics.js).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EPIC_STALE_DAYS,
  PROTECTED_CAT_IDS,
  epicCutoffDate,
  collectRecentlyUsedCatIds,
  findStaleCategories,
  pickableCategories,
  applyEpicArchive,
  restoreArchivedCategory,
} from '../../src/js/pure-fns-epics.js';

const TODAY = '2026-08-21';

/** Shorthand category factory keeping the fixtures readable. */
const cat = (id, extra = {}) => ({ id, label: id.toUpperCase(), color: '#123456', ...extra });

describe('epicCutoffDate', () => {
  const cases = [
    { today: '2026-08-21', days: 21, expected: '2026-08-01' },
    { today: '2026-08-21', days: 1, expected: '2026-08-21' },
    { today: '2026-03-01', days: 21, expected: '2026-02-09' }, // crosses a month boundary
    { today: '2026-01-10', days: 21, expected: '2025-12-21' }, // crosses a year boundary
  ];
  cases.forEach(({ today, days, expected }) => {
    it(`returns ${expected} for ${today} - ${days}d`, () => {
      assert.equal(epicCutoffDate(today, days), expected);
    });
  });
});

describe('collectRecentlyUsedCatIds', () => {
  it('collects tags from both entries and plan tasks inside the window', () => {
    const used = collectRecentlyUsedCatIds(
      {
        entries: [{ tag: 'a', date: '2026-08-10' }],
        planTasks: [{ tag: 'b', date: '2026-08-05' }],
      },
      '2026-08-01'
    );
    assert.deepEqual([...used].sort(), ['a', 'b']);
  });

  it('ignores records dated before the cutoff', () => {
    const used = collectRecentlyUsedCatIds(
      { entries: [{ tag: 'old', date: '2026-07-31' }] },
      '2026-08-01'
    );
    assert.equal(used.has('old'), false);
  });

  it('counts a record dated exactly on the cutoff as recent', () => {
    const used = collectRecentlyUsedCatIds(
      { entries: [{ tag: 'edge', date: '2026-08-01' }] },
      '2026-08-01'
    );
    assert.equal(used.has('edge'), true);
  });

  it('ignores undated or untagged records rather than assuming they are recent', () => {
    const used = collectRecentlyUsedCatIds(
      { entries: [{ tag: 'undated' }, { date: '2026-08-10' }, null], planTasks: [] },
      '2026-08-01'
    );
    assert.equal(used.size, 0);
  });
});

describe('findStaleCategories', () => {
  it('flags only epics with no entry and no task in the window', () => {
    const { staleIds, cutoffIso } = findStaleCategories({
      categories: [cat('fresh'), cat('stale'), cat('taskOnly')],
      entries: [{ tag: 'fresh', date: '2026-08-20' }],
      planTasks: [{ tag: 'taskOnly', date: '2026-08-15' }],
      todayIso: TODAY,
    });
    assert.deepEqual(staleIds, ['stale']);
    assert.equal(cutoffIso, '2026-08-01');
  });

  it('never flags a built-in epic, even when completely unused', () => {
    const { staleIds } = findStaleCategories({
      categories: PROTECTED_CAT_IDS.map((id) => cat(id)),
      entries: [],
      planTasks: [],
      todayIso: TODAY,
    });
    assert.deepEqual(staleIds, []);
  });

  it('never flags the currently selected epic', () => {
    const { staleIds } = findStaleCategories({
      categories: [cat('selected'), cat('stale')],
      entries: [],
      planTasks: [],
      todayIso: TODAY,
      selectedTag: 'selected',
    });
    assert.deepEqual(staleIds, ['stale']);
  });

  it('skips epics that are already archived so tidying twice is a no-op', () => {
    const categories = [cat('stale')];
    const first = findStaleCategories({ categories, entries: [], planTasks: [], todayIso: TODAY });
    const second = findStaleCategories({
      categories: applyEpicArchive(categories, first.staleIds),
      entries: [],
      planTasks: [],
      todayIso: TODAY,
    });
    assert.deepEqual(first.staleIds, ['stale']);
    assert.deepEqual(second.staleIds, []);
  });

  it('keeps an epic used exactly 21 days ago and drops one used 22 days ago', () => {
    const { staleIds } = findStaleCategories({
      categories: [cat('day21'), cat('day22')],
      entries: [
        { tag: 'day21', date: '2026-08-01' },
        { tag: 'day22', date: '2026-07-31' },
      ],
      planTasks: [],
      todayIso: TODAY,
      windowDays: EPIC_STALE_DAYS,
    });
    assert.deepEqual(staleIds, ['day22']);
  });

  it('returns an empty list for an empty category set', () => {
    const { staleIds } = findStaleCategories({ categories: [], todayIso: TODAY });
    assert.deepEqual(staleIds, []);
  });
});

describe('pickableCategories', () => {
  it('hides archived epics', () => {
    const result = pickableCategories([cat('a'), cat('b', { archived: true })]);
    assert.deepEqual(
      result.map((c) => c.id),
      ['a']
    );
  });

  it('keeps an archived epic visible when it is the one currently selected', () => {
    const result = pickableCategories([cat('a'), cat('b', { archived: true })], 'b');
    assert.deepEqual(
      result.map((c) => c.id),
      ['a', 'b']
    );
  });
});

describe('applyEpicArchive', () => {
  it('flags the listed epics without dropping or mutating any record', () => {
    const categories = [cat('a'), cat('b')];
    const result = applyEpicArchive(categories, ['b']);
    assert.equal(result.length, 2);
    assert.equal(result[1].archived, true);
    assert.equal(result[1].label, 'B', 'label is preserved for historical entries');
    assert.equal(categories[1].archived, undefined, 'input array is not mutated');
  });
});

describe('restoreArchivedCategory', () => {
  it('clears the archived flag from one epic only', () => {
    const result = restoreArchivedCategory(
      [cat('a', { archived: true }), cat('b', { archived: true })],
      'a'
    );
    assert.equal('archived' in result[0], false);
    assert.equal(result[1].archived, true);
  });
});
