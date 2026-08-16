/**
 * @file lifecycle.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pureFns from '../../src/js/pure-fns.js';
import { __dirname } from './_helpers.mjs';

const lifecycleSrc = readFileSync(join(__dirname, '../../src/js/07-lifecycle.js'), 'utf8');

/**
 * Evaluates the collapse-state helper block from 07-lifecycle.js in a minimal
 * VM sandbox. The block is extracted by matching between comment headings so
 * it stays in sync with the source automatically.
 * @param {Record<string,string>} [preloaded] - Initial localStorage contents.
 * @returns {{ readCollapseState: Function, writeCollapseState: Function, store: Record<string,string> }}
 */
function loadCollapseSandbox(preloaded = {}) {
  const store = { ...preloaded };
  const sandbox = {
    localStorage: {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => {
        store[key] = value;
      },
    },
  };
  const match = lifecycleSrc.match(
    /\/\*.+Section collapse state persistence.+\*\/([\s\S]*?)(?=\/\*.+Section collapse handlers)/
  );
  if (!match) throw new Error('Collapse-state block not found in 07-lifecycle.js');
  vm.createContext(sandbox);
  vm.runInContext(match[0], sandbox);
  return {
    readCollapseState: sandbox.readCollapseState,
    writeCollapseState: sandbox.writeCollapseState,
    store,
  };
}

describe('readCollapseState', () => {
  it('returns defaultCollapsed=true when no value is stored', () => {
    const { readCollapseState } = loadCollapseSandbox();
    assert.equal(readCollapseState('mySection', true), true);
  });

  it('returns defaultCollapsed=false when no value is stored', () => {
    const { readCollapseState } = loadCollapseSandbox();
    assert.equal(readCollapseState('mySection', false), false);
  });

  it('returns true when stored value is "1" regardless of default', () => {
    const { readCollapseState } = loadCollapseSandbox({ 'tt-open2-mySection': '1' });
    assert.equal(readCollapseState('mySection', false), true);
  });

  it('returns false when stored value is "0" regardless of default', () => {
    const { readCollapseState } = loadCollapseSandbox({ 'tt-open2-mySection': '0' });
    assert.equal(readCollapseState('mySection', true), false);
  });

  it('uses the COLLAPSE_PREFIX (tt-open2-) when building the storage key', () => {
    // A value stored under the bare section id (no prefix) must not match.
    const { readCollapseState } = loadCollapseSandbox({ mySection: '1' });
    assert.equal(readCollapseState('mySection', false), false);
  });

  it('isolates sections: stored state for one id does not affect another', () => {
    const { readCollapseState } = loadCollapseSandbox({ 'tt-open2-sectionA': '1' });
    assert.equal(readCollapseState('sectionA', false), true);
    assert.equal(readCollapseState('sectionB', false), false);
  });
});

describe('writeCollapseState', () => {
  it('writes "1" when collapsed is true', () => {
    const { writeCollapseState, store } = loadCollapseSandbox();
    writeCollapseState('mySection', true);
    assert.equal(store['tt-open2-mySection'], '1');
  });

  it('writes "0" when collapsed is false', () => {
    const { writeCollapseState, store } = loadCollapseSandbox();
    writeCollapseState('mySection', false);
    assert.equal(store['tt-open2-mySection'], '0');
  });

  it('overwrites a previous value', () => {
    const { writeCollapseState, store } = loadCollapseSandbox({ 'tt-open2-s': '1' });
    writeCollapseState('s', false);
    assert.equal(store['tt-open2-s'], '0');
  });

  it('round-trips: write true then read back true', () => {
    const { readCollapseState, writeCollapseState } = loadCollapseSandbox();
    writeCollapseState('roundTrip', true);
    assert.equal(readCollapseState('roundTrip', false), true);
  });

  it('round-trips: write false then read back false', () => {
    const { readCollapseState, writeCollapseState } = loadCollapseSandbox();
    writeCollapseState('roundTrip', false);
    assert.equal(readCollapseState('roundTrip', true), false);
  });
});

/**
 * Evaluates the SOD helper block from 07-lifecycle.js in a minimal VM sandbox.
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.preloaded] - Initial localStorage contents.
 * @returns {{ ensureDayStarted: Function, getDayStart: Function, store: Record<string,string>, calls: { renderSodBtn: number, renderTimeblock: number } }}
 */
function loadSodSandbox({ preloaded = {}, viewDate = new Date() } = {}) {
  const store = { ...preloaded };
  const calls = { renderSodBtn: 0, renderTimeblock: 0 };
  const fakeEl = {
    textContent: '',
    appendChild: () => {},
    setAttribute: () => {},
    addEventListener: () => {},
  };
  const sandbox = {
    dk: pureFns.dk,
    // viewDate is the day the user has navigated to; the SOD/EOD key helpers
    // default to it so the chip reflects whichever day is in view.
    viewDate,
    isToday: (d) => pureFns.dk(d) === pureFns.dk(new Date()),
    localStorage: {
      getItem: (key) => (key in store ? store[key] : null),
      setItem: (key, value) => {
        store[key] = String(value);
      },
    },
    document: {
      getElementById: () => fakeEl,
      createElement: () => ({ className: '', setAttribute: () => {} }),
      createTextNode: () => ({}),
    },
    // renderTimeblock is not declared by the vm script so this property survives.
    renderTimeblock: () => {
      calls.renderTimeblock++;
    },
  };
  // Evaluate from the start of the file up to (not including) the section
  // collapse handlers, which run top-level DOM code. This range includes the SOD
  // and EOD helper declarations; the only top-level executable in it is the
  // sodBtn listener, whose bind is a no-op because fakeEl.addEventListener is
  // stubbed.
  const cutIdx = lifecycleSrc.indexOf('/* ── Section collapse handlers ── */');
  if (cutIdx === -1)
    throw new Error('Could not locate collapse handlers marker in 07-lifecycle.js');
  vm.createContext(sandbox);
  vm.runInContext(lifecycleSrc.slice(0, cutIdx), sandbox);
  // renderSodBtn was defined by the vm script (function declaration). Replace
  // the sandbox property with a spy — mutations to the sandbox object are
  // visible as global-scope changes inside the vm context, so subsequent calls
  // from ensureDayStarted will invoke the spy.
  sandbox.renderSodBtn = () => {
    calls.renderSodBtn++;
  };
  return {
    ensureDayStarted: sandbox.ensureDayStarted,
    getDayStart: sandbox.getDayStart,
    getEodTs: sandbox.getEodTs,
    sodKey: sandbox.sodKey,
    eodKey: sandbox.eodKey,
    store,
    calls,
  };
}

describe('ensureDayStarted', () => {
  it('records SOD in localStorage when day is not started', () => {
    const before = Date.now();
    const { ensureDayStarted, store } = loadSodSandbox();
    ensureDayStarted();
    const key = Object.keys(store).find((k) => k.startsWith('wl_sod_'));
    assert.ok(key, 'wl_sod_ key should be written');
    const ts = parseInt(store[key]);
    assert.ok(ts >= before && ts <= Date.now(), 'stored timestamp should be approximately now');
  });

  it('calls renderSodBtn after recording SOD', () => {
    const { ensureDayStarted, calls } = loadSodSandbox();
    ensureDayStarted();
    assert.equal(calls.renderSodBtn, 1);
  });

  it('calls renderTimeblock after recording SOD', () => {
    const { ensureDayStarted, calls } = loadSodSandbox();
    ensureDayStarted();
    assert.equal(calls.renderTimeblock, 1);
  });

  it('is idempotent: does not overwrite SOD when already started', () => {
    const todayKey = pureFns.dk(new Date());
    const existing = '1000000000000';
    const { ensureDayStarted, store } = loadSodSandbox({
      preloaded: { ['wl_sod_' + todayKey]: existing },
    });
    ensureDayStarted();
    assert.equal(store['wl_sod_' + todayKey], existing, 'SOD timestamp must not be overwritten');
  });

  it('does not call renderSodBtn when day is already started', () => {
    const todayKey = pureFns.dk(new Date());
    const { ensureDayStarted, calls } = loadSodSandbox({
      preloaded: { ['wl_sod_' + todayKey]: '1000000000000' },
    });
    ensureDayStarted();
    assert.equal(calls.renderSodBtn, 0);
  });

  it('does not call renderTimeblock when day is already started', () => {
    const todayKey = pureFns.dk(new Date());
    const { ensureDayStarted, calls } = loadSodSandbox({
      preloaded: { ['wl_sod_' + todayKey]: '1000000000000' },
    });
    ensureDayStarted();
    assert.equal(calls.renderTimeblock, 0);
  });

  it('records SOD against today even when a past day is in view', () => {
    const past = new Date('2026-05-20T09:00:00');
    const todayKey = pureFns.dk(new Date());
    const { ensureDayStarted, store } = loadSodSandbox({ viewDate: past });
    ensureDayStarted();
    assert.ok(store['wl_sod_' + todayKey], 'today key should be written');
    assert.ok(!store['wl_sod_2026-05-20'], 'the viewed past day must not be written');
  });
});

describe('per-day start/end lookup', () => {
  const PAST = new Date('2026-05-20T12:00:00');
  const PAST_KEY = '2026-05-20';

  it('getDayStart reads the SOD for the day in view, not today', () => {
    const { getDayStart } = loadSodSandbox({
      viewDate: PAST,
      preloaded: { ['wl_sod_' + PAST_KEY]: '1700000000000' },
    });
    assert.equal(getDayStart(), 1700000000000);
  });

  it('getDayStart returns null when the viewed day has no SOD', () => {
    const todayKey = pureFns.dk(new Date());
    const { getDayStart } = loadSodSandbox({
      viewDate: PAST,
      preloaded: { ['wl_sod_' + todayKey]: '1700000000000' },
    });
    assert.equal(getDayStart(), null);
  });

  it('getEodTs reads the EOD for the day in view, not today', () => {
    const { getEodTs } = loadSodSandbox({
      viewDate: PAST,
      preloaded: { ['wl_eod_' + PAST_KEY]: '1700000050000' },
    });
    assert.equal(getEodTs(), 1700000050000);
  });

  it('an explicit day argument overrides the viewDate default', () => {
    const { getDayStart } = loadSodSandbox({
      viewDate: PAST,
      preloaded: { ['wl_sod_2026-01-01']: '1600000000000' },
    });
    assert.equal(getDayStart(new Date('2026-01-01T08:00:00')), 1600000000000);
  });

  it('sodKey defaults to the day in view when called with no argument', () => {
    const { sodKey } = loadSodSandbox({ viewDate: PAST });
    assert.equal(sodKey(), 'wl_sod_' + PAST_KEY);
  });

  it('eodKey defaults to the day in view when called with no argument', () => {
    const { eodKey } = loadSodSandbox({ viewDate: PAST });
    assert.equal(eodKey(), 'wl_eod_' + PAST_KEY);
  });
});
