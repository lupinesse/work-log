/**
 * @file focus-trap-dom.test.mjs
 * jsdom tests for the Tab / Shift+Tab focus trap (WCAG 2.1.2), issue #553.
 * `trapFocusInOverlay` lives in the leaf module `focus-utils.js` (extracted
 * from 02-utils.js in issue #336, extraction #17). The same table of
 * behaviours runs against two consumers through their real overlay keydown
 * handlers: `12c-gapreport.js` (concatenated, receives the function from the
 * bundle) and `12d-weeklyreport.js` (ES module, imports it directly).
 */

import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { __dirname, createDom, stubOffsetParent, assertNoUncaughtErrors } from './_helpers.mjs';

// 12d-weeklyreport.js reads `document` / `localStorage` as globals; restore them
// afterwards so this file leaves the process as it found it.
const originalGlobals = { document: globalThis.document, localStorage: globalThis.localStorage };
after(() => {
  for (const [name, value] of Object.entries(originalGlobals)) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
});

const readSrc = (file) => readFileSync(join(__dirname, '../../src/js/', file), 'utf8');

/** Strips ESM syntax so a leaf module can run in a VM classic-script context. */
function stripEsm(source) {
  return source
    .replace(/^import\s[^;]*;\s*$/gm, '')
    .replace(/^export ((?:async\s+)?(?:const|function|let|class))\b/gm, '$1');
}

const FOCUSABLES = `
  <button id="first">First</button>
  <button id="middle">Middle</button>
  <button id="disabled" disabled>Disabled</button>
  <button id="last">Last</button>`;

/** Each adapter mounts an open overlay wired to the implementation under test. */
const IMPLEMENTATIONS = [
  {
    name: 'focus-utils.js via 12c-gapreport.js',
    overlayId: 'gapReportOverlay',
    async mount(inner) {
      const dom = createDom(
        `<button id="gapReportBtn">Open</button>
         <div id="gapReportOverlay" class="show">${inner}</div>`
      );
      stubOffsetParent(dom.window);
      const context = dom.getInternalVMContext();
      vm.runInContext(stripEsm(readSrc('focus-utils.js')), context);
      vm.runInContext(readSrc('12c-gapreport.js'), context);
      return dom;
    },
  },
  {
    name: '12d-weeklyreport.js',
    overlayId: 'weeklyReportOverlay',
    async mount(inner) {
      const dom = createDom(
        `<button id="weeklyReportBtn">Open</button>
         <div id="weeklyReportOverlay" class="show">${inner}</div>`
      );
      stubOffsetParent(dom.window);
      globalThis.document = dom.window.document;
      globalThis.localStorage ??= { getItem: () => null, setItem: () => {} };
      const { initWeeklyReport } = await import('../../src/js/12d-weeklyreport.js');
      initWeeklyReport();
      return dom;
    },
  },
];

for (const impl of IMPLEMENTATIONS) {
  describe(`focus trap: ${impl.name}`, () => {
    let dom;
    let window;
    let overlay;

    const byId = (id) => window.document.getElementById(id);

    /** Focuses `id`, presses Tab, and returns the dispatched event. */
    const pressTab = (id, { shiftKey = false } = {}) => {
      byId(id).focus();
      const event = new window.KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      overlay.dispatchEvent(event);
      return event;
    };

    beforeEach(async () => {
      dom = await impl.mount(FOCUSABLES);
      window = dom.window;
      overlay = byId(impl.overlayId);
    });

    afterEach(() => {
      assertNoUncaughtErrors(dom);
    });

    it('sees focusable elements at all (guards against a vacuous pass)', () => {
      byId('first').focus();
      assert.equal(window.document.activeElement, byId('first'));
      assert.notEqual(byId('first').offsetParent, null);
    });

    it('wraps Tab from the last element to the first', () => {
      const event = pressTab('last');
      assert.equal(event.defaultPrevented, true);
      assert.equal(window.document.activeElement, byId('first'));
    });

    it('wraps Shift+Tab from the first element to the last', () => {
      const event = pressTab('first', { shiftKey: true });
      assert.equal(event.defaultPrevented, true);
      assert.equal(window.document.activeElement, byId('last'));
    });

    for (const [label, id, shiftKey] of [
      ['Tab on the first element', 'first', false],
      ['Tab on a middle element', 'middle', false],
      ['Shift+Tab on a middle element', 'middle', true],
      ['Shift+Tab on the last element', 'last', true],
    ]) {
      it(`leaves native order alone for ${label}`, () => {
        const event = pressTab(id, { shiftKey });
        assert.equal(event.defaultPrevented, false);
        assert.equal(window.document.activeElement, byId(id));
      });
    }

    it('skips disabled buttons and tabindex="-1" non-buttons when finding the edges', async () => {
      const dom = await impl.mount(
        `<button id="first">First</button><button id="last">Last</button>
         <button id="disabled" disabled>Disabled</button>
         <div id="skipped" tabindex="-1">Skipped</div>`
      );
      window = dom.window;
      overlay = byId(impl.overlayId);
      assert.equal(pressTab('last').defaultPrevented, true);
      assert.equal(window.document.activeElement, byId('first'));
    });

    // Regression (#556): `button:not([disabled])` used to match tabindex="-1"
    // controls, making an untabbable element the trap's edge.
    for (const [label, untabbable] of [
      ['button', (id) => `<button id="${id}" tabindex="-1"></button>`],
      ['input', (id) => `<input id="${id}" tabindex="-1">`],
      ['link', (id) => `<a id="${id}" href="#" tabindex="-1"></a>`],
    ]) {
      it(`ignores a tabindex="-1" ${label} at either edge`, async () => {
        const dom = await impl.mount(
          `${untabbable('phantomFirst')}
           <button id="first">First</button><button id="last">Last</button>
           ${untabbable('phantomLast')}`
        );
        window = dom.window;
        overlay = byId(impl.overlayId);
        assert.equal(pressTab('last').defaultPrevented, true);
        assert.equal(window.document.activeElement, byId('first'));
        assert.equal(pressTab('first', { shiftKey: true }).defaultPrevented, true);
        assert.equal(window.document.activeElement, byId('last'));
      });
    }

    it('does not throw or prevent default when nothing is focusable', async () => {
      const dom = await impl.mount('<p id="text">No controls</p>');
      window = dom.window;
      overlay = byId(impl.overlayId);
      const event = new window.KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      overlay.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
    });
  });
}
