/**
 * @file pure-fns-tasks.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRapidTokens,
  resolveCarryStatus,
  findWeeklyPlanReviewTasks,
  findPromotableTask,
  WORK_LOCATIONS,
  locationFor,
  nextLocation,
} from '../../src/js/pure-fns.js';
import { localDate } from './_helpers.mjs';

describe('resolveRapidDate (via parseRapidTokens)', () => {
  /** Resolve a bare date token through parseRapidTokens and return .date. */
  function resolve(token, refDate) {
    return parseRapidTokens(`>${token}`, [], refDate).date;
  }

  const friday = localDate(2026, 5, 29);

  it('resolves "today"', () => assert.equal(resolve('today', friday), '2026-05-29'));

  it('resolves "TODAY" case-insensitively', () =>
    assert.equal(resolve('TODAY', friday), '2026-05-29'));

  it('resolves "tomorrow"', () => assert.equal(resolve('tomorrow', friday), '2026-05-30'));

  it('resolves "tomorrow" across a month boundary', () =>
    assert.equal(resolve('tomorrow', localDate(2026, 5, 31)), '2026-06-01'));

  it('passes through a valid YYYY-MM-DD verbatim', () =>
    assert.equal(resolve('2026-12-25', friday), '2026-12-25'));

  it('resolves "fri" to the NEXT Friday (not today when today is Friday)', () => {
    // diff = ((5 - 5 + 7) % 7) || 7 = 0 || 7 = 7
    assert.equal(resolve('fri', friday), '2026-06-05');
  });

  it('resolves "mon" to the next Monday from a Friday', () => {
    // diff = ((1 - 5 + 7) % 7) || 7 = 3
    assert.equal(resolve('mon', friday), '2026-06-01');
  });

  it('resolves weekday abbreviations case-insensitively', () => {
    assert.equal(resolve('FRI', friday), '2026-06-05');
    assert.equal(resolve('Mon', friday), '2026-06-01');
  });

  it('leaves unrecognised token in text and sets date to null', () => {
    const result = parseRapidTokens('>nextweek', [], friday);
    assert.equal(result.date, null);
    assert.equal(result.text, '>nextweek');
  });

  it('leaves partial ISO date in text and sets date to null', () => {
    const result = parseRapidTokens('>2026-05', [], friday);
    assert.equal(result.date, null);
    assert.equal(result.text, '>2026-05');
  });
});

describe('parseRapidTokens', () => {
  const cats = [
    { id: 'work', label: 'Work' },
    { id: 'personal', label: 'Personal' },
    { id: 'meeting', label: 'Team Meeting' },
  ];
  const friday = localDate(2026, 5, 29);

  it('returns text unchanged when no tokens present', () => {
    const r = parseRapidTokens('plain text', cats, friday);
    assert.equal(r.text, 'plain text');
    assert.equal(r.tag, null);
    assert.equal(r.signifier, null);
    assert.equal(r.date, null);
  });

  it('resolves #category by id', () => {
    const r = parseRapidTokens('write tests #work', cats, friday);
    assert.equal(r.tag, 'work');
    assert.equal(r.text, 'write tests');
  });

  it('resolves #category by label (case-insensitive)', () => {
    const r = parseRapidTokens('thing #Work', cats, friday);
    assert.equal(r.tag, 'work');
  });

  it('resolves #category by id prefix', () => {
    const r = parseRapidTokens('task #per', cats, friday);
    assert.equal(r.tag, 'personal');
  });

  it('resolves #category by label prefix', () => {
    const r = parseRapidTokens('standup #team', cats, friday);
    assert.equal(r.tag, 'meeting');
  });

  it('leaves unrecognised #token in text', () => {
    const r = parseRapidTokens('task #unknown', cats, friday);
    assert.equal(r.text, 'task #unknown');
    assert.equal(r.tag, null);
  });

  it('resolves !flag signifier shortcode', () => {
    const r = parseRapidTokens('review PR !flag', cats, friday);
    assert.equal(r.signifier, 'flagged');
    assert.equal(r.text, 'review PR');
  });

  it('resolves all !sig aliases', () => {
    const cases = [
      ['!f', 'flagged'],
      ['!star', 'flagged'],
      ['!x', 'cancelled'],
      ['!drop', 'cancelled'],
      ['!cancel', 'cancelled'],
      ['!ot', 'overtime'],
      ['!ev', 'event'],
      ['!e', 'event'],
      ['!m', 'migrated'],
    ];
    cases.forEach(([tok, expected]) => {
      assert.equal(
        parseRapidTokens(`task ${tok}`, cats, friday).signifier,
        expected,
        `${tok} should resolve to ${expected}`
      );
    });
  });

  it('leaves unrecognised !token in text', () => {
    const r = parseRapidTokens('task !urgent', cats, friday);
    assert.equal(r.text, 'task !urgent');
    assert.equal(r.signifier, null);
  });

  it('resolves >tomorrow date token', () => {
    const r = parseRapidTokens('prep slides >tomorrow', cats, friday);
    assert.equal(r.date, '2026-05-30');
    assert.equal(r.text, 'prep slides');
  });

  it('resolves >today date token', () => {
    const r = parseRapidTokens('checkin >today', cats, friday);
    assert.equal(r.date, '2026-05-29');
  });

  it('resolves >YYYY-MM-DD exact date token', () => {
    const r = parseRapidTokens('dentist >2026-07-10', cats, friday);
    assert.equal(r.date, '2026-07-10');
  });

  it('leaves unrecognised >token in text', () => {
    const r = parseRapidTokens('task >nextweek', cats, friday);
    assert.equal(r.text, 'task >nextweek');
    assert.equal(r.date, null);
  });

  it('combines all three tokens and strips extra whitespace', () => {
    const r = parseRapidTokens('review code #work !flag >tomorrow', cats, friday);
    assert.equal(r.text, 'review code');
    assert.equal(r.tag, 'work');
    assert.equal(r.signifier, 'flagged');
    assert.equal(r.date, '2026-05-30');
  });

  it('returns empty text when input contains only recognised tokens', () => {
    const r = parseRapidTokens('#work !flag', cats, friday);
    assert.equal(r.text, '');
    assert.equal(r.tag, 'work');
    assert.equal(r.signifier, 'flagged');
  });

  it('last #category token wins', () => {
    const r = parseRapidTokens('task #work #personal', cats, friday);
    assert.equal(r.tag, 'personal');
  });

  it('works with an empty cats array — unresolved token left in text', () => {
    const r = parseRapidTokens('task #work', [], friday);
    assert.equal(r.text, 'task #work');
    assert.equal(r.tag, null);
  });
});

describe('resolveCarryStatus', () => {
  const prev = (status, date = '2026-01-01') => ({ status, date, text: 'Task' });
  const today = (status) => ({ status, text: 'Task' });

  // ── pending / blocked: override todo or inprogress ──
  it('pending prev overrides todo today', () =>
    assert.equal(resolveCarryStatus(today('todo'), prev('pending')), 'pending'));

  it('pending prev overrides inprogress today', () =>
    assert.equal(resolveCarryStatus(today('inprogress'), prev('pending')), 'pending'));

  it('blocked prev overrides todo today', () =>
    assert.equal(resolveCarryStatus(today('todo'), prev('blocked')), 'blocked'));

  it('blocked prev overrides inprogress today', () =>
    assert.equal(resolveCarryStatus(today('inprogress'), prev('blocked')), 'blocked'));

  // ── upcoming: only overrides todo, NOT inprogress (bug-fix guard) ──
  it('upcoming prev overrides todo today', () =>
    assert.equal(resolveCarryStatus(today('todo'), prev('upcoming')), 'upcoming'));

  it('upcoming prev does NOT override inprogress today', () =>
    assert.equal(
      resolveCarryStatus(today('inprogress'), prev('upcoming')),
      null,
      'should not revert an inprogress task to upcoming on reload'
    ));

  // ── inprogress promotion ──
  it('inprogress prev promotes todo today', () =>
    assert.equal(resolveCarryStatus(today('todo'), prev('inprogress')), 'inprogress'));

  it('inprogress prev does not touch inprogress today', () =>
    assert.equal(resolveCarryStatus(today('inprogress'), prev('inprogress')), null));

  // ── no-change cases ──
  it('returns null when prev is done', () =>
    assert.equal(resolveCarryStatus(today('todo'), prev('done')), null));

  it('returns null when today is done', () =>
    assert.equal(resolveCarryStatus(today('done'), prev('pending')), null));

  it('returns null when today is pending and prev is pending', () =>
    assert.equal(resolveCarryStatus(today('pending'), prev('pending')), null));

  it('returns null when today is upcoming', () =>
    assert.equal(resolveCarryStatus(today('upcoming'), prev('upcoming')), null));
});

describe('findWeeklyPlanReviewTasks', () => {
  const WEEK_START = '2026-06-01'; // Monday
  const WEEK_END = '2026-06-08'; // following Monday
  const base = { id: '1', text: 'PROJ-1: Fix login', status: 'upcoming', date: '2026-06-03' };

  it('includes an upcoming task dated inside the window', () => {
    assert.deepEqual(findWeeklyPlanReviewTasks([base], WEEK_START, WEEK_END), [base]);
  });

  for (const status of ['todo', 'inprogress', 'pending', 'blocked', 'done']) {
    it(`excludes a "${status}" task even when dated inside the window`, () => {
      assert.deepEqual(findWeeklyPlanReviewTasks([{ ...base, status }], WEEK_START, WEEK_END), []);
    });
  }

  it('excludes an upcoming task dated before the window', () => {
    assert.deepEqual(
      findWeeklyPlanReviewTasks([{ ...base, date: '2026-05-31' }], WEEK_START, WEEK_END),
      []
    );
  });

  it('excludes an upcoming task dated exactly at the window end (exclusive)', () => {
    assert.deepEqual(
      findWeeklyPlanReviewTasks([{ ...base, date: WEEK_END }], WEEK_START, WEEK_END),
      []
    );
  });

  it('includes an upcoming task dated exactly at the window start (inclusive)', () => {
    assert.deepEqual(
      findWeeklyPlanReviewTasks([{ ...base, date: WEEK_START }], WEEK_START, WEEK_END),
      [{ ...base, date: WEEK_START }]
    );
  });

  it('sorts matching tasks by date ascending', () => {
    const later = { ...base, id: '2', date: '2026-06-05' };
    const earlier = { ...base, id: '3', date: '2026-06-02' };
    const result = findWeeklyPlanReviewTasks([later, base, earlier], WEEK_START, WEEK_END);
    assert.deepEqual(
      result.map((t) => t.id),
      ['3', '1', '2']
    );
  });

  it('returns an empty array for an empty or missing planTasks array', () => {
    assert.deepEqual(findWeeklyPlanReviewTasks([], WEEK_START, WEEK_END), []);
    assert.deepEqual(findWeeklyPlanReviewTasks(undefined, WEEK_START, WEEK_END), []);
  });
});

describe('findPromotableTask', () => {
  const TODAY = '2026-06-04';
  const task = (overrides) => ({
    id: 't1',
    text: 'Fix login',
    date: TODAY,
    status: 'todo',
    ...overrides,
  });

  it('finds a todo task with matching date and text', () => {
    const t = task();
    assert.equal(findPromotableTask([t], 'Fix login', TODAY), t);
  });

  it('finds an upcoming task with matching date and text', () => {
    const t = task({ status: 'upcoming' });
    assert.equal(findPromotableTask([t], 'Fix login', TODAY), t);
  });

  it('matches case-insensitively', () => {
    const t = task();
    assert.equal(findPromotableTask([t], 'FIX LOGIN', TODAY), t);
  });

  it('returns null when no task matches the text', () => {
    assert.equal(findPromotableTask([task()], 'Something else', TODAY), null);
  });

  it('returns null when the matching task is dated a different day', () => {
    assert.equal(findPromotableTask([task({ date: '2026-06-03' })], 'Fix login', TODAY), null);
  });

  it('returns null when the matching task is already inprogress', () => {
    assert.equal(findPromotableTask([task({ status: 'inprogress' })], 'Fix login', TODAY), null);
  });

  it('returns null when the matching task is done', () => {
    assert.equal(findPromotableTask([task({ status: 'done' })], 'Fix login', TODAY), null);
  });

  it('returns null when the matching task is pending or blocked', () => {
    assert.equal(findPromotableTask([task({ status: 'pending' })], 'Fix login', TODAY), null);
    assert.equal(findPromotableTask([task({ status: 'blocked' })], 'Fix login', TODAY), null);
  });

  it('returns null for an empty or missing planTasks array', () => {
    assert.equal(findPromotableTask([], 'Fix login', TODAY), null);
    assert.equal(findPromotableTask(undefined, 'Fix login', TODAY), null);
  });
});

describe('locationFor', () => {
  it('returns the stored location for a known day', () =>
    assert.equal(locationFor({ '2026-06-03': 'office' }, '2026-06-03'), 'office'));

  it('defaults to remote when the day is unset', () =>
    assert.equal(locationFor({}, '2026-06-03'), 'remote'));

  it('defaults to remote when the day is not in the map', () =>
    assert.equal(locationFor({ '2026-06-02': 'office' }, '2026-06-03'), 'remote'));

  it('falls back to the default for an unknown stored value', () =>
    assert.equal(locationFor({ '2026-06-03': 'moon-base' }, '2026-06-03'), 'remote'));

  it('tolerates a null map', () => assert.equal(locationFor(null, '2026-06-03'), 'remote'));

  it('only ever returns ids present in WORK_LOCATIONS', () =>
    assert.ok(Object.prototype.hasOwnProperty.call(WORK_LOCATIONS, locationFor({}, '2026-06-03'))));
});

describe('nextLocation', () => {
  it('flips remote to office', () => assert.equal(nextLocation('remote'), 'office'));

  it('flips office to remote', () => assert.equal(nextLocation('office'), 'remote'));

  it('wraps an unknown value back to the first location', () =>
    assert.equal(nextLocation('bogus'), Object.keys(WORK_LOCATIONS)[0]));

  it('returns to the original after two toggles', () =>
    assert.equal(nextLocation(nextLocation('remote')), 'remote'));
});
