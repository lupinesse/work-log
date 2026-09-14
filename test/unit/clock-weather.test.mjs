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
