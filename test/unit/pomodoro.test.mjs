/**
 * @file pomodoro.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname } from './_helpers.mjs';

const pomoSrc = readFileSync(join(__dirname, '../../src/js/08-pomodoro.js'), 'utf8');

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
