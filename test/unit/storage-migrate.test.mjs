/**
 * @file storage-migrate.test.mjs
 * Covers src/js/01b-migrate.js — key-rename migrations and the sweep of
 * localStorage keys left behind by removed features.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname } from './_helpers.mjs';

/**
 * Loads 01b-migrate.js into a VM sandbox backed by an in-memory localStorage.
 * The module runs its migrations on load, so the returned store reflects the
 * post-migration state.
 *
 * @param {Record<string, string>} initial - Starting localStorage contents.
 * @returns {{ store: Record<string, string>, sandbox: Object }}
 */
function loadMigrateSandbox(initial = {}) {
  const store = { ...initial };
  const sandbox = {
    localStorage: {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => {
        store[key] = String(value);
      },
      removeItem: (key) => {
        delete store[key];
      },
    },
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    dk: (date) => {
      const pad = (num) => String(num).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(__dirname, '../../src/js/01b-migrate.js'), 'utf8'), sandbox);
  return { store, sandbox };
}

describe('01b-migrate — key renames', () => {
  it('copies a v0 key to its v1 name and drops the old one', () => {
    const { store } = loadMigrateSandbox({ wl_entries: '[{"id":"a"}]' });
    assert.equal(store.wl_entries_v1, '[{"id":"a"}]');
    assert.equal('wl_entries' in store, false);
  });

  it('does not overwrite a destination key that already has data', () => {
    const { store } = loadMigrateSandbox({ wl_cats: '["old"]', wl_cats_v1: '["new"]' });
    assert.equal(store.wl_cats_v1, '["new"]');
    assert.equal('wl_cats' in store, false);
  });
});

describe('01b-migrate — retired keys', () => {
  it('removes the retired transition-bridge key on load', () => {
    const { store } = loadMigrateSandbox({ wl_seen_ended_v1: '["Standup|2026-01-01T09:00:00Z"]' });
    assert.equal('wl_seen_ended_v1' in store, false);
  });

  it('leaves live keys untouched', () => {
    const { store } = loadMigrateSandbox({ wl_entries_v1: '[]', wl_plan_v1: '[]' });
    assert.equal(store.wl_entries_v1, '[]');
    assert.equal(store.wl_plan_v1, '[]');
  });

  it('is a no-op and reports zero when the retired key is absent', () => {
    const { sandbox } = loadMigrateSandbox({});
    assert.equal(sandbox.removeRetiredKeys(), 0);
  });

  it('logs and keeps going when storage refuses the removal', () => {
    const warnings = [];
    const { sandbox } = loadMigrateSandbox({});
    sandbox.wlLog.warn = (...args) => warnings.push(args[0]);
    sandbox.localStorage.getItem = () => '[]';
    sandbox.localStorage.removeItem = () => {
      throw new Error('SecurityError: storage is disabled');
    };
    assert.equal(sandbox.removeRetiredKeys(), 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /wl_seen_ended_v1/);
  });

  it('reports how many retired keys it removed', () => {
    const { sandbox, store } = loadMigrateSandbox({});
    store.wl_seen_ended_v1 = '[]';
    assert.equal(sandbox.removeRetiredKeys(), 1);
    assert.equal('wl_seen_ended_v1' in store, false);
  });
});
