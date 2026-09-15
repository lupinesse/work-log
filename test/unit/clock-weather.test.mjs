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
import { escHtml } from '../../src/js/pure-fns-format.js';

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

/**
 * Loads just isJiraTicketText()/jiraTicketHtml() from 09-clock-weather.js,
 * not the whole file — its top level unconditionally calls tickClock() and
 * setInterval(), which would need a much larger DOM/render stub surface
 * unrelated to these two pure functions. Same source-slice approach
 * runAutoPauseHandler() above already uses for 07-lifecycle.js.
 * @returns {object} Sandbox exposing isJiraTicketText and jiraTicketHtml.
 */
function loadJiraTicketFns() {
  const src = readFileSync(join(__dirname, '../../src/js/09-clock-weather.js'), 'utf8');
  const match = src.match(
    /const JIRA_TICKET_TEXT_PATTERN[\s\S]*?\nfunction jiraTicketHtml[\s\S]*?\n}/
  );
  if (!match)
    throw new Error('isJiraTicketText/jiraTicketHtml block not found in 09-clock-weather.js');
  const sandbox = {
    escHtml,
    JIRA_BASE: 'https://example.atlassian.net/browse',
  };
  vm.createContext(sandbox);
  vm.runInContext(match[0], sandbox);
  return sandbox;
}

describe('isJiraTicketText / jiraTicketHtml', () => {
  it('isJiraTicketText matches a bare ticket key', () => {
    const sb = loadJiraTicketFns();
    assert.equal(sb.isJiraTicketText('PROJ-123'), true);
  });

  it('isJiraTicketText matches a ticket key followed by descriptive text', () => {
    const sb = loadJiraTicketFns();
    assert.equal(sb.isJiraTicketText('PROJ-123: fix the thing'), true);
  });

  it('isJiraTicketText is false for plain text with no ticket key', () => {
    const sb = loadJiraTicketFns();
    assert.equal(sb.isJiraTicketText('Just a normal task'), false);
  });

  it('isJiraTicketText and jiraTicketHtml agree on whether a link is rendered', () => {
    // The two are read from the same extracted block, so verifying they stay
    // in sync is really guarding against a future edit to one regressing —
    // the property #431/#432 introduced this predicate specifically to keep.
    const sb = loadJiraTicketFns();
    for (const text of ['PROJ-123', 'PROJ-123: fix the thing', 'not a ticket', '']) {
      const rendersLink = sb.jiraTicketHtml(text).includes('jira-key-link');
      assert.equal(
        sb.isJiraTicketText(text),
        rendersLink,
        `mismatch for ${JSON.stringify(text)}: isJiraTicketText=${sb.isJiraTicketText(text)}, rendersLink=${rendersLink}`
      );
    }
  });

  it('jiraTicketHtml renders the key as a link and escapes the rest', () => {
    const sb = loadJiraTicketFns();
    const html = sb.jiraTicketHtml('PROJ-123: fix <the> thing');
    assert.match(
      html,
      /<a class="jira-key-link" href="https:\/\/example\.atlassian\.net\/browse\/PROJ-123"/
    );
    assert.match(html, /fix &lt;the&gt; thing/);
  });
});
