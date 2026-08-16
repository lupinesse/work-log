/**
 * @file dailylog.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname } from './_helpers.mjs';

const dailylogSrc = readFileSync(join(__dirname, '../../src/js/18-dailylog.js'), 'utf8');

/**
 * Minimal VM sandbox for buildDailyLogItems.
 * @param {object} overrides
 */
function loadDailylogSandbox(overrides = {}) {
  const sb = {
    entries: [],
    logNotes: [],
    planTasks: [],
    getCat: () => ({ label: 'work', color: '#378ADD' }),
    escHtml: (s) => String(s),
    dk: (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },
    fmtDur: (ms) => `${Math.round(ms / 60000)}m`,
    sigSymbol: () => '',
    wlLog: { info: () => {}, warn: () => {}, error: () => {} },
    renderTodayFlow: () => {},
    saveLogNotes: () => {},
    document: { getElementById: () => null },
    ...overrides,
  };
  vm.createContext(sb);
  vm.runInContext(dailylogSrc, sb);
  return sb;
}

describe('buildDailyLogItems — session-note partitioning', () => {
  const TODAY = '2026-06-01';

  it('emits type "note" for regular log notes', () => {
    const sb = loadDailylogSandbox();
    sb.logNotes = [{ id: 'n1', text: 'standup', ts: 1000, date: TODAY, type: 'note' }];
    const items = sb.buildDailyLogItems(TODAY);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'note');
    assert.ok(items[0].text.includes('standup'), 'note text preserved');
  });

  it('emits type "session-note" with parentEntryId for session notes', () => {
    const sb = loadDailylogSandbox();
    sb.logNotes = [
      {
        id: 'sn1',
        text: 'checked logs',
        ts: 2000,
        date: TODAY,
        type: 'session-note',
        entryId: 'e42',
      },
    ];
    const items = sb.buildDailyLogItems(TODAY);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'session-note');
    assert.equal(items[0].parentEntryId, 'e42');
    assert.equal(items[0].text, 'checked logs');
  });

  it('does not wrap session-note text in <em>', () => {
    const sb = loadDailylogSandbox();
    sb.logNotes = [
      { id: 'sn2', text: 'raw text', ts: 3000, date: TODAY, type: 'session-note', entryId: 'e1' },
    ];
    const items = sb.buildDailyLogItems(TODAY);
    assert.ok(!items[0].text.includes('<em>'), 'no <em> wrapper for session notes');
  });

  it('wraps regular note text in <em>', () => {
    const sb = loadDailylogSandbox();
    sb.logNotes = [{ id: 'n2', text: 'a thought', ts: 4000, date: TODAY, type: 'note' }];
    const items = sb.buildDailyLogItems(TODAY);
    assert.ok(items[0].text.includes('<em>'), 'regular note wrapped in <em>');
  });

  it('excludes notes from other days', () => {
    const sb = loadDailylogSandbox();
    sb.logNotes = [
      {
        id: 'sn3',
        text: 'yesterday',
        ts: 5000,
        date: '2026-05-31',
        type: 'session-note',
        entryId: 'e1',
      },
    ];
    const items = sb.buildDailyLogItems(TODAY);
    assert.equal(items.length, 0);
  });

  it('returns both entry items and session-note items sorted by ts', () => {
    const sb = loadDailylogSandbox();
    sb.entries = [{ id: 'e1', text: 'Big task', tag: 'work', ts: 1000, date: TODAY, tsEnd: 5000 }];
    sb.logNotes = [
      {
        id: 'sn1',
        text: 'progress update',
        ts: 3000,
        date: TODAY,
        type: 'session-note',
        entryId: 'e1',
      },
    ];
    const items = sb.buildDailyLogItems(TODAY);
    assert.equal(items.length, 2);
    assert.equal(items[0].type, 'entry');
    assert.equal(items[1].type, 'session-note');
    assert.equal(items[1].parentEntryId, 'e1');
  });
});
