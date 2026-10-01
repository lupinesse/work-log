/**
 * @file _helpers.mjs
 * Shared fixtures for test/unit/*.test.mjs, extracted from the former
 * monolithic test/unit.mjs (issue #334). __dirname is exported so every
 * sandbox-loading test file can resolve src/js/ paths without repeating
 * the dirname(fileURLToPath(import.meta.url)) boilerplate.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

export const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Builds a Date in the local timezone from calendar fields, avoiding the
 * UTC-parsing pitfalls of `new Date(isoString)` in tests that assert on
 * local wall-clock time.
 *
 * @param {number} y - Full year.
 * @param {number} m - 1-based month (1 = January).
 * @param {number} d - Day of month.
 * @param {number} [hh] - Hours (0-23).
 * @param {number} [mm] - Minutes.
 * @param {number} [ss] - Seconds.
 * @returns {Date}
 */
export function localDate(y, m, d, hh = 0, mm = 0, ss = 0) {
  return new Date(y, m - 1, d, hh, mm, ss, 0);
}

/**
 * Same as {@link localDate}, returned as epoch milliseconds.
 *
 * @param {number} y - Full year.
 * @param {number} m - 1-based month (1 = January).
 * @param {number} d - Day of month.
 * @param {number} [hh] - Hours (0-23).
 * @param {number} [mm] - Minutes.
 * @param {number} [ss] - Seconds.
 * @returns {number}
 */
export function localMs(y, m, d, hh = 0, mm = 0, ss = 0) {
  return localDate(y, m, d, hh, mm, ss).getTime();
}

/**
 * Gives a VM sandbox the accessor pairs that state.js provides in the real
 * bundle (#423), each backed by the sandbox's own property of the same name:
 * `getEntries`/`setEntries` over `sandbox.entries`, and
 * `getActiveTimer`/`setActiveTimer` over `sandbox.activeTimer`, and
 * `getCategories`/`setCategories` over `sandbox.categories`. The app files
 * under test read and write these only through the accessors, so a sandbox
 * that sets `entries`, `activeTimer` or `categories` keeps working unchanged: a
 * `setActiveTimer(next)` shows up as `sandbox.activeTimer`, and vice versa.
 *
 * Each variable moved onto state.js adds one pair here, so a test never needs
 * to know which variables have migrated yet.
 *
 * Call it before `vm.createContext(sandbox)`; it returns the same object so it
 * can wrap the call.
 * @param {object} sandbox - The sandbox object about to become a VM context.
 * @returns {object} The same sandbox, with the accessor pairs added.
 */
export function withStateAccessors(sandbox) {
  sandbox.getEntries = () => sandbox.entries;
  sandbox.setEntries = (next) => {
    sandbox.entries = next;
  };
  sandbox.getActiveTimer = () => sandbox.activeTimer;
  sandbox.setActiveTimer = (next) => {
    sandbox.activeTimer = next;
  };
  sandbox.getCategories = () => sandbox.categories;
  sandbox.setCategories = (next) => {
    sandbox.categories = next;
  };
  return sandbox;
}

/**
 * Reads the pure-fns sub-modules as classic-script source for the VM sandboxes.
 * pure-fns.js is a barrel of `export { … } from …` re-exports, which are not
 * valid classic-script syntax, so the sandboxes concatenate the sub-modules
 * instead and strip the ESM import lines and `export` declaration prefixes.
 * @returns {string} Concatenated pure-fns source, safe for vm.runInContext.
 */
export function loadPureFnsScriptSource() {
  return (
    [
      'pure-fns-format.js',
      'pure-fns-validate.js',
      'pure-fns-tasks.js',
      'pure-fns-timesheet.js',
      'pure-fns-export.js',
      'pure-fns-gapreport.js',
      'pure-fns-weeklyreport.js',
      'pure-fns-rollingsummary.js',
      'pure-fns-backup.js',
      'pure-fns-epics.js',
    ]
      .map((f) => readFileSync(join(__dirname, '../../src/js/' + f), 'utf8'))
      .join('\n')
      .replace(/^import\s[^;]*;\s*$/gm, '') // single-line imports only; all sub-module imports are single-line
      // eslint-disable-next-line security/detect-unsafe-regex -- strips export keywords from our own pure-fns source; trusted input, no nested quantifiers
      .replace(/^export ((?:async\s+)?(?:const|function|let|class))\b/gm, '$1')
  );
}

/**
 * Reads the render-family classic-script files as one concatenated source,
 * in the same order build.js's alphabetical `readdirSync().sort()` puts them
 * in the real bundle. Split from the former monolithic 04-render.js (QA
 * finding: module size) into five sibling files that share one script-scope
 * — render() itself, plus renderHeaderAndTimerSection(), live in
 * 04-render.js; the rest are grouped by concern in 04a-04d. A VM sandbox
 * that only loads 04-render.js no longer sees the functions it calls, so
 * every render.test.mjs sandbox needs all five, exactly as the real bundle
 * does.
 * @returns {string} Concatenated render-family source, safe for vm.runInContext.
 */
export function loadRenderScriptSource() {
  return [
    '04-render.js',
    '04a-render-entry-meta.js',
    '04b-render-stats.js',
    '04c-render-timeline.js',
    '04d-render-quickpick.js',
  ]
    .map((f) => readFileSync(join(__dirname, '../../src/js/' + f), 'utf8'))
    .join('\n');
}

/**
 * Builds a jsdom window for DOM/event unit tests. `runScripts: 'outside-only'`
 * lets a test evaluate a src/js/ classic-script file inside the window via
 * `vm.runInContext(src, dom.getInternalVMContext())` without executing any
 * inline <script> in the markup.
 * @param {string} [html] - Markup for the document body.
 * @returns {import('jsdom').JSDOM} The JSDOM instance (`.window`, `.window.document`).
 */
export function createDom(html = '') {
  return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
    runScripts: 'outside-only',
  });
}

/**
 * Gives a jsdom window a stand-in for layout. jsdom has no layout engine, so
 * `HTMLElement.offsetParent` is always null and focus-trap code that filters
 * on `offsetParent !== null` would see no focusable elements at all. Every
 * element reports its parent node instead; tests hide an element by
 * overriding the property on that instance.
 * @param {Window} window - A jsdom window, e.g. `createDom().window`.
 * @returns {void}
 */
export function stubOffsetParent(window) {
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.parentNode;
    },
  });
}
