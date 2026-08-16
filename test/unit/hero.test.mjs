/**
 * @file hero.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname, loadPureFnsScriptSource } from './_helpers.mjs';

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
  vm.createContext(sandbox);
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
