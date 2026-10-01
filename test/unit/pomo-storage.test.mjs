/**
 * @file pomo-storage.test.mjs
 * Unit tests for src/js/pomo-storage.js — pomoGetLog and pomoSaveSession.
 * Extracted as part of ES-module extraction #14 (issue #336).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage before importing the module under test.
const store = {};
const localStorageStub = {
  getItem: (key) => store[key] ?? null,
  setItem: (key, val) => {
    store[key] = String(val);
  },
  removeItem: (key) => {
    delete store[key];
  },
};
globalThis.localStorage = localStorageStub;

const { pomoGetLog, pomoSaveSession } = await import('../../src/js/pomo-storage.js');

const STORE_KEY = 'wl_pomoLog_v1';

/** Resets the in-memory localStorage store before each test. */
function clearStore() {
  for (const key of Object.keys(store)) delete store[key];
}

describe('pomoGetLog', () => {
  beforeEach(clearStore);

  it('returns an empty array when no log is stored', () => {
    assert.deepEqual(pomoGetLog(), []);
  });

  it('returns stored valid entries', () => {
    const entries = [
      { ts: 1_700_000_000_000, mins: 25, task: 'Write tests' },
      { ts: 1_699_990_000_000, mins: 10, task: null },
    ];
    store[STORE_KEY] = JSON.stringify(entries);
    assert.deepEqual(pomoGetLog(), entries);
  });

  it('drops invalid records (missing mins)', () => {
    store[STORE_KEY] = JSON.stringify([
      { ts: 1_700_000_000_000, mins: 25, task: null },
      { ts: 1_699_990_000_000, task: null }, // missing mins
    ]);
    const result = pomoGetLog();
    assert.equal(result.length, 1);
    assert.equal(result[0].mins, 25);
  });

  it('drops invalid records (non-numeric ts)', () => {
    store[STORE_KEY] = JSON.stringify([
      { ts: 'bad', mins: 25, task: null },
      { ts: 1_700_000_000_000, mins: 10, task: null },
    ]);
    const result = pomoGetLog();
    assert.equal(result.length, 1);
    assert.equal(result[0].mins, 10);
  });

  it('returns empty array on malformed JSON', () => {
    store[STORE_KEY] = 'not-json';
    assert.deepEqual(pomoGetLog(), []);
  });

  it('returns empty array when stored value is not an array', () => {
    store[STORE_KEY] = JSON.stringify({ ts: 1, mins: 5, task: null });
    assert.deepEqual(pomoGetLog(), []);
  });
});

describe('pomoSaveSession', () => {
  beforeEach(clearStore);

  it('writes a new session to an empty log', () => {
    const session = { ts: 1_700_000_000_000, mins: 25, task: 'Focus block' };
    pomoSaveSession(session);
    const stored = JSON.parse(store[STORE_KEY]);
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0], session);
  });

  it('prepends the new session before existing entries', () => {
    const older = { ts: 1_699_990_000_000, mins: 10, task: null };
    store[STORE_KEY] = JSON.stringify([older]);
    const newer = { ts: 1_700_000_000_000, mins: 25, task: 'Write tests' };
    pomoSaveSession(newer);
    const stored = JSON.parse(store[STORE_KEY]);
    assert.equal(stored.length, 2);
    assert.deepEqual(stored[0], newer);
    assert.deepEqual(stored[1], older);
  });

  it('caps the log at 100 entries', () => {
    const existing = Array.from({ length: 100 }, (_, i) => ({
      ts: 1_700_000_000_000 - i * 1000,
      mins: 5,
      task: null,
    }));
    store[STORE_KEY] = JSON.stringify(existing);
    pomoSaveSession({ ts: Date.now(), mins: 25, task: 'new' });
    const stored = JSON.parse(store[STORE_KEY]);
    assert.equal(stored.length, 100);
    assert.equal(stored[0].task, 'new');
  });
});
