/**
 * @file pure-fns-validate.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validEntry,
  validCategory,
  validPlanTask,
  validBlock,
  validTimer,
  validPomoEntry,
  validateBackupFile,
  filterNewBackupEntries,
  validWeatherResponse,
  validCalendarMeeting,
  normalizeCalendarMeeting,
  calendarMeetingKey,
  isMeetingHidden,
  validJiraCsvRow,
} from '../../src/js/pure-fns.js';

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
  it('link is optional — entry still valid without it', () => assert.ok(validEntry(base)));
  it('accepts a string link', () =>
    assert.ok(validEntry({ ...base, link: 'https://confluence/PROJ/pages/123' })));
  it('rejects a numeric link', () => assert.equal(validEntry({ ...base, link: 123 }), false));
  it('note is optional — entry still valid without it', () => assert.ok(validEntry(base)));
  it('accepts a string note', () => assert.ok(validEntry({ ...base, note: 'wrote the report' })));
  it('rejects a numeric note', () => assert.equal(validEntry({ ...base, note: 7 }), false));
});

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

describe('validBlock', () => {
  const base = { id: '1', date: '2026-05-26', slot: 2, duration: 1, text: 'standup' };

  it('accepts a valid block', () => assert.ok(validBlock(base)));
  it('rejects null', () => assert.equal(validBlock(null), false));
  it('rejects missing id', () => assert.equal(validBlock({ ...base, id: undefined }), false));
  it('rejects string slot', () => assert.equal(validBlock({ ...base, slot: '2' }), false));
  it('rejects string duration', () => assert.equal(validBlock({ ...base, duration: '1' }), false));
  it('rejects missing text', () => assert.equal(validBlock({ ...base, text: undefined }), false));
});

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

describe('validPomoEntry', () => {
  it('accepts a valid pomo entry', () => assert.ok(validPomoEntry({ ts: 1_000_000, mins: 25 })));
  it('rejects null', () => assert.equal(validPomoEntry(null), false));
  it('rejects missing ts', () => assert.equal(validPomoEntry({ mins: 25 }), false));
  it('rejects missing mins', () => assert.equal(validPomoEntry({ ts: 1_000_000 }), false));
  it('rejects string mins', () =>
    assert.equal(validPomoEntry({ ts: 1_000_000, mins: '25' }), false));
  it('rejects string ts', () => assert.equal(validPomoEntry({ ts: '1000000', mins: 25 }), false));
});

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

describe('normalizeCalendarMeeting', () => {
  const base = { subject: 'Standup', start: '2026-05-28T09:00', end: '2026-05-28T09:30' };

  it('leaves a normal subject unchanged', () =>
    assert.equal(normalizeCalendarMeeting(base).subject, 'Standup'));
  it('names an untitled meeting so it survives validation', () =>
    assert.equal(normalizeCalendarMeeting({ ...base, subject: null }).subject, '(no title)'));
  it('names a meeting with a missing subject', () =>
    assert.equal(normalizeCalendarMeeting({ start: 'a', end: 'b' }).subject, '(no title)'));
  it('names a meeting with a blank subject', () =>
    assert.equal(normalizeCalendarMeeting({ ...base, subject: '   ' }).subject, '(no title)'));
  it('names a meeting with a non-string subject', () =>
    assert.equal(normalizeCalendarMeeting({ ...base, subject: 42 }).subject, '(no title)'));
  it('trims surrounding whitespace', () =>
    assert.equal(normalizeCalendarMeeting({ ...base, subject: '  Standup  ' }).subject, 'Standup'));
  it('keeps the other fields', () => {
    const normalized = normalizeCalendarMeeting({ ...base, subject: null, joinUrl: 'https://x' });
    assert.equal(normalized.start, base.start);
    assert.equal(normalized.end, base.end);
    assert.equal(normalized.joinUrl, 'https://x');
  });
  it('does not modify the input', () => {
    const input = { ...base, subject: null };
    normalizeCalendarMeeting(input);
    assert.equal(input.subject, null);
  });
  it('passes a normalised untitled meeting through the validator', () =>
    assert.ok(validCalendarMeeting(normalizeCalendarMeeting({ ...base, subject: null }))));
  it('returns null unchanged', () => assert.equal(normalizeCalendarMeeting(null), null));
  it('returns a non-object unchanged', () => assert.equal(normalizeCalendarMeeting('x'), 'x'));
});

describe('calendarMeetingKey', () => {
  it('pairs subject and start', () =>
    assert.equal(
      calendarMeetingKey({ subject: 'Standup', start: '2026-05-28T09:00' }),
      'Standup|2026-05-28T09:00'
    ));
  it('separates two occurrences of one recurring meeting', () =>
    assert.notEqual(
      calendarMeetingKey({ subject: 'Standup', start: '2026-05-28T09:00' }),
      calendarMeetingKey({ subject: 'Standup', start: '2026-05-28T14:00' })
    ));
  it('tolerates a missing start', () =>
    assert.equal(calendarMeetingKey({ subject: 'Standup' }), 'Standup|'));
  it('returns an empty string for null', () => assert.equal(calendarMeetingKey(null), ''));
});

describe('isMeetingHidden', () => {
  const standupMorning = { subject: 'Standup', start: '2026-05-28T09:00' };
  const standupAfternoon = { subject: 'Standup', start: '2026-05-28T14:00' };

  it('hides the meeting whose key was stored', () =>
    assert.ok(isMeetingHidden(standupMorning, ['Standup|2026-05-28T09:00'])));
  it('leaves another occurrence of the same meeting visible', () =>
    assert.equal(isMeetingHidden(standupAfternoon, ['Standup|2026-05-28T09:00']), false));
  it('leaves an unrelated meeting visible', () =>
    assert.equal(isMeetingHidden({ subject: 'Retro', start: 'x' }, ['Standup|y']), false));
  it('still honours a legacy subject-only entry', () =>
    assert.ok(isMeetingHidden(standupMorning, ['Standup'])));
  it('returns false for an empty list', () =>
    assert.equal(isMeetingHidden(standupMorning, []), false));
  it('returns false when the stored value is not an array', () =>
    assert.equal(isMeetingHidden(standupMorning, null), false));
  it('ignores non-string entries', () =>
    assert.equal(isMeetingHidden(standupMorning, [42, null]), false));
});

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

function makeBackupEntry(id, date = '2026-06-03') {
  return { id, text: 'task', ts: 1000, date };
}

const alwaysValid = () => true;

const alwaysInvalid = () => false;

describe('filterNewBackupEntries', () => {
  it('returns backup entries whose id is absent from currentEntries', () => {
    const current = [makeBackupEntry('a'), makeBackupEntry('b')];
    const backup = [makeBackupEntry('b'), makeBackupEntry('c')];
    const result = filterNewBackupEntries(current, backup, alwaysValid);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'c');
  });

  it('returns all backup entries when currentEntries is empty', () => {
    const backup = [makeBackupEntry('x'), makeBackupEntry('y')];
    const result = filterNewBackupEntries([], backup, alwaysValid);
    assert.equal(result.length, 2);
  });

  it('returns an empty array when backupEntries is empty', () => {
    const current = [makeBackupEntry('a')];
    const result = filterNewBackupEntries(current, [], alwaysValid);
    assert.deepEqual(result, []);
  });

  it('returns an empty array when all backup ids are already present', () => {
    const current = [makeBackupEntry('a'), makeBackupEntry('b')];
    const backup = [makeBackupEntry('a'), makeBackupEntry('b')];
    const result = filterNewBackupEntries(current, backup, alwaysValid);
    assert.deepEqual(result, []);
  });

  it('excludes backup entries that fail the isValid predicate', () => {
    const current = [];
    const backup = [makeBackupEntry('a'), makeBackupEntry('b')];
    const result = filterNewBackupEntries(current, backup, alwaysInvalid);
    assert.deepEqual(result, []);
  });

  it('excludes invalid entries even when their id is new', () => {
    const current = [makeBackupEntry('existing')];
    const backup = [
      makeBackupEntry('new-valid'),
      { id: 'new-invalid' }, // missing required fields → validEntry returns false
    ];
    const isValid = (e) => typeof e.text === 'string' && typeof e.ts === 'number';
    const result = filterNewBackupEntries(current, backup, isValid);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'new-valid');
  });

  it('does not mutate the currentEntries or backupEntries arrays', () => {
    const current = [makeBackupEntry('a')];
    const backup = [makeBackupEntry('b')];
    const currentCopy = [...current];
    const backupCopy = [...backup];
    filterNewBackupEntries(current, backup, alwaysValid);
    assert.deepEqual(current, currentCopy);
    assert.deepEqual(backup, backupCopy);
  });
});
