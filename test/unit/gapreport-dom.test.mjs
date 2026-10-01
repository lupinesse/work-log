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
import { __dirname, createDom } from './_helpers.mjs';

const gapReportSrc = readFileSync(join(__dirname, '../../src/js/12c-gapreport.js'), 'utf8');

const MARKUP = `
  <button id="gapReportBtn">Gap report</button>
  <div id="gapReportOverlay" class="show">
    <button id="gapReportClose">Close</button>
    <div id="gapReportList"></div>
  </div>`;

describe('gap report overlay (jsdom)', () => {
  let window;
  let overlay;

  /** Dispatches a bubbling keydown on the overlay. */
  const pressKey = (key) =>
    overlay.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));

  beforeEach(() => {
    const dom = createDom(MARKUP);
    window = dom.window;
    overlay = window.document.getElementById('gapReportOverlay');
    vm.runInContext(gapReportSrc, dom.getInternalVMContext());
  });

  // Close the jsdom window so timers and listeners do not leak across tests.
  afterEach(() => window.close());

  it('closes the overlay on Escape', () => {
    pressKey('Escape');
    assert.equal(overlay.classList.contains('show'), false);
  });

  it('ignores other keys', () => {
    pressKey('Tab');
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
