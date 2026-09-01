/**
 * @file entries.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname } from './_helpers.mjs';

/**
 * Loads 05-entries.js into a VM sandbox. `captureInput` is exposed on the
 * sandbox so tests can set the typed text before calling addEntry().
 * @param {Object} [overrides] - Properties merged into the sandbox before eval.
 * @returns {Object} The populated sandbox.
 */
function loadEntriesSandbox(overrides = {}) {
  const entriesSrc = readFileSync(join(__dirname, '../../src/js/05-entries.js'), 'utf8');
  const captureInput = { value: '', focus: () => {} };
  const elements = { captureInput };

  const sandbox = {
    document: { getElementById: (id) => elements[id] || null },
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    activeTimer: null,
    entries: [],
    selectedTag: 'other',
    viewDate: new Date(),
    startTimer: () => {},
    stopTimer: () => {},
    save: () => {},
    render: () => {},
    dk: () => '2026-06-04',
    safeRoundedStart: () => Date.now(),
    promoteMatchingTaskToInProgress: () => {},
    _entryMetaEditId: null,
    _pendingNoteConfirm: null,
    ...overrides,
  };
  sandbox._captureInput = captureInput;
  vm.createContext(sandbox);
  vm.runInContext(entriesSrc, sandbox);
  return sandbox;
}

describe('addEntry', () => {
  it('promotes a matching plan task when starting the timer on a new entry', () => {
    const calls = [];
    const sandbox = loadEntriesSandbox({
      promoteMatchingTaskToInProgress: (text) => calls.push(text),
    });
    sandbox._captureInput.value = 'Ship feature';
    sandbox.addEntry(true);
    assert.deepEqual(calls, ['Ship feature']);
  });

  it('does not attempt promotion when logging without starting the timer', () => {
    const calls = [];
    const sandbox = loadEntriesSandbox({
      promoteMatchingTaskToInProgress: (text) => calls.push(text),
    });
    sandbox._captureInput.value = 'Ship feature';
    sandbox.addEntry(false);
    assert.deepEqual(calls, []);
  });

  it('does not attempt promotion when the capture input is empty', () => {
    const calls = [];
    const sandbox = loadEntriesSandbox({
      promoteMatchingTaskToInProgress: (text) => calls.push(text),
    });
    sandbox._captureInput.value = '   ';
    sandbox.addEntry(true);
    assert.deepEqual(calls, []);
  });
});

describe('findMostRecentEntryForText', () => {
  it('returns the most recently created matching entry', () => {
    const sandbox = loadEntriesSandbox({
      entries: [
        { id: '1', text: 'Ship feature', tag: 'other' },
        { id: '2', text: 'Ship feature', tag: 'other', link: 'CONF-1' },
      ],
    });
    const found = sandbox.findMostRecentEntryForText('Ship feature');
    assert.equal(found.id, '2');
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    const sandbox = loadEntriesSandbox({
      entries: [{ id: '1', text: 'Ship Feature', tag: 'other' }],
    });
    assert.equal(sandbox.findMostRecentEntryForText('  ship feature  ').id, '1');
  });

  it('returns undefined when no entry matches', () => {
    const sandbox = loadEntriesSandbox({ entries: [{ id: '1', text: 'Other task' }] });
    assert.equal(sandbox.findMostRecentEntryForText('Ship feature'), undefined);
  });
});

describe('createRestartedEntry', () => {
  it('builds a plain new entry when no prior entry with the same text exists', () => {
    const sandbox = loadEntriesSandbox({ entries: [] });
    const entry = sandbox.createRestartedEntry('Ship feature', 'dev');
    assert.equal(entry.text, 'Ship feature');
    assert.equal(entry.tag, 'dev');
    assert.equal(entry.link, undefined);
    assert.equal(sandbox._entryMetaEditId, null);
    assert.equal(sandbox._pendingNoteConfirm, null);
  });

  it('carries the prior entry link over silently, without a note-confirm prompt', () => {
    const sandbox = loadEntriesSandbox({
      entries: [{ id: '1', text: 'Ship feature', tag: 'dev', link: 'CONF-42' }],
    });
    const entry = sandbox.createRestartedEntry('Ship feature', 'dev');
    assert.equal(entry.link, 'CONF-42');
    assert.equal(sandbox._entryMetaEditId, null);
    assert.equal(sandbox._pendingNoteConfirm, null);
  });

  it('flags the prior note for confirmation instead of copying it directly', () => {
    const sandbox = loadEntriesSandbox({
      entries: [{ id: '1', text: 'Ship feature', tag: 'dev', note: 'Wrote unit tests' }],
    });
    const entry = sandbox.createRestartedEntry('Ship feature', 'dev');
    assert.equal(entry.note, undefined);
    assert.equal(sandbox._entryMetaEditId, entry.id);
    assert.equal(sandbox._pendingNoteConfirm.id, entry.id);
    assert.equal(sandbox._pendingNoteConfirm.note, 'Wrote unit tests');
  });

  it('carries the link over and flags the note when both are present', () => {
    const sandbox = loadEntriesSandbox({
      entries: [
        { id: '1', text: 'Ship feature', tag: 'dev', link: 'CONF-42', note: 'Wrote unit tests' },
      ],
    });
    const entry = sandbox.createRestartedEntry('Ship feature', 'dev');
    assert.equal(entry.link, 'CONF-42');
    assert.equal(entry.note, undefined);
    assert.equal(sandbox._pendingNoteConfirm.id, entry.id);
    assert.equal(sandbox._pendingNoteConfirm.note, 'Wrote unit tests');
  });
});
