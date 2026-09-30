/**
 * @file storage-migrate.test.mjs
 * Covers src/js/01b-migrate.js — key-rename migrations and the sweep of
 * localStorage keys left behind by removed features.
 *
 * Updated for the ES-module extraction of 01b-migrate.js (#336): the
 * vm.runInContext sandbox is replaced by direct calls to the exported
 * functions, with globalThis.localStorage swapped between tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function makeLocalStorageMock(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    _store: store,
  };
}

let migrateMod;
async function loadMigrateMod() {
  if (!migrateMod) {
    globalThis.wlLog = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };
    // Must set localStorage before first import so the module-level side
    // effects don't throw ReferenceError in Node.js.
    if (!globalThis.localStorage) globalThis.localStorage = makeLocalStorageMock();
    migrateMod = await import('../../src/js/01b-migrate.js');
  }
  return migrateMod;
}

// ---------------------------------------------------------------------------

describe('01b-migrate — key renames', () => {
  it('copies a v0 key to its v1 name and drops the old one', async () => {
    const { migrateStorage } = await loadMigrateMod();
    const ls = makeLocalStorageMock({ wl_entries: '[{"id":"a"}]' });
    globalThis.localStorage = ls;

    migrateStorage();

    assert.equal(ls._store.wl_entries_v1, '[{"id":"a"}]');
    assert.equal('wl_entries' in ls._store, false);
  });

  it('does not overwrite a destination key that already has data', async () => {
    const { migrateStorage } = await loadMigrateMod();
    const ls = makeLocalStorageMock({ wl_cats: '["old"]', wl_cats_v1: '["new"]' });
    globalThis.localStorage = ls;

    migrateStorage();

    assert.equal(ls._store.wl_cats_v1, '["new"]');
    assert.equal('wl_cats' in ls._store, false);
  });
});

describe('01b-migrate — retired keys', () => {
  it('removes the retired transition-bridge key when present', async () => {
    const { removeRetiredKeys } = await loadMigrateMod();
    const ls = makeLocalStorageMock({ wl_seen_ended_v1: '["Standup|2026-01-01T09:00:00Z"]' });
    globalThis.localStorage = ls;

    removeRetiredKeys();

    assert.equal('wl_seen_ended_v1' in ls._store, false);
  });

  it('leaves live keys untouched', async () => {
    const { removeRetiredKeys } = await loadMigrateMod();
    const ls = makeLocalStorageMock({ wl_entries_v1: '[]', wl_plan_v1: '[]' });
    globalThis.localStorage = ls;

    removeRetiredKeys();

    assert.equal(ls._store.wl_entries_v1, '[]');
    assert.equal(ls._store.wl_plan_v1, '[]');
  });

  it('is a no-op and reports zero when the retired key is absent', async () => {
    const { removeRetiredKeys } = await loadMigrateMod();
    globalThis.localStorage = makeLocalStorageMock({});

    assert.equal(removeRetiredKeys(), 0);
  });

  it('keeps going and returns 0 when storage refuses the removal', async () => {
    // wlLog is an imported binding, not a globalThis property, so we cannot
    // intercept its calls from the test. The observable guarantee is that the
    // catch block does not re-throw and that removed stays 0 (the throw happens
    // before the removeItem / counter line).
    const { removeRetiredKeys } = await loadMigrateMod();
    globalThis.localStorage = {
      getItem: () => '[]', // key exists
      removeItem: () => {
        throw new Error('SecurityError: storage is disabled');
      },
    };

    assert.doesNotThrow(() => removeRetiredKeys());
    assert.equal(removeRetiredKeys(), 0);
  });

  it('reports how many retired keys it removed', async () => {
    const { removeRetiredKeys } = await loadMigrateMod();
    const ls = makeLocalStorageMock({ wl_seen_ended_v1: '[]' });
    globalThis.localStorage = ls;

    assert.equal(removeRetiredKeys(), 1);
    assert.equal('wl_seen_ended_v1' in ls._store, false);
  });
});
