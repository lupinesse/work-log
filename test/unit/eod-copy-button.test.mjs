/**
 * @file eod-copy-button.test.mjs
 * jsdom coverage for flashCopiedLabel() in 12a-changelog.js: the copy button
 * must return to its original label even when clicked again during the
 * "Copied!" flash (regression, #545 review).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { __dirname, createDom, assertNoUncaughtErrors } from './_helpers.mjs';

const changelogSrc = readFileSync(join(__dirname, '../../src/js/12a-changelog.js'), 'utf8');

// 12a-changelog.js binds listeners to these elements at load time.
const BOUND_IDS = [
  'eodBtn',
  'expiryBtn',
  'expirySave',
  'expiryCancel',
  'expiryOverlay',
  'expiryTextarea',
  'eodClose',
  'eodOverlay',
];
const ORIGINAL_LABEL = '<span aria-hidden="true">📋</span> copy to clipboard';
const MARKUP =
  BOUND_IDS.map((id) => `<div id="${id}"></div>`).join('') +
  `<button id="eodCopyBtn">${ORIGINAL_LABEL}</button>`;

describe('flashCopiedLabel (jsdom)', () => {
  let dom;
  let button;
  let timers;

  const flash = () => vm.runInContext('flashCopiedLabel', dom.getInternalVMContext())(button);
  const runTimers = () => timers.splice(0).forEach((callback) => callback());

  beforeEach(() => {
    dom = createDom(MARKUP);
    const context = dom.getInternalVMContext();
    timers = [];
    context.setTimeout = (callback) => timers.push(callback);
    vm.runInContext(
      'var STORE_DEV_LOG = "x"; var wlLog = { warn() {} }; var openExpiryModal = () => {}; var saveExpiryDates = () => {};',
      context
    );
    vm.runInContext(changelogSrc, context);
    button = dom.window.document.getElementById('eodCopyBtn');
  });

  afterEach(() => {
    try {
      assertNoUncaughtErrors(dom);
    } finally {
      dom.window.close();
    }
  });

  it('shows "Copied!" and then restores the original markup', () => {
    flash();
    assert.equal(button.textContent, 'Copied!');
    runTimers();
    assert.equal(button.innerHTML, ORIGINAL_LABEL);
  });

  it('restores the original label after a second click during the flash (regression)', () => {
    flash();
    flash();
    runTimers();
    assert.equal(button.innerHTML, ORIGINAL_LABEL);
  });
});
