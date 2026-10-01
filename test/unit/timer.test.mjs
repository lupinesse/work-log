/**
 * @file timer.test.mjs
 * Unit tests for 03-timer.js's use of the state.js timerInterval accessors
 * (#423). The timer functions used to reassign a bare `timerInterval` binding
 * declared in 01-state.js; they now read/write it through
 * getTimerInterval()/setTimerInterval(). These tests load the real 03-timer.js
 * source with the real state.js accessors and a fake setInterval/clearInterval,
 * so a regression to a stray bare `timerInterval` shows up as the accessor not
 * holding (or not clearing) the interval ID.
 *
 * Run: node --test test/unit/timer.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it, beforeEach } from 'node:test';
import vm from 'node:vm';

import { __dirname } from './_helpers.mjs';
import { clearTimerInterval, getTimerInterval, setTimerInterval } from '../../src/js/state.js';

const timerSource = readFileSync(join(__dirname, '../../src/js/03-timer.js'), 'utf8');

/** Restores the real clearInterval after a test that replaced it; set by loadTimer(). */
let restoreClearInterval = null;
afterEach(() => restoreClearInterval?.());

/**
 * Minimal stand-in for a DOM element: 03-timer.js binds listeners at load time
 * and toggles classes/values when stopping, but none of that is under test.
 * @returns {object} A fake element that accepts the calls the timer code makes.
 */
function fakeElement() {
  return {
    addEventListener: () => {},
    classList: { add: () => {}, remove: () => {} },
    style: {},
    value: '',
  };
}

/**
 * Loads 03-timer.js into a VM sandbox wired to the real state.js accessors,
 * with the UI collaborators stubbed and setInterval/clearInterval faked.
 * @param {object} [options] - Sandbox overrides.
 * @param {object|null} [options.activeTimer] - Initial active timer.
 * @param {Array<object>} [options.entries] - Initial log entries.
 * @returns {{ sandbox: object, intervalsStarted: Function[], intervalsCleared: number[] }}
 */
function loadTimer({ activeTimer = null, entries = [] } = {}) {
  const intervalsStarted = [];
  const intervalsCleared = [];
  // state.js's clearTimerInterval() calls the real global clearInterval, not
  // the sandbox's, so intercept it there; afterEach puts the original back.
  const realClearInterval = globalThis.clearInterval;
  globalThis.clearInterval = (id) => intervalsCleared.push(id);
  restoreClearInterval = () => {
    globalThis.clearInterval = realClearInterval;
  };
  const noop = () => {};
  const sandbox = {
    clearTimerInterval,
    getTimerInterval,
    setTimerInterval,
    activeTimer,
    entries,
    _lastChimeMinute: 0,
    _longRunningWarnDismissed: true,
    setInterval: (callback) => {
      intervalsStarted.push(callback);
      return intervalsStarted.length * 100; // distinct, truthy fake IDs
    },
    save: noop,
    render: noop,
    updateTimerBar: noop,
    updateTimerBtn: noop,
    updateTabAndFavicon: noop,
    renderHeroCard: noop,
    heroEnterStopped: noop,
    roundToNearest30IfBillable: (ts) => ts,
    document: {
      getElementById: () => fakeElement(),
      querySelector: () => null,
      addEventListener: () => {},
    },
    Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(timerSource, sandbox);
  // The file defines its own UI/tick helpers, which would override the stubs
  // above at load. Their behaviour is out of scope; re-stub them so only the
  // interval bookkeeping is under test.
  for (const name of ['tickTimer', 'updateTimerBar', 'updateTabAndFavicon', 'updateTimerBtn']) {
    sandbox[name] = noop;
  }
  return { sandbox, intervalsStarted, intervalsCleared };
}

describe('03-timer.js stores its interval ID via state.js accessors', () => {
  beforeEach(() => setTimerInterval(null));

  it('startTimer holds the new interval ID in the accessor', () => {
    const { sandbox, intervalsStarted } = loadTimer();
    sandbox.startTimer('e1');
    assert.equal(intervalsStarted.length, 1);
    assert.equal(getTimerInterval(), 100);
  });

  it('startTimer clears a previously held interval before starting another', () => {
    const { sandbox, intervalsCleared } = loadTimer();
    sandbox.startTimer('e1');
    sandbox.startTimer('e2');
    assert.deepEqual(intervalsCleared, [100]);
    assert.equal(getTimerInterval(), 200);
  });

  it('pauseTimer clears the interval and resets the accessor to null', () => {
    const { sandbox, intervalsCleared } = loadTimer();
    sandbox.startTimer('e1');
    sandbox.pauseTimer();
    assert.deepEqual(intervalsCleared, [100]);
    assert.equal(getTimerInterval(), null);
  });

  it('resumeTimer holds a fresh interval ID in the accessor', () => {
    const { sandbox } = loadTimer();
    sandbox.startTimer('e1');
    sandbox.pauseTimer();
    sandbox.resumeTimer();
    assert.equal(getTimerInterval(), 200);
  });

  it('stopTimer clears the interval and resets the accessor to null', () => {
    const { sandbox, intervalsCleared } = loadTimer({
      entries: [{ id: 'e1', ts: 0 }],
    });
    sandbox.startTimer('e1');
    sandbox.stopTimer();
    assert.deepEqual(intervalsCleared, [100]);
    assert.equal(getTimerInterval(), null);
  });

  it('pauseTimer leaves the accessor untouched when no timer is active', () => {
    const { sandbox, intervalsCleared } = loadTimer();
    setTimerInterval(7);
    sandbox.pauseTimer();
    assert.deepEqual(intervalsCleared, []);
    assert.equal(getTimerInterval(), 7);
  });

  it('resumeTimerIfActive starts an interval for a running timer restored from storage', () => {
    const { sandbox, intervalsStarted } = loadTimer({
      activeTimer: { entryId: 'e1', startTs: Date.now(), accumulatedMs: 0, paused: false },
      entries: [{ id: 'e1', ts: 0, text: 'restored' }],
    });
    sandbox.resumeTimerIfActive();
    assert.equal(intervalsStarted.length, 1);
    assert.equal(getTimerInterval(), 100);
  });

  it('resumeTimerIfActive does not start an interval for a restored paused timer', () => {
    const { sandbox, intervalsStarted } = loadTimer({
      activeTimer: { entryId: 'e1', startTs: null, accumulatedMs: 5000, paused: true },
      entries: [{ id: 'e1', ts: 0, text: 'restored' }],
    });
    sandbox.resumeTimerIfActive();
    assert.equal(intervalsStarted.length, 0);
    assert.equal(getTimerInterval(), null);
  });
});

describe('03-timer.js no-ops in the wrong state, as its JSDoc promises', () => {
  beforeEach(() => setTimerInterval(null));

  it('pauseTimer twice clears the interval only once', () => {
    const { sandbox, intervalsCleared } = loadTimer();
    sandbox.startTimer('e1');
    sandbox.pauseTimer();
    sandbox.pauseTimer();
    assert.deepEqual(intervalsCleared, [100]);
    assert.equal(getTimerInterval(), null);
  });

  it('stopTimer twice clears the interval only once', () => {
    const { sandbox, intervalsCleared } = loadTimer({ entries: [{ id: 'e1', ts: 0 }] });
    sandbox.startTimer('e1');
    sandbox.stopTimer();
    sandbox.stopTimer();
    assert.deepEqual(intervalsCleared, [100]);
    assert.equal(getTimerInterval(), null);
  });

  it('resumeTimer on a timer that is already running does not start a second interval', () => {
    const { sandbox, intervalsStarted } = loadTimer();
    sandbox.startTimer('e1');
    sandbox.resumeTimer();
    assert.equal(intervalsStarted.length, 1);
    assert.equal(getTimerInterval(), 100);
  });

  it('resumeTimer with no active timer does not start an interval', () => {
    const { sandbox, intervalsStarted } = loadTimer();
    sandbox.resumeTimer();
    assert.equal(intervalsStarted.length, 0);
    assert.equal(getTimerInterval(), null);
  });
});

describe('no source file outside state.js uses a bare timerInterval binding', () => {
  it('03-timer.js, 04c-render-timeline.js and 11-timeblock.js reference only the accessors', () => {
    for (const file of ['03-timer.js', '04c-render-timeline.js', '11-timeblock.js']) {
      const source = readFileSync(join(__dirname, '../../src/js', file), 'utf8');
      assert.doesNotMatch(
        source,
        /(?<![A-Za-z])timerInterval\b(?!\()/,
        `${file} still uses a bare timerInterval`
      );
    }
  });

  it('03-timer.js and 04c-render-timeline.js stop the tick via clearTimerInterval, not clearInterval', () => {
    for (const file of ['03-timer.js', '04c-render-timeline.js']) {
      const source = readFileSync(join(__dirname, '../../src/js', file), 'utf8');
      assert.doesNotMatch(
        source,
        /(?<![A-Za-z])clearInterval\(/,
        `${file} calls clearInterval directly`
      );
    }
  });
});
