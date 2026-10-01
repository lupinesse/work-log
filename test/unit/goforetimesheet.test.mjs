/**
 * @file goforetimesheet.test.mjs
 * Covers src/js/26-gofore-timesheet.js — exported function smoke test.
 *
 * renderEodTimesheet is a DOM operation and is integration-tested via smoke
 * tests; only the module export shape is verified here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Stubs for browser globals the module imports indirectly
// ---------------------------------------------------------------------------

function installBrowserStubs() {
  if (!globalThis.localStorage) {
    const store = {};
    globalThis.localStorage = {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    };
  }
  if (!globalThis.document) {
    const noopEl = {
      addEventListener: () => {},
      disabled: false,
      hidden: false,
      textContent: '',
      value: '',
      dataset: {},
      classList: { toggle() {} },
    };
    globalThis.document = {
      getElementById: () => noopEl,
    };
  }
}

let mod;

async function loadMod() {
  if (!mod) {
    installBrowserStubs();
    mod = await import('../../src/js/26-gofore-timesheet.js');
  }
  return mod;
}

// ---------------------------------------------------------------------------

describe('26-gofore-timesheet — renderEodTimesheet is exported', () => {
  it('exports a function named renderEodTimesheet', async () => {
    const { renderEodTimesheet } = await loadMod();
    assert.equal(typeof renderEodTimesheet, 'function');
  });
});
