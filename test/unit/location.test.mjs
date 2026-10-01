/**
 * @file location.test.mjs
 * Covers src/js/24-location.js — localStorage ↔ DOM location helpers.
 *
 * Updated for the ES-module extraction of 24-location.js (#336): the
 * vm.runInContext sandbox is replaced by direct calls to the exported
 * functions, with globalThis.localStorage and globalThis.document swapped
 * between tests. viewDate is controlled via setViewDate() from state.js.
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
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
    _store: store,
  };
}

let locationMod;
let stateMod;

async function loadMods() {
  if (!locationMod) {
    // Must set localStorage and document before first import so module-level
    // side effects don't throw ReferenceError in Node.js.
    if (!globalThis.localStorage) globalThis.localStorage = makeLocalStorageMock();
    if (!globalThis.document) globalThis.document = { getElementById: () => null };
    locationMod = await import('../../src/js/24-location.js');
    stateMod = await import('../../src/js/state.js');
  }
  return { ...locationMod, ...stateMod };
}

// ---------------------------------------------------------------------------

describe('24-location — loadLocationMap', () => {
  it('returns the parsed map for valid stored JSON', async () => {
    const { loadLocationMap } = await loadMods();
    globalThis.localStorage = makeLocalStorageMock({
      wl_location_v1: '{"2026-06-03":"office"}',
    });
    assert.deepEqual(loadLocationMap(), { '2026-06-03': 'office' });
  });

  it('returns an empty map when the key is missing', async () => {
    const { loadLocationMap } = await loadMods();
    globalThis.localStorage = makeLocalStorageMock();
    assert.deepEqual(loadLocationMap(), {});
  });

  it('returns an empty map on corrupt JSON (does not throw)', async () => {
    const { loadLocationMap } = await loadMods();
    globalThis.localStorage = makeLocalStorageMock({ wl_location_v1: '{not valid json' });
    assert.doesNotThrow(() => loadLocationMap());
    assert.deepEqual(loadLocationMap(), {});
  });

  it('returns an empty map when the stored value is not an object', async () => {
    const { loadLocationMap } = await loadMods();
    globalThis.localStorage = makeLocalStorageMock({ wl_location_v1: '42' });
    assert.deepEqual(loadLocationMap(), {});
  });
});

describe('24-location — saveLocationMap', () => {
  it('writes the map as JSON under the STORE_LOCATION key', async () => {
    const { saveLocationMap } = await loadMods();
    const ls = makeLocalStorageMock();
    globalThis.localStorage = ls;
    saveLocationMap({ '2026-06-03': 'office' });
    assert.equal(ls._store.wl_location_v1, '{"2026-06-03":"office"}');
  });

  it('overwrites an existing entry with the new map', async () => {
    const { saveLocationMap } = await loadMods();
    const ls = makeLocalStorageMock({ wl_location_v1: '{"2026-06-01":"remote"}' });
    globalThis.localStorage = ls;
    saveLocationMap({ '2026-06-01': 'office' });
    assert.equal(ls._store.wl_location_v1, '{"2026-06-01":"office"}');
  });
});

describe('24-location — getViewLocation', () => {
  it('returns the stored location for the current viewDate', async () => {
    const { getViewLocation, setViewDate } = await loadMods();
    const orig = (await loadMods()).getViewDate();
    try {
      setViewDate(new Date('2026-06-03T12:00:00'));
      globalThis.localStorage = makeLocalStorageMock({
        wl_location_v1: '{"2026-06-03":"office"}',
      });
      assert.equal(getViewLocation(), 'office');
    } finally {
      setViewDate(orig);
    }
  });

  it('returns the default (remote) when the date has no stored entry', async () => {
    const { getViewLocation, setViewDate } = await loadMods();
    const orig = (await loadMods()).getViewDate();
    try {
      setViewDate(new Date('2026-06-04T12:00:00'));
      globalThis.localStorage = makeLocalStorageMock({});
      assert.equal(getViewLocation(), 'remote');
    } finally {
      setViewDate(orig);
    }
  });
});

describe('24-location — toggleViewLocation', () => {
  it('changes the location for the current viewDate and persists it', async () => {
    const { toggleViewLocation, loadLocationMap, setViewDate } = await loadMods();
    const orig = (await loadMods()).getViewDate();
    try {
      setViewDate(new Date('2026-06-05T12:00:00'));
      const ls = makeLocalStorageMock({});
      globalThis.localStorage = ls;
      globalThis.document = { getElementById: () => null };
      toggleViewLocation();
      const stored = loadLocationMap();
      assert.ok('2026-06-05' in stored);
      // toggling from default 'remote' must produce a different value
      assert.notEqual(stored['2026-06-05'], 'remote');
    } finally {
      setViewDate(orig);
    }
  });

  it('is idempotent in the sense that two toggles produce a different key each time', async () => {
    const { toggleViewLocation, loadLocationMap, setViewDate } = await loadMods();
    const orig = (await loadMods()).getViewDate();
    try {
      setViewDate(new Date('2026-06-06T12:00:00'));
      const ls = makeLocalStorageMock({});
      globalThis.localStorage = ls;
      globalThis.document = { getElementById: () => null };
      toggleViewLocation();
      const after1 = loadLocationMap()['2026-06-06'];
      toggleViewLocation();
      const after2 = loadLocationMap()['2026-06-06'];
      assert.notEqual(after1, after2);
    } finally {
      setViewDate(orig);
    }
  });
});

describe('24-location — renderLocation / initLocation', () => {
  it('renderLocation is a no-op when the button element is absent', async () => {
    const { renderLocation } = await loadMods();
    globalThis.document = { getElementById: () => null };
    assert.doesNotThrow(() => renderLocation());
  });

  it('initLocation is a no-op when the button element is absent', async () => {
    const { initLocation } = await loadMods();
    globalThis.document = { getElementById: () => null };
    assert.doesNotThrow(() => initLocation());
  });
});
