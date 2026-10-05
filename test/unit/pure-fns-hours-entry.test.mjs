/**
 * @file pure-fns-hours-entry.test.mjs
 * Unit tests for the daily hours entry builder.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimesheetDescription,
  buildTimesheetDayPayload,
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
