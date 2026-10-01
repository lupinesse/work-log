/**
 * @file state.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as appConstants from '../../src/js/app-constants.js';
import { __dirname, withStateAccessors } from './_helpers.mjs';
import {
  getEntries,
  setEntries,
  getActiveTimer,
  setActiveTimer,
  clearTimerInterval,
  getTimerInterval,
  setTimerInterval,
  getCategories,
  setCategories,
  getSelectedTag,
  setSelectedTag,
  getViewDate,
  setViewDate,
  getLogNotes,
  setLogNotes,
  getTrackers,
  setTrackers,
  getBlocks,
  setBlocks,
  getPlanTasks,
  setPlanTasks,
} from '../../src/js/state.js';

/**
 * Creates a VM sandbox with 01-state.js loaded, exposing createCategory and
 * nextDistinctColor for direct testing.
 * @param {Object} [overrides] - Properties merged into the sandbox before eval.
 * @returns {Object} The populated sandbox.
 */
function loadStateSandbox(overrides = {}) {
  const stateSrc = readFileSync(join(__dirname, '../../src/js/01-state.js'), 'utf8');

  const sandbox = {
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    // entries, activeTimer and categories live in state.js now (#423);
    // 01-state.js reaches them through the accessors, which withStateAccessors
    // backs with these.
    entries: [],
    activeTimer: null,
    categories: [...appConstants.DEFAULT_CATS],
    logNotes: [],
    ...appConstants,
    ...overrides,
  };

  vm.createContext(withStateAccessors(sandbox));
  vm.runInContext(stateSrc, sandbox);
  return sandbox;
}

describe('createCategory', () => {
  it('creates and appends a category with a distinct colour', () => {
    const sandbox = loadStateSandbox();
    sandbox.categories = [{ id: 'work', label: 'Work', color: '#378ADD' }];
    const result = sandbox.createCategory('New Epic');
    assert.ok(result);
    assert.equal(result.label, 'New Epic');
    assert.ok(result.id.startsWith('cat_'));
    assert.ok(result.color);
    assert.equal(sandbox.categories.length, 2);
    assert.ok(sandbox.categories.includes(result));
  });

  it('trims the raw label before creating', () => {
    const sandbox = loadStateSandbox();
    sandbox.categories = [];
    const result = sandbox.createCategory('  Spaced Epic  ');
    assert.equal(result.label, 'Spaced Epic');
  });

  it('returns null and does not append for an empty/whitespace-only label', () => {
    const sandbox = loadStateSandbox();
    sandbox.categories = [{ id: 'work', label: 'Work', color: '#378ADD' }];
    assert.equal(sandbox.createCategory('   '), null);
    assert.equal(sandbox.categories.length, 1);
  });

  it('returns null and does not append a case-insensitive duplicate label', () => {
    const sandbox = loadStateSandbox();
    sandbox.categories = [{ id: 'work', label: 'Work', color: '#378ADD' }];
    assert.equal(sandbox.createCategory('WORK'), null);
    assert.equal(sandbox.categories.length, 1);
  });

  it('warns via wlLog when rejecting a duplicate label', () => {
    const warnCalls = [];
    const sandbox = loadStateSandbox({
      wlLog: {
        warn: (...args) => warnCalls.push(args),
        error: () => {},
        info: () => {},
        debug: () => {},
      },
    });
    sandbox.categories = [{ id: 'work', label: 'Work', color: '#378ADD' }];
    sandbox.createCategory('WORK');
    assert.equal(warnCalls.length, 1);
    assert.match(warnCalls[0][0], /createCategory/);
  });
});

describe('load() — entries', () => {
  /**
   * Copies a value out of the VM sandbox as plain JSON. Arrays built inside the
   * sandbox have a different Array.prototype from the test's, so strict
   * deepEqual would reject them even when the contents match.
   * @param {*} value - A value read from the sandbox.
   * @returns {*} A same-realm deep copy.
   */
  const plain = (value) => JSON.parse(JSON.stringify(value));

  /**
   * Loads 01-state.js with just enough collaborators for load() to run, and a
   * localStorage backed by `store`. Records every wlLog warn/error call.
   * @param {Record<string, string>} store - Raw localStorage values by key.
   * @param {Array<object>} [seedEntries] - What the entries array holds before load().
   * @param {object|null} [seedActiveTimer] - What activeTimer holds before load().
   * @param {Function} [validTimer] - Stand-in for the timer schema validator.
   * @returns {{ sandbox: object, warnings: string[], errors: string[] }}
   */
  function loadWithStore(store, seedEntries = [], seedActiveTimer = null, validTimer = () => true) {
    const warnings = [];
    const errors = [];
    const sandbox = loadStateSandbox({
      entries: seedEntries,
      activeTimer: seedActiveTimer,
      localStorage: { getItem: (key) => store[key] ?? null, setItem: () => {} },
      wlLog: {
        warn: (message) => warnings.push(message),
        error: (message) => errors.push(message),
        info: () => {},
        debug: () => {},
      },
      validEntry: (entry) => !!entry && typeof entry.id === 'string',
      validTimer,
      validCategory: () => true,
      loadTrackers: () => {},
    });
    return { sandbox, warnings, errors };
  }

  it('keeps valid stored entries, drops invalid ones, and warns about the drop', () => {
    const { sandbox, warnings } = loadWithStore({
      wl_entries_v1: JSON.stringify([{ id: 'a' }, { nope: true }]),
    });
    sandbox.load();
    assert.deepEqual(plain(sandbox.entries), [{ id: 'a' }]);
    assert.match(warnings.join('\n'), /dropped 1 invalid entry record/);
  });

  it('resets entries to an empty array and logs an error when the stored JSON is corrupt', () => {
    const { sandbox, errors } = loadWithStore({ wl_entries_v1: '{not json' }, [{ id: 'stale' }]);
    sandbox.load();
    assert.deepEqual(plain(sandbox.entries), []);
    assert.match(errors.join('\n'), /load: failed to parse entries/);
  });

  it('restores entries from the snapshot when primary storage holds none', () => {
    const { sandbox, warnings } = loadWithStore({
      wl_entries_v1: '[]',
      wl_snapshot: JSON.stringify({ entries: [{ id: 'snap' }, { nope: true }] }),
    });
    sandbox.load();
    assert.deepEqual(plain(sandbox.entries), [{ id: 'snap' }]);
    assert.match(warnings.join('\n'), /restored from snapshot/);
  });

  it('ignores a snapshot whose entries field is not an array, without throwing', () => {
    const { sandbox, warnings, errors } = loadWithStore({
      wl_entries_v1: '[]',
      wl_snapshot: JSON.stringify({ entries: 'corrupted' }),
    });
    assert.doesNotThrow(() => sandbox.load());
    assert.deepEqual(plain(sandbox.entries), []);
    assert.deepEqual(errors, []);
    // Without the Array.isArray guard, `'corrupted'.filter` throws and the
    // surrounding try/catch turns it into this warning instead.
    assert.doesNotMatch(warnings.join('\n'), /failed to parse snapshot/);
  });
});

describe('load() — categories', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const stored = [
    { id: 'work', label: 'Work', color: '#111' },
    { id: 'bad', label: 'Bad', color: '#222' },
  ];

  /**
   * Loads 01-state.js with a localStorage backed by `store`; only the 'bad'
   * category fails validation.
   * @param {Record<string, string>} store - Raw localStorage values by key.
   * @returns {{ sandbox: object, warnings: string[] }}
   */
  function loadWithCategoryStore(store) {
    const warnings = [];
    const sandbox = loadStateSandbox({
      localStorage: { getItem: (key) => store[key] ?? null, setItem: () => {} },
      wlLog: {
        warn: (message) => warnings.push(message),
        error: () => {},
        info: () => {},
        debug: () => {},
      },
      validEntry: () => true,
      validTimer: () => true,
      validCategory: (category) => category.id !== 'bad',
      loadTrackers: () => {},
    });
    return { sandbox, warnings };
  }

  it('replaces the defaults with the valid stored categories and warns about the drop', () => {
    const { sandbox, warnings } = loadWithCategoryStore({ wl_cats_v1: JSON.stringify(stored) });
    sandbox.load();
    assert.deepEqual(plain(sandbox.categories), [stored[0]]);
    assert.match(warnings.join('\n'), /dropped 1 invalid category record/);
  });

  it('keeps the default categories when nothing is stored', () => {
    const { sandbox } = loadWithCategoryStore({});
    sandbox.load();
    assert.deepEqual(plain(sandbox.categories), plain(appConstants.DEFAULT_CATS));
  });

  it('takes the categories from the snapshot when entries are restored from it', () => {
    const { sandbox } = loadWithCategoryStore({
      wl_entries_v1: '[]',
      wl_snapshot: JSON.stringify({ entries: [{ id: 'e' }], categories: stored }),
    });
    sandbox.load();
    assert.deepEqual(plain(sandbox.categories), [stored[0]]);
  });
});

describe('loadLogNotes()', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value));

  /**
   * Loads 01-state.js with a localStorage backed by `store`.
   * @param {Record<string, string>} store - Raw localStorage values by key.
   * @param {Array<object>} [seedNotes] - What logNotes holds before loading.
   * @returns {{ sandbox: object, warnings: string[] }}
   */
  function loadWithNotesStore(store, seedNotes = []) {
    const warnings = [];
    const sandbox = loadStateSandbox({
      logNotes: seedNotes,
      localStorage: { getItem: (key) => store[key] ?? null, setItem: () => {} },
      wlLog: {
        warn: (message) => warnings.push(message),
        error: () => {},
        info: () => {},
        debug: () => {},
      },
    });
    return { sandbox, warnings };
  }

  it('replaces the held notes with the stored array', () => {
    const stored = [{ id: 'n1', text: 'a note', type: 'note' }];
    const { sandbox } = loadWithNotesStore({ wl_lognotes_v1: JSON.stringify(stored) }, [
      { id: 'stale' },
    ]);
    sandbox.loadLogNotes();
    assert.deepEqual(plain(sandbox.logNotes), stored);
  });

  it('treats a stored value that is not an array as no notes', () => {
    const { sandbox } = loadWithNotesStore({ wl_lognotes_v1: JSON.stringify({ id: 'n1' }) }, [
      { id: 'stale' },
    ]);
    sandbox.loadLogNotes();
    assert.deepEqual(plain(sandbox.logNotes), []);
  });

  it('replaces the held notes with an empty list and warns when the stored JSON is corrupt', () => {
    const { sandbox, warnings } = loadWithNotesStore({ wl_lognotes_v1: '{not json' }, [
      { id: 'stale' },
    ]);
    sandbox.loadLogNotes();
    assert.deepEqual(plain(sandbox.logNotes), []);
    assert.match(warnings.join('\n'), /loadLogNotes: failed to parse/);
  });
});

describe('load() — activeTimer', () => {
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const runningTimer = { entryId: 'e1', startTs: 1, accumulatedMs: 0, paused: false };

  /**
   * Loads 01-state.js with a localStorage backed by `store`.
   * @param {Record<string, string>} store - Raw localStorage values by key.
   * @param {object|null} seedActiveTimer - activeTimer before load().
   * @param {Function} [validTimer] - Stand-in for the timer schema validator.
   * @returns {{ sandbox: object, warnings: string[], errors: string[] }}
   */
  function loadWithTimerStore(store, seedActiveTimer, validTimer = () => true) {
    const warnings = [];
    const errors = [];
    const sandbox = loadStateSandbox({
      activeTimer: seedActiveTimer,
      localStorage: { getItem: (key) => store[key] ?? null, setItem: () => {} },
      wlLog: {
        warn: (message) => warnings.push(message),
        error: (message) => errors.push(message),
        info: () => {},
        debug: () => {},
      },
      validEntry: () => true,
      validTimer,
      validCategory: () => true,
      loadTrackers: () => {},
    });
    return { sandbox, warnings, errors };
  }

  it('restores a valid stored timer', () => {
    const { sandbox } = loadWithTimerStore({ wl_timer_v1: JSON.stringify(runningTimer) }, null);
    sandbox.load();
    assert.deepEqual(plain(sandbox.activeTimer), runningTimer);
  });

  it('discards an invalid stored timer and warns', () => {
    const { sandbox, warnings } = loadWithTimerStore(
      { wl_timer_v1: JSON.stringify({ bogus: true }) },
      runningTimer,
      () => false
    );
    sandbox.load();
    assert.equal(sandbox.activeTimer, null);
    assert.match(warnings.join('\n'), /discarded invalid timer state/);
  });

  it('clears a previously held timer and logs an error when the stored JSON is corrupt', () => {
    const { sandbox, errors } = loadWithTimerStore({ wl_timer_v1: '{not json' }, runningTimer);
    sandbox.load();
    assert.equal(sandbox.activeTimer, null);
    assert.match(errors.join('\n'), /load: failed to parse timer state/);
  });
});

// ---------------------------------------------------------------------------
// state.js — new accessor-layer leaf module
// ---------------------------------------------------------------------------

describe('state.js — initial values', () => {
  it('entries starts as an empty array', () => {
    assert.deepEqual(getEntries(), []);
  });

  it('activeTimer starts as null', () => {
    assert.equal(getActiveTimer(), null);
  });

  it('timerInterval starts as null', () => {
    assert.equal(getTimerInterval(), null);
  });

  it('selectedTag starts as "work"', () => {
    assert.equal(getSelectedTag(), 'work');
  });

  it('viewDate starts as a Date instance', () => {
    assert.ok(getViewDate() instanceof Date);
  });

  it('logNotes starts as an empty array', () => {
    assert.deepEqual(getLogNotes(), []);
  });

  it('trackers starts as an empty array', () => {
    assert.deepEqual(getTrackers(), []);
  });

  it('blocks starts as an empty array', () => {
    assert.deepEqual(getBlocks(), []);
  });

  it('planTasks starts as an empty array', () => {
    assert.deepEqual(getPlanTasks(), []);
  });

  it('categories starts as a copy of DEFAULT_CATS with the correct labels', () => {
    const cats = getCategories();
    const labels = cats.map((c) => c.label);
    assert.ok(labels.includes('work'));
    assert.ok(labels.includes('break'));
    assert.equal(cats.length, appConstants.DEFAULT_CATS.length);
  });

  it('categories is a shallow copy, not the same reference as DEFAULT_CATS', () => {
    assert.notStrictEqual(getCategories(), appConstants.DEFAULT_CATS);
  });
});

describe('state.js — getter/setter round-trips', () => {
  it('setEntries / getEntries round-trips an array', () => {
    const orig = getEntries();
    const next = [{ id: 'e1', text: 'test', ts: 1, date: '2026-01-01' }];
    try {
      setEntries(next);
      assert.strictEqual(getEntries(), next);
    } finally {
      setEntries(orig);
    }
  });

  it('setActiveTimer / getActiveTimer round-trips an object', () => {
    const orig = getActiveTimer();
    const next = { id: 't1', start: 1000 };
    try {
      setActiveTimer(next);
      assert.strictEqual(getActiveTimer(), next);
    } finally {
      setActiveTimer(orig);
    }
  });

  it('setActiveTimer accepts null to clear the timer', () => {
    const orig = getActiveTimer();
    try {
      setActiveTimer({ id: 'x' });
      setActiveTimer(null);
      assert.equal(getActiveTimer(), null);
    } finally {
      setActiveTimer(orig);
    }
  });

  it('setTimerInterval / getTimerInterval round-trips a numeric interval ID', () => {
    const orig = getTimerInterval();
    try {
      setTimerInterval(42);
      assert.equal(getTimerInterval(), 42);
    } finally {
      setTimerInterval(orig);
    }
  });

  describe('clearTimerInterval', () => {
    /**
     * Runs `body` with a recording stand-in for the global clearInterval,
     * restoring the real one and the stored interval ID afterwards.
     * @param {(cleared: number[]) => void} body - Test body receiving the recorded IDs.
     * @returns {void}
     */
    function withRecordedClearInterval(body) {
      const realClearInterval = globalThis.clearInterval;
      const originalInterval = getTimerInterval();
      const cleared = [];
      globalThis.clearInterval = (id) => cleared.push(id);
      try {
        body(cleared);
      } finally {
        globalThis.clearInterval = realClearInterval;
        setTimerInterval(originalInterval);
      }
    }

    it('clears the held interval and resets the stored ID to null', () => {
      withRecordedClearInterval((cleared) => {
        setTimerInterval(42);
        clearTimerInterval();
        assert.deepEqual(cleared, [42]);
        assert.equal(getTimerInterval(), null);
      });
    });

    it('is a no-op when no interval is held', () => {
      withRecordedClearInterval((cleared) => {
        setTimerInterval(null);
        clearTimerInterval();
        assert.deepEqual(cleared, []);
        assert.equal(getTimerInterval(), null);
      });
    });

    it('is idempotent: a second call does not clear again', () => {
      withRecordedClearInterval((cleared) => {
        setTimerInterval(7);
        clearTimerInterval();
        clearTimerInterval();
        assert.deepEqual(cleared, [7]);
      });
    });
  });

  it('setCategories / getCategories round-trips an array', () => {
    const orig = getCategories();
    const next = [{ id: 'x', label: 'X', color: '#000' }];
    try {
      setCategories(next);
      assert.strictEqual(getCategories(), next);
    } finally {
      setCategories(orig);
    }
  });

  it('setSelectedTag / getSelectedTag round-trips a string', () => {
    const orig = getSelectedTag();
    try {
      setSelectedTag('personal');
      assert.equal(getSelectedTag(), 'personal');
    } finally {
      setSelectedTag(orig);
    }
  });

  it('setViewDate / getViewDate round-trips a Date', () => {
    const orig = getViewDate();
    const next = new Date('2026-06-15');
    try {
      setViewDate(next);
      assert.strictEqual(getViewDate(), next);
    } finally {
      setViewDate(orig);
    }
  });

  it('setLogNotes / getLogNotes round-trips an array', () => {
    const orig = getLogNotes();
    const next = ['note one'];
    try {
      setLogNotes(next);
      assert.strictEqual(getLogNotes(), next);
    } finally {
      setLogNotes(orig);
    }
  });

  it('setTrackers / getTrackers round-trips an array', () => {
    const orig = getTrackers();
    const next = [{ id: 'tr1' }];
    try {
      setTrackers(next);
      assert.strictEqual(getTrackers(), next);
    } finally {
      setTrackers(orig);
    }
  });

  it('setBlocks / getBlocks round-trips an array', () => {
    const orig = getBlocks();
    const next = [{ id: 'b1', start: '09:00', end: '10:00', label: 'Focus' }];
    try {
      setBlocks(next);
      assert.strictEqual(getBlocks(), next);
    } finally {
      setBlocks(orig);
    }
  });

  it('setPlanTasks / getPlanTasks round-trips an array', () => {
    const orig = getPlanTasks();
    const next = [{ id: 'p1', text: 'Task 1', status: 'todo' }];
    try {
      setPlanTasks(next);
      assert.strictEqual(getPlanTasks(), next);
    } finally {
      setPlanTasks(orig);
    }
  });
});

describe('state.js — live reference semantics', () => {
  it('getCategories returns a live reference — push is reflected in the next get', () => {
    const cats = getCategories();
    const lenBefore = cats.length;
    cats.push({ id: 'test-live', label: 'Live test', color: '#f00' });
    assert.equal(getCategories().length, lenBefore + 1);
    // clean up
    setCategories(getCategories().filter((c) => c.id !== 'test-live'));
  });

  it('getEntries returns a live reference — push is reflected in the next get', () => {
    const entries = getEntries();
    const lenBefore = entries.length;
    entries.push({ id: 'live-test', text: 'x', ts: 0, date: '2026-01-01' });
    assert.equal(getEntries().length, lenBefore + 1);
    // clean up
    setEntries(getEntries().filter((e) => e.id !== 'live-test'));
  });
});
