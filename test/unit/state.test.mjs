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
import { __dirname } from './_helpers.mjs';
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
  // categories is declared with `let` at module scope, which the vm module
  // keeps in a lexical record separate from the sandbox global object —
  // setting sandbox.categories after the fact wouldn't be visible to
  // createCategory()/nextDistinctColor(). Promote to `var` so it's a real
  // global property tests can seed (same fix as loadJiraSandbox above).
  const stateSrc = readFileSync(join(__dirname, '../../src/js/01-state.js'), 'utf8').replace(
    /^let categories = \[\.\.\.DEFAULT_CATS\];$/m,
    'var categories = [...DEFAULT_CATS];'
  );

  const sandbox = {
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    ...appConstants,
    ...overrides,
  };

  vm.createContext(sandbox);
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

function makeFakeElement(tag) {
  return {
    tagName: tag,
    className: '',
    id: '',
    children: [],
    removed: false,
    setAttribute() {},
    addEventListener() {},
    appendChild(child) {
      this.children.push(child);
    },
    remove() {
      this.removed = true;
    },
  };
}

function makeFakeDocument() {
  const prepended = [];
  return {
    prepended,
    createElement: (tag) => makeFakeElement(tag),
    body: { prepend: (el) => prepended.push(el) },
  };
}

describe('save() — localStorage failure handling', () => {
  it('does not throw when localStorage.setItem throws', () => {
    const sandbox = loadStateSandbox({
      document: makeFakeDocument(),
      exportBackup: () => {},
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
    });
    assert.doesNotThrow(() => sandbox.save());
  });

  it('logs the failure via wlLog.error instead of swallowing it', () => {
    const errorCalls = [];
    const sandbox = loadStateSandbox({
      document: makeFakeDocument(),
      exportBackup: () => {},
      wlLog: {
        warn: () => {},
        error: (...args) => errorCalls.push(args),
        info: () => {},
        debug: () => {},
      },
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
    });
    sandbox.save();
    assert.equal(errorCalls.length, 1);
    assert.match(errorCalls[0][0], /save/);
  });

  it('shows a persistent banner flagging the failure to the user', () => {
    const doc = makeFakeDocument();
    const sandbox = loadStateSandbox({
      document: doc,
      exportBackup: () => {},
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
    });
    sandbox.save();
    assert.equal(doc.prepended.length, 1);
    assert.equal(doc.prepended[0].id, 'saveFailBanner');
    assert.equal(doc.prepended[0].removed, false);
  });

  it('does not stack a second banner on repeated failures', () => {
    const doc = makeFakeDocument();
    const sandbox = loadStateSandbox({
      document: doc,
      exportBackup: () => {},
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
    });
    sandbox.save();
    sandbox.save();
    assert.equal(doc.prepended.length, 1);
  });

  it('removes the banner once a later save() succeeds', () => {
    const doc = makeFakeDocument();
    let shouldThrow = true;
    const sandbox = loadStateSandbox({
      document: doc,
      exportBackup: () => {},
      localStorage: {
        getItem: () => null,
        setItem: () => {
          if (shouldThrow) throw new Error('QuotaExceededError');
        },
      },
    });
    sandbox.save();
    assert.equal(doc.prepended[0].removed, false);
    shouldThrow = false;
    sandbox.save();
    assert.equal(doc.prepended[0].removed, true);
  });

  it('still refuses to overwrite existing entries with an empty array', () => {
    const doc = makeFakeDocument();
    const setItemCalls = [];
    const sandbox = loadStateSandbox({
      document: doc,
      exportBackup: () => {},
      localStorage: {
        getItem: (key) => (key === 'wl_entries_v1' ? '[{"id":"e1"}]' : null),
        setItem: (...args) => setItemCalls.push(args),
      },
    });
    sandbox.save();
    assert.equal(setItemCalls.length, 0);
    assert.equal(doc.prepended.length, 0);
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
