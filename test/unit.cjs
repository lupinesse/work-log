// Work Log — Unit Tests
// Run with: node test/unit.cjs
// Covers pure functions from src/js/00-pure-fns.js and the Notion integration
// in src/js/15-notion.js using Node's built-in test runner. No browser,
// no Playwright, no build step required.
//
// Node >=20 required (matches `engines` in package.json).

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Load the pure functions from source by evaluating the file in a vm sandbox.
// This bypasses the ESM/CJS module boundary (package.json has "type": "module"
// so .js files are ESM and can't be require()'d directly).  The vm approach
// reads the file as plain text and executes it — function declarations become
// properties on the sandbox object, giving us the exact compiled-for-browser
// source under test rather than a duplicate copy.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../src/js/00-pure-fns.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const {
  safeCssColor,
  escHtml,
  dk,
  fmtTime,
  fmtElapsed,
  fmtDur,
  fmtDurLong,
  roundUp30,
  roundToNearest30,
  validEntry,
  validCategory,
  validPlanTask,
  validBlock,
  validTimer,
  validPomoEntry,
  validateBackupFile,
} = sandbox;

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

// ── 15-notion.js ─────────────────────────────────────────────────────────────
// Tests for addTaskToNotion, saveTaskNotionUrl, and callClaudeWithNotion.
// These functions depend on browser globals (fetch, getCat, planTasks, etc.)
// so each test builds a fresh VM sandbox with stubs for those globals.

const notionSrc = fs.readFileSync(path.join(__dirname, '../src/js/15-notion.js'), 'utf8');

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
 * @returns {Object} The populated sandbox.
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

describe('addTaskToNotion', () => {
  it('returns the Notion page URL on success', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse(JSON.stringify({ url: 'https://notion.so/page-1' })),
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
        return new MockResponse(JSON.stringify({ url: 'https://notion.so/p' }));
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
        return new MockResponse(JSON.stringify({ url: 'https://notion.so/p' }));
      },
    });
    await sandbox.addTaskToNotion({ text: 'Untagged task' });
    assert.equal(captured.epic, 'other');
  });

  it('throws when the API returns a non-OK status', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse(JSON.stringify({ detail: 'Forbidden' }), { status: 403 }),
    });
    await assert.rejects(
      () => sandbox.addTaskToNotion({ text: 'x', tag: 'a' }),
      (err) => err.message === 'Forbidden'
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

  it('throws when the response is OK but contains no URL', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse(JSON.stringify({ id: '123' })),
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
});

describe('callClaudeWithNotion', () => {
  it('returns concatenated text content from a successful response', async () => {
    const body = {
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'tool_use', id: 'x' },
        { type: 'text', text: 'World' },
      ],
    };
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse(JSON.stringify(body)),
    });
    const result = await sandbox.callClaudeWithNotion('test prompt');
    assert.equal(result, 'Hello World');
  });

  it('sends model and maxTokens overrides in the request body', async () => {
    let captured;
    const sandbox = loadNotionSandbox({
      fetch: async (_url, opts) => {
        captured = JSON.parse(opts.body);
        return new MockResponse(JSON.stringify({ content: [] }));
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
        return new MockResponse(JSON.stringify({ content: [] }));
      },
    });
    await sandbox.callClaudeWithNotion('p');
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

  it('includes truncated body text in the error message', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse('Some error detail', { status: 400 }),
    });
    await assert.rejects(
      () => sandbox.callClaudeWithNotion('p'),
      (err) => err.message === 'API 400: Some error detail'
    );
  });

  it('returns empty string when response has no text blocks', async () => {
    const sandbox = loadNotionSandbox({
      fetch: async () => new MockResponse(JSON.stringify({ content: [] })),
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
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(savedTaskId, 'p2');
    assert.equal(savedUrl, 'https://notion.so/new-page');
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
    await new Promise((resolve) => setImmediate(resolve));

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
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, '📋');
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /Failed to add to Notion: API down/);
  });
});
