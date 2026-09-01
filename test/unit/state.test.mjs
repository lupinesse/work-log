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
