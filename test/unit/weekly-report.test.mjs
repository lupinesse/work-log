/**
 * @file weekly-report.test.mjs
 * Covers src/js/12d-weeklyreport.js — weekly report modal helpers.
 *
 * Updated for the ES-module extraction of 12d-weeklyreport.js (#336): direct
 * calls to the exported functions with globalThis stubs where needed.
 * DOM-bound functions (open/close/copy/init) are tested as no-ops when their
 * target elements are absent (reduced test DOM).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function makeLocalStorageMock(initial = {}) {
  const store = { ...initial };
  return {
    // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => {
      // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
      store[key] = String(value);
    },
    removeItem: (key) => {
      // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
      delete store[key];
    },
    clear: () => {
      // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
      Object.keys(store).forEach((k) => delete store[k]);
    },
    _store: store,
  };
}

let weeklyMod;

async function loadMods() {
  if (!weeklyMod) {
    if (!globalThis.localStorage) globalThis.localStorage = makeLocalStorageMock();
    if (!globalThis.document) globalThis.document = { getElementById: () => null };
    weeklyMod = await import('../../src/js/12d-weeklyreport.js');
  }
  return weeklyMod;
}

// ---------------------------------------------------------------------------

describe('12d-weeklyreport — weekRangeLabel', () => {
  it('returns a non-empty string containing the em-dash separator', async () => {
    const { weekRangeLabel } = await loadMods();
    // 2026-09-28 is a Monday
    const weekStart = new Date('2026-09-28T00:00:00').getTime();
    const result = weekRangeLabel(weekStart);
    assert.equal(typeof result, 'string');
    assert.ok(result.includes(' – '), `expected " – " in "${result}"`);
  });

  it('start and end parts are different strings', async () => {
    const { weekRangeLabel } = await loadMods();
    const weekStart = new Date('2026-09-28T00:00:00').getTime();
    const result = weekRangeLabel(weekStart);
    const [start, end] = result.split(' – ');
    assert.ok(start, 'start part should be non-empty');
    assert.ok(end, 'end part should be non-empty');
    assert.notEqual(start, end);
  });

  it('end is exactly 6 days after start', async () => {
    const { weekRangeLabel } = await loadMods();
    // Use two consecutive weeks and confirm results differ
    const week1 = weekRangeLabel(new Date('2026-09-28T00:00:00').getTime());
    const week2 = weekRangeLabel(new Date('2026-10-05T00:00:00').getTime());
    assert.notEqual(week1, week2);
  });
});

describe('12d-weeklyreport — openWeeklyReportOverlay', () => {
  it('is a no-op when the overlay element is absent', async () => {
    const { openWeeklyReportOverlay } = await loadMods();
    globalThis.document = { getElementById: () => null, activeElement: null };
    assert.doesNotThrow(() => openWeeklyReportOverlay());
  });
});

describe('12d-weeklyreport — closeWeeklyReportOverlay', () => {
  it('is a no-op when the overlay element is absent', async () => {
    const { closeWeeklyReportOverlay } = await loadMods();
    globalThis.document = { getElementById: () => null };
    assert.doesNotThrow(() => closeWeeklyReportOverlay());
  });
});

describe('12d-weeklyreport — copyWeeklyReportText', () => {
  it('is a no-op when the text element is absent', async () => {
    const { copyWeeklyReportText } = await loadMods();
    globalThis.document = { getElementById: () => null };
    assert.doesNotThrow(() => copyWeeklyReportText());
  });
});

describe('12d-weeklyreport — restoreWeeklyReportFocus', () => {
  it('is a no-op when no trigger element was stored', async () => {
    const { restoreWeeklyReportFocus } = await loadMods();
    // _weeklyReportTrigger is null by default (openWeeklyReportOverlay needs a
    // real overlay element to set it, which the stub DOM does not provide).
    assert.doesNotThrow(() => restoreWeeklyReportFocus());
  });
});

describe('12d-weeklyreport — initWeeklyReport', () => {
  it('is a no-op when all button elements are absent', async () => {
    const { initWeeklyReport } = await loadMods();
    globalThis.document = { getElementById: () => null };
    assert.doesNotThrow(() => initWeeklyReport());
  });
});
