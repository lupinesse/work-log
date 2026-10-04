/**
 * @file parked-id-escape.test.mjs
 * Regression tests for #624: renderParked() in 12-misc.js must escape
 * thought.id through escHtml() before interpolating it into data-id HTML
 * attributes. Raw interpolation lets a localStorage-controlled id containing
 * HTML meta-characters break the attribute context.
 *
 * Run: node --test test/unit/parked-id-escape.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { __dirname, extractFunctionSource, loadPureFnsScriptSource } from './_helpers.mjs';

const renderParkedSrc = extractFunctionSource(
  readFileSync(join(__dirname, '../../src/js/12-misc.js'), 'utf8'),
  'renderParked'
);

/**
 * Builds a VM sandbox for renderParked() with minimal DOM stubs.
 *
 * @param {object[]} [thoughts=[]] - Parked thoughts to populate parkedThoughts state.
 * @returns {{ sandbox: object, getHtml: () => string, sectionEl: object, badgeEl: object }}
 */
function loadSandbox(thoughts = []) {
  let _html = '';
  const listEl = {
    get innerHTML() {
      return _html;
    },
    set innerHTML(v) {
      _html = v;
    },
    querySelectorAll: () => [],
  };
  const sectionEl = { style: { display: 'none' } };
  const badgeEl = { textContent: '' };

  const sandbox = {
    parkedThoughts: [...thoughts],
    document: {
      getElementById(id) {
        if (id === 'parkList') return listEl;
        if (id === 'parkSection') return sectionEl;
        if (id === 'parkBadge') return badgeEl;
        return null;
      },
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(loadPureFnsScriptSource(), sandbox);
  vm.runInContext(renderParkedSrc, sandbox);

  return { sandbox, getHtml: () => _html, sectionEl, badgeEl };
}

describe('renderParked — thought.id escaping (#624)', () => {
  it('renders a plain numeric id into data-id unchanged', () => {
    const { sandbox, getHtml } = loadSandbox([
      { id: '1700000000000', text: 'Buy milk', done: false },
    ]);
    sandbox.renderParked();
    assert.match(getHtml(), /data-id="1700000000000"/);
  });

  it('escapes a double-quote in id so the attribute context is not broken — #624 regression', () => {
    const { sandbox, getHtml } = loadSandbox([{ id: 'foo"bar', text: 'Thought', done: false }]);
    sandbox.renderParked();
    const html = getHtml();
    // Raw double-quote must not appear inside the attribute value
    assert.doesNotMatch(html, /data-id="foo"bar/);
    // HTML entity must appear instead
    assert.match(html, /data-id="foo&quot;bar"/);
  });

  it('escapes angle brackets in id — #624 regression', () => {
    const { sandbox, getHtml } = loadSandbox([
      { id: '"><script>alert(1)</script>', text: 'Thought', done: false },
    ]);
    sandbox.renderParked();
    const html = getHtml();
    // Raw unencoded tags must not appear in the attribute value
    assert.doesNotMatch(html, /data-id="[^"]*<script>/i);
    // Encoded form of the opening `">` must appear in all three data-id slots
    assert.match(html, /data-id="&quot;&gt;&lt;script&gt;/);
  });

  it('escapes all three data-id occurrences (container div, promote btn, dismiss btn)', () => {
    const { sandbox, getHtml } = loadSandbox([{ id: 'a"b', text: 'X', done: false }]);
    sandbox.renderParked();
    const html = getHtml();
    const encoded = (html.match(/data-id="a&quot;b"/g) || []).length;
    assert.strictEqual(encoded, 3, 'expected escaping on all three data-id sites');
  });

  it('hides section and writes no HTML when all thoughts are done', () => {
    const { sandbox, getHtml, sectionEl } = loadSandbox([{ id: '1', text: 'Done', done: true }]);
    sandbox.renderParked();
    assert.strictEqual(sectionEl.style.display, 'none');
    assert.strictEqual(getHtml(), '');
  });

  it('shows section and updates badge when there are open thoughts', () => {
    const { sandbox, sectionEl, badgeEl } = loadSandbox([
      { id: '1', text: 'A', done: false },
      { id: '2', text: 'B', done: false },
      { id: '3', text: 'C', done: true },
    ]);
    sandbox.renderParked();
    assert.strictEqual(sectionEl.style.display, '');
    assert.strictEqual(badgeEl.textContent, 2);
  });
});
