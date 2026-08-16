/**
 * @file location.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORK_LOCATIONS, locationFor, nextLocation } from '../../src/js/pure-fns.js';
import { __dirname } from './_helpers.mjs';

const locationSrc = readFileSync(join(__dirname, '../../src/js/24-location.js'), 'utf8');

/**
 * Creates a vm sandbox exposing 24-location.js's functions with a stubbed
 * localStorage seeded from `preloaded`. STORE_LOCATION (normally declared in
 * 01-state.js) is injected directly so the module can resolve it.
 * @param {Record<string, string>} [preloaded] - Initial localStorage contents.
 * @returns {object} The vm sandbox with the module's functions attached.
 */
function loadLocationSandbox(preloaded = {}) {
  const store = { ...preloaded };
  const warnings = [];
  const sandbox = {
    STORE_LOCATION: 'wl_location_v1',
    WORK_LOCATIONS,
    DEFAULT_WORK_LOCATION: 'remote',
    locationFor,
    nextLocation,
    viewDate: new Date('2026-06-03T12:00:00'),
    dk: (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => {
        store[k] = v;
      },
    },
    document: { getElementById: () => null },
    wlLog: { info: () => {}, warn: (m) => warnings.push(m), error: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(locationSrc, sandbox);
  sandbox.__warnings = warnings;
  return sandbox;
}

describe('loadLocationMap', () => {
  // The map is built inside the vm realm, so spread it into a this-realm object
  // before deepEqual — cross-realm objects have a different Object.prototype.
  const plain = (sb) => ({ ...sb.loadLocationMap() });

  it('returns the parsed map for valid stored JSON', () => {
    const sb = loadLocationSandbox({ wl_location_v1: '{"2026-06-03":"office"}' });
    assert.deepEqual(plain(sb), { '2026-06-03': 'office' });
  });

  it('returns an empty map when the key is missing', () => {
    const sb = loadLocationSandbox();
    assert.deepEqual(plain(sb), {});
  });

  it('returns an empty map and warns on corrupt JSON', () => {
    const sb = loadLocationSandbox({ wl_location_v1: '{not valid json' });
    assert.deepEqual(plain(sb), {});
    assert.equal(sb.__warnings.length, 1);
  });

  it('returns an empty map when the stored value is not an object', () => {
    const sb = loadLocationSandbox({ wl_location_v1: '42' });
    assert.deepEqual(plain(sb), {});
  });
});
