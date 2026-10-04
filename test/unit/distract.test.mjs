/**
 * @file distract.test.mjs
 * Unit tests for 12-misc.js's handleDistractClick() (#607). Cancelling the
 * "What pulled you away?" prompt used to call pauseTimer() a second time — a
 * no-op on an already-paused timer — so the timer stayed paused instead of
 * resuming. The handler is extracted on its own (12-misc.js wires the DOM at
 * load time) and run against stubbed timer and storage collaborators.
 *
 * Run: node --test test/unit/distract.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import { __dirname, extractFunctionSource, withStateAccessors } from './_helpers.mjs';

const handlerSource = extractFunctionSource(
  readFileSync(join(__dirname, '../../src/js/12-misc.js'), 'utf8'),
  'handleDistractClick'
);

/**
 * Loads handleDistractClick into a VM sandbox whose pauseTimer/resumeTimer
 * flip `activeTimer.paused` and record every call.
 * @param {object} options - Sandbox setup.
 * @param {object|null} options.activeTimer - Timer state when the button is clicked.
 * @param {string|null} options.promptAnswer - What prompt() returns (null = Cancel).
 * @returns {object} The sandbox, with `calls` and `savedNotes` recorders.
 */
function loadHandler({ activeTimer, promptAnswer }) {
  const sandbox = withStateAccessors({
    activeTimer,
    calls: [],
    savedNotes: [],
    prompt: () => promptAnswer,
    pauseTimer() {
      sandbox.calls.push('pause');
      if (sandbox.activeTimer && !sandbox.activeTimer.paused) sandbox.activeTimer.paused = true;
    },
    resumeTimer() {
      sandbox.calls.push('resume');
      if (sandbox.activeTimer && sandbox.activeTimer.paused) sandbox.activeTimer.paused = false;
    },
    saveDistraction: (note) => sandbox.savedNotes.push(note),
    renderDistractionCount: () => {},
  });
  vm.createContext(sandbox);
  vm.runInContext(handlerSource, sandbox);
  return sandbox;
}

describe('handleDistractClick (#607)', () => {
  const cases = [
    {
      name: 'cancel on a running timer resumes it and logs nothing',
      activeTimer: { paused: false },
      promptAnswer: null,
      expectedCalls: ['pause', 'resume'],
      expectedPaused: false,
      expectedNotes: [],
    },
    {
      name: 'cancel on an already-paused timer leaves it paused',
      activeTimer: { paused: true },
      promptAnswer: null,
      expectedCalls: [],
      expectedPaused: true,
      expectedNotes: [],
    },
    {
      name: 'submitting a note logs it and keeps the timer paused',
      activeTimer: { paused: false },
      promptAnswer: '  Slack ping  ',
      expectedCalls: ['pause'],
      expectedPaused: true,
      expectedNotes: ['Slack ping'],
    },
    {
      name: 'submitting an empty note logs a null note',
      activeTimer: { paused: false },
      promptAnswer: '',
      expectedCalls: ['pause'],
      expectedPaused: true,
      expectedNotes: [null],
    },
    {
      name: 'submitting a whitespace-only note logs a null note',
      activeTimer: { paused: false },
      promptAnswer: '   ',
      expectedCalls: ['pause'],
      expectedPaused: true,
      expectedNotes: [null],
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const sandbox = loadHandler(testCase);
      sandbox.handleDistractClick();
      assert.deepEqual(sandbox.calls, testCase.expectedCalls);
      assert.equal(sandbox.activeTimer.paused, testCase.expectedPaused);
      assert.deepEqual(sandbox.savedNotes, testCase.expectedNotes);
    });
  }

  it('cancel with no active timer touches neither pause nor resume', () => {
    const sandbox = loadHandler({ activeTimer: null, promptAnswer: null });
    sandbox.handleDistractClick();
    assert.deepEqual(sandbox.calls, []);
    assert.deepEqual(sandbox.savedNotes, []);
  });
});
