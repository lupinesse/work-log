/**
 * @file gofore-timesheet-client.test.mjs
 * Drives src/js/26-gofore-timesheet.js in a VM sandbox: the End of Day form is
 * drafted from the day's entries, edited by the user, and posted to the local
 * server; server and network failures surface as readable status messages.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  __dirname,
  loadCatUtilsScriptSource,
  loadPureFnsScriptSource,
  withStateAccessors,
} from './_helpers.mjs';

const clientSrc = readFileSync(join(__dirname, '../../src/js/26-gofore-timesheet.js'), 'utf8')
  .replace(/^import\s[^;]*;\s*$/gm, '')
  .replace(/^export ((?:async\s+)?(?:const|function|let|class))\b/gm, '$1');
const HOUR = 3600000;

/**
 * Builds a sandbox with a minimal DOM for the timesheet form.
 * @param {Object} options - `entries`, a `fetch` stub, optional `submitEnabled` and `clipboard`.
 * @returns {Object} Sandbox with `elements` and a `click()` helper.
 */
function loadSandbox(options) {
  const { entries, fetch, submitEnabled = true } = options;
  // An explicit `clipboard: undefined` must stay undefined (non-secure pages), so don't use a default.
  const clipboard = 'clipboard' in options ? options.clipboard : {};
  const elements = {};
  const makeEl = () => ({
    value: '',
    textContent: '',
    disabled: false,
    dataset: {},
    classList: { toggle() {} },
    listeners: {},
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
  });
  [
    'eodTimesheetHours',
    'eodTimesheetDesc',
    'eodTimesheetSubmit',
    'eodTimesheetCopy',
    'eodTimesheetStatus',
  ].forEach((id) => (elements[id] = makeEl()));
  const sandbox = {
    entries,
    fetch,
    getEntries: () => entries,
    categories: [
      { id: 'work', label: 'work', color: '#aaa' },
      { id: 'meeting', label: 'meeting', color: '#bbb' },
      { id: 'other', label: 'other', color: '#888780' },
    ],
    GOFORE_SUBMIT_ENABLED: submitEnabled,
    navigator: { clipboard },
    wlLog: { info() {}, warn() {} },
    document: { getElementById: (id) => elements[id] },
    console,
    Number,
    String,
    JSON,
  };
  vm.createContext(withStateAccessors(sandbox));
  vm.runInContext(loadPureFnsScriptSource(), sandbox);
  vm.runInContext(loadCatUtilsScriptSource(), sandbox);
  vm.runInContext(clientSrc, sandbox);
  return { sandbox, elements };
}

const dayEntries = [
  { date: '2026-09-30', text: 'AITO-1: Flow', tag: 'work', ts: 0, tsEnd: 2 * HOUR },
  { date: '2026-09-30', text: 'FUAT', tag: 'meeting', ts: 2 * HOUR, tsEnd: 3 * HOUR },
  { date: '2026-09-29', text: 'Yesterday', tag: 'work', ts: 0, tsEnd: HOUR },
];

describe('End of Day timesheet form', () => {
  it('hides the submit button but keeps the draft copyable while submit is disabled', () => {
    const { sandbox, elements } = loadSandbox({
      entries: dayEntries,
      fetch: async () => ({}),
      submitEnabled: false,
    });
    sandbox.renderEodTimesheet('2026-09-30');
    assert.equal(elements.eodTimesheetSubmit.hidden, true);
    assert.equal(elements.eodTimesheetCopy.disabled, false);
    assert.equal(elements.eodTimesheetDesc.value, 'work (AITO-1: Flow), meeting (FUAT)');
  });

  it('shows the submit button when submit is enabled', () => {
    const { sandbox, elements } = loadSandbox({ entries: dayEntries, fetch: async () => ({}) });
    sandbox.renderEodTimesheet('2026-09-30');
    assert.equal(elements.eodTimesheetSubmit.hidden, false);
  });

  it('copies the description as edited by the user', async () => {
    let copied;
    const { sandbox, elements } = loadSandbox({
      entries: dayEntries,
      fetch: async () => ({}),
      clipboard: { writeText: async (text) => (copied = text) },
    });
    sandbox.renderEodTimesheet('2026-09-30');
    elements.eodTimesheetDesc.value = 'test execution (AITO-1: Flow)';
    await elements.eodTimesheetCopy.listeners.click();
    assert.equal(copied, 'test execution (AITO-1: Flow)');
    assert.match(elements.eodTimesheetStatus.textContent, /copied/);
  });

  it('keeps emoji out of the aria-live status text (regression, #545)', async () => {
    const { sandbox, elements } = loadSandbox({
      entries: dayEntries,
      fetch: async () => ({}),
      clipboard: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    });
    sandbox.renderEodTimesheet('2026-09-30');
    await elements.eodTimesheetCopy.listeners.click();
    assert.doesNotMatch(elements.eodTimesheetStatus.textContent, /\p{Extended_Pictographic}/u);
  });

  it('tells the user to copy manually when the clipboard API is missing', async () => {
    // navigator.clipboard is undefined on non-secure pages, so writeText itself is absent.
    const { sandbox, elements } = loadSandbox({
      entries: dayEntries,
      fetch: async () => ({}),
      clipboard: undefined,
    });
    sandbox.renderEodTimesheet('2026-09-30');
    await elements.eodTimesheetCopy.listeners.click();
    assert.match(elements.eodTimesheetStatus.textContent, /copy it manually/);
  });

  it('tells the user to copy manually when the clipboard is refused', async () => {
    const { sandbox, elements } = loadSandbox({
      entries: dayEntries,
      fetch: async () => ({}),
      clipboard: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    });
    sandbox.renderEodTimesheet('2026-09-30');
    await elements.eodTimesheetCopy.listeners.click();
    assert.match(elements.eodTimesheetStatus.textContent, /copy it manually/);
  });

  it('drafts hours and description from today only', () => {
    const { sandbox, elements } = loadSandbox({ entries: dayEntries, fetch: async () => ({}) });
    sandbox.renderEodTimesheet('2026-09-30');
    assert.equal(elements.eodTimesheetHours.value, '3');
    assert.equal(elements.eodTimesheetDesc.value, 'work (AITO-1: Flow), meeting (FUAT)');
    assert.equal(elements.eodTimesheetSubmit.disabled, false);
  });

  it('disables the form, including copy, when nothing was tracked', () => {
    const { sandbox, elements } = loadSandbox({ entries: [], fetch: async () => ({}) });
    sandbox.renderEodTimesheet('2026-09-30');
    assert.equal(elements.eodTimesheetSubmit.disabled, true);
    assert.equal(elements.eodTimesheetCopy.disabled, true);
    assert.match(elements.eodTimesheetStatus.textContent, /Nothing tracked/);
  });

  for (const [name, edit, expected] of [
    ['cleared hours', { hours: '' }, /hours/],
    ['a blanked description', { desc: '   ' }, /description/],
  ]) {
    it(`refuses to send ${name}`, async () => {
      let fetched = false;
      const { sandbox, elements } = loadSandbox({
        entries: dayEntries,
        fetch: async () => {
          fetched = true;
          return {};
        },
      });
      sandbox.renderEodTimesheet('2026-09-30');
      if ('hours' in edit) elements.eodTimesheetHours.value = edit.hours;
      if ('desc' in edit) elements.eodTimesheetDesc.value = edit.desc;
      await elements.eodTimesheetSubmit.listeners.click();
      assert.equal(fetched, false);
      assert.match(elements.eodTimesheetStatus.textContent, expected);
    });
  }

  it('posts the edited description and reports success', async () => {
    let request;
    const { sandbox, elements } = loadSandbox({
      entries: dayEntries,
      fetch: async (url, init) => {
        request = { url, body: JSON.parse(init.body) };
        return { ok: true, status: 200, json: async () => ({ ok: true, method: 'playwright' }) };
      },
    });
    sandbox.renderEodTimesheet('2026-09-30');
    elements.eodTimesheetDesc.value = 'test execution (AITO-1: Flow)';
    await elements.eodTimesheetSubmit.listeners.click();
    assert.equal(request.url, '/api/gofore-timesheet');
    assert.deepEqual(request.body, {
      date: '2026-09-30',
      hours: 3,
      description: 'test execution (AITO-1: Flow)',
    });
    assert.match(
      elements.eodTimesheetStatus.textContent,
      /saved for 2026-09-30 \(via Playwright fallback\)/
    );
    assert.equal(elements.eodTimesheetSubmit.disabled, false);
  });

  for (const [name, fetchStub, expected] of [
    [
      'the server error (e.g. expired sign-in)',
      async () => ({ ok: false, status: 502, json: async () => ({ error: 'sign-in expired' }) }),
      /sign-in expired/,
    ],
    [
      'an unreachable server',
      async () => {
        throw new Error('network down');
      },
      /Could not reach the local server/,
    ],
  ]) {
    it(`shows ${name}`, async () => {
      const { sandbox, elements } = loadSandbox({ entries: dayEntries, fetch: fetchStub });
      sandbox.renderEodTimesheet('2026-09-30');
      await elements.eodTimesheetSubmit.listeners.click();
      assert.match(elements.eodTimesheetStatus.textContent, expected);
      assert.equal(elements.eodTimesheetSubmit.disabled, false);
    });
  }
});
