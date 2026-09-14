/**
 * @file changelog-data.test.mjs
 * Regression coverage for issue #336: 12b-changelog-data.js had no dedicated
 * test before this — its third ES-module extraction (STORE_DEV_LOG,
 * TEST_AREA_NAMES, DEV_CHANGES). These are structural invariants that
 * 12a-changelog.js silently degrades on rather than errors on: an unknown
 * `areas` number renders as "Unknown" (TEST_AREA_NAMES[n] || 'Unknown')
 * instead of failing loudly, so a bad entry would otherwise ship unnoticed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STORE_DEV_LOG, TEST_AREA_NAMES, DEV_CHANGES } from '../../src/js/12b-changelog-data.js';

const DEV_CHANGE_ID = /^\d{8}-\d{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('STORE_DEV_LOG', () => {
  it('is the expected localStorage key', () => {
    assert.equal(STORE_DEV_LOG, 'wl_dev_log');
  });
});

describe('TEST_AREA_NAMES', () => {
  it('maps every key to a non-empty string label', () => {
    const entries = Object.entries(TEST_AREA_NAMES);
    assert.ok(entries.length > 0);
    for (const [key, label] of entries) {
      assert.equal(typeof label, 'string');
      assert.ok(label.trim().length > 0, `area ${key} has an empty label`);
    }
  });
});

describe('DEV_CHANGES', () => {
  it('is a non-empty array', () => {
    assert.ok(Array.isArray(DEV_CHANGES));
    assert.ok(DEV_CHANGES.length > 0);
  });

  it('every entry has a well-formed id, date, desc, and areas list', () => {
    // areas may legitimately be empty — e.g. a changelog entry for a change
    // (adding the test suite itself, a docs-only change) that isn't tied to
    // any of the numbered manual test areas.
    for (const entry of DEV_CHANGES) {
      assert.match(entry.id, DEV_CHANGE_ID, `malformed id: ${entry.id}`);
      assert.match(entry.date, ISO_DATE, `malformed date on ${entry.id}: ${entry.date}`);
      assert.ok(!Number.isNaN(new Date(entry.date).getTime()), `unparseable date on ${entry.id}`);
      assert.equal(typeof entry.desc, 'string');
      assert.ok(entry.desc.trim().length > 0, `empty desc on ${entry.id}`);
      assert.ok(Array.isArray(entry.areas), `areas is not an array on ${entry.id}`);
    }
  });

  it('every entry id is unique', () => {
    const ids = DEV_CHANGES.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('every referenced area number is a known key in TEST_AREA_NAMES', () => {
    const knownAreas = new Set(Object.keys(TEST_AREA_NAMES).map(Number));
    for (const entry of DEV_CHANGES) {
      for (const area of entry.areas) {
        assert.ok(
          knownAreas.has(area),
          `${entry.id} references unknown area ${area} — would render as "Unknown" in the changelog modal`
        );
      }
    }
  });
});
