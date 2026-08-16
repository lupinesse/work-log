/**
 * @file clock-weather.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname } from './_helpers.mjs';

const clockSrc = readFileSync(join(__dirname, '../../src/js/09-clock-weather.js'), 'utf8');

const trackingFuncSrc = (() => {
  // Grab from the JSDoc comment before updateHeaderTracking through the next
  // top-level comment (// WEATHER_LAT …).
  const fnIdx = clockSrc.indexOf('function updateHeaderTracking()');
  if (fnIdx === -1) throw new Error('updateHeaderTracking not found in 09-clock-weather.js');
  const docStart = clockSrc.lastIndexOf('/**', fnIdx);
  const blockEnd = clockSrc.indexOf('\n// WEATHER_LAT', fnIdx);
  return clockSrc.slice(docStart, blockEnd > -1 ? blockEnd : undefined);
})();

/**
 * Creates a minimal VM sandbox for testing updateHeaderTracking.
 * The function is now a no-op; the sandbox only needs to execute the source.
 * @returns {{ updateHeaderTracking: Function, _elements: Record<string, object> }}
 */
function loadHeaderTrackingSandbox() {
  const elements = {};
  const sb = {
    // DOM stub — records any getElementById calls so tests can assert none are made
    document: {
      getElementById: (id) => {
        if (!elements[id]) elements[id] = { textContent: '', style: {} };
        return elements[id];
      },
    },
  };
  vm.createContext(sb);
  vm.runInContext(trackingFuncSrc, sb);
  sb._elements = elements;
  return sb;
}

describe('updateHeaderTracking', () => {
  it('does not throw when called with an empty DOM', () => {
    const sb = loadHeaderTrackingSandbox();
    assert.doesNotThrow(() => sb.updateHeaderTracking());
  });

  it('does not create or modify any DOM elements', () => {
    const sb = loadHeaderTrackingSandbox();
    sb.updateHeaderTracking();
    assert.deepEqual(sb._elements, {});
  });
});

function runAutoPauseHandler({ autoPauseEnabled, hidden, timerRunning, timerPaused = false }) {
  const lifecycleSrc = readFileSync(join(__dirname, '../../src/js/07-lifecycle.js'), 'utf8');
  const handlerMatch = lifecycleSrc.match(
    /document\.addEventListener\('visibilitychange',\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*\);/
  );
  if (!handlerMatch) throw new Error('visibilitychange listener not found in 07-lifecycle.js');
  const pausedCalls = [];
  const box = {
    AUTO_PAUSE_ON_TAB_SWITCH: autoPauseEnabled,
    document: { hidden },
    activeTimer: timerRunning ? { paused: timerPaused } : null,
    pauseTimer: () => pausedCalls.push(true),
    wlLog: { info: () => {} },
  };
  vm.createContext(box);
  vm.runInContext(`(function(){${handlerMatch[1]}})()`, box);
  return pausedCalls;
}

describe('auto-pause on visibilitychange', () => {
  it('calls pauseTimer when tab hides with a running timer and feature enabled', () => {
    const calls = runAutoPauseHandler({
      autoPauseEnabled: true,
      hidden: true,
      timerRunning: true,
      timerPaused: false,
    });
    assert.equal(calls.length, 1);
  });

  it('does not pause when AUTO_PAUSE_ON_TAB_SWITCH is false', () => {
    const calls = runAutoPauseHandler({
      autoPauseEnabled: false,
      hidden: true,
      timerRunning: true,
      timerPaused: false,
    });
    assert.equal(calls.length, 0);
  });

  it('does not pause when the tab becomes visible (hidden=false)', () => {
    const calls = runAutoPauseHandler({
      autoPauseEnabled: true,
      hidden: false,
      timerRunning: true,
      timerPaused: false,
    });
    assert.equal(calls.length, 0);
  });

  it('does not pause when no active timer', () => {
    const calls = runAutoPauseHandler({
      autoPauseEnabled: true,
      hidden: true,
      timerRunning: false,
    });
    assert.equal(calls.length, 0);
  });

  it('does not pause when timer is already paused', () => {
    const calls = runAutoPauseHandler({
      autoPauseEnabled: true,
      hidden: true,
      timerRunning: true,
      timerPaused: true,
    });
    assert.equal(calls.length, 0);
  });
});
