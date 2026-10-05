/**
 * @file eod-entry.test.mjs
 * Covers src/js/26-eod-entry.js — exported function smoke test.
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
      // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => {
        // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
        store[k] = String(v);
      },
      removeItem: (k) => {
        // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
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
    mod = await import('../../src/js/26-eod-entry.js');
  }
  return mod;
}

// ---------------------------------------------------------------------------

describe('26-eod-entry — renderEodTimesheet is exported', () => {
  it('exports a function named renderEodTimesheet', async () => {
    const { renderEodTimesheet } = await loadMod();
    assert.equal(typeof renderEodTimesheet, 'function');
  });
});
