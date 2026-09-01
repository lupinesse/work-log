/**
 * @file pure-fns-format.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  safeCssColor,
  escHtml,
  dk,
  fmtTime,
  fmtElapsed,
  fmtDur,
  fmtAgo,
  fmtDurLong,
  isLongRunningTimer,
  mondayOfWeek,
  roundToNearest30,
} from '../../src/js/pure-fns.js';
import { localMs } from './_helpers.mjs';

describe('safeCssColor', () => {
  const FALLBACK = '#888780';

  it('accepts short hex #rgb', () => assert.equal(safeCssColor('#fff'), '#fff'));
  it('accepts 6-digit hex #rrggbb', () => assert.equal(safeCssColor('#1a2b3c'), '#1a2b3c'));
  it('accepts 8-digit hex #rrggbbaa', () => assert.equal(safeCssColor('#1a2b3cff'), '#1a2b3cff'));
  it('accepts uppercase hex', () => assert.equal(safeCssColor('#AABBCC'), '#AABBCC'));
  it('accepts hsl()', () => assert.equal(safeCssColor('hsl(120, 50%, 50%)'), 'hsl(120, 50%, 50%)'));
  it('accepts hsl() with spaces around values', () =>
    assert.equal(safeCssColor('hsl( 0 , 0% , 0% )'), 'hsl( 0 , 0% , 0% )'));

  it('rejects plain colour name "red"', () => assert.equal(safeCssColor('red'), FALLBACK));
  it('rejects rgb()', () => assert.equal(safeCssColor('rgb(0,0,0)'), FALLBACK));
  it('rejects rgba()', () => assert.equal(safeCssColor('rgba(0,0,0,1)'), FALLBACK));
  it('rejects empty string', () => assert.equal(safeCssColor(''), FALLBACK));
  it('rejects CSS injection attempt', () =>
    assert.equal(safeCssColor('red; background:url(x)'), FALLBACK));
  it('rejects javascript: URI', () => assert.equal(safeCssColor('javascript:alert(1)'), FALLBACK));
  it('coerces non-string to string before testing', () =>
    assert.equal(safeCssColor(null), FALLBACK));
});

describe('escHtml', () => {
  it('escapes &', () => assert.equal(escHtml('a&b'), 'a&amp;b'));
  it('escapes <', () => assert.equal(escHtml('<script>'), '&lt;script&gt;'));
  it('escapes >', () => assert.equal(escHtml('1>0'), '1&gt;0'));
  it('escapes "', () => assert.equal(escHtml('"quoted"'), '&quot;quoted&quot;'));
  it('escapes all four in one string', () =>
    assert.equal(escHtml('<a href="x&y">'), '&lt;a href=&quot;x&amp;y&quot;&gt;'));
  it('passes safe strings through unchanged', () =>
    assert.equal(escHtml('hello world'), 'hello world'));
  it('coerces numbers to string', () => assert.equal(escHtml(42), '42'));
  it('coerces null to string "null"', () => assert.equal(escHtml(null), 'null'));
});

describe('dk', () => {
  // dk uses local date components (getFullYear/getMonth/getDate) — create dates
  // with the local-time constructor (year, month, day, ...) to avoid timezone-
  // dependent failures in CI.
  it('formats a local date as YYYY-MM-DD', () =>
    assert.equal(dk(new Date(2026, 4, 26, 12, 0, 0)), '2026-05-26')); // noon local
  it('returns YYYY-MM-DD at local year-end (11:59 PM)', () =>
    assert.equal(dk(new Date(2026, 11, 31, 23, 59, 0)), '2026-12-31'));
  it('returns YYYY-MM-DD at local midnight (00:00)', () =>
    assert.equal(dk(new Date(2026, 0, 1, 0, 0, 0)), '2026-01-01'));
  it('output matches YYYY-MM-DD pattern', () =>
    assert.match(dk(new Date()), /^\d{4}-\d{2}-\d{2}$/));
});

describe('fmtTime', () => {
  // Uses local time (getHours/getMinutes), so create dates with local constructors.
  it('formats 09:30 with leading zero on hour', () =>
    assert.equal(fmtTime(localMs(2026, 5, 26, 9, 30)), '09:30'));
  it('formats 14:05 with leading zero on minute', () =>
    assert.equal(fmtTime(localMs(2026, 5, 26, 14, 5)), '14:05'));
  it('formats midnight as 00:00', () => assert.equal(fmtTime(localMs(2026, 5, 26, 0, 0)), '00:00'));
  it('formats 23:59', () => assert.equal(fmtTime(localMs(2026, 5, 26, 23, 59)), '23:59'));
  it('output matches HH:MM pattern', () => assert.match(fmtTime(Date.now()), /^\d{2}:\d{2}$/));
});

describe('fmtElapsed', () => {
  it('formats 0ms as 00:00', () => assert.equal(fmtElapsed(0), '00:00'));
  it('formats 90s as 01:30', () => assert.equal(fmtElapsed(90_000), '01:30'));
  it('formats 59s as 00:59', () => assert.equal(fmtElapsed(59_000), '00:59'));
  it('formats exactly 1h as 01:00:00', () => assert.equal(fmtElapsed(3_600_000), '01:00:00'));
  it('formats 1h 1m 1s as 01:01:01', () => assert.equal(fmtElapsed(3_661_000), '01:01:01'));
  it('formats 2h 30m 5s as 02:30:05', () => assert.equal(fmtElapsed(9_005_000), '02:30:05'));
  it('uses MM:SS below 1h', () => assert.match(fmtElapsed(3_599_000), /^\d{2}:\d{2}$/));
  it('uses HH:MM:SS at exactly 1h', () =>
    assert.match(fmtElapsed(3_600_000), /^\d{2}:\d{2}:\d{2}$/));
});

describe('fmtDur', () => {
  it('formats 0ms as 0m', () => assert.equal(fmtDur(0), '0m'));
  it('formats 45 min as 45m', () => assert.equal(fmtDur(45 * 60_000), '45m'));
  it('formats exactly 1h as 1h', () => assert.equal(fmtDur(60 * 60_000), '1h'));
  it('formats 1h 30m as 1h 30m', () => assert.equal(fmtDur(90 * 60_000), '1h 30m'));
  it('formats 2h 0m as 2h (no trailing 0m)', () => assert.equal(fmtDur(120 * 60_000), '2h'));
  it('rounds partial minutes', () => assert.equal(fmtDur(89 * 60_000 + 30_000), '1h 30m'));
});

describe('fmtDurLong', () => {
  it('formats 0ms as 0min', () => assert.equal(fmtDurLong(0), '0min'));
  it('formats 45 min as 45min', () => assert.equal(fmtDurLong(45 * 60_000), '45min'));
  it('formats exactly 1h as 1h (no min suffix)', () => assert.equal(fmtDurLong(60 * 60_000), '1h'));
  it('formats 1h 30m as 1h 30min', () => assert.equal(fmtDurLong(90 * 60_000), '1h 30min'));
  it('formats 2h 0m as 2h (no trailing 0min)', () => assert.equal(fmtDurLong(120 * 60_000), '2h'));
  it('rounds partial minutes', () => assert.equal(fmtDurLong(89 * 60_000 + 30_000), '1h 30min'));
});

describe('fmtAgo', () => {
  const NOW = 1_000_000_000_000; // fixed reference point for deterministic tests

  it('returns "just now" for 0 ms elapsed', () => assert.equal(fmtAgo(NOW, NOW), 'just now'));
  it('returns "just now" for 30 s elapsed', () =>
    assert.equal(fmtAgo(NOW - 30_000, NOW), 'just now'));
  it('returns "just now" for 59 s elapsed', () =>
    assert.equal(fmtAgo(NOW - 59_999, NOW), 'just now'));
  it('returns "1 min ago" for exactly 1 min', () =>
    assert.equal(fmtAgo(NOW - 60_000, NOW), '1 min ago'));
  it('returns "2 min ago" for 2 min', () =>
    assert.equal(fmtAgo(NOW - 2 * 60_000, NOW), '2 min ago'));
  it('returns "59 min ago" for 59 min', () =>
    assert.equal(fmtAgo(NOW - 59 * 60_000, NOW), '59 min ago'));
  it('returns "1h ago" for exactly 1 hour', () =>
    assert.equal(fmtAgo(NOW - 60 * 60_000, NOW), '1h ago'));
  it('returns "2h ago" for 2 hours', () => assert.equal(fmtAgo(NOW - 120 * 60_000, NOW), '2h ago'));
  it('truncates partial hours (89 min → 1h)', () =>
    assert.equal(fmtAgo(NOW - 89 * 60_000, NOW), '1h ago'));
  it('defaults now to Date.now() when omitted (smoke test — result is a string)', () =>
    assert.equal(typeof fmtAgo(Date.now() - 5_000), 'string'));
});

describe('isLongRunningTimer', () => {
  it('returns false under the default 240 min threshold', () =>
    assert.equal(isLongRunningTimer(239 * 60_000), false));
  it('returns false at exactly the default 240 min threshold', () =>
    assert.equal(isLongRunningTimer(240 * 60_000), false));
  it('returns true just past the default 240 min threshold', () =>
    assert.equal(isLongRunningTimer(240 * 60_000 + 1), true));
  it('returns false for 0 ms elapsed', () => assert.equal(isLongRunningTimer(0), false));
  it('respects a custom threshold', () => {
    assert.equal(isLongRunningTimer(29 * 60_000, 30), false);
    assert.equal(isLongRunningTimer(30 * 60_000, 30), false);
    assert.equal(isLongRunningTimer(31 * 60_000, 30), true);
  });
});

describe('mondayOfWeek', () => {
  it('returns that same day at 00:00 when given a Monday', () => {
    const monday = localMs(2026, 6, 1, 9, 30); // 2026-06-01 is a Monday
    assert.equal(mondayOfWeek(monday), localMs(2026, 6, 1, 0, 0, 0));
  });

  it("returns the week's Monday when given a mid-week day", () => {
    const wednesday = localMs(2026, 6, 3, 14, 30); // 2026-06-03 is a Wednesday
    assert.equal(mondayOfWeek(wednesday), localMs(2026, 6, 1, 0, 0, 0));
  });

  it('returns the preceding Monday when given a Sunday', () => {
    const sunday = localMs(2026, 6, 7, 23, 59); // 2026-06-07 is a Sunday
    assert.equal(mondayOfWeek(sunday), localMs(2026, 6, 1, 0, 0, 0));
  });

  it('defaults to Date.now() when omitted (smoke test — returns a number)', () =>
    assert.equal(typeof mondayOfWeek(), 'number'));
});

describe('roundToNearest30', () => {
  /**
   * Build a timestamp with specific minutes; returns the rounded timestamp's minutes.
   */
  function roundedMinutes(inputMinutes) {
    const ts = localMs(2026, 5, 26, 10, inputMinutes, 0);
    return new Date(roundToNearest30(ts)).getMinutes();
  }
  /** Also check that hours advance when rounding past :60. */
  function roundedHour(inputMinutes) {
    const ts = localMs(2026, 5, 26, 10, inputMinutes, 0);
    return new Date(roundToNearest30(ts)).getHours();
  }

  it('0 min → stays at :00', () => assert.equal(roundedMinutes(0), 0));
  it('14 min → rounds down to :00', () => assert.equal(roundedMinutes(14), 0));
  it('15 min → tie rounds DOWN to :00', () => assert.equal(roundedMinutes(15), 0));
  it('16 min → rounds up to :30', () => assert.equal(roundedMinutes(16), 30));
  it('29 min → rounds up to :30', () => assert.equal(roundedMinutes(29), 30));
  it('30 min → stays at :30', () => assert.equal(roundedMinutes(30), 30));
  it('44 min → rounds down to :30', () => assert.equal(roundedMinutes(44), 30));
  it('45 min → tie rounds DOWN to :30', () => assert.equal(roundedMinutes(45), 30));
  it('46 min → rounds up to next hour :00', () => assert.equal(roundedMinutes(46), 0));
  it('59 min → rounds up to next hour :00', () => assert.equal(roundedMinutes(59), 0));
  it('hour advances when rounding past :60', () => assert.equal(roundedHour(46), 11));
  it('seconds are zeroed', () => {
    const ts = localMs(2026, 5, 26, 10, 5, 45);
    assert.equal(new Date(roundToNearest30(ts)).getSeconds(), 0);
  });

  // End-of-day clamping — must not cross into the next day
  it('23:46 clamps to 23:30, not next-day midnight', () => {
    const ts = localMs(2026, 5, 26, 23, 46, 0);
    const r = new Date(roundToNearest30(ts));
    assert.equal(r.getHours(), 23);
    assert.equal(r.getMinutes(), 30);
    assert.equal(r.getDate(), 26, 'must stay on the same day');
  });
  it('23:59 clamps to 23:30, not next-day midnight', () => {
    const ts = localMs(2026, 5, 26, 23, 59, 0);
    const r = new Date(roundToNearest30(ts));
    assert.equal(r.getHours(), 23);
    assert.equal(r.getMinutes(), 30);
    assert.equal(r.getDate(), 26, 'must stay on the same day');
  });
  it('23:30 stays at 23:30', () => {
    const ts = localMs(2026, 5, 26, 23, 30, 0);
    const r = new Date(roundToNearest30(ts));
    assert.equal(r.getHours(), 23);
    assert.equal(r.getMinutes(), 30);
  });
  it('23:16 rounds up to 23:30', () => {
    const ts = localMs(2026, 5, 26, 23, 16, 0);
    const r = new Date(roundToNearest30(ts));
    assert.equal(r.getHours(), 23);
    assert.equal(r.getMinutes(), 30);
  });
});
