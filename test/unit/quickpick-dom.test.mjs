/**
 * @file quickpick-dom.test.mjs
 * jsdom coverage for renderQuickPick() in 04d-render-quickpick.js. Uses the BEM
 * element names (qp-item__text, qp-item__remove, qp-wrap__restore) introduced
 * in #535 and drives the click handlers that select on them.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { __dirname, createDom, assertNoUncaughtErrors } from './_helpers.mjs';

const quickPickSrc = readFileSync(join(__dirname, '../../src/js/04d-render-quickpick.js'), 'utf8');

const MARKUP = '<div id="quickPick"></div><input id="captureInput" />';

const STUBS = `
  var entries = [
    { text: 'Write docs', tag: 'work', date: '2026-10-01' },
    { text: 'Fix bug', tag: 'dev', date: '2026-10-01' },
  ];
  var getEntries = () => entries;
  var qpHidden = new Set();
  var saveCalls = 0;
  var saveQpHidden = () => { saveCalls += 1; };
  var dk = () => '2026-10-01';
  var getIterationExpiry = () => null;
  var escHtml = (text) => String(text);
  var selectedTag = 'other';
  var setSelectedTag = (tag) => { selectedTag = tag; };
  var tagRowRenders = 0;
  var renderTagRow = () => { tagRowRenders += 1; };
`;

describe('renderQuickPick BEM element names (jsdom)', () => {
  let dom;
  let quickPick;
  const evaluate = (code) => vm.runInContext(code, dom.getInternalVMContext());

  beforeEach(() => {
    dom = createDom(MARKUP);
    const context = dom.getInternalVMContext();
    vm.runInContext(STUBS, context);
    vm.runInContext(quickPickSrc, context);
    quickPick = dom.window.document.getElementById('quickPick');
    evaluate('renderQuickPick()');
  });

  afterEach(() => {
    try {
      assertNoUncaughtErrors(dom);
    } finally {
      dom.window.close();
    }
  });

  it('emits element classes with the BEM __ separator', () => {
    assert.equal(quickPick.querySelectorAll('.qp-item__text').length, 2);
    assert.equal(quickPick.querySelectorAll('.qp-item__remove').length, 2);
  });

  it('no longer emits the single-hyphen legacy names', () => {
    assert.equal(quickPick.querySelectorAll('.qp-item-text, .qp-remove, .qp-restore').length, 0);
  });

  it('fills the capture input and selects the tag when a pill is clicked', () => {
    quickPick.querySelector('.qp-item').click();
    assert.equal(dom.window.document.getElementById('captureInput').value, 'Fix bug');
    assert.equal(evaluate('selectedTag'), 'dev');
  });

  it('hides a task from the list when its remove control is clicked (and does not select it)', () => {
    quickPick.querySelector('.qp-item__remove').click();
    assert.equal(evaluate('qpHidden.has("fix bug")'), true);
    assert.equal(evaluate('saveCalls'), 1);
    assert.equal(dom.window.document.getElementById('captureInput').value, '');
    assert.equal(quickPick.querySelectorAll('.qp-item').length, 1);
  });

  it('offers a restore control after hiding, and restores everything when clicked', () => {
    quickPick.querySelector('.qp-item__remove').click();
    const restore = quickPick.querySelector('.qp-wrap__restore');
    assert.ok(restore, 'restore button rendered with the new class');
    restore.click();
    assert.equal(evaluate('qpHidden.size'), 0);
    assert.equal(quickPick.querySelectorAll('.qp-item').length, 2);
  });
});
