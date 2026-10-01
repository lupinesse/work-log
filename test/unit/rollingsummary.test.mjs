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

// ---------------------------------------------------------------------------
// buildSummaryText
// ---------------------------------------------------------------------------

describe('25-rollingsummary — buildSummaryText', () => {
  const DATE_KEY = '2026-10-01';
  // locationFor returns 'remote' when no value is stored; locationMap {} → fallback
  const locationMap = {};

  function makeRow(overrides = {}) {
    return {
      dateKey: DATE_KEY,
      locationEmoji: '🏠',
      sodTs: 1_000_000,
      eodTs: 1_003_600_000,
      totalMs: 3_600_000,
      topTasks: [],
      ...overrides,
    };
  }

  it('returns empty string when no rows have sodTs or totalMs', async () => {
    const { buildSummaryText } = await loadMod();
    const rows = [makeRow({ sodTs: null, eodTs: null, totalMs: 0 })];
    assert.equal(buildSummaryText(rows, 0, locationMap), '');
  });

  it('includes location label, date, session times, and total for a row with data', async () => {
    const { buildSummaryText } = await loadMod();
    const rows = [makeRow()];
    const result = buildSummaryText(rows, 3_600_000, locationMap);
    assert.match(result, /Remote/);
    assert.match(result, /Thu 01 Oct/);
    assert.match(result, /1h/);
  });

  it('appends Week total line when weekTotalMs > 0', async () => {
    const { buildSummaryText } = await loadMod();
    const rows = [makeRow()];
    const result = buildSummaryText(rows, 7_200_000, locationMap);
    assert.match(result, /Week total:/);
  });

  it('does not append Week total when weekTotalMs is 0', async () => {
    const { buildSummaryText } = await loadMod();
    const rows = [makeRow()];
    const result = buildSummaryText(rows, 0, locationMap);
    assert.doesNotMatch(result, /Week total:/);
  });

  it('includes top tasks when present', async () => {
    const { buildSummaryText } = await loadMod();
    const rows = [makeRow({ topTasks: [{ text: 'Write tests', totalMs: 1_800_000 }] })];
    const result = buildSummaryText(rows, 1_800_000, locationMap);
    assert.match(result, /Write tests/);
    assert.match(result, /30m/);
  });

  it('uses em-dash placeholder when sodTs is null', async () => {
    const { buildSummaryText } = await loadMod();
    const rows = [makeRow({ sodTs: null, totalMs: 3_600_000 })];
    const result = buildSummaryText(rows, 3_600_000, locationMap);
    assert.match(result, /—/);
  });

  it('uses em-dash placeholder when eodTs is null', async () => {
    const { buildSummaryText } = await loadMod();
    const rows = [makeRow({ eodTs: null })];
    const result = buildSummaryText(rows, 3_600_000, locationMap);
    assert.match(result, /—/);
  });

  it('uses em-dash for total when totalMs is 0 but sodTs is present', async () => {
    const { buildSummaryText } = await loadMod();
    const rows = [makeRow({ totalMs: 0 })];
    const result = buildSummaryText(rows, 0, locationMap);
    assert.match(result, /—/);
  });
});
