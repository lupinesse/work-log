/**
 * @file gapreport-dom.test.mjs
 * Reference jsdom test (issue #465): loads 12c-gapreport.js into a real DOM
 * and drives its overlay with dispatched events, covering behaviour the
 * VM-sandbox tests cannot reach.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { __dirname, createDom, stubOffsetParent, assertNoUncaughtErrors } from './_helpers.mjs';

const gapReportSrc = readFileSync(join(__dirname, '../../src/js/12c-gapreport.js'), 'utf8');
// 12c calls trapFocusInOverlay, which the real bundle imports from the leaf
// module focus-utils.js; strip its ESM syntax so the sandbox gets it too (#602).
const focusUtilsSrc = readFileSync(join(__dirname, '../../src/js/focus-utils.js'), 'utf8').replace(
  /^export function/m,
  'function'
);

const MARKUP = `
  <button id="gapReportBtn">Gap report</button>
  <div id="gapReportOverlay" class="show">
    <button id="gapReportClose">Close</button>
    <button id="gapReportLast">Last</button>
    <div id="gapReportList"></div>
  </div>`;

describe('gap report overlay (jsdom)', () => {
  let dom;
  let window;
  let overlay;

  /** Dispatches a bubbling keydown on the overlay. */
  const pressKey = (key) =>
    overlay.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));

  beforeEach(() => {
    dom = createDom(MARKUP);
    window = dom.window;
    stubOffsetParent(window);
    overlay = window.document.getElementById('gapReportOverlay');
    vm.runInContext(focusUtilsSrc, dom.getInternalVMContext());
    vm.runInContext(gapReportSrc, dom.getInternalVMContext());
  });

  // A handler that throws would otherwise only be logged by jsdom (#602).
  afterEach(() => {
    assertNoUncaughtErrors(dom);
    // Close the jsdom window so timers and listeners do not leak across tests.
    window.close();
  });

  it('closes the overlay on Escape', () => {
    pressKey('Escape');
    assert.equal(overlay.classList.contains('show'), false);
  });

  it('ignores other keys', () => {
    pressKey('Home');
    assert.equal(overlay.classList.contains('show'), true);
  });

  it('keeps Tab inside the dialog by wrapping from the last control to the first (#602)', () => {
    const last = window.document.getElementById('gapReportLast');
    last.focus();
    const event = new window.KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    overlay.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(window.document.activeElement, window.document.getElementById('gapReportClose'));
    assert.equal(overlay.classList.contains('show'), true);
  });

  it('closes when the backdrop is clicked but not when inner content is', () => {
    window.document.getElementById('gapReportList').click();
    assert.equal(overlay.classList.contains('show'), true);
    overlay.click();
    assert.equal(overlay.classList.contains('show'), false);
  });

  it('closes via the close button', () => {
    window.document.getElementById('gapReportClose').click();
    assert.equal(overlay.classList.contains('show'), false);
  });
});
