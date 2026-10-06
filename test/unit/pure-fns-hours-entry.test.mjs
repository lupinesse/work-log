/**
 * @file pure-fns-hours-entry.test.mjs
 * Unit tests for the daily hours entry builder.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimesheetDescription,
  buildTimesheetDayPayload,
  resolveEodTimestamp,
  selectUnfinishedWorkedTasks,
  selectDevChangesForDay,
} from '../../src/js/pure-fns-hours-entry.js';

const HOUR = 3600000;
const label = (id) =>
  // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
  ({ review: 'ticket review', meeting: 'meetings', work: 'test execution' })[id] ?? id;
const entry = (text, tag, startHour, endHour) => ({
  text,
  tag,
  ts: startHour * HOUR,
  tsEnd: endHour * HOUR,
});

describe('buildTimesheetDescription', () => {
  it('groups tasks by category in the house style, without durations', () => {
    const description = buildTimesheetDescription(
      [
        entry('AITO-198711', 'review', 0, 1),
        entry('FUAT bi-daily', 'meeting', 1, 2),
        entry('AITO-204930', 'review', 2, 3),
      ],
      label
    );
    assert.equal(description, 'ticket review (AITO-198711, AITO-204930), meetings (FUAT bi-daily)');
  });

  it('lists a task worked in two blocks once, case-insensitively', () => {
    const description = buildTimesheetDescription(
      [entry('AITO-1: Flow', 'work', 0, 1), entry('aito-1: flow', 'work', 2, 3)],
      label
    );
    assert.equal(description, 'test execution (AITO-1: Flow)');
  });

  it('treats a missing tag as other and skips blank text', () => {
    const description = buildTimesheetDescription(
      [{ text: 'Misc', ts: 0, tsEnd: HOUR }, entry('  ', 'work', 1, 2)],
      label
    );
    assert.equal(description, 'other (Misc)');
  });

  it('returns an empty string for no entries', () => {
    assert.equal(buildTimesheetDescription([], label), '');
  });
});

describe('buildTimesheetDayPayload', () => {
  it('sums all tracked time into decimal hours rounded to two places', () => {
    const payload = buildTimesheetDayPayload(
      '2026-09-30',
      [entry('A', 'work', 0, 3.5), { text: 'B', tag: 'meeting', ts: 0, tsEnd: 1200000 }],
      label
    );
    assert.deepEqual(payload, {
      date: '2026-09-30',
      hours: 3.83,
      description: 'test execution (A), meetings (B)',
    });
  });

  it('returns null when nothing was tracked, so nothing is submitted', () => {
    assert.equal(buildTimesheetDayPayload('2026-09-30', [], label), null);
  });
});

describe('resolveEodTimestamp', () => {
  const now = new Date(2026, 9, 6, 14, 5).getTime();
  const today = new Date(now);
  const earlierDay = new Date(2026, 9, 5);
  const endOfEarlierDay = new Date(2026, 9, 5, 23, 59, 59, 999).getTime();
  const lastEntryEnd = new Date(2026, 9, 5, 17, 30).getTime();
  const earlierEntries = [
    { ts: new Date(2026, 9, 5, 9).getTime(), tsEnd: new Date(2026, 9, 5, 12).getTime() },
    { ts: new Date(2026, 9, 5, 13).getTime(), tsEnd: lastEntryEnd },
  ];
  const cases = [
    ['today stamps now', today, earlierEntries, now],
    ['an earlier day stamps its last entry end', earlierDay, earlierEntries, lastEntryEnd],
    ['an earlier day ignores entry order', earlierDay, [...earlierEntries].reverse(), lastEntryEnd],
    [
      'an earlier day with no entries stamps the end of that day, never now',
      earlierDay,
      [],
      endOfEarlierDay,
    ],
  ];
  cases.forEach(([name, viewDay, entries, expected]) => {
    it(name, () => assert.equal(resolveEodTimestamp(viewDay, entries, now), expected));
  });
});

describe('selectUnfinishedWorkedTasks', () => {
  const entries = [
    { date: '2026-10-05', text: 'Review ticket' },
    { date: '2026-10-05', text: ' Fix Bug ' },
    { date: '2026-10-06', text: 'Today only' },
    { date: '2026-10-05' },
  ];
  const tasks = [
    { date: '2026-10-05', status: 'todo', text: 'review ticket' },
    { date: '2026-10-05', status: 'done', text: 'fix bug' },
    { date: '2026-10-05', status: 'todo', text: 'never worked on' },
    { date: '2026-10-06', status: 'todo', text: 'today only' },
  ];

  it('selects the viewed earlier day, not today', () => {
    assert.deepEqual(selectUnfinishedWorkedTasks('2026-10-05', entries, tasks), [tasks[0]]);
  });

  it('selects today when today is the viewed day', () => {
    assert.deepEqual(selectUnfinishedWorkedTasks('2026-10-06', entries, tasks), [tasks[3]]);
  });

  it('returns nothing for a day with no entries', () => {
    assert.deepEqual(selectUnfinishedWorkedTasks('2026-10-04', entries, tasks), []);
  });
});

describe('selectDevChangesForDay', () => {
  const devLog = [
    { date: '2026-10-05', desc: 'earlier' },
    { date: '2026-10-06', desc: 'today' },
  ];

  it('returns only the changes dated the viewed day', () => {
    assert.deepEqual(selectDevChangesForDay(devLog, '2026-10-05'), [devLog[0]]);
  });

  it('returns an empty list when nothing was logged that day', () => {
    assert.deepEqual(selectDevChangesForDay(devLog, '2026-10-01'), []);
  });
});
