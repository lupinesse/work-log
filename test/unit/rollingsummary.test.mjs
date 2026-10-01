/**
 * @file rollingsummary.test.mjs
 * Covers src/js/25-rollingsummary.js — exported pure/localStorage functions.
 *
 * renderRollingSummary and copySummaryText are DOM+clipboard operations and
 * are integration-tested via smoke tests; only the deterministic helpers are
 * covered here.
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
}

let mod;

async function loadMod() {
  if (!mod) {
    installBrowserStubs();
    mod = await import('../../src/js/25-rollingsummary.js');
  }
  return mod;
}

// ---------------------------------------------------------------------------

describe('25-rollingsummary — fmtDateLabel', () => {
  const cases = [
    { dateKey: '2026-01-05', expected: 'Mon 05 Jan' },
    { dateKey: '2026-06-04', expected: 'Thu 04 Jun' },
    { dateKey: '2026-12-31', expected: 'Thu 31 Dec' },
    { dateKey: '2026-07-19', expected: 'Sun 19 Jul' },
  ];

  for (const { dateKey, expected } of cases) {
    it(`formats ${dateKey} as "${expected}"`, async () => {
      const { fmtDateLabel } = await loadMod();
      assert.equal(fmtDateLabel(dateKey), expected);
    });
  }

  it('pads single-digit day with leading zero', async () => {
    const { fmtDateLabel } = await loadMod();
    assert.match(fmtDateLabel('2026-03-07'), /\d{2} /);
  });
});

describe('25-rollingsummary — renderRollingSummary is exported', () => {
  it('exports a function named renderRollingSummary', async () => {
    const { renderRollingSummary } = await loadMod();
    assert.equal(typeof renderRollingSummary, 'function');
  });
});
