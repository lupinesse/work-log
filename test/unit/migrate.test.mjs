/**
 * @file migrate.test.mjs
 * Regression coverage for issue #336: 01b-migrate.js extracted to a leaf
 * ES module. Tests cover all three exported functions using a minimal
 * localStorage mock.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// --- Browser API mocks -------------------------------------------------------

function makeLocalStorageMock(initial = {}) {
  const store = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
    _store: store,
  };
}

// ---------------------------------------------------------------------------

let mod;

async function loadMod() {
  if (!mod) {
    globalThis.wlLog = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };
    // Provide a mock before importing so the module-level side-effect calls
    // (migrateStorage / migrateEntryDatesToLocal / removeRetiredKeys) run on
    // an empty store without throwing ReferenceError in Node.js.
    globalThis.localStorage = makeLocalStorageMock();
    mod = await import('../../src/js/01b-migrate.js');
  }
  return mod;
}

// ---------------------------------------------------------------------------

describe('01b-migrate.js — module exports', () => {
  it('exports the expected public symbols', async () => {
    const m = await loadMod();
    assert.equal(typeof m.migrateStorage, 'function');
    assert.equal(typeof m.migrateEntryDatesToLocal, 'function');
    assert.equal(typeof m.removeRetiredKeys, 'function');
  });
});

describe('migrateStorage', () => {
  it('copies data from old key to new key and removes old key', async () => {
    const { migrateStorage } = await loadMod();
    globalThis.localStorage = makeLocalStorageMock({ wl_entries: '[{"id":1}]' });

    migrateStorage();

    assert.equal(globalThis.localStorage.getItem('wl_entries_v1'), '[{"id":1}]');
    assert.equal(globalThis.localStorage.getItem('wl_entries'), null);
  });

  it('skips migration when old key does not exist', async () => {
    const { migrateStorage } = await loadMod();
    globalThis.localStorage = makeLocalStorageMock({});

    migrateStorage();

    assert.equal(globalThis.localStorage.getItem('wl_entries_v1'), null);
  });

  it('removes stale old key when destination already has data', async () => {
    const { migrateStorage } = await loadMod();
    globalThis.localStorage = makeLocalStorageMock({
      wl_entries: '[{"id":1}]',
      wl_entries_v1: '[{"id":2}]',
    });

    migrateStorage();

    // Destination untouched; old key removed
    assert.equal(globalThis.localStorage.getItem('wl_entries_v1'), '[{"id":2}]');
    assert.equal(globalThis.localStorage.getItem('wl_entries'), null);
  });

  it('handles alternative old key name (wl_categories → wl_cats_v1)', async () => {
    const { migrateStorage } = await loadMod();
    globalThis.localStorage = makeLocalStorageMock({ wl_categories: '[{"name":"Work"}]' });

    migrateStorage();

    assert.equal(globalThis.localStorage.getItem('wl_cats_v1'), '[{"name":"Work"}]');
    assert.equal(globalThis.localStorage.getItem('wl_categories'), null);
  });

  it('is idempotent — running twice does not corrupt data', async () => {
    const { migrateStorage } = await loadMod();
    globalThis.localStorage = makeLocalStorageMock({ wl_plan: '[{"t":"task"}]' });

    migrateStorage();
    migrateStorage();

    assert.equal(globalThis.localStorage.getItem('wl_plan_v1'), '[{"t":"task"}]');
    assert.equal(globalThis.localStorage.getItem('wl_plan'), null);
  });
});

describe('migrateEntryDatesToLocal', () => {
  it('does nothing when wl_entries_v1 is absent', async () => {
    const { migrateEntryDatesToLocal } = await loadMod();
    globalThis.localStorage = makeLocalStorageMock({});

    assert.doesNotThrow(() => migrateEntryDatesToLocal());
  });

  it('does not modify entries whose date already matches the local date', async () => {
    const { migrateEntryDatesToLocal } = await loadMod();
    // ts at 2026-06-15 noon UTC — local date matches UTC date in any UTC+ offset
    // Use a timestamp where local == UTC to keep the test tz-agnostic:
    // We force a ts where dk(new Date(ts)) equals the stored date by deriving it ourselves.
    const d = new Date(2026, 5, 15, 12, 0, 0); // local noon 2026-06-15
    const ts = d.getTime();
    const pad = (n) => String(n).padStart(2, '0');
    const localDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const entries = [{ id: 1, ts, date: localDate, note: 'ok' }];
    globalThis.localStorage = makeLocalStorageMock({
      wl_entries_v1: JSON.stringify(entries),
    });

    migrateEntryDatesToLocal();

    const stored = JSON.parse(globalThis.localStorage.getItem('wl_entries_v1'));
    assert.equal(stored[0].date, localDate);
  });

  it('corrects entries whose date does not match the local date', async () => {
    const { migrateEntryDatesToLocal } = await loadMod();
    // Build a ts at local midnight; the correct local date is that date.
    const d = new Date(2026, 5, 15, 0, 0, 0); // local midnight 2026-06-15
    const ts = d.getTime();
    const pad = (n) => String(n).padStart(2, '0');
    const localDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    // Simulate a "wrong" (UTC-offset) date stored from old bug
    const wrongDate = '2026-06-14'; // one day early as UTC+1 would have stored
    const entries = [{ id: 1, ts, date: wrongDate, note: 'early entry' }];
    globalThis.localStorage = makeLocalStorageMock({
      wl_entries_v1: JSON.stringify(entries),
    });

    migrateEntryDatesToLocal();

    const stored = JSON.parse(globalThis.localStorage.getItem('wl_entries_v1'));
    // The date should now be the correct local date
    assert.equal(stored[0].date, localDate);
  });

  it('skips entries with missing ts or date fields', async () => {
    const { migrateEntryDatesToLocal } = await loadMod();
    const entries = [
      { id: 1, note: 'no ts or date' },
      { id: 2, ts: Date.now() }, // no date
    ];
    globalThis.localStorage = makeLocalStorageMock({
      wl_entries_v1: JSON.stringify(entries),
    });

    assert.doesNotThrow(() => migrateEntryDatesToLocal());
  });

  it('handles malformed JSON gracefully without throwing', async () => {
    const { migrateEntryDatesToLocal } = await loadMod();
    globalThis.localStorage = makeLocalStorageMock({
      wl_entries_v1: 'not-json',
    });

    assert.doesNotThrow(() => migrateEntryDatesToLocal());
  });
});

describe('removeRetiredKeys', () => {
  it('removes a known retired key and returns the count', async () => {
    const { removeRetiredKeys } = await loadMod();
    globalThis.localStorage = makeLocalStorageMock({ wl_seen_ended_v1: '1' });

    const removed = removeRetiredKeys();

    assert.equal(removed, 1);
    assert.equal(globalThis.localStorage.getItem('wl_seen_ended_v1'), null);
  });

  it('returns 0 when no retired keys are present', async () => {
    const { removeRetiredKeys } = await loadMod();
    globalThis.localStorage = makeLocalStorageMock({});

    const removed = removeRetiredKeys();

    assert.equal(removed, 0);
  });

  it('is idempotent — calling twice still returns 0 on second call', async () => {
    const { removeRetiredKeys } = await loadMod();
    globalThis.localStorage = makeLocalStorageMock({ wl_seen_ended_v1: '1' });

    removeRetiredKeys();
    const second = removeRetiredKeys();

    assert.equal(second, 0);
  });
});
