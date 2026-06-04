import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pureFns from '../src/js/pure-fns.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const {
  safeCssColor,
  escHtml,
  dk,
  fmtTime,
  fmtElapsed,
  fmtDur,
  fmtDurLong,
  fmtAgo,
  roundUp30,
  roundToNearest30,
  validEntry,
  validCategory,
  validPlanTask,
  validBlock,
  validTimer,
  validPomoEntry,
  validateBackupFile,
  validWeatherResponse,
  validCalendarMeeting,
  validJiraCsvRow,
  resolveRapidDate,
  parseRapidTokens,
  stripJiraPrefix,
  groupEntriesByCategory,
  mergeAdjacentEntries,
  buildBillableSummaryParts,
  computeDayBounds,
  formatGroupedLines,
  resolveCarryStatus,
  locationFor,
  nextLocation,
  WORK_LOCATIONS,
  DEFAULT_WORK_LOCATION,
  buildRollingSummary,
} = pureFns;

// ── Helper ────────────────────────────────────────────────────────────────────
/** Build a Date with specific local-time components. */
function localDate(y, m, d, hh = 0, mm = 0, ss = 0) {
  return new Date(y, m - 1, d, hh, mm, ss, 0);
}
/** Milliseconds from local time components. */
function localMs(y, m, d, hh = 0, mm = 0, ss = 0) {
  return localDate(y, m, d, hh, mm, ss).getTime();
}

// ── safeCssColor ─────────────────────────────────────────────────────────────
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

// ── escHtml ───────────────────────────────────────────────────────────────────
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

// ── dk ────────────────────────────────────────────────────────────────────────
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

// ── fmtTime ───────────────────────────────────────────────────────────────────
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

// ── fmtElapsed ────────────────────────────────────────────────────────────────
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

// ── fmtDur ────────────────────────────────────────────────────────────────────
describe('fmtDur', () => {
  it('formats 0ms as 0m', () => assert.equal(fmtDur(0), '0m'));
  it('formats 45 min as 45m', () => assert.equal(fmtDur(45 * 60_000), '45m'));
  it('formats exactly 1h as 1h', () => assert.equal(fmtDur(60 * 60_000), '1h'));
  it('formats 1h 30m as 1h 30m', () => assert.equal(fmtDur(90 * 60_000), '1h 30m'));
  it('formats 2h 0m as 2h (no trailing 0m)', () => assert.equal(fmtDur(120 * 60_000), '2h'));
  it('rounds partial minutes', () => assert.equal(fmtDur(89 * 60_000 + 30_000), '1h 30m'));
});

// ── fmtDurLong ────────────────────────────────────────────────────────────────
describe('fmtDurLong', () => {
  it('formats 0ms as 0min', () => assert.equal(fmtDurLong(0), '0min'));
  it('formats 45 min as 45min', () => assert.equal(fmtDurLong(45 * 60_000), '45min'));
  it('formats exactly 1h as 1h (no min suffix)', () => assert.equal(fmtDurLong(60 * 60_000), '1h'));
  it('formats 1h 30m as 1h 30min', () => assert.equal(fmtDurLong(90 * 60_000), '1h 30min'));
  it('formats 2h 0m as 2h (no trailing 0min)', () => assert.equal(fmtDurLong(120 * 60_000), '2h'));
  it('rounds partial minutes', () => assert.equal(fmtDurLong(89 * 60_000 + 30_000), '1h 30min'));
});

// ── fmtAgo ───────────────────────────────────────────────────────────────────
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

// ── roundUp30 ─────────────────────────────────────────────────────────────────
describe('roundUp30', () => {
  const SLOT = 30 * 60 * 1000; // 30 min in ms

  it('returns 30 min for 0ms (minimum billable)', () => assert.equal(roundUp30(0), SLOT));
  it('returns 30 min for 1ms', () => assert.equal(roundUp30(1), SLOT));
  it('returns 30 min for exactly 30 min', () => assert.equal(roundUp30(SLOT), SLOT));
  it('returns 60 min for 30 min + 1ms', () => assert.equal(roundUp30(SLOT + 1), SLOT * 2));
  it('returns 60 min for exactly 60 min', () => assert.equal(roundUp30(SLOT * 2), SLOT * 2));
  it('returns 90 min for 60 min + 1ms', () => assert.equal(roundUp30(SLOT * 2 + 1), SLOT * 3));
  it('returns 90 min for a 75-minute task', () =>
    assert.equal(roundUp30(75 * 60 * 1000), SLOT * 3));
});

// ── roundToNearest30 ──────────────────────────────────────────────────────────
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

// ── validEntry ────────────────────────────────────────────────────────────────
describe('validEntry', () => {
  const base = { id: '1', text: 'task', ts: 1234567890, date: '2026-05-26' };

  it('accepts a valid entry', () => assert.ok(validEntry(base)));
  it('rejects null', () => assert.equal(validEntry(null), false));
  it('rejects undefined', () => assert.equal(validEntry(undefined), false));
  it('rejects missing id', () => assert.equal(validEntry({ ...base, id: undefined }), false));
  it('rejects numeric id', () => assert.equal(validEntry({ ...base, id: 42 }), false));
  it('rejects missing text', () => assert.equal(validEntry({ ...base, text: undefined }), false));
  it('rejects missing ts', () => assert.equal(validEntry({ ...base, ts: undefined }), false));
  it('rejects string ts', () => assert.equal(validEntry({ ...base, ts: '1234567890' }), false));
  it('rejects missing date', () => assert.equal(validEntry({ ...base, date: undefined }), false));
  it('rejects date in wrong format DD-MM-YYYY', () =>
    assert.equal(validEntry({ ...base, date: '26-05-2026' }), false));
  it('rejects date with slashes YYYY/MM/DD', () =>
    assert.equal(validEntry({ ...base, date: '2026/05/26' }), false));
  it('tsEnd is optional — entry still valid without it', () => assert.ok(validEntry(base)));
  it('tsEnd present — entry still valid', () =>
    assert.ok(validEntry({ ...base, tsEnd: 9999999999 })));
});

// ── validCategory ─────────────────────────────────────────────────────────────
describe('validCategory', () => {
  const base = { id: 'work', label: 'Work', color: '#378ADD' };

  it('accepts a valid category', () => assert.ok(validCategory(base)));
  it('rejects null', () => assert.equal(validCategory(null), false));
  it('rejects missing id', () => assert.equal(validCategory({ ...base, id: undefined }), false));
  it('rejects missing label', () =>
    assert.equal(validCategory({ ...base, label: undefined }), false));
  it('rejects missing color', () =>
    assert.equal(validCategory({ ...base, color: undefined }), false));
  it('rejects numeric color', () =>
    assert.equal(validCategory({ ...base, color: 0xff0000 }), false));
});

// ── validPlanTask ─────────────────────────────────────────────────────────────
describe('validPlanTask', () => {
  const base = { id: '1', text: 'task', date: '2026-05-26', status: 'todo' };
  const VALID_STATUSES = ['todo', 'inprogress', 'done', 'pending', 'blocked', 'upcoming'];

  it('accepts a valid task', () => assert.ok(validPlanTask(base)));
  it('rejects null', () => assert.equal(validPlanTask(null), false));
  it('rejects missing id', () => assert.equal(validPlanTask({ ...base, id: undefined }), false));
  it('rejects missing text', () =>
    assert.equal(validPlanTask({ ...base, text: undefined }), false));
  it('rejects missing date', () =>
    assert.equal(validPlanTask({ ...base, date: undefined }), false));
  it('rejects bad date format', () =>
    assert.equal(validPlanTask({ ...base, date: '26/05/2026' }), false));
  it('rejects unknown status', () =>
    assert.equal(validPlanTask({ ...base, status: 'wip' }), false));
  it('rejects missing status', () =>
    assert.equal(validPlanTask({ ...base, status: undefined }), false));

  for (const status of VALID_STATUSES) {
    it(`accepts status "${status}"`, () => assert.ok(validPlanTask({ ...base, status })));
  }
});

// ── validBlock ────────────────────────────────────────────────────────────────
describe('validBlock', () => {
  const base = { id: '1', date: '2026-05-26', slot: 2, duration: 1, text: 'standup' };

  it('accepts a valid block', () => assert.ok(validBlock(base)));
  it('rejects null', () => assert.equal(validBlock(null), false));
  it('rejects missing id', () => assert.equal(validBlock({ ...base, id: undefined }), false));
  it('rejects string slot', () => assert.equal(validBlock({ ...base, slot: '2' }), false));
  it('rejects string duration', () => assert.equal(validBlock({ ...base, duration: '1' }), false));
  it('rejects missing text', () => assert.equal(validBlock({ ...base, text: undefined }), false));
});

// ── validTimer ────────────────────────────────────────────────────────────────
describe('validTimer', () => {
  it('accepts a running timer (startTs set)', () =>
    assert.ok(validTimer({ entryId: 'e1', startTs: 1_000_000 })));
  it('accepts a paused timer (paused=true, accumulatedMs set)', () =>
    assert.ok(validTimer({ entryId: 'e1', paused: true, accumulatedMs: 5_000 })));
  it('rejects null', () => assert.equal(validTimer(null), false));
  it('rejects missing entryId', () => assert.equal(validTimer({ startTs: 1_000_000 }), false));
  it('rejects numeric entryId', () =>
    assert.equal(validTimer({ entryId: 42, startTs: 1_000_000 }), false));
  it('rejects paused=true without accumulatedMs', () =>
    assert.equal(validTimer({ entryId: 'e1', paused: true }), false));
  it('rejects paused=true with string accumulatedMs', () =>
    assert.equal(validTimer({ entryId: 'e1', paused: true, accumulatedMs: '5000' }), false));
  it('rejects timer with neither startTs nor paused', () =>
    assert.equal(validTimer({ entryId: 'e1' }), false));
});

// ── validPomoEntry ────────────────────────────────────────────────────────────
describe('validPomoEntry', () => {
  it('accepts a valid pomo entry', () => assert.ok(validPomoEntry({ ts: 1_000_000, mins: 25 })));
  it('rejects null', () => assert.equal(validPomoEntry(null), false));
  it('rejects missing ts', () => assert.equal(validPomoEntry({ mins: 25 }), false));
  it('rejects missing mins', () => assert.equal(validPomoEntry({ ts: 1_000_000 }), false));
  it('rejects string mins', () =>
    assert.equal(validPomoEntry({ ts: 1_000_000, mins: '25' }), false));
  it('rejects string ts', () => assert.equal(validPomoEntry({ ts: '1000000', mins: 25 }), false));
});

// ── validateBackupFile ────────────────────────────────────────────────────────
describe('validateBackupFile', () => {
  const minimalValid = { version: '1', entries: [], categories: [], planTasks: [] };

  it('accepts a minimal valid backup', () => {
    const result = validateBackupFile(minimalValid);
    assert.ok(result.valid, `expected valid, got: ${result.error}`);
  });

  it('accepts a backup with optional arrays', () => {
    const result = validateBackupFile({
      ...minimalValid,
      blocks: [],
      pomoLog: [],
      devLog: [],
      distractions: [],
      qpHidden: [],
    });
    assert.ok(result.valid);
  });

  it('rejects null', () => {
    const result = validateBackupFile(null);
    assert.equal(result.valid, false);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
  });

  it('rejects an array', () => {
    const result = validateBackupFile([]);
    assert.equal(result.valid, false);
  });

  it('rejects a plain string', () => {
    const result = validateBackupFile('backup');
    assert.equal(result.valid, false);
  });

  it('rejects version !== "1"', () => {
    const result = validateBackupFile({ ...minimalValid, version: '2' });
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('"2"'));
  });

  it('rejects missing version field', () => {
    const noVersion = { ...minimalValid };
    delete noVersion.version;
    const result = validateBackupFile(noVersion);
    assert.equal(result.valid, false);
  });

  it('rejects missing entries array', () => {
    const noEntries = { ...minimalValid };
    delete noEntries.entries;
    const result = validateBackupFile(noEntries);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('"entries"'));
  });

  it('rejects missing categories array', () => {
    const noCats = { ...minimalValid };
    delete noCats.categories;
    const result = validateBackupFile(noCats);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('"categories"'));
  });

  it('rejects missing planTasks array', () => {
    const noTasks = { ...minimalValid };
    delete noTasks.planTasks;
    const result = validateBackupFile(noTasks);
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('"planTasks"'));
  });

  it('rejects entries being an object instead of array', () => {
    const result = validateBackupFile({ ...minimalValid, entries: {} });
    assert.equal(result.valid, false);
  });
});

// ── validWeatherResponse ──────────────────────────────────────────────────────
describe('validWeatherResponse', () => {
  const VALID = {
    current: { temperature_2m: 15.3, weather_code: 3 },
    hourly: {
      time: ['2026-05-28T00:00', '2026-05-28T01:00'],
      precipitation_probability: [10, 20],
    },
  };

  it('accepts a well-formed Open-Meteo response', () =>
    assert.equal(validWeatherResponse(VALID), true));
  it('accepts a response with an additional daily block', () =>
    assert.equal(
      validWeatherResponse({
        ...VALID,
        daily: {
          time: ['2026-05-28'],
          sunrise: ['2026-05-28T04:10'],
          sunset: ['2026-05-28T21:50'],
          daylight_duration: [64200],
        },
      }),
      true
    ));
  it('rejects null', () => assert.equal(validWeatherResponse(null), false));
  it('rejects undefined', () => assert.equal(validWeatherResponse(undefined), false));
  it('rejects empty object', () => assert.equal(validWeatherResponse({}), false));
  it('rejects when current block is missing', () =>
    assert.equal(validWeatherResponse({ hourly: VALID.hourly }), false));
  it('rejects when hourly block is missing', () =>
    assert.equal(validWeatherResponse({ current: VALID.current }), false));
  it('rejects when temperature_2m is missing from current', () =>
    assert.equal(
      validWeatherResponse({ current: { weather_code: 3 }, hourly: VALID.hourly }),
      false
    ));
  it('rejects when weather_code is a string instead of number', () =>
    assert.equal(
      validWeatherResponse({
        current: { temperature_2m: 15, weather_code: '3' },
        hourly: VALID.hourly,
      }),
      false
    ));
  it('rejects when hourly.time is not an array', () =>
    assert.equal(
      validWeatherResponse({
        current: VALID.current,
        hourly: { time: null, precipitation_probability: [] },
      }),
      false
    ));
  it('rejects when hourly.precipitation_probability is not an array', () =>
    assert.equal(
      validWeatherResponse({
        current: VALID.current,
        hourly: { time: [], precipitation_probability: 'none' },
      }),
      false
    ));
});

// ── validCalendarMeeting ──────────────────────────────────────────────────────
describe('validCalendarMeeting', () => {
  const VALID = { subject: 'Standup', start: '2026-05-28T09:00', end: '2026-05-28T09:30' };

  it('accepts a minimal meeting with subject, start, and end', () =>
    assert.equal(validCalendarMeeting(VALID), true));
  it('accepts a meeting with optional joinUrl and account', () =>
    assert.equal(
      validCalendarMeeting({
        ...VALID,
        joinUrl: 'https://teams.example.com/x',
        account: 'work@example.com',
      }),
      true
    ));
  it('rejects null', () => assert.equal(validCalendarMeeting(null), false));
  it('rejects undefined', () => assert.equal(validCalendarMeeting(undefined), false));
  it('rejects empty object', () => assert.equal(validCalendarMeeting({}), false));
  it('rejects when subject is missing', () =>
    assert.equal(
      validCalendarMeeting({ start: '2026-05-28T09:00', end: '2026-05-28T09:30' }),
      false
    ));
  it('rejects when start is missing', () =>
    assert.equal(validCalendarMeeting({ subject: 'x', end: '2026-05-28T09:30' }), false));
  it('rejects when end is missing', () =>
    assert.equal(validCalendarMeeting({ subject: 'x', start: '2026-05-28T09:00' }), false));
  it('rejects when subject is a number instead of string', () =>
    assert.equal(
      validCalendarMeeting({ subject: 42, start: '2026-05-28T09:00', end: '2026-05-28T09:30' }),
      false
    ));
  it('rejects when start is an array instead of string', () =>
    assert.equal(
      validCalendarMeeting({ subject: 'x', start: ['2026-05-28T09:00'], end: '2026-05-28T09:30' }),
      false
    ));
  it('rejects a plain string (not an object)', () =>
    assert.equal(validCalendarMeeting('Standup'), false));
});

// ── validJiraCsvRow ───────────────────────────────────────────────────────────
describe('validJiraCsvRow', () => {
  it('accepts a row with "Issue key" and "Summary"', () =>
    assert.equal(
      validJiraCsvRow({ 'Issue key': 'AITO-1', Summary: 'Fix login', Status: 'Open' }),
      true
    ));
  it('accepts a row with alternate "Key" column name', () =>
    assert.equal(validJiraCsvRow({ Key: 'PROJ-2', Summary: 'Dark mode', Status: 'To Do' }), true));
  it('accepts a row with "Issue Key" (capitalised K)', () =>
    assert.equal(
      validJiraCsvRow({ 'Issue Key': 'AITO-3', Summary: 'Refactor', Status: 'Done' }),
      true
    ));
  it('accepts a row with lowercase "summary"', () =>
    assert.equal(validJiraCsvRow({ 'Issue key': 'AITO-4', summary: 'Lowercase summary' }), true));
  it('rejects null', () => assert.equal(validJiraCsvRow(null), false));
  it('rejects undefined', () => assert.equal(validJiraCsvRow(undefined), false));
  it('rejects empty object (no columns)', () => assert.equal(validJiraCsvRow({}), false));
  it('rejects when key column is present but summary is absent', () =>
    assert.equal(validJiraCsvRow({ 'Issue key': 'AITO-1' }), false));
  it('rejects when summary is present but key column is absent', () =>
    assert.equal(validJiraCsvRow({ Summary: 'Fix login' }), false));
  it('rejects when key column is present but empty', () =>
    assert.equal(validJiraCsvRow({ 'Issue key': '   ', Summary: 'Fix login' }), false));
  it('rejects when summary is present but empty', () =>
    assert.equal(validJiraCsvRow({ 'Issue key': 'AITO-1', Summary: '   ' }), false));
  it('rejects a semicolon-delimited row parsed as one column (wrong delimiter)', () =>
    assert.equal(validJiraCsvRow({ 'AITO-1;Fix login bug;Open': '' }), false));
});

// ── 15-notion.js ─────────────────────────────────────────────────────────────
// Tests for addTaskToNotion, saveTaskNotionUrl, and callClaudeWithNotion.
// These functions depend on browser globals (fetch, getCat, planTasks, etc.)
// so each test builds a fresh VM sandbox with stubs for those globals.

const notionSrc = readFileSync(join(__dirname, '../src/js/15-notion.js'), 'utf8');

/**
 * Minimal Fetch Response shim — enough for 15-notion.js to read `ok`, `status`,
 * `json()`, and `text()`. Named `MockResponse` deliberately so it doesn't shadow
 * Node's global `Response`.
 */
class MockResponse {
  /**
   * @param {string|Object} body - Response body. Objects are JSON-stringified.
   * @param {{ status?: number }} [init] - Status defaults to 200.
   */
  constructor(body, init = {}) {
    this._body = typeof body === 'string' ? body : JSON.stringify(body);
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
  }
  async json() {
    return JSON.parse(this._body);
  }
  async text() {
    return this._body;
  }
}

/**
 * Creates a VM sandbox pre-loaded with the browser globals that 15-notion.js
 * expects, evaluates the source, and exposes the registered document-level
 * click handler via `sandbox.__clickHandler` so tests can drive it directly.
 * @param {Object} overrides - Properties merged onto the sandbox before eval.
 * @returns {Object} The populated sandbox, with a `__clickHandler(event)`
 *   method that invokes the click listener 15-notion.js registered on
 *   `document` (null-safe when no listener was captured).
 */
function loadNotionSandbox(overrides = {}) {
  const store = {};
  let capturedClickHandler = null;
  const sandbox = {
    fetch: async () => new MockResponse({}),
    getCat: () => ({ id: 'other', label: 'other', color: '#888780' }),
    planTasks: [],
    savePlan: () => {},
    renderPlan: () => {},
    localStorage: {
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => {
        store[key] = String(value);
      },
      removeItem: (key) => {
        delete store[key];
      },
    },
    document: {
      addEventListener: (event, handler) => {
        // 15-notion.js registers exactly one document-level click listener
        // (the delegated handler for `.notion-task-btn`). Last-write-wins
        // by design: if a second handler is ever added, this stub silently
        // drops the earlier one, which would surface as missing assertions
        // — bump this capture to an array of handlers in that case.
        if (event === 'click') capturedClickHandler = handler;
      },
    },
    window: {},
    alert: () => {},
    console,
    ...overrides,
  };
  vm.createContext(sandbox);
  vm.runInContext(notionSrc, sandbox);
  sandbox.__clickHandler = (event) => capturedClickHandler && capturedClickHandler(event);
  return sandbox;
}

it('regression #33: removes wl_anthropic_key from localStorage on load', () => {
  const removed = [];
  loadNotionSandbox({
    localStorage: { removeItem: (k) => removed.push(k), getItem: () => null, setItem: () => {} },
  });
  assert.ok(removed.includes('wl_anthropic_key'));
});

describe('addTaskToNotion', () => {
  it('returns the Notion page URL on success', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse({ url: 'https://notion.so/page-1' }),
    });
    const url = await sandbox.addTaskToNotion({ text: 'Write tests', tag: 'dev' });
    assert.equal(url, 'https://notion.so/page-1');
  });

  it('sends the task title and epic label in the request body', async () => {
    let captured;
    const sandbox = loadNotionSandbox({
      getCat: () => ({ id: 'dev', label: 'Development', color: '#000' }),
      fetch: async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return new MockResponse({ url: 'https://notion.so/p' });
      },
    });
    await sandbox.addTaskToNotion({ text: 'My task', tag: 'dev' });
    assert.equal(captured.title, 'My task');
    assert.equal(captured.epic, 'development');
  });

  it('falls back to "other" when task has no tag', async () => {
    let captured;
    const sandbox = loadNotionSandbox({
      getCat: (id) => ({ id, label: id, color: '#000' }),
      fetch: async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return new MockResponse({ url: 'https://notion.so/p' });
      },
    });
    await sandbox.addTaskToNotion({ text: 'Untagged task' });
    assert.equal(captured.epic, 'other');
  });

  it('throws when the API returns a non-OK status', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse({ detail: 'Forbidden' }, { status: 403 }),
    });
    await assert.rejects(
      () => sandbox.addTaskToNotion({ text: 'x', tag: 'a' }),
      (err) => err.message === 'Forbidden'
    );
  });

  it('falls back to data.error when data.detail is absent', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse({ error: 'database not found' }, { status: 404 }),
    });
    await assert.rejects(
      () => sandbox.addTaskToNotion({ text: 'x', tag: 'a' }),
      (err) => err.message === 'database not found'
    );
  });

  it('throws with generic message when error response has no detail', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse('not json', { status: 500 }),
    });
    await assert.rejects(
      () => sandbox.addTaskToNotion({ text: 'x', tag: 'a' }),
      (err) => err.message === 'API 500'
    );
  });

  it('truncates the error detail to 300 characters', async () => {
    const longDetail = 'y'.repeat(500);
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse({ detail: longDetail }, { status: 500 }),
    });
    await assert.rejects(
      () => sandbox.addTaskToNotion({ text: 'x', tag: 'a' }),
      (err) => err.message === 'y'.repeat(300)
    );
  });

  it('throws when the response is OK but contains no URL', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse({ id: '123' }),
    });
    await assert.rejects(
      () => sandbox.addTaskToNotion({ text: 'x', tag: 'a' }),
      (err) => err.message === 'No URL returned from Notion'
    );
  });
});

describe('saveTaskNotionUrl', () => {
  it('persists the URL on the matching plan task', () => {
    const task = { id: 'abc', text: 'Do thing' };
    let planSaved = false;
    let planRendered = false;
    const sandbox = loadNotionSandbox({
      planTasks: [task],
      savePlan: () => {
        planSaved = true;
      },
      renderPlan: () => {
        planRendered = true;
      },
    });
    sandbox.saveTaskNotionUrl('abc', 'https://notion.so/page');
    assert.equal(task.notionUrl, 'https://notion.so/page');
    assert.equal(planSaved, true);
    assert.equal(planRendered, true);
  });

  it('does nothing when the task ID is not found', () => {
    let planSaved = false;
    const sandbox = loadNotionSandbox({
      planTasks: [{ id: 'xyz', text: 'Other' }],
      savePlan: () => {
        planSaved = true;
      },
    });
    sandbox.saveTaskNotionUrl('missing-id', 'https://notion.so/page');
    assert.equal(planSaved, false);
  });

  it('updates only the matching task when multiple tasks exist', () => {
    const tasks = [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ];
    const sandbox = loadNotionSandbox({ planTasks: tasks });
    sandbox.saveTaskNotionUrl('b', 'https://notion.so/b');
    assert.equal(tasks[0].notionUrl, undefined, 'task a should be untouched');
    assert.equal(tasks[1].notionUrl, 'https://notion.so/b');
    assert.equal(tasks[2].notionUrl, undefined, 'task c should be untouched');
  });
});

describe('callClaudeWithNotion', () => {
  it('concatenates text blocks, skips non-text, and trims surrounding whitespace', async () => {
    // Leading + trailing whitespace makes the source's `.trim()` load-bearing:
    // without it the result would be '  Hello World  '.
    const body = {
      content: [
        { type: 'text', text: '  Hello ' },
        { type: 'tool_use', id: 'x' },
        { type: 'text', text: 'World  ' },
      ],
    };
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse(body),
    });
    const result = await sandbox.callClaudeWithNotion('test prompt');
    assert.equal(result, 'Hello World');
  });

  it('sends model and maxTokens overrides in the request body', async () => {
    let captured;
    const sandbox = loadNotionSandbox({
      fetch: async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return new MockResponse({ content: [] });
      },
    });
    await sandbox.callClaudeWithNotion('p', { model: 'claude-opus-4-7', maxTokens: 500 });
    assert.equal(captured.model, 'claude-opus-4-7');
    assert.equal(captured.max_tokens, 500);
  });

  it('uses default model and maxTokens when no overrides given', async () => {
    let captured;
    const sandbox = loadNotionSandbox({
      fetch: async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return new MockResponse({ content: [] });
      },
    });
    await sandbox.callClaudeWithNotion('p');
    // These literals mirror the defaults in src/js/15-notion.js — bump them
    // together when the source default model or token cap changes.
    assert.equal(captured.model, 'claude-sonnet-4-6');
    assert.equal(captured.max_tokens, 1000);
  });

  it('throws when the API returns a non-OK status', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse('Unauthorized', { status: 401 }),
    });
    await assert.rejects(
      () => sandbox.callClaudeWithNotion('p'),
      (err) => err.message.includes('API 401')
    );
  });

  it('includes the error body in the message (short body, no truncation)', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse('Some error detail', { status: 400 }),
    });
    await assert.rejects(
      () => sandbox.callClaudeWithNotion('p'),
      (err) => err.message === 'API 400: Some error detail'
    );
  });

  it('truncates the error body to 200 characters', async () => {
    const longBody = 'x'.repeat(500);
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse(longBody, { status: 500 }),
    });
    await assert.rejects(
      () => sandbox.callClaudeWithNotion('p'),
      (err) => err.message === `API 500: ${'x'.repeat(200)}`
    );
  });

  it('returns empty string when response has no text blocks', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse({ content: [] }),
    });
    const result = await sandbox.callClaudeWithNotion('p');
    assert.equal(result, '');
  });
});

// ── per-task Notion button click handler ─────────────────────────────────────
// 15-notion.js:84-117 attaches a delegated document click handler. The sandbox
// captures it on registration so tests can drive it with synthetic events
// without a real DOM. Async tests drain the microtask queue with setImmediate
// because the handler kicks off a fire-and-forget promise chain.

/**
 * Build a synthetic click event whose `target.closest()` returns the given
 * button, mimicking the shape the delegated handler expects.
 * Note: the stub ignores its selector argument because the handler only
 * calls `closest('.notion-task-btn')` once. Add a switch on the selector
 * if a future handler grows a second `closest()` call.
 * @param {Object} btn - Stand-in for the `.notion-task-btn` element.
 * @returns {{ target: { closest: Function }, stopPropagation: Function }}
 */
function eventTargetingButton(btn) {
  return { target: { closest: () => btn }, stopPropagation: () => {} };
}

/**
 * Drain queued microtasks so fire-and-forget promise chains can settle.
 * Pumps several `setImmediate` ticks rather than coupling to a specific
 * depth — the click handler in src/js/15-notion.js currently has a
 * 1–2-await chain, so five ticks gives generous headroom for slower
 * CI runners or a future internal `await`.
 *
 * If a future contributor restructures the click handler to return its
 * promise, switch the tests to `await sandbox.__clickHandler(...)`
 * directly and delete this helper.
 * @returns {Promise<void>}
 */
async function flushPromises() {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('Notion button click handler', () => {
  it('opens the existing notionUrl in a new tab without fetching', () => {
    const openCalls = [];
    let fetchCalled = false;
    const sandbox = loadNotionSandbox({
      planTasks: [{ id: 'p1', text: 'Task', notionUrl: 'https://notion.so/page-1' }],
      window: {
        open: (url, target, features) => openCalls.push({ url, target, features }),
      },
      fetch: async () => {
        fetchCalled = true;
        return new MockResponse({});
      },
    });

    const btn = { dataset: { pid: 'p1' }, disabled: false, textContent: '📋' };
    sandbox.__clickHandler(eventTargetingButton(btn));

    assert.equal(openCalls.length, 1);
    assert.equal(openCalls[0].url, 'https://notion.so/page-1');
    assert.equal(openCalls[0].target, '_blank');
    // Pin 'noopener': prevents the opened page from controlling window.opener
    // (tab-jacking / reverse-tabnabbing). Removing it would silently weaken
    // a security boundary, so this assertion guards against drift.
    assert.equal(openCalls[0].features, 'noopener');
    assert.equal(fetchCalled, false);
  });

  it('is a no-op when the click target has no .notion-task-btn ancestor', () => {
    let fetchCalled = false;
    const sandbox = loadNotionSandbox({
      fetch: async () => {
        fetchCalled = true;
        return new MockResponse({});
      },
    });
    sandbox.__clickHandler({ target: { closest: () => null }, stopPropagation: () => {} });
    assert.equal(fetchCalled, false);
  });

  it('is a no-op when the button has no pid in its dataset', () => {
    let fetchCalled = false;
    const sandbox = loadNotionSandbox({
      fetch: async () => {
        fetchCalled = true;
        return new MockResponse({});
      },
    });
    sandbox.__clickHandler(eventTargetingButton({ dataset: {} }));
    assert.equal(fetchCalled, false);
  });

  it('is a no-op when the pid does not match any plan task', () => {
    let fetchCalled = false;
    const sandbox = loadNotionSandbox({
      planTasks: [{ id: 'other-id', text: 'Some other task' }],
      fetch: async () => {
        fetchCalled = true;
        return new MockResponse({});
      },
    });
    const btn = { dataset: { pid: 'unknown-pid' }, disabled: false, textContent: '📋' };
    sandbox.__clickHandler(eventTargetingButton(btn));
    assert.equal(fetchCalled, false);
    assert.equal(btn.disabled, false, 'button must not be disabled when task is missing');
  });

  it('disables the button and persists the URL on a successful add', async () => {
    let savedTaskId, savedUrl;
    const sandbox = loadNotionSandbox({
      planTasks: [{ id: 'p2', text: 'New task' }],
    });
    // Override VM-context globals: properties assigned on the sandbox after
    // vm.runInContext are visible to closures created inside the script
    // (including the captured click handler), so this replaces the real
    // function with a stub for this test.
    sandbox.addTaskToNotion = async () => 'https://notion.so/new-page';
    sandbox.saveTaskNotionUrl = (taskId, url) => {
      savedTaskId = taskId;
      savedUrl = url;
    };

    const btn = { dataset: { pid: 'p2' }, disabled: false, textContent: '📋' };
    sandbox.__clickHandler(eventTargetingButton(btn));
    assert.equal(btn.disabled, true, 'button disabled synchronously before fetch resolves');
    await flushPromises();

    assert.equal(savedTaskId, 'p2');
    assert.equal(savedUrl, 'https://notion.so/new-page');
    // Source leaves the button in its loading state on success — renderPlan
    // is expected to redraw it via saveTaskNotionUrl. Guard against a future
    // refactor that prematurely re-enables the button here.
    assert.equal(btn.disabled, true);
    assert.equal(btn.textContent, '…');
  });

  it('restores the button and alerts when addTaskToNotion resolves to a non-HTTP URL', async () => {
    const alerts = [];
    const sandbox = loadNotionSandbox({
      planTasks: [{ id: 'p4', text: 'Weird URL task' }],
      alert: (message) => alerts.push(message),
    });
    sandbox.addTaskToNotion = async () => '/relative-path';

    const btn = { dataset: { pid: 'p4' }, disabled: false, textContent: '📋' };
    sandbox.__clickHandler(eventTargetingButton(btn));
    await flushPromises();

    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, '📋');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /Notion responded but no URL: \/relative-path/);
  });

  it('restores the button and alerts when addTaskToNotion rejects', async () => {
    const alerts = [];
    const sandbox = loadNotionSandbox({
      planTasks: [{ id: 'p3', text: 'Failing task' }],
      alert: (message) => alerts.push(message),
    });
    sandbox.addTaskToNotion = async () => {
      throw new Error('API down');
    };

    const btn = { dataset: { pid: 'p3' }, disabled: false, textContent: '📋' };
    sandbox.__clickHandler(eventTargetingButton(btn));
    await flushPromises();

    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, '📋');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /Failed to add to Notion: API down/);
  });
});

// ── flatSort ──────────────────────────────────────────────────────────────────
// flatSort lives in src/js/10-tasks.js and reads the module-level globals
// `activeTimer` and `entries` to give the live-timer task a sort bonus.
// Loading the file in a VM sandbox with those globals pre-populated lets us
// test the sort algorithm without a browser or build step.

/**
 * Creates a VM sandbox with pure-fns.js and 10-tasks.js loaded.
 * The sandbox exposes `flatSort` as a property (function declaration = global).
 *
 * @param {Object} [overrides] - Properties to merge into the sandbox before evaluation.
 * @returns {Object} The populated VM sandbox.
 */
function loadFlatSortSandbox(overrides = {}) {
  const pureSrc = readFileSync(join(__dirname, '../src/js/pure-fns.js'), 'utf8').replace(
    /^export ((?:async\s+)?(?:const|function|let|class))\b/gm,
    '$1'
  );
  const tasksSrc = readFileSync(join(__dirname, '../src/js/10-tasks.js'), 'utf8');
  const sandbox = {
    document: {
      getElementById: () => ({
        addEventListener: () => {},
        style: {},
        classList: { toggle: () => {} },
      }),
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    // Stubs for collapse-state helpers defined in 07-lifecycle.js (not loaded here).
    readCollapseState: (_id, defaultCollapsed) => defaultCollapsed,
    writeCollapseState: () => {},
    console,
    activeTimer: null,
    entries: [],
    planTasks: [],
    categories: [{ id: 'other', label: 'Other', color: '#888' }],
    viewDate: new Date(),
    pendingCollapsed: false,
    planCollapsed: false,
    wlLog: { warn: () => {}, error: () => {}, info: () => {} },
    validPlanTask: () => true,
    selectedTag: 'other',
    render: () => {},
    renderPlan: () => {},
    getCat: (id) => ({ id, label: id, color: '#888', billable: true }),
    safeRoundedStart: () => Date.now(),
    ...overrides,
  };
  vm.createContext(sandbox);
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(tasksSrc, sandbox);
  return sandbox;
}

describe('flatSort', () => {
  it('orders tasks by status: inprogress → todo → pending → blocked → done', () => {
    const { flatSort } = loadFlatSortSandbox();
    const tasks = [
      { id: '1', text: 'done task', status: 'done' },
      { id: '2', text: 'blocked task', status: 'blocked' },
      { id: '3', text: 'pending task', status: 'pending' },
      { id: '4', text: 'todo task', status: 'todo' },
      { id: '5', text: 'live task', status: 'inprogress' },
    ];
    const result = flatSort(tasks);
    assert.equal(result[0].status, 'inprogress');
    assert.equal(result[1].status, 'todo');
    assert.equal(result[2].status, 'pending');
    assert.equal(result[3].status, 'blocked');
    assert.equal(result[4].status, 'done');
  });

  it('orders by priority within same status: high(1) > normal(0) > low(-1)', () => {
    const { flatSort } = loadFlatSortSandbox();
    const tasks = [
      { id: '1', text: 'low pri', status: 'todo', priority: -1 },
      { id: '2', text: 'normal pri', status: 'todo' },
      { id: '3', text: 'high pri', status: 'todo', priority: 1 },
    ];
    const result = flatSort(tasks);
    assert.equal(result[0].priority, 1);
    assert.equal(result[1].id, '2', 'normal-priority task sorts between high and low');
    assert.equal(result[1].priority, undefined);
    assert.equal(result[2].priority, -1);
  });

  it('places child immediately after its parent', () => {
    const { flatSort } = loadFlatSortSandbox();
    const tasks = [
      { id: 'p1', text: 'beta parent', status: 'todo' },
      { id: 'c1', text: 'child of beta', status: 'todo', parentId: 'p1' },
      { id: 'p2', text: 'alpha parent', status: 'todo' },
    ];
    const result = flatSort(tasks);
    const p1Idx = result.findIndex((t) => t.id === 'p1');
    const c1Idx = result.findIndex((t) => t.id === 'c1');
    assert.equal(c1Idx, p1Idx + 1, 'child must immediately follow its parent');
  });

  it('appends orphaned children (missing parent) at the end', () => {
    const { flatSort } = loadFlatSortSandbox();
    const tasks = [
      { id: 'p1', text: 'parent', status: 'todo' },
      { id: 'orphan', text: 'orphan', status: 'todo', parentId: 'deleted-parent-id' },
    ];
    const result = flatSort(tasks);
    assert.equal(result[result.length - 1].id, 'orphan');
  });

  it('sorts the live-timer matching task first regardless of status', () => {
    const sandbox = loadFlatSortSandbox();
    sandbox.activeTimer = { entryId: 'e1' };
    sandbox.entries = [
      { id: 'e1', text: 'Active work', tag: 'other', ts: Date.now(), date: '2026-05-28' },
    ];
    const tasks = [
      { id: '1', text: 'done task', status: 'done' },
      { id: '2', text: 'Active work', status: 'todo' },
    ];
    const result = sandbox.flatSort(tasks);
    assert.equal(result[0].id, '2', 'live-timer task must sort first');
  });

  it('uses alphabetical tiebreaker within same status and priority', () => {
    const { flatSort } = loadFlatSortSandbox();
    const tasks = [
      { id: '1', text: 'zebra', status: 'todo' },
      { id: '2', text: 'apple', status: 'todo' },
      { id: '3', text: 'mango', status: 'todo' },
    ];
    const result = flatSort(tasks);
    assert.equal(result[0].text, 'apple');
    assert.equal(result[1].text, 'mango');
    assert.equal(result[2].text, 'zebra');
  });

  it('returns empty array unchanged', () => {
    const { flatSort } = loadFlatSortSandbox();
    assert.equal(flatSort([]).length, 0);
  });
});

// ── _qcBuildTaskGroups and _qcTaskListHtml ────────────────────────────────────
// These pure functions live in src/js/16-rapid.js.  The module-level let for
// _qcFilterCat is promoted to var via source rewrite so tests can mutate it
// as a sandbox property without reloading the file each time.

/**
 * Creates a VM sandbox with pure-fns.js and 16-rapid.js loaded.
 * Injects getCat using the sandbox's `categories` array.
 *
 * @param {Object} [overrides] - Properties to merge into the sandbox before evaluation.
 * @returns {Object} The populated VM sandbox.
 */
function loadRapidSandbox(overrides = {}) {
  const pureSrc = readFileSync(join(__dirname, '../src/js/pure-fns.js'), 'utf8').replace(
    /^export ((?:async\s+)?(?:const|function|let|class))\b/gm,
    '$1'
  );
  const rapidSrc = readFileSync(join(__dirname, '../src/js/16-rapid.js'), 'utf8')
    .replace(/\blet (_qcFilterCat)\b/, 'var $1')
    .replace(/\blet (_qcSearch)\b/, 'var $1');

  const sandbox = {
    document: { getElementById: () => null, addEventListener: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    activeTimer: null,
    entries: [],
    planTasks: [],
    categories: [
      { id: 'other', label: 'Other', color: '#888780' },
      { id: 'work', label: 'Work', color: '#4a90e2', billable: true },
    ],
    fmtElapsed: () => '0:00',
    getElapsedMs: () => 0,
    selectedTag: 'other',
    startTimer: () => {},
    stopTimer: () => {},
    save: () => {},
    render: () => {},
    safeRoundedStart: () => Date.now(),
    ...overrides,
  };
  vm.createContext(sandbox);
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(
    `function getCat(id) {
       const cat = categories.find(function(c){ return c.id === id; })
                || categories.find(function(c){ return c.id === 'other'; });
       if (!cat) return { id: 'other', label: 'Other', color: '#888780' };
       return { id: cat.id, label: cat.label, color: cat.color };
     }`,
    sandbox
  );
  vm.runInContext(rapidSrc, sandbox);
  return sandbox;
}

describe('_qcBuildTaskGroups', () => {
  const TODAY = '2026-05-28';

  it('returns three empty arrays when there is no data', () => {
    const sandbox = loadRapidSandbox();
    const { inProgress, todo, recent } = sandbox._qcBuildTaskGroups('', TODAY);
    assert.equal(inProgress.length, 0);
    assert.equal(todo.length, 0);
    assert.equal(recent.length, 0);
  });

  it('puts the active-timer entry in inProgress', () => {
    const sandbox = loadRapidSandbox();
    sandbox.activeTimer = { entryId: 'e1' };
    sandbox.entries = [{ id: 'e1', text: 'Active work', tag: 'work', ts: 1, date: TODAY }];
    const { inProgress } = sandbox._qcBuildTaskGroups('', TODAY);
    assert.equal(inProgress.length, 1);
    assert.equal(inProgress[0].id, 'e1');
  });

  it('puts open plan tasks in todo, excludes done and _migrated', () => {
    const sandbox = loadRapidSandbox();
    sandbox.planTasks = [
      { id: 't1', text: 'open task', tag: 'work', status: 'todo', date: TODAY },
      { id: 't2', text: 'done task', tag: 'work', status: 'done', date: TODAY },
      { id: 't3', text: 'migrated', tag: 'work', status: 'todo', date: TODAY, _migrated: true },
    ];
    const { todo } = sandbox._qcBuildTaskGroups('', TODAY);
    assert.equal(todo.length, 1);
    assert.equal(todo[0].id, 't1');
  });

  it('puts closed today entries in recent, deduplicates by text', () => {
    const sandbox = loadRapidSandbox();
    sandbox.entries = [
      { id: 'e1', text: 'Task A', tag: 'work', ts: 1, date: TODAY },
      { id: 'e2', text: 'Task A', tag: 'work', ts: 2, date: TODAY },
    ];
    const { recent } = sandbox._qcBuildTaskGroups('', TODAY);
    assert.equal(recent.length, 1, 'duplicate texts must appear once only');
  });

  it('filters all groups by search string', () => {
    const sandbox = loadRapidSandbox();
    sandbox.planTasks = [
      { id: 't1', text: 'Design review', tag: 'work', status: 'todo', date: TODAY },
      { id: 't2', text: 'Unrelated task', tag: 'work', status: 'todo', date: TODAY },
    ];
    const { todo } = sandbox._qcBuildTaskGroups('design', TODAY);
    assert.equal(todo.length, 1);
    assert.equal(todo[0].id, 't1');
  });

  it('filters all groups by category when _qcFilterCat is set', () => {
    const sandbox = loadRapidSandbox();
    sandbox._qcFilterCat = 'work';
    sandbox.planTasks = [
      { id: 't1', text: 'Work task', tag: 'work', status: 'todo', date: TODAY },
      { id: 't2', text: 'Other task', tag: 'other', status: 'todo', date: TODAY },
    ];
    const { todo } = sandbox._qcBuildTaskGroups('', TODAY);
    assert.equal(todo.length, 1);
    assert.equal(todo[0].id, 't1');
  });
});

describe('_qcTaskListHtml', () => {
  it('returns a qc-empty div when all groups are empty', () => {
    const sandbox = loadRapidSandbox();
    const html = sandbox._qcTaskListHtml({ inProgress: [], todo: [], recent: [] }, '');
    assert.ok(html.includes('qc-empty'), 'empty-state div must be present');
  });

  it('shows the typed search text in the empty-state prompt', () => {
    const sandbox = loadRapidSandbox();
    const html = sandbox._qcTaskListHtml({ inProgress: [], todo: [], recent: [] }, 'design');
    assert.ok(html.includes('design'), 'empty-state must surface the user search text');
  });

  it('renders "In progress" group header when inProgress is non-empty', () => {
    const sandbox = loadRapidSandbox();
    const entry = { id: 'e1', text: 'Active', tag: 'work', ts: 1 };
    const html = sandbox._qcTaskListHtml({ inProgress: [entry], todo: [], recent: [] }, '');
    assert.ok(html.includes('In progress'), '"In progress" header must appear');
    assert.ok(html.includes('Active'), 'entry text must appear');
  });

  it('renders "To-do" group header and caps at 6 items', () => {
    const sandbox = loadRapidSandbox();
    const todo = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      text: `Task ${i}`,
      tag: 'work',
    }));
    const html = sandbox._qcTaskListHtml({ inProgress: [], todo, recent: [] }, '');
    assert.ok(html.includes('To-do'), '"To-do" header must appear');
    const matches = [...html.matchAll(/qc-task-row/g)];
    assert.ok(matches.length <= 6, `todo must be capped at 6 rows, got ${matches.length}`);
  });

  it('caps recent group at 5 items', () => {
    const sandbox = loadRapidSandbox();
    const recent = Array.from({ length: 7 }, (_, i) => ({
      id: `e${i}`,
      text: `Entry ${i}`,
      tag: 'other',
    }));
    const html = sandbox._qcTaskListHtml({ inProgress: [], todo: [], recent }, '');
    const matches = [...html.matchAll(/qc-task-row/g)];
    assert.ok(matches.length <= 5, `recent must be capped at 5 rows, got ${matches.length}`);
  });

  it('escapes HTML in task text to prevent XSS', () => {
    const sandbox = loadRapidSandbox();
    const entry = { id: 'e1', text: '<script>alert(1)</script>', tag: 'other' };
    const html = sandbox._qcTaskListHtml({ inProgress: [entry], todo: [], recent: [] }, '');
    assert.ok(!html.includes('<script>'), 'raw <script> tag must not appear in output');
    assert.ok(html.includes('&lt;script&gt;'), 'text must be HTML-escaped');
  });
});

// ── calcMonthSummaryStats and calcMonthTaskCounts ────────────────────────────
// Pure helpers extracted from 19-monthlylog.js so the data-derivation step
// is independently testable without DOM. The render functions are thin
// wrappers that take these results and write them to innerHTML.

/**
 * Loads 19-monthlylog.js into a VM sandbox so its function declarations
 * become sandbox properties. The file expects browser globals at parse
 * time (`document`, etc.) and reads module-level state from globals
 * (`viewDate`, `_mlYear`, `_mlMonth`) — we stub the minimum needed.
 *
 * @returns {Object} Populated VM sandbox.
 */
function loadMonthlyLogSandbox() {
  const monthlySrc = readFileSync(join(__dirname, '../src/js/19-monthlylog.js'), 'utf8');
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

// ── Today's Flow — findLargestGap / view preference ───────────────────────────

const timeflowSrc = readFileSync(join(__dirname, '../src/js/11-timeflow.js'), 'utf8');

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

// ── resolveRapidDate ──────────────────────────────────────────────────────────
// 2026-05-29 is a Friday (getDay() === 5).
describe('resolveRapidDate', () => {
  const friday = localDate(2026, 5, 29);

  it('resolves "today"', () => {
    assert.equal(resolveRapidDate('today', friday), '2026-05-29');
  });

  it('resolves "TODAY" case-insensitively', () => {
    assert.equal(resolveRapidDate('TODAY', friday), '2026-05-29');
  });

  it('resolves "tomorrow"', () => {
    assert.equal(resolveRapidDate('tomorrow', friday), '2026-05-30');
  });

  it('resolves "tomorrow" across a month boundary', () => {
    assert.equal(resolveRapidDate('tomorrow', localDate(2026, 5, 31)), '2026-06-01');
  });

  it('passes through a valid YYYY-MM-DD verbatim', () => {
    assert.equal(resolveRapidDate('2026-12-25', friday), '2026-12-25');
  });

  it('resolves "fri" to the NEXT Friday (not today when today is Friday)', () => {
    // diff = ((5 - 5 + 7) % 7) || 7 = 0 || 7 = 7
    assert.equal(resolveRapidDate('fri', friday), '2026-06-05');
  });

  it('resolves "mon" to the next Monday from a Friday', () => {
    // diff = ((1 - 5 + 7) % 7) || 7 = 3
    assert.equal(resolveRapidDate('mon', friday), '2026-06-01');
  });

  it('resolves weekday abbreviations case-insensitively', () => {
    assert.equal(resolveRapidDate('FRI', friday), '2026-06-05');
    assert.equal(resolveRapidDate('Mon', friday), '2026-06-01');
  });

  it('returns null for an unrecognised token', () => {
    assert.equal(resolveRapidDate('nextweek', friday), null);
  });

  it('returns null for a partial ISO date like "2026-05"', () => {
    assert.equal(resolveRapidDate('2026-05', friday), null);
  });
});

// ── parseRapidTokens ──────────────────────────────────────────────────────────
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

// ── stripJiraPrefix ───────────────────────────────────────────────────────────
describe('stripJiraPrefix', () => {
  it('strips a "KEY-123: " prefix', () =>
    assert.equal(stripJiraPrefix('PROJ-42: Fix login'), 'Fix login'));
  it('strips a "KEY-123 " prefix (space separator)', () =>
    assert.equal(stripJiraPrefix('ABC-7 Write docs'), 'Write docs'));
  it('handles alphanumeric project keys', () =>
    assert.equal(stripJiraPrefix('AB12-9: Task'), 'Task'));
  it('leaves text without a Jira key unchanged', () =>
    assert.equal(stripJiraPrefix('Write tests'), 'Write tests'));
  it('does not strip a lowercase pseudo-key', () =>
    assert.equal(stripJiraPrefix('proj-42: keep'), 'proj-42: keep'));
  it('trims surrounding whitespace', () => assert.equal(stripJiraPrefix('  spaced  '), 'spaced'));
});

// ── groupEntriesByCategory ─────────────────────────────────────────────────────
describe('groupEntriesByCategory', () => {
  it('groups by category and task, preserving first-seen order', () => {
    const entries = [
      { text: 'A', tag: 'work', ts: 0, tsEnd: 1000 },
      { text: 'B', tag: 'admin', ts: 2000, tsEnd: 3000 },
      { text: 'A', tag: 'work', ts: 4000, tsEnd: 5000 },
    ];
    const { catOrder, catGrouped } = groupEntriesByCategory(entries);
    assert.deepEqual([...catOrder], ['work', 'admin']);
    assert.deepEqual([...catGrouped.work.taskOrder], ['a']);
    assert.equal(catGrouped.work.totalMs, 2000);
    assert.equal(catGrouped.work.tasks.a.totalMs, 2000);
    assert.equal(catGrouped.work.tasks.a.label, 'A');
    assert.equal(catGrouped.work.tasks.a.hasTime, true);
  });

  it('treats a missing tag as "other"', () => {
    const { catOrder } = groupEntriesByCategory([{ text: 'X', ts: 0, tsEnd: 10 }]);
    assert.deepEqual([...catOrder], ['other']);
  });

  it('marks entries with no duration as hasTime=false and totalMs=0', () => {
    const { catGrouped } = groupEntriesByCategory([{ text: 'X', tag: 'work', ts: 100 }]);
    assert.equal(catGrouped.work.tasks.x.hasTime, false);
    assert.equal(catGrouped.work.totalMs, 0);
  });

  it('keeps the original-case label from the first occurrence', () => {
    const { catGrouped } = groupEntriesByCategory([
      { text: 'Task One', tag: 'work', ts: 0, tsEnd: 1 },
      { text: 'task one', tag: 'work', ts: 2, tsEnd: 3 },
    ]);
    assert.equal(catGrouped.work.tasks['task one'].label, 'Task One');
  });

  it('returns empty structures for no entries', () => {
    const { catOrder, catGrouped } = groupEntriesByCategory([]);
    assert.equal(catOrder.length, 0);
    assert.equal(Object.keys(catGrouped).length, 0);
  });
});

// ── mergeAdjacentEntries ───────────────────────────────────────────────────────
describe('mergeAdjacentEntries', () => {
  const MIN = 60000;

  it('merges same-task entries within the default 30-min gap', () => {
    const merged = mergeAdjacentEntries([
      { text: 'A', ts: 0, tsEnd: 10 * MIN },
      { text: 'A', ts: 30 * MIN, tsEnd: 40 * MIN },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]._end, 40 * MIN);
  });

  it('does not merge across a gap larger than the threshold', () => {
    const merged = mergeAdjacentEntries([
      { text: 'A', ts: 0, tsEnd: 10 * MIN },
      { text: 'A', ts: 50 * MIN, tsEnd: 60 * MIN },
    ]);
    assert.equal(merged.length, 2);
  });

  it('does not merge different tasks even when adjacent', () => {
    const merged = mergeAdjacentEntries([
      { text: 'A', ts: 0, tsEnd: 10 * MIN },
      { text: 'B', ts: 11 * MIN, tsEnd: 12 * MIN },
    ]);
    assert.equal(merged.length, 2);
  });

  it('does not merge same-text entries that belong to different categories', () => {
    const merged = mergeAdjacentEntries([
      { text: 'Standup', tag: 'work', ts: 0, tsEnd: 10 * MIN },
      { text: 'Standup', tag: 'dev', ts: 11 * MIN, tsEnd: 20 * MIN },
    ]);
    assert.equal(merged.length, 2);
    assert.deepEqual([...merged.map((e) => e.tag)], ['work', 'dev']);
  });

  it('still merges same-text entries when both lack a tag (both → "other")', () => {
    const merged = mergeAdjacentEntries([
      { text: 'Email', ts: 0, tsEnd: 10 * MIN },
      { text: 'Email', ts: 11 * MIN, tsEnd: 20 * MIN },
    ]);
    assert.equal(merged.length, 1);
  });

  it('sorts by start time before merging', () => {
    const merged = mergeAdjacentEntries([
      { text: 'A', ts: 30 * MIN, tsEnd: 40 * MIN },
      { text: 'A', ts: 0, tsEnd: 10 * MIN },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].ts, 0);
    assert.equal(merged[0]._end, 40 * MIN);
  });

  it('respects a custom gap argument', () => {
    // 6-minute gap between the first end (10 min) and the second start (16 min)
    const entries = [
      { text: 'A', ts: 0, tsEnd: 10 * MIN },
      { text: 'A', ts: 16 * MIN, tsEnd: 20 * MIN },
    ];
    assert.equal(mergeAdjacentEntries(entries, 5 * MIN).length, 2); // gap exceeds 5 min
    assert.equal(mergeAdjacentEntries(entries, 10 * MIN).length, 1); // gap within 10 min
  });

  it('does not mutate the input array or its objects', () => {
    const input = [{ text: 'A', ts: 0, tsEnd: 10 }];
    const snapshot = JSON.stringify(input);
    mergeAdjacentEntries(input);
    assert.equal(JSON.stringify(input), snapshot);
  });
});

// ── buildBillableSummaryParts ──────────────────────────────────────────────────
describe('buildBillableSummaryParts', () => {
  const label = (tag) => ({ work: 'Work', dev: 'Dev' })[tag] || tag;

  it('groups categorised tasks as "Category (task, task)"', () => {
    const parts = buildBillableSummaryParts(
      [
        { text: 'PROJ-1: Build', tag: 'work' },
        { text: 'Review', tag: 'work' },
      ],
      label
    );
    assert.deepEqual([...parts], ['Work (Build, Review)']);
  });

  it('lists uncategorised tasks bare (no tag or "other")', () => {
    const parts = buildBillableSummaryParts(
      [{ text: 'Standup', tag: 'other' }, { text: 'Email' }],
      label
    );
    assert.deepEqual([...parts], ['Standup', 'Email']);
  });

  it('preserves first-seen category order and de-duplicates task names', () => {
    const parts = buildBillableSummaryParts(
      [
        { text: 'Code', tag: 'dev' },
        { text: 'Plan', tag: 'work' },
        { text: 'Code', tag: 'dev' },
      ],
      label
    );
    assert.deepEqual([...parts], ['Dev (Code)', 'Work (Plan)']);
  });

  it('returns an empty array for no entries', () =>
    assert.equal(buildBillableSummaryParts([], label).length, 0));
});

// ── computeDayBounds ───────────────────────────────────────────────────────────
describe('computeDayBounds', () => {
  const base = { isViewingToday: false, dayStart: null, activeTimer: null, now: 0 };

  it('uses the supplied day start when viewing today', () => {
    const { dayStartTs } = computeDayBounds([{ ts: 5000 }], [], {
      ...base,
      isViewingToday: true,
      dayStart: 1000,
    });
    assert.equal(dayStartTs, 1000);
  });

  it('falls back to the earliest entry start when no day start is given', () => {
    const { dayStartTs } = computeDayBounds([{ ts: 5000 }, { ts: 2000 }], [], base);
    assert.equal(dayStartTs, 2000);
  });

  it('ignores the day start when not viewing today', () => {
    const { dayStartTs } = computeDayBounds([{ ts: 9000 }], [], {
      ...base,
      isViewingToday: false,
      dayStart: 1000,
    });
    assert.equal(dayStartTs, 9000);
  });

  it('takes the latest tracked end as the day end', () => {
    const timed = [
      { ts: 0, tsEnd: 3000 },
      { ts: 4000, tsEnd: 8000 },
    ];
    const { dayEndTs } = computeDayBounds(timed, timed, base);
    assert.equal(dayEndTs, 8000);
  });

  it('extends the end to a running timer using `now`', () => {
    const entries = [{ id: 't1', ts: 1000 }];
    const { dayEndTs } = computeDayBounds(entries, [], {
      ...base,
      isViewingToday: true,
      activeTimer: { entryId: 't1', paused: false, startTs: 1000 },
      now: 9999,
    });
    assert.equal(dayEndTs, 9999);
  });

  it('uses accumulated time for a paused timer', () => {
    const entries = [{ id: 't1', ts: 1000 }];
    const { dayEndTs } = computeDayBounds(entries, [], {
      ...base,
      isViewingToday: true,
      activeTimer: { entryId: 't1', paused: true, accumulatedMs: 2500 },
      now: 9999,
    });
    assert.equal(dayEndTs, 3500); // start (1000) + accumulated (2500)
  });

  it('returns null bounds for an empty day', () => {
    const { dayStartTs, dayEndTs } = computeDayBounds([], [], base);
    assert.equal(dayStartTs, null);
    assert.equal(dayEndTs, null);
  });
});

// ── formatGroupedLines ─────────────────────────────────────────────────────────
describe('formatGroupedLines', () => {
  const fmt = (ms) => `${ms}ms`;
  const label = (tag) => `[${tag}]`;

  it('renders a category header line followed by indented task lines', () => {
    const catGrouped = {
      work: {
        totalMs: 3000,
        taskOrder: ['a', 'b'],
        tasks: {
          a: { label: 'Task A', totalMs: 1000, hasTime: true },
          b: { label: 'Task B', totalMs: 2000, hasTime: true },
        },
      },
    };
    const lines = formatGroupedLines(['work'], catGrouped, fmt, label);
    assert.deepEqual([...lines], ['3000ms - [work]', '    1000ms - Task A', '    2000ms - Task B']);
  });

  it('shows -- for categories and tasks with no tracked time', () => {
    const catGrouped = {
      admin: {
        totalMs: 0,
        taskOrder: ['x'],
        tasks: { x: { label: 'Untimed', totalMs: 0, hasTime: false } },
      },
    };
    const lines = formatGroupedLines(['admin'], catGrouped, fmt, label);
    assert.deepEqual([...lines], ['-- - [admin]', '    -- - Untimed']);
  });

  it('returns no lines for an empty category order', () =>
    assert.equal(formatGroupedLines([], {}, fmt, label).length, 0));
});

// ── 07-lifecycle.js — readCollapseState / writeCollapseState ─────────────────
// These helpers live alongside DOM event listeners that fire at load time.
// We extract only the collapse-state block via regex so we can test the logic
// without stubbing the full browser environment.

const lifecycleSrc = readFileSync(join(__dirname, '../src/js/07-lifecycle.js'), 'utf8');

/**
 * Evaluates the collapse-state helper block from 07-lifecycle.js in a minimal
 * VM sandbox. The block is extracted by matching between comment headings so
 * it stays in sync with the source automatically.
 * @param {Record<string,string>} [preloaded] - Initial localStorage contents.
 * @returns {{ readCollapseState: Function, writeCollapseState: Function, store: Record<string,string> }}
 */
function loadCollapseSandbox(preloaded = {}) {
  const store = { ...preloaded };
  const sandbox = {
    localStorage: {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => {
        store[key] = value;
      },
    },
  };
  const match = lifecycleSrc.match(
    /\/\*.+Section collapse state persistence.+\*\/([\s\S]*?)(?=\/\*.+Section collapse handlers)/
  );
  if (!match) throw new Error('Collapse-state block not found in 07-lifecycle.js');
  vm.createContext(sandbox);
  vm.runInContext(match[0], sandbox);
  return {
    readCollapseState: sandbox.readCollapseState,
    writeCollapseState: sandbox.writeCollapseState,
    store,
  };
}

describe('readCollapseState', () => {
  it('returns defaultCollapsed=true when no value is stored', () => {
    const { readCollapseState } = loadCollapseSandbox();
    assert.equal(readCollapseState('mySection', true), true);
  });

  it('returns defaultCollapsed=false when no value is stored', () => {
    const { readCollapseState } = loadCollapseSandbox();
    assert.equal(readCollapseState('mySection', false), false);
  });

  it('returns true when stored value is "1" regardless of default', () => {
    const { readCollapseState } = loadCollapseSandbox({ 'tt-open2-mySection': '1' });
    assert.equal(readCollapseState('mySection', false), true);
  });

  it('returns false when stored value is "0" regardless of default', () => {
    const { readCollapseState } = loadCollapseSandbox({ 'tt-open2-mySection': '0' });
    assert.equal(readCollapseState('mySection', true), false);
  });

  it('uses the COLLAPSE_PREFIX (tt-open2-) when building the storage key', () => {
    // A value stored under the bare section id (no prefix) must not match.
    const { readCollapseState } = loadCollapseSandbox({ mySection: '1' });
    assert.equal(readCollapseState('mySection', false), false);
  });

  it('isolates sections: stored state for one id does not affect another', () => {
    const { readCollapseState } = loadCollapseSandbox({ 'tt-open2-sectionA': '1' });
    assert.equal(readCollapseState('sectionA', false), true);
    assert.equal(readCollapseState('sectionB', false), false);
  });
});

describe('writeCollapseState', () => {
  it('writes "1" when collapsed is true', () => {
    const { writeCollapseState, store } = loadCollapseSandbox();
    writeCollapseState('mySection', true);
    assert.equal(store['tt-open2-mySection'], '1');
  });

  it('writes "0" when collapsed is false', () => {
    const { writeCollapseState, store } = loadCollapseSandbox();
    writeCollapseState('mySection', false);
    assert.equal(store['tt-open2-mySection'], '0');
  });

  it('overwrites a previous value', () => {
    const { writeCollapseState, store } = loadCollapseSandbox({ 'tt-open2-s': '1' });
    writeCollapseState('s', false);
    assert.equal(store['tt-open2-s'], '0');
  });

  it('round-trips: write true then read back true', () => {
    const { readCollapseState, writeCollapseState } = loadCollapseSandbox();
    writeCollapseState('roundTrip', true);
    assert.equal(readCollapseState('roundTrip', false), true);
  });

  it('round-trips: write false then read back false', () => {
    const { readCollapseState, writeCollapseState } = loadCollapseSandbox();
    writeCollapseState('roundTrip', false);
    assert.equal(readCollapseState('roundTrip', true), false);
  });
});

// ── 07-lifecycle.js — ensureDayStarted ───────────────────────────────────────
// We extract the SOD helper block (sodKey, getDayStart, renderSodBtn,
// ensureDayStarted) by slicing up to the first module-level DOM listener so we
// can test without stubbing the full browser environment.

/**
 * Evaluates the SOD helper block from 07-lifecycle.js in a minimal VM sandbox.
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.preloaded] - Initial localStorage contents.
 * @returns {{ ensureDayStarted: Function, getDayStart: Function, store: Record<string,string>, calls: { renderSodBtn: number, renderTimeblock: number } }}
 */
function loadSodSandbox({ preloaded = {}, viewDate = new Date() } = {}) {
  const store = { ...preloaded };
  const calls = { renderSodBtn: 0, renderTimeblock: 0 };
  const fakeEl = {
    textContent: '',
    appendChild: () => {},
    setAttribute: () => {},
    addEventListener: () => {},
  };
  const sandbox = {
    dk: pureFns.dk,
    // viewDate is the day the user has navigated to; the SOD/EOD key helpers
    // default to it so the chip reflects whichever day is in view.
    viewDate,
    isToday: (d) => pureFns.dk(d) === pureFns.dk(new Date()),
    localStorage: {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => {
        store[key] = String(value);
      },
    },
    document: {
      getElementById: () => fakeEl,
      createElement: () => ({ className: '', setAttribute: () => {} }),
      createTextNode: () => ({}),
    },
    // renderTimeblock is not declared by the vm script so this property survives.
    renderTimeblock: () => {
      calls.renderTimeblock++;
    },
  };
  // Evaluate from the start of the file up to (not including) the section
  // collapse handlers, which run top-level DOM code. This range includes the SOD
  // and EOD helper declarations; the only top-level executable in it is the
  // sodBtn listener, whose bind is a no-op because fakeEl.addEventListener is
  // stubbed.
  const cutIdx = lifecycleSrc.indexOf('/* ── Section collapse handlers ── */');
  if (cutIdx === -1)
    throw new Error('Could not locate collapse handlers marker in 07-lifecycle.js');
  vm.createContext(sandbox);
  vm.runInContext(lifecycleSrc.slice(0, cutIdx), sandbox);
  // renderSodBtn was defined by the vm script (function declaration). Replace
  // the sandbox property with a spy — mutations to the sandbox object are
  // visible as global-scope changes inside the vm context, so subsequent calls
  // from ensureDayStarted will invoke the spy.
  sandbox.renderSodBtn = () => {
    calls.renderSodBtn++;
  };
  return {
    ensureDayStarted: sandbox.ensureDayStarted,
    getDayStart: sandbox.getDayStart,
    getEodTs: sandbox.getEodTs,
    sodKey: sandbox.sodKey,
    eodKey: sandbox.eodKey,
    store,
    calls,
  };
}

describe('ensureDayStarted', () => {
  it('records SOD in localStorage when day is not started', () => {
    const before = Date.now();
    const { ensureDayStarted, store } = loadSodSandbox();
    ensureDayStarted();
    const key = Object.keys(store).find((k) => k.startsWith('wl_sod_'));
    assert.ok(key, 'wl_sod_ key should be written');
    const ts = parseInt(store[key]);
    assert.ok(ts >= before && ts <= Date.now(), 'stored timestamp should be approximately now');
  });

  it('calls renderSodBtn after recording SOD', () => {
    const { ensureDayStarted, calls } = loadSodSandbox();
    ensureDayStarted();
    assert.equal(calls.renderSodBtn, 1);
  });

  it('calls renderTimeblock after recording SOD', () => {
    const { ensureDayStarted, calls } = loadSodSandbox();
    ensureDayStarted();
    assert.equal(calls.renderTimeblock, 1);
  });

  it('is idempotent: does not overwrite SOD when already started', () => {
    const todayKey = pureFns.dk(new Date());
    const existing = '1000000000000';
    const { ensureDayStarted, store } = loadSodSandbox({
      preloaded: { ['wl_sod_' + todayKey]: existing },
    });
    ensureDayStarted();
    assert.equal(store['wl_sod_' + todayKey], existing, 'SOD timestamp must not be overwritten');
  });

  it('does not call renderSodBtn when day is already started', () => {
    const todayKey = pureFns.dk(new Date());
    const { ensureDayStarted, calls } = loadSodSandbox({
      preloaded: { ['wl_sod_' + todayKey]: '1000000000000' },
    });
    ensureDayStarted();
    assert.equal(calls.renderSodBtn, 0);
  });

  it('does not call renderTimeblock when day is already started', () => {
    const todayKey = pureFns.dk(new Date());
    const { ensureDayStarted, calls } = loadSodSandbox({
      preloaded: { ['wl_sod_' + todayKey]: '1000000000000' },
    });
    ensureDayStarted();
    assert.equal(calls.renderTimeblock, 0);
  });

  it('records SOD against today even when a past day is in view', () => {
    const past = new Date('2026-05-20T09:00:00');
    const todayKey = pureFns.dk(new Date());
    const { ensureDayStarted, store } = loadSodSandbox({ viewDate: past });
    ensureDayStarted();
    assert.ok(store['wl_sod_' + todayKey], 'today key should be written');
    assert.ok(!store['wl_sod_2026-05-20'], 'the viewed past day must not be written');
  });
});

// ── getDayStart / getEodTs read the day in view ───────────────────────────────
describe('per-day start/end lookup', () => {
  const PAST = new Date('2026-05-20T12:00:00');
  const PAST_KEY = '2026-05-20';

  it('getDayStart reads the SOD for the day in view, not today', () => {
    const { getDayStart } = loadSodSandbox({
      viewDate: PAST,
      preloaded: { ['wl_sod_' + PAST_KEY]: '1700000000000' },
    });
    assert.equal(getDayStart(), 1700000000000);
  });

  it('getDayStart returns null when the viewed day has no SOD', () => {
    const todayKey = pureFns.dk(new Date());
    const { getDayStart } = loadSodSandbox({
      viewDate: PAST,
      preloaded: { ['wl_sod_' + todayKey]: '1700000000000' },
    });
    assert.equal(getDayStart(), null);
  });

  it('getEodTs reads the EOD for the day in view, not today', () => {
    const { getEodTs } = loadSodSandbox({
      viewDate: PAST,
      preloaded: { ['wl_eod_' + PAST_KEY]: '1700000050000' },
    });
    assert.equal(getEodTs(), 1700000050000);
  });

  it('an explicit day argument overrides the viewDate default', () => {
    const { getDayStart } = loadSodSandbox({
      viewDate: PAST,
      preloaded: { ['wl_sod_2026-01-01']: '1600000000000' },
    });
    assert.equal(getDayStart(new Date('2026-01-01T08:00:00')), 1600000000000);
  });

  it('sodKey defaults to the day in view when called with no argument', () => {
    const { sodKey } = loadSodSandbox({ viewDate: PAST });
    assert.equal(sodKey(), 'wl_sod_' + PAST_KEY);
  });

  it('eodKey defaults to the day in view when called with no argument', () => {
    const { eodKey } = loadSodSandbox({ viewDate: PAST });
    assert.equal(eodKey(), 'wl_eod_' + PAST_KEY);
  });
});

// ── 08-pomodoro.js — pomoAffirmation / pomoAddTime / pomoTapOut ───────────────
// Functions under test close over `let` state variables (pomoTotal, pomoLeft,
// pomoRunning) that are declared in the pomodoro source.  We work around this
// in two ways:
//   • pomoAffirmation now accepts explicit (total, left) params with defaults,
//     so it can be called as a pure function from outside the script scope.
//   • pomoAddTime and pomoTapOut are tested by concatenating the source with a
//     small test-harness snippet into one vm.runInContext call, so the harness
//     shares the same lexical scope as the source and can read/write the state
//     variables directly.

const pomoSrc = readFileSync(join(__dirname, '../src/js/08-pomodoro.js'), 'utf8');

// Extract everything before the event-listener / init block so no listeners
// fire at load time and updatePomoDisplay() is not called automatically.
const _pomoEndMarker = "\ndocument.getElementById('pomoStart').addEventListener";
const pomoCoreSrc = (() => {
  const idx = pomoSrc.indexOf(_pomoEndMarker);
  if (idx === -1)
    throw new Error('loadPomoSandbox: event-listener marker not found in 08-pomodoro.js');
  return pomoSrc.slice(0, idx);
})();

/**
 * Returns a fresh object containing the browser-globals stubs that
 * 08-pomodoro.js needs at load time.  Pass it as the vm sandbox.
 * @param {Object} [extra] - Additional properties merged onto the sandbox.
 * @returns {Object}
 */
function makePomoSandboxBase(extra = {}) {
  const store = {};
  const makeEl = () => ({
    textContent: '',
    style: {},
    href: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    setAttribute: () => {},
    getAttribute: () => null,
    remove: () => {},
    querySelectorAll: () => ({ forEach: () => {} }),
    insertBefore: () => {},
  });
  const sb = {
    STORE_POMO_LOG: 'wl_pomoLog_v1',
    activeTimer: null,
    entries: [],
    validPomoEntry: (e) => e != null && typeof e.ts === 'number' && typeof e.mins === 'number',
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    renderPomoLog: () => {},
    refreshPomoDashboard: undefined,
    updatePomoTaskLabel: undefined,
    isToday: () => true,
    escHtml: (s) => String(s),
    localStorage: {
      getItem: (key) => store[key] ?? null,
      setItem: (key, val) => {
        store[key] = String(val);
      },
    },
    clearInterval: () => {},
    setInterval: () => null,
    setTimeout: () => null,
    document: {
      getElementById: () => makeEl(),
      querySelector: () => null,
      querySelectorAll: () => ({ forEach: () => {} }),
      createElementNS: () => ({
        setAttribute: () => {},
        querySelectorAll: () => ({ forEach: () => {} }),
        insertBefore: () => {},
      }),
      createElement: () => ({ ...makeEl(), getContext: () => null }),
      head: { appendChild: () => {} },
    },
    _store: store,
    ...extra,
  };
  return sb;
}

// ── pomoAffirmation ───────────────────────────────────────────────────────────
// pomoAffirmation(total, left) is a function declaration, so it is hoisted onto
// the sandbox object after vm.runInContext.  We load the pomo source once and
// call the function directly with explicit (total, left) arguments to keep the
// tests pure and fast.
describe('pomoAffirmation', () => {
  let pomoFnSb;
  before(() => {
    pomoFnSb = makePomoSandboxBase();
    vm.createContext(pomoFnSb);
    vm.runInContext(pomoCoreSrc, pomoFnSb);
  });

  it('returns empty string when total is 0', () => {
    assert.equal(pomoFnSb.pomoAffirmation(0, 0), '');
  });

  it('0 % elapsed → stay with it', () => {
    assert.equal(pomoFnSb.pomoAffirmation(300, 300), '0% in · stay with it');
  });

  it('24 % elapsed → stay with it', () => {
    // 24 % of 300 = 72 elapsed → left = 228
    assert.equal(pomoFnSb.pomoAffirmation(300, 228), '24% in · stay with it');
  });

  it("25 % elapsed → you're in the zone", () => {
    // 25 % of 300 = 75 elapsed → left = 225
    assert.equal(pomoFnSb.pomoAffirmation(300, 225), "25% in · you're in the zone");
  });

  it("49 % elapsed → you're in the zone", () => {
    const left = Math.round(300 * (1 - 0.49));
    assert.equal(pomoFnSb.pomoAffirmation(300, left), "49% in · you're in the zone");
  });

  it('50 % elapsed → keep going', () => {
    assert.equal(pomoFnSb.pomoAffirmation(300, 150), '50% in · keep going');
  });

  it('74 % elapsed → keep going', () => {
    const left = Math.round(300 * (1 - 0.74));
    assert.equal(pomoFnSb.pomoAffirmation(300, left), '74% in · keep going');
  });

  it('75 % elapsed → almost there', () => {
    // 75 % of 300 = 225 elapsed → left = 75
    assert.equal(pomoFnSb.pomoAffirmation(300, 75), '75% in · almost there!');
  });

  it('100 % elapsed → almost there', () => {
    assert.equal(pomoFnSb.pomoAffirmation(300, 0), '100% in · almost there!');
  });
});

// ── pomoAddTime ───────────────────────────────────────────────────────────────
// Each test concatenates pomoCoreSrc + a harness snippet into one runInContext
// call so the harness can read and write the `let` state variables.
describe('pomoAddTime', () => {
  it('adds 120 to pomoLeft and pomoTotal when the timer is running', () => {
    const sb = makePomoSandboxBase({ results: {} });
    vm.createContext(sb);
    vm.runInContext(
      `${pomoCoreSrc}
pomoRunning = true;
const _prevLeft = pomoLeft;
const _prevTotal = pomoTotal;
pomoAddTime();
results.leftDiff = pomoLeft - _prevLeft;
results.totalDiff = pomoTotal - _prevTotal;`,
      sb
    );
    assert.equal(sb.results.leftDiff, 120);
    assert.equal(sb.results.totalDiff, 120);
  });

  it('is a no-op when the timer is not running', () => {
    const sb = makePomoSandboxBase({ results: {} });
    vm.createContext(sb);
    vm.runInContext(
      `${pomoCoreSrc}
pomoRunning = false;
const _prevLeft = pomoLeft;
const _prevTotal = pomoTotal;
pomoAddTime();
results.leftUnchanged = pomoLeft === _prevLeft;
results.totalUnchanged = pomoTotal === _prevTotal;`,
      sb
    );
    assert.equal(sb.results.leftUnchanged, true);
    assert.equal(sb.results.totalUnchanged, true);
  });
});

// ── pomoTapOut ────────────────────────────────────────────────────────────────
describe('pomoTapOut', () => {
  it('sets pomoLeft to 0 and pomoRunning to false', () => {
    const sb = makePomoSandboxBase({ results: {} });
    vm.createContext(sb);
    vm.runInContext(
      `${pomoCoreSrc}
pomoTotal = 300;
pomoLeft = 120;
pomoRunning = true;
pomoTapOut();
results.left = pomoLeft;
results.running = pomoRunning;`,
      sb
    );
    assert.equal(sb.results.left, 0);
    assert.equal(sb.results.running, false);
  });

  it('logs partial minutes equal to elapsed time (180 s → 3 min)', () => {
    const sb = makePomoSandboxBase({ results: {} });
    vm.createContext(sb);
    vm.runInContext(
      `${pomoCoreSrc}
pomoTotal = 300;
pomoLeft = 120;  // 180 s elapsed → ceil(180/60) = 3 min
pomoRunning = true;
pomoTapOut();
const log = JSON.parse(localStorage.getItem(STORE_POMO_LOG) || '[]');
results.mins = log[0].mins;`,
      sb
    );
    assert.equal(sb.results.mins, 3);
  });

  it('records at least 1 minute even when elapsed time is 0', () => {
    const sb = makePomoSandboxBase({ results: {} });
    vm.createContext(sb);
    vm.runInContext(
      `${pomoCoreSrc}
pomoTotal = 300;
pomoLeft = 300;  // 0 s elapsed → partialMins = Math.max(1, 0) = 1
pomoRunning = true;
pomoTapOut();
const log = JSON.parse(localStorage.getItem(STORE_POMO_LOG) || '[]');
results.mins = log[0].mins;`,
      sb
    );
    assert.equal(sb.results.mins, 1);
  });

  it('persists the tap-out entry to STORE_POMO_LOG in localStorage', () => {
    const sb = makePomoSandboxBase({ results: {} });
    vm.createContext(sb);
    vm.runInContext(
      `${pomoCoreSrc}
pomoTotal = 600;
pomoLeft = 0;
pomoRunning = true;
pomoTapOut();
results.stored = localStorage.getItem(STORE_POMO_LOG) !== null;`,
      sb
    );
    assert.equal(sb.results.stored, true);
  });
});

// ── 09-clock-weather.js — updateHeaderTracking ───────────────────────────────
// Extract just the updateHeaderTracking function (JSDoc + body) to avoid
// running tickClock() and setInterval() that fire at the top of the file.

const clockSrc = readFileSync(join(__dirname, '../src/js/09-clock-weather.js'), 'utf8');

const trackingFuncSrc = (() => {
  // Grab from the JSDoc comment before updateHeaderTracking through the next
  // top-level comment (// WEATHER_LAT …).
  const fnIdx = clockSrc.indexOf('function updateHeaderTracking()');
  if (fnIdx === -1) throw new Error('updateHeaderTracking not found in 09-clock-weather.js');
  const docStart = clockSrc.lastIndexOf('/**', fnIdx);
  const blockEnd = clockSrc.indexOf('\n// WEATHER_LAT', fnIdx);
  return clockSrc.slice(docStart, blockEnd > -1 ? blockEnd : undefined);
})();

/**
 * Creates a minimal VM sandbox for testing updateHeaderTracking.
 * The function is now a no-op; the sandbox only needs to execute the source.
 * @returns {{ updateHeaderTracking: Function, _elements: Record<string, object> }}
 */
function loadHeaderTrackingSandbox() {
  const elements = {};
  const sb = {
    // DOM stub — records any getElementById calls so tests can assert none are made
    document: {
      getElementById: (id) => {
        if (!elements[id]) elements[id] = { textContent: '', style: {} };
        return elements[id];
      },
    },
  };
  vm.createContext(sb);
  vm.runInContext(trackingFuncSrc, sb);
  sb._elements = elements;
  return sb;
}

// updateHeaderTracking() was converted to a no-op in the top-zone redesign
// (ITEM 1): the header tracked-total and pace bar were removed.  These tests
// verify the no-op contract: the function must be callable and must not touch
// any DOM elements (those elements no longer exist in the page).
describe('updateHeaderTracking', () => {
  it('does not throw when called with an empty DOM', () => {
    const sb = loadHeaderTrackingSandbox();
    assert.doesNotThrow(() => sb.updateHeaderTracking());
  });

  it('does not create or modify any DOM elements', () => {
    const sb = loadHeaderTrackingSandbox();
    sb.updateHeaderTracking();
    assert.deepEqual(sb._elements, {});
  });
});

// ── auto-pause visibilitychange ──────────────────────────────────────────────
// Extracts the handler body from 07-lifecycle.js and runs it in isolation with
// mock globals so we can verify the guard conditions without a browser.

function runAutoPauseHandler({ autoPauseEnabled, hidden, timerRunning, timerPaused = false }) {
  const lifecycleSrc = readFileSync(join(__dirname, '../src/js/07-lifecycle.js'), 'utf8');
  const handlerMatch = lifecycleSrc.match(
    /document\.addEventListener\('visibilitychange',\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*\);/
  );
  if (!handlerMatch) throw new Error('visibilitychange listener not found in 07-lifecycle.js');
  const pausedCalls = [];
  const box = {
    AUTO_PAUSE_ON_TAB_SWITCH: autoPauseEnabled,
    document: { hidden },
    activeTimer: timerRunning ? { paused: timerPaused } : null,
    pauseTimer: () => pausedCalls.push(true),
    wlLog: { info: () => {} },
  };
  vm.createContext(box);
  vm.runInContext(`(function(){${handlerMatch[1]}})()`, box);
  return pausedCalls;
}

describe('auto-pause on visibilitychange', () => {
  it('calls pauseTimer when tab hides with a running timer and feature enabled', () => {
    const calls = runAutoPauseHandler({
      autoPauseEnabled: true,
      hidden: true,
      timerRunning: true,
      timerPaused: false,
    });
    assert.equal(calls.length, 1);
  });

  it('does not pause when AUTO_PAUSE_ON_TAB_SWITCH is false', () => {
    const calls = runAutoPauseHandler({
      autoPauseEnabled: false,
      hidden: true,
      timerRunning: true,
      timerPaused: false,
    });
    assert.equal(calls.length, 0);
  });

  it('does not pause when the tab becomes visible (hidden=false)', () => {
    const calls = runAutoPauseHandler({
      autoPauseEnabled: true,
      hidden: false,
      timerRunning: true,
      timerPaused: false,
    });
    assert.equal(calls.length, 0);
  });

  it('does not pause when no active timer', () => {
    const calls = runAutoPauseHandler({
      autoPauseEnabled: true,
      hidden: true,
      timerRunning: false,
    });
    assert.equal(calls.length, 0);
  });

  it('does not pause when timer is already paused', () => {
    const calls = runAutoPauseHandler({
      autoPauseEnabled: true,
      hidden: true,
      timerRunning: true,
      timerPaused: true,
    });
    assert.equal(calls.length, 0);
  });
});

// ── renderMigrationStep — safeCssColor sanitisation ────────────────────────
// renderMigrationStep lives in 20-migration.js and builds a style attribute
// using cat.color. We verify it goes through safeCssColor so a malicious stored
// value cannot inject arbitrary CSS.

/**
 * Creates a VM sandbox with pure-fns.js and 20-migration.js loaded.
 * Promotes _migItems and _migIdx to var so tests can mutate them via the
 * sandbox object without reloading the module.
 *
 * @param {Object} [overrides] - Properties to merge into the sandbox before evaluation.
 * @returns {{ sandbox: Object, getBodyHtml: () => string }}
 */
function loadMigrationSandbox(overrides = {}) {
  const pureSrc = readFileSync(join(__dirname, '../src/js/pure-fns.js'), 'utf8').replace(
    /^export ((?:async\s+)?(?:const|function|let|class))\b/gm,
    '$1'
  );
  const migSrc = readFileSync(join(__dirname, '../src/js/20-migration.js'), 'utf8')
    .replace(/\blet (_migItems)\b/, 'var $1')
    .replace(/\blet (_migIdx)\b/, 'var $1');

  let capturedBodyHtml = '';
  const bodyEl = {
    set innerHTML(v) {
      capturedBodyHtml = v;
    },
    get innerHTML() {
      return capturedBodyHtml;
    },
  };

  const sandbox = {
    document: {
      getElementById: (id) => {
        if (id === 'migrationBody') return bodyEl;
        return { addEventListener: () => {}, style: {}, textContent: '' };
      },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    alert: () => {},
    planTasks: [],
    categories: [],
    STORE_MIGRATION: 'wl_migration_v1',
    getCat: (id) => ({ id, label: id, color: '#888780' }),
    carryMigTask: () => {},
    scheduleMigTask: () => {},
    dropMigTask: () => {},
    render: () => {},
    save: () => {},
    ...overrides,
  };

  vm.createContext(sandbox);
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(migSrc, sandbox);
  return { sandbox, getBodyHtml: () => capturedBodyHtml };
}

describe('renderMigrationStep', () => {
  it('sanitises a malicious cat.color value via safeCssColor', () => {
    const malicious = 'red; background:url(x)';
    const { sandbox, getBodyHtml } = loadMigrationSandbox({
      getCat: () => ({ id: 'evil', label: 'Evil', color: malicious }),
    });
    sandbox._migItems = [{ tag: 'evil', text: 'Task', date: '2026-05-01' }];
    sandbox._migIdx = 0;
    sandbox.renderMigrationStep();
    const html = getBodyHtml();
    assert.ok(!html.includes(malicious), 'raw malicious value must not appear in innerHTML');
    assert.ok(html.includes('background:#888780'), 'safeCssColor fallback must be used');
  });

  it('passes a valid hex colour through unchanged', () => {
    const { sandbox, getBodyHtml } = loadMigrationSandbox({
      getCat: () => ({ id: 'work', label: 'Work', color: '#4a90e2' }),
    });
    sandbox._migItems = [{ tag: 'work', text: 'Valid task', date: '2026-05-01' }];
    sandbox._migIdx = 0;
    sandbox.renderMigrationStep();
    assert.ok(getBodyHtml().includes('background:#4a90e2'));
  });

  it('renders the done screen when all items are resolved', () => {
    const { sandbox, getBodyHtml } = loadMigrationSandbox();
    sandbox._migItems = [{ tag: 'other', text: 'Done task', date: '2026-05-01' }];
    sandbox._migIdx = 1;
    sandbox.renderMigrationStep();
    assert.ok(getBodyHtml().includes('mig-done'));
  });
});

// ── jiraRenderTasks — safeCssColor sanitisation ─────────────────────────────
// jiraRenderTasks builds cat-dot spans with cat.color in a style attribute.
// We verify it goes through safeCssColor (not escHtml) so a malicious stored
// colour cannot inject CSS.

/**
 * Creates a VM sandbox with pure-fns.js and 14-jira.js loaded.
 * Strips the IIFE wrapper so internal functions are sandbox-accessible.
 * Promotes jiraTasks, jiraSelected, jiraCatMap to var so tests can seed them.
 *
 * @param {Object} [overrides] - Properties merged into the sandbox before eval.
 * @returns {{ sandbox: Object, getContainerHtml: () => string }}
 */
function loadJiraSandbox(overrides = {}) {
  let jiraSrc = readFileSync(join(__dirname, '../src/js/14-jira.js'), 'utf8');
  jiraSrc = jiraSrc.replace(/\(function initJiraImporter\(\)\s*\{\r?\n/, '');
  jiraSrc = jiraSrc.replace(/\r?\n\}\)\(\);\r?\n?$/, '');
  jiraSrc = jiraSrc.replace(
    /let jiraTasks = \[\],\r?\n\s*jiraSelected = new Set\(\),\r?\n\s*jiraCatMap = \{\};/,
    'var jiraTasks = [];\nvar jiraSelected = new Set();\nvar jiraCatMap = {};'
  );
  if (!jiraSrc.includes('function jiraRenderTasks'))
    throw new Error('loadJiraSandbox: IIFE strip or var-promotion failed — check 14-jira.js');
  if (jiraSrc.includes('(function initJiraImporter'))
    throw new Error('loadJiraSandbox: IIFE opening was not removed');
  const pureSrc = readFileSync(join(__dirname, '../src/js/pure-fns.js'), 'utf8').replace(
    /^export ((?:async\s+)?(?:const|function|let|class))\b/gm,
    '$1'
  );

  let capturedHtml = '';
  const containerEl = {
    set innerHTML(v) {
      capturedHtml = v;
    },
    get innerHTML() {
      return capturedHtml;
    },
    style: {},
    querySelectorAll: () => [],
  };
  const stub = () => ({
    addEventListener: () => {},
    style: {},
    textContent: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    disabled: false,
  });

  const sandbox = {
    window: {},
    document: {
      getElementById: (id) => (id === 'jiraTaskRows' ? containerEl : stub()),
      addEventListener: () => {},
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    alert: () => {},
    planTasks: [],
    categories: [],
    getCat: () => null,
    addPlanTask: () => {},
    render: () => {},
    save: () => {},
    savePlan: () => {},
    renderPlan: () => {},
    readCollapseState: (_id, defaultVal) => defaultVal,
    writeCollapseState: () => {},
    ...overrides,
  };

  vm.createContext(sandbox);
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(jiraSrc, sandbox);
  return { sandbox, getContainerHtml: () => capturedHtml };
}

describe('jiraRenderTasks', () => {
  it('sanitises a malicious cat.color via safeCssColor', () => {
    const malicious = 'red; background:url(x)';
    const { sandbox, getContainerHtml } = loadJiraSandbox();
    // jiraGetCat(t) returns jiraCatMap[parentKey|parentSummary]
    sandbox.jiraCatMap = { '|': { id: 'evil', label: 'Evil', color: malicious } };
    sandbox.jiraTasks = [{ key: 'EVIL-1', summary: 'Bad task', status: 'todo' }];
    sandbox.jiraSelected = new Set();
    sandbox.jiraRenderTasks();
    const html = getContainerHtml();
    assert.ok(!html.includes(malicious), 'raw malicious value must not appear');
    assert.ok(html.includes('background:#888780'), 'safeCssColor fallback must be used');
  });

  it('passes a valid hex colour through unchanged', () => {
    const { sandbox, getContainerHtml } = loadJiraSandbox();
    sandbox.jiraCatMap = { '|': { id: 'work', label: 'Work', color: '#4a90e2' } };
    sandbox.jiraTasks = [{ key: 'WORK-1', summary: 'Good task', status: 'todo' }];
    sandbox.jiraSelected = new Set();
    sandbox.jiraRenderTasks();
    assert.ok(getContainerHtml().includes('background:#4a90e2'));
  });

  it('renders no cat-dot when the task has no matching category', () => {
    const { sandbox, getContainerHtml } = loadJiraSandbox();
    sandbox.jiraCatMap = {};
    sandbox.jiraTasks = [{ key: 'X-1', summary: 'Orphan', status: 'todo' }];
    sandbox.jiraSelected = new Set();
    sandbox.jiraRenderTasks();
    assert.ok(!getContainerHtml().includes('background:'));
  });
});

// ── buildDailyLogItems — session-note partitioning ───────────────────────────

const dailylogSrc = readFileSync(join(__dirname, '../src/js/18-dailylog.js'), 'utf8');

/**
 * Minimal VM sandbox for buildDailyLogItems.
 * @param {object} overrides
 */
function loadDailylogSandbox(overrides = {}) {
  const sb = {
    entries: [],
    logNotes: [],
    planTasks: [],
    getCat: () => ({ label: 'work', color: '#378ADD' }),
    escHtml: (s) => String(s),
    dk: (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },
    fmtDur: (ms) => `${Math.round(ms / 60000)}m`,
    sigSymbol: () => '',
    wlLog: { info: () => {}, warn: () => {}, error: () => {} },
    renderTodayFlow: () => {},
    saveLogNotes: () => {},
    document: { getElementById: () => null },
    ...overrides,
  };
  vm.createContext(sb);
  vm.runInContext(dailylogSrc, sb);
  return sb;
}

describe('buildDailyLogItems — session-note partitioning', () => {
  const TODAY = '2026-06-01';

  it('emits type "note" for regular log notes', () => {
    const sb = loadDailylogSandbox();
    sb.logNotes = [{ id: 'n1', text: 'standup', ts: 1000, date: TODAY, type: 'note' }];
    const items = sb.buildDailyLogItems(TODAY);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'note');
    assert.ok(items[0].text.includes('standup'), 'note text preserved');
  });

  it('emits type "session-note" with parentEntryId for session notes', () => {
    const sb = loadDailylogSandbox();
    sb.logNotes = [
      {
        id: 'sn1',
        text: 'checked logs',
        ts: 2000,
        date: TODAY,
        type: 'session-note',
        entryId: 'e42',
      },
    ];
    const items = sb.buildDailyLogItems(TODAY);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'session-note');
    assert.equal(items[0].parentEntryId, 'e42');
    assert.equal(items[0].text, 'checked logs');
  });

  it('does not wrap session-note text in <em>', () => {
    const sb = loadDailylogSandbox();
    sb.logNotes = [
      { id: 'sn2', text: 'raw text', ts: 3000, date: TODAY, type: 'session-note', entryId: 'e1' },
    ];
    const items = sb.buildDailyLogItems(TODAY);
    assert.ok(!items[0].text.includes('<em>'), 'no <em> wrapper for session notes');
  });

  it('wraps regular note text in <em>', () => {
    const sb = loadDailylogSandbox();
    sb.logNotes = [{ id: 'n2', text: 'a thought', ts: 4000, date: TODAY, type: 'note' }];
    const items = sb.buildDailyLogItems(TODAY);
    assert.ok(items[0].text.includes('<em>'), 'regular note wrapped in <em>');
  });

  it('excludes notes from other days', () => {
    const sb = loadDailylogSandbox();
    sb.logNotes = [
      {
        id: 'sn3',
        text: 'yesterday',
        ts: 5000,
        date: '2026-05-31',
        type: 'session-note',
        entryId: 'e1',
      },
    ];
    const items = sb.buildDailyLogItems(TODAY);
    assert.equal(items.length, 0);
  });

  it('returns both entry items and session-note items sorted by ts', () => {
    const sb = loadDailylogSandbox();
    sb.entries = [{ id: 'e1', text: 'Big task', tag: 'work', ts: 1000, date: TODAY, tsEnd: 5000 }];
    sb.logNotes = [
      {
        id: 'sn1',
        text: 'progress update',
        ts: 3000,
        date: TODAY,
        type: 'session-note',
        entryId: 'e1',
      },
    ];
    const items = sb.buildDailyLogItems(TODAY);
    assert.equal(items.length, 2);
    assert.equal(items[0].type, 'entry');
    assert.equal(items[1].type, 'session-note');
    assert.equal(items[1].parentEntryId, 'e1');
  });
});

// ── partitionSessionNotes ────────────────────────────────────────────────────

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

// ── buildSessionNotesHtml ────────────────────────────────────────────────────

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

// ── resolveCarryStatus ────────────────────────────────────────────────────────
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

// ── work location ─────────────────────────────────────────────────────────────
describe('locationFor', () => {
  it('returns the stored location for a known day', () =>
    assert.equal(locationFor({ '2026-06-03': 'office' }, '2026-06-03'), 'office'));

  it('defaults to remote when the day is unset', () =>
    assert.equal(locationFor({}, '2026-06-03'), DEFAULT_WORK_LOCATION));

  it('defaults to remote when the day is not in the map', () =>
    assert.equal(locationFor({ '2026-06-02': 'office' }, '2026-06-03'), 'remote'));

  it('falls back to the default for an unknown stored value', () =>
    assert.equal(locationFor({ '2026-06-03': 'moon-base' }, '2026-06-03'), 'remote'));

  it('tolerates a null map', () =>
    assert.equal(locationFor(null, '2026-06-03'), DEFAULT_WORK_LOCATION));

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

// ── loadLocationMap (24-location.js localStorage glue) ─────────────────────────
const locationSrc = readFileSync(join(__dirname, '../src/js/24-location.js'), 'utf8');

/**
 * Creates a vm sandbox exposing 24-location.js's functions with a stubbed
 * localStorage seeded from `preloaded`. STORE_LOCATION (normally declared in
 * 01-state.js) is injected directly so the module can resolve it.
 * @param {Record<string, string>} [preloaded] - Initial localStorage contents.
 * @returns {object} The vm sandbox with the module's functions attached.
 */
function loadLocationSandbox(preloaded = {}) {
  const store = { ...preloaded };
  const warnings = [];
  const sandbox = {
    STORE_LOCATION: 'wl_location_v1',
    WORK_LOCATIONS,
    DEFAULT_WORK_LOCATION,
    locationFor,
    nextLocation,
    viewDate: new Date('2026-06-03T12:00:00'),
    dk: (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v;
      },
    },
    document: { getElementById: () => null },
    wlLog: { info: () => {}, warn: (m) => warnings.push(m), error: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(locationSrc, sandbox);
  sandbox.__warnings = warnings;
  return sandbox;
}

describe('loadLocationMap', () => {
  // The map is built inside the vm realm, so spread it into a this-realm object
  // before deepEqual — cross-realm objects have a different Object.prototype.
  const plain = (sb) => ({ ...sb.loadLocationMap() });

  it('returns the parsed map for valid stored JSON', () => {
    const sb = loadLocationSandbox({ wl_location_v1: '{"2026-06-03":"office"}' });
    assert.deepEqual(plain(sb), { '2026-06-03': 'office' });
  });

  it('returns an empty map when the key is missing', () => {
    const sb = loadLocationSandbox();
    assert.deepEqual(plain(sb), {});
  });

  it('returns an empty map and warns on corrupt JSON', () => {
    const sb = loadLocationSandbox({ wl_location_v1: '{not valid json' });
    assert.deepEqual(plain(sb), {});
    assert.equal(sb.__warnings.length, 1);
  });

  it('returns an empty map when the stored value is not an object', () => {
    const sb = loadLocationSandbox({ wl_location_v1: '42' });
    assert.deepEqual(plain(sb), {});
  });
});

// ── buildRollingSummary ───────────────────────────────────────────────────────

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
