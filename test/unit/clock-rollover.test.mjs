/**
 * @file clock-rollover.test.mjs
 * Unit tests for the midnight-rollover branch of tickClock() in
 * 09-clock-weather.js. When the date changes under a long-running tab, the
 * clock tick carries unfinished tasks forward and has to move the viewed day
 * to the new today through setViewDate() (#423); otherwise the user keeps
 * looking at yesterday's log.
 *
 * Run: node --test test/unit/clock-rollover.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import { __dirname, withStateAccessors } from './_helpers.mjs';

const clockSource = readFileSync(join(__dirname, '../../src/js/09-clock-weather.js'), 'utf8');
// Everything up to the weather section is the clock itself: the ISO-week
// helpers, the _lastTickDate seed, the immediate tickClock() call and the
// function. The rest of the file is network-bound weather code.
const clockSection = clockSource.slice(0, clockSource.indexOf('// WEATHER_LAT'));

const STALE_VIEW_DATE = new Date('2020-01-01T12:00:00');

/**
 * Loads the clock section into a VM sandbox. `dk` returns each value of
 * `dayKeys` in turn (the last one repeats), so the first call seeds
 * `_lastTickDate` and the second is the key tickClock() compares it with.
 * @param {string[]} dayKeys - Successive day keys the stubbed dk() returns.
 * @returns {{ sandbox: object, calls: string[] }} The sandbox and the ordered
 *   names of the rollover collaborators that ran.
 */
function loadClock(dayKeys) {
  const calls = [];
  const record = (name) => () => calls.push(name);
  let keyIndex = 0;
  const sandbox = {
    viewDate: STALE_VIEW_DATE,
    dk: () => dayKeys[Math.min(keyIndex++, dayKeys.length - 1)],
    document: { getElementById: () => ({ textContent: '' }) },
    setInterval: () => 0,
    positionNowLine: () => {},
    checkBlockNotifications: () => {},
    autoCarryTasks: record('autoCarryTasks'),
    patchCarriedTasks: record('patchCarriedTasks'),
    renderSodBtn: record('renderSodBtn'),
    renderEodBtn: record('renderEodBtn'),
    checkPomoWeeklyClear: record('checkPomoWeeklyClear'),
    render: record('render'),
  };
  vm.createContext(withStateAccessors(sandbox));
  vm.runInContext(clockSection, sandbox);
  return { sandbox, calls };
}

describe('tickClock() midnight rollover', () => {
  it('moves the viewed day to the new today when the date changes', () => {
    const { sandbox } = loadClock(['2026-09-30', '2026-10-01']);
    const movedBy = Math.abs(sandbox.viewDate.getTime() - Date.now());
    assert.ok(movedBy < 60_000, `viewDate is ${movedBy}ms from now, expected the current time`);
  });

  it('carries tasks forward and re-renders around the viewDate change', () => {
    const { calls } = loadClock(['2026-09-30', '2026-10-01']);
    assert.deepEqual(calls, [
      'autoCarryTasks',
      'patchCarriedTasks',
      'renderSodBtn',
      'renderEodBtn',
      'checkPomoWeeklyClear',
      'render',
    ]);
  });

  it('leaves the viewed day alone when the date has not changed', () => {
    const { sandbox, calls } = loadClock(['2026-10-01']);
    assert.equal(sandbox.viewDate, STALE_VIEW_DATE);
    assert.deepEqual(calls, []);
  });
});
