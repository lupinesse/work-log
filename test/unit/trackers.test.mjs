/**
 * @file trackers.test.mjs
 * Drives src/js/22-trackers.js in a VM sandbox: tracker day status
 * classification, streak calculation, localStorage round-trips, and
 * the render / delete flow.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname, loadPureFnsScriptSource, stripEsmSyntax } from './_helpers.mjs';

const trackersSrc = stripEsmSyntax(
  readFileSync(join(__dirname, '../../src/js/22-trackers.js'), 'utf8')
);

const STORE_TRACKERS = 'wl_trackers_v1';
const HOUR = 3600000;

/**
 * Builds a VM sandbox with the minimal DOM + state stubs for the trackers module.
 * @param {Object} opts
 * @param {Array} [opts.trackers=[]] - Initial trackers state.
 * @param {Array} [opts.entries=[]] - Entries available to trackerDayStatus.
 * @param {Array} [opts.categories=[]] - Categories for form rendering.
 * @param {Object} [opts.storage={}] - Initial localStorage content.
 * @returns {{ sandbox, getTrackerState }}
 */
function loadSandbox({ trackers = [], entries = [], categories = [], storage = {} } = {}) {
  let _trackers = [...trackers];
  const _storage = { ...storage };

  const listEl = {
    innerHTML: '',
    querySelectorAll() {
      return [];
    },
  };

  const sandbox = {
    STORE_TRACKERS,
    getTrackers: () => _trackers,
    setTrackers: (next) => {
      _trackers = next;
    },
    getEntries: () => entries,
    getCategories: () => categories,
    wlLog: { info() {}, warn() {} },
    localStorage: {
      // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
      getItem: (k) => (Object.prototype.hasOwnProperty.call(_storage, k) ? _storage[k] : null),
      setItem: (k, v) => {
        // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
        _storage[k] = String(v);
      },
    },
    alert: () => {},
    document: {
      getElementById: (id) => (id === 'trackerList' ? listEl : null),
      querySelectorAll: () => [],
    },
    Date,
    Array,
    Number,
    String,
    JSON,
    parseInt,
    isNaN,
  };

  vm.createContext(sandbox);
  vm.runInContext(loadPureFnsScriptSource(), sandbox);
  vm.runInContext(trackersSrc, sandbox);

  return {
    sandbox,
    getTrackerState: () => _trackers,
    getStorage: () => _storage,
    listEl,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORK_TRACKER = {
  id: 't1',
  name: 'Deep work',
  targetMinutes: 60,
  tags: ['work'],
  color: '#4A90E2',
};

const dateKey = '2026-09-30';

function workEntry(date, startMs, endMs) {
  return { date, tag: 'work', ts: startMs, tsEnd: endMs };
}

// ---------------------------------------------------------------------------

describe('22-trackers — trackerDayStatus', () => {
  it('returns "hit" when tracked time meets the target', () => {
    const entries = [workEntry(dateKey, 0, 90 * 60000)]; // 90 min
    const { sandbox } = loadSandbox({ entries });
    assert.equal(sandbox.trackerDayStatus(WORK_TRACKER, dateKey), 'hit');
  });

  it('returns "partial" when tracked time is 50–99% of target', () => {
    const entries = [workEntry(dateKey, 0, 45 * 60000)]; // 45 min (75%)
    const { sandbox } = loadSandbox({ entries });
    assert.equal(sandbox.trackerDayStatus(WORK_TRACKER, dateKey), 'partial');
  });

  it('returns "partial" when tracked time is exactly 50% of target', () => {
    const entries = [workEntry(dateKey, 0, 30 * 60000)]; // 30 min (50%)
    const { sandbox } = loadSandbox({ entries });
    assert.equal(sandbox.trackerDayStatus(WORK_TRACKER, dateKey), 'partial');
  });

  it('returns "miss" when tracked time is below 50% of target', () => {
    const entries = [workEntry(dateKey, 0, 29 * 60000)]; // 29 min (<50%)
    const { sandbox } = loadSandbox({ entries });
    assert.equal(sandbox.trackerDayStatus(WORK_TRACKER, dateKey), 'miss');
  });

  it('returns "miss" with no entries for that day', () => {
    const entries = [workEntry('2026-09-29', 0, 2 * HOUR)];
    const { sandbox } = loadSandbox({ entries });
    assert.equal(sandbox.trackerDayStatus(WORK_TRACKER, dateKey), 'miss');
  });

  it('ignores cancelled entries', () => {
    const entries = [
      { date: dateKey, tag: 'work', ts: 0, tsEnd: 90 * 60000, signifier: 'cancelled' },
    ];
    const { sandbox } = loadSandbox({ entries });
    assert.equal(sandbox.trackerDayStatus(WORK_TRACKER, dateKey), 'miss');
  });

  it('ignores entries without tsEnd', () => {
    const entries = [{ date: dateKey, tag: 'work', ts: 0, tsEnd: undefined }];
    const { sandbox } = loadSandbox({ entries });
    assert.equal(sandbox.trackerDayStatus(WORK_TRACKER, dateKey), 'miss');
  });

  it('sums multiple entries for the same day', () => {
    const entries = [workEntry(dateKey, 0, 30 * 60000), workEntry(dateKey, 40 * 60000, 70 * 60000)]; // 30 + 30 = 60 min
    const { sandbox } = loadSandbox({ entries });
    assert.equal(sandbox.trackerDayStatus(WORK_TRACKER, dateKey), 'hit');
  });

  it('only counts entries whose tag is in tracker.tags', () => {
    const entries = [workEntry(dateKey, 0, 90 * 60000)];
    const meetingTracker = { ...WORK_TRACKER, tags: ['meeting'] };
    const { sandbox } = loadSandbox({ entries });
    assert.equal(sandbox.trackerDayStatus(meetingTracker, dateKey), 'miss');
  });
});

// ---------------------------------------------------------------------------

describe('22-trackers — loadTrackers / saveTrackers', () => {
  it('loads persisted trackers from localStorage', () => {
    const stored = [WORK_TRACKER];
    const { sandbox, getTrackerState } = loadSandbox({
      storage: { [STORE_TRACKERS]: JSON.stringify(stored) },
    });
    sandbox.loadTrackers();
    assert.deepEqual(getTrackerState(), stored);
  });

  it('falls back to [] when nothing is stored', () => {
    const { sandbox, getTrackerState } = loadSandbox();
    sandbox.loadTrackers();
    assert.equal(getTrackerState().length, 0);
  });

  it('falls back to [] when stored JSON is not an array', () => {
    const { sandbox, getTrackerState } = loadSandbox({
      storage: { [STORE_TRACKERS]: JSON.stringify({ not: 'an array' }) },
    });
    sandbox.loadTrackers();
    assert.equal(getTrackerState().length, 0);
  });

  it('falls back to [] on malformed JSON', () => {
    const { sandbox, getTrackerState } = loadSandbox({
      storage: { [STORE_TRACKERS]: '{ broken' },
    });
    sandbox.loadTrackers();
    assert.equal(getTrackerState().length, 0);
  });

  it('replaces trackers already held with [] when the stored JSON is malformed', () => {
    // The test above starts from an empty list, so it passes even if the
    // reset is dropped; holding a tracker first makes the reset observable.
    const { sandbox, getTrackerState } = loadSandbox({
      trackers: [WORK_TRACKER],
      storage: { [STORE_TRACKERS]: '{ broken' },
    });
    sandbox.loadTrackers();
    assert.equal(getTrackerState().length, 0);
  });

  it('saveTrackers round-trips through localStorage', () => {
    const initial = [WORK_TRACKER];
    const { sandbox, getStorage } = loadSandbox({ trackers: initial });
    sandbox.saveTrackers();
    // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
    assert.deepEqual(JSON.parse(getStorage()[STORE_TRACKERS]), initial);
  });

  it('saveTrackers reflects the current state at call time', () => {
    const { sandbox, getStorage } = loadSandbox({ trackers: [] });
    sandbox.setTrackers([WORK_TRACKER]);
    sandbox.saveTrackers();
    // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
    assert.deepEqual(JSON.parse(getStorage()[STORE_TRACKERS]), [WORK_TRACKER]);
  });
});

// ---------------------------------------------------------------------------

describe('22-trackers — renderTrackers', () => {
  it('renders an empty-state message when there are no trackers', () => {
    const { sandbox, listEl } = loadSandbox({ trackers: [] });
    sandbox.renderTrackers();
    assert.match(listEl.innerHTML, /No trackers yet/);
  });

  it('renders a card for each tracker', () => {
    const t2 = { ...WORK_TRACKER, id: 't2', name: 'Meetings', tags: ['meeting'] };
    const { sandbox, listEl } = loadSandbox({ trackers: [WORK_TRACKER, t2] });
    sandbox.renderTrackers();
    assert.match(listEl.innerHTML, /Deep work/);
    assert.match(listEl.innerHTML, /Meetings/);
  });

  it('shows target in hours when >= 60 minutes', () => {
    const twoHour = { ...WORK_TRACKER, targetMinutes: 120 };
    const { sandbox, listEl } = loadSandbox({ trackers: [twoHour] });
    sandbox.renderTrackers();
    assert.match(listEl.innerHTML, /2h\/day/);
  });

  it('shows target in minutes when < 60', () => {
    const thirtyMin = { ...WORK_TRACKER, targetMinutes: 30 };
    const { sandbox, listEl } = loadSandbox({ trackers: [thirtyMin] });
    sandbox.renderTrackers();
    assert.match(listEl.innerHTML, /30m\/day/);
  });

  it('escapes HTML in tracker name', () => {
    const xss = { ...WORK_TRACKER, name: '<script>alert(1)</script>' };
    const { sandbox, listEl } = loadSandbox({ trackers: [xss] });
    sandbox.renderTrackers();
    assert.doesNotMatch(listEl.innerHTML, /<script>/i);
    assert.match(listEl.innerHTML, /&lt;script&gt;/);
  });

  it('returns early when #trackerList is absent', () => {
    const { sandbox } = loadSandbox({ trackers: [WORK_TRACKER] });
    // Override getElementById to return null for trackerList
    sandbox.document.getElementById = () => null;
    // Should not throw
    assert.doesNotThrow(() => sandbox.renderTrackers());
  });
});
