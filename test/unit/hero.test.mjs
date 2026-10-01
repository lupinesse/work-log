/**
 * @file hero.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname, loadPureFnsScriptSource, withStateAccessors } from './_helpers.mjs';

/**
 * Loads 06a-hero.js into a VM sandbox. All of the file's DOM binding happens
 * inside initHero() (called separately, not at parse time), so the module
 * evaluates safely with a minimal document stub. `_composerInput` is exposed
 * on the sandbox so tests can set the typed text before calling _heroHandleStart.
 * @param {Object} [overrides] - Properties merged into the sandbox before eval.
 * @returns {Object} The populated sandbox.
 */
function loadHeroSandbox(overrides = {}) {
  const pureSrc = loadPureFnsScriptSource();
  const heroSrc = readFileSync(join(__dirname, '../../src/js/06a-hero.js'), 'utf8');
  const composerInput = { value: '' };
  const elements = { heroComposerInput: composerInput };

  const sandbox = {
    document: {
      getElementById: (id) => elements[id] || null,
      addEventListener: () => {},
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    activeTimer: null,
    entries: [],
    planTasks: [],
    categories: [{ id: 'other', label: 'Other', color: '#888780' }],
    selectedTag: 'other',
    startTimer: () => {},
    stopTimer: () => {},
    save: () => {},
    render: () => {},
    safeRoundedStart: () => Date.now(),
    promoteMatchingTaskToInProgress: () => {},
    ...overrides,
  };
  sandbox._composerInput = composerInput;
  vm.createContext(withStateAccessors(sandbox));
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(heroSrc, sandbox);
  return sandbox;
}

describe('_heroHandleStart', () => {
  it('promotes a matching plan task when starting tracking from typed text', () => {
    const calls = [];
    const sandbox = loadHeroSandbox({
      promoteMatchingTaskToInProgress: (text) => calls.push(text),
    });
    sandbox._composerInput.value = 'Write report';
    sandbox._heroHandleStart();
    assert.deepEqual(calls, ['Write report']);
  });

  it('does not attempt promotion when the composer input is empty', () => {
    const calls = [];
    const sandbox = loadHeroSandbox({
      promoteMatchingTaskToInProgress: (text) => calls.push(text),
    });
    sandbox._composerInput.value = '   ';
    sandbox._heroHandleStart();
    assert.deepEqual(calls, []);
  });
});

describe('_heroStartFromChip', () => {
  it('promotes a matching plan task when reusing an open entry', () => {
    const calls = [];
    const sandbox = loadHeroSandbox({
      entries: [{ id: 'e1', text: 'Recent task', tag: 'other', ts: 1 }],
      promoteMatchingTaskToInProgress: (text) => calls.push(text),
    });
    sandbox._heroStartFromChip('Recent task', 'other');
    assert.deepEqual(calls, ['Recent task']);
  });

  it('promotes a matching plan task when creating a fresh entry', () => {
    const calls = [];
    const sandbox = loadHeroSandbox({
      promoteMatchingTaskToInProgress: (text) => calls.push(text),
    });
    sandbox._heroStartFromChip('New task', 'other');
    assert.deepEqual(calls, ['New task']);
  });
});

describe('renderHeroCard fill dispatch', () => {
  /**
   * Builds a hero sandbox whose DOM lookups return throwaway elements and whose
   * four state fillers are spies, then renders the card.
   * @param {{ activeTimer: (Object|null), stopped: boolean }} setup - Timer/stopped state.
   * @returns {string[]} Names of the fillers that ran.
   */
  function fillersCalledFor({ activeTimer, stopped }) {
    const called = [];
    const makeEl = () => ({ style: {}, classList: { toggle() {} }, className: '' });
    const sandbox = loadHeroSandbox({
      activeTimer,
      document: { getElementById: makeEl, addEventListener: () => {} },
    });
    for (const name of ['Idle', 'Running', 'Paused', 'Stopped']) {
      sandbox[`_heroFill${name}`] = () => called.push(name);
    }
    vm.runInContext(`_heroStopped = ${stopped}`, sandbox);
    sandbox.renderHeroCard();
    return called;
  }

  const CASES = [
    ['idle', { activeTimer: null, stopped: false }, ['Idle']],
    ['running', { activeTimer: { paused: false }, stopped: false }, ['Running']],
    ['paused', { activeTimer: { paused: true }, stopped: false }, ['Paused']],
    ['stopped', { activeTimer: null, stopped: true }, ['Stopped']],
  ];

  for (const [state, setup, expected] of CASES) {
    it(`runs only the ${state} filler`, () => {
      assert.deepEqual(Array.from(fillersCalledFor(setup)), expected);
    });
  }
});

describe('_heroFillStopped elapsed display (#488)', () => {
  it('formats a zero-duration session with fmtElapsed, like the other hero clocks', () => {
    const elapsedEl = { textContent: '' };
    const elements = { heroStoppedElapsed: elapsedEl };
    const sandbox = loadHeroSandbox({
      document: {
        getElementById: (id) => elements[id] || null,
        addEventListener: () => {},
      },
    });
    vm.runInContext(
      "_heroStoppedEntry = { id: 'e1', text: 'x', tag: 'other', ts: 5000, tsEnd: 5000 }",
      sandbox
    );
    sandbox._heroFillStopped();
    assert.equal(elapsedEl.textContent, '00:00');
  });
});
