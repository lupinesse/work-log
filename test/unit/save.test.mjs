/**
 * @file save.test.mjs
 * Tests for src/js/01c-save.js (leaf ES module extracted from 01-state.js,
 * issue #336, extraction #15): save(), showSaveFailureBanner(),
 * hideSaveFailureBanner(), and setExportBackupCallback().
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as appConstants from '../../src/js/app-constants.js';
import { __dirname, withStateAccessors, stripEsmSyntax } from './_helpers.mjs';

/**
 * Creates a VM sandbox with 01c-save.js loaded, stripping ESM import/export
 * syntax and injecting the required globals.
 * @param {Object} [overrides] - Properties merged into the sandbox before eval.
 * @returns {Object} The populated sandbox.
 */
function loadSaveSandbox(overrides = {}) {
  const raw = readFileSync(join(__dirname, '../../src/js/01c-save.js'), 'utf8');
  const src = stripEsmSyntax(raw);

  const sandbox = {
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: makeFakeDocument(),
    // State is backed by withStateAccessors below
    entries: [],
    activeTimer: null,
    categories: [...appConstants.DEFAULT_CATS],
    // app-constants exports (STORE_* keys etc.)
    ...appConstants,
    ...overrides,
  };

  vm.createContext(withStateAccessors(sandbox));
  vm.runInContext(src, sandbox);
  return sandbox;
}

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
    const sandbox = loadSaveSandbox({
      document: makeFakeDocument(),
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
    const sandbox = loadSaveSandbox({
      document: makeFakeDocument(),
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
    const sandbox = loadSaveSandbox({
      document: doc,
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
    const sandbox = loadSaveSandbox({
      document: doc,
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
    const sandbox = loadSaveSandbox({
      document: doc,
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
    const sandbox = loadSaveSandbox({
      document: doc,
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

describe('setExportBackupCallback', () => {
  it('does not throw and save() continues to work after registration', () => {
    const sandbox = loadSaveSandbox({
      document: makeFakeDocument(),
      localStorage: { getItem: () => null, setItem: () => {} },
    });
    assert.doesNotThrow(() => sandbox.setExportBackupCallback(() => {}));
    assert.doesNotThrow(() => sandbox.save());
  });
});
