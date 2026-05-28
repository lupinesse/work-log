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
 * Creates a VM sandbox with 00-pure-fns.js and 10-tasks.js loaded.
 * The sandbox exposes `flatSort` as a property (function declaration = global).
 *
 * @param {Object} [overrides] - Properties to merge into the sandbox before evaluation.
 * @returns {Object} The populated VM sandbox.
 */
function loadFlatSortSandbox(overrides = {}) {
  const pureSrc = fs.readFileSync(path.join(__dirname, '../src/js/00-pure-fns.js'), 'utf8');
  const tasksSrc = fs.readFileSync(path.join(__dirname, '../src/js/10-tasks.js'), 'utf8');
  const sandbox = {
    document: {
      getElementById: () => ({
        addEventListener: () => {},
        style: {},
        classList: { toggle: () => {} },
      }),
    },
    localStorage: { getItem: () => null, setItem: () => {} },
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
 * Creates a VM sandbox with 00-pure-fns.js and 16-rapid.js loaded.
 * Injects getCat using the sandbox's `categories` array.
 *
 * @param {Object} [overrides] - Properties to merge into the sandbox before evaluation.
 * @returns {Object} The populated VM sandbox.
 */
function loadRapidSandbox(overrides = {}) {
  const pureSrc = fs.readFileSync(path.join(__dirname, '../src/js/00-pure-fns.js'), 'utf8');
  const rapidSrc = fs
    .readFileSync(path.join(__dirname, '../src/js/16-rapid.js'), 'utf8')
    .replace(/\blet (_qcFilterCat)\b/, 'var $1')
    .replace(/\blet (_qcSearch)\b/, 'var $1');

  const sandbox = {
    document: { getElementById: () => null, addEventListener: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
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
