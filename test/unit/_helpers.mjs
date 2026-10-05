/**
 * @file _helpers.mjs
 * Shared fixtures for test/unit/*.test.mjs, extracted from the former
 * monolithic test/unit.mjs (issue #334). __dirname is exported so every
 * sandbox-loading test file can resolve src/js/ paths without repeating
 * the dirname(fileURLToPath(import.meta.url)) boilerplate.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

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
 * `getEntries`/`setEntries` over `sandbox.entries`,
 * `getActiveTimer`/`setActiveTimer` over `sandbox.activeTimer`,
 * `getCategories`/`setCategories` over `sandbox.categories`,
 * `getSelectedTag`/`setSelectedTag` over `sandbox.selectedTag`,
 * `getViewDate`/`setViewDate` over `sandbox.viewDate`,
 * `getBlocks`/`setBlocks` over `sandbox.blocks`,
 * `getPlanTasks`/`setPlanTasks` over `sandbox.planTasks`, and
 * `getLogNotes`/`setLogNotes` over `sandbox.logNotes`.
 *
 * The app files under test read and write these only through the accessors, so
 * a sandbox that sets one of those properties keeps working unchanged: a
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
  sandbox.getSelectedTag = () => sandbox.selectedTag;
  sandbox.setSelectedTag = (next) => {
    sandbox.selectedTag = next;
  };
  sandbox.getViewDate = () => sandbox.viewDate;
  sandbox.setViewDate = (next) => {
    sandbox.viewDate = next;
  };
  sandbox.getBlocks = () => sandbox.blocks;
  sandbox.setBlocks = (next) => {
    sandbox.blocks = next;
  };
  sandbox.getPlanTasks = () => sandbox.planTasks;
  sandbox.setPlanTasks = (next) => {
    sandbox.planTasks = next;
  };
  sandbox.getLogNotes = () => sandbox.logNotes;
  sandbox.setLogNotes = (next) => {
    sandbox.logNotes = next;
  };
  return sandbox;
}

/**
 * Strips ESM `import` declarations and `export` keyword prefixes from a source
 * string so the module can be evaluated as a classic script in a VM context via
 * `vm.runInContext`. Handles single-line import statements and the common
 * `export const|function|let|class` prefix form.
 * @param {string} source - The ESM source text to strip.
 * @returns {string} The source with ESM syntax removed, safe for vm.runInContext.
 */
export function stripEsmSyntax(source) {
  return (
    source
      .replace(/^import\s[^;]*;\s*$/gm, '')
      // eslint-disable-next-line security/detect-unsafe-regex -- strips export keywords from our own source files; trusted input, no nested quantifiers
      .replace(/^export ((?:async\s+)?(?:const|function|let|class))\b/gm, '$1')
  );
}

/**
 * Reads `cat-utils.js` as classic-script source for VM sandboxes.
 * Strips the ESM import lines and `export` declaration prefixes so the file
 * can be evaluated with `vm.runInContext`. Requires `safeCssColor` (from
 * `loadPureFnsScriptSource`) and `getCategories` (from `withStateAccessors`)
 * to already be in the sandbox context before calling the resulting functions.
 * @returns {string} cat-utils.js source, safe for vm.runInContext.
 */
export function loadCatUtilsScriptSource() {
  return stripEsmSyntax(readFileSync(join(__dirname, '../../src/js/cat-utils.js'), 'utf8'));
}

/**
 * Reads `entry-billable.js` as classic-script source for VM sandboxes.
 * Strips the ESM import lines and `export` declaration prefixes so the file
 * can be evaluated with `vm.runInContext`. Requires `getPlanTasks` (from
 * `withStateAccessors`) and `getCat` (from the sandbox) to already be in the
 * sandbox context before calling the resulting functions.
 * @returns {string} entry-billable.js source, safe for vm.runInContext.
 */
export function loadEntryBillableScriptSource() {
  return readFileSync(join(__dirname, '../../src/js/entry-billable.js'), 'utf8')
    .replace(/^import\s[^;]*;\s*$/gm, '')
    .replace(/^export ((?:async\s+)?(?:const|function|let|class))\b/gm, '$1');
}

/**
 * Reads `entry-utils.js` as classic-script source for VM sandboxes.
 * Strips the ESM import lines and `export` declaration prefixes so the file
 * can be evaluated with `vm.runInContext`. Requires `dk`, `roundToNearest30`
 * (from `loadPureFnsScriptSource`) and `getEntries`, `getViewDate`
 * (from `withStateAccessors`) to already be in the sandbox before calling the
 * resulting functions.
 * @returns {string} entry-utils.js source, safe for vm.runInContext.
 */
export function loadEntryUtilsScriptSource() {
  return readFileSync(join(__dirname, '../../src/js/entry-utils.js'), 'utf8')
    .replace(/^import\s[^;]*;\s*$/gm, '')
    .replace(/^export ((?:async\s+)?(?:const|function|let|class))\b/gm, '$1');
}

/**
 * Returns the full text of a top-level function declaration from a source
 * string, found by matching braces from its opening line. Lets a test run one
 * function from a concatenated-bundle file without evaluating the file's
 * top-level DOM wiring.
 * @param {string} source - File contents to search.
 * @param {string} name - Function name to extract.
 * @returns {string} The function's source, from `function` to its closing brace.
 */
export function extractFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found`);
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
    if (source[index] === '{') depth += 1;
    // eslint-disable-next-line security/detect-object-injection -- test fixture — key is a known constant, not external input
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

/**
 * Reads the pure-fns sub-modules as classic-script source for the VM sandboxes.
 * pure-fns.js is a barrel of `export { … } from …` re-exports, which are not
 * valid classic-script syntax, so the sandboxes concatenate the sub-modules
 * instead and strip the ESM import lines and `export` declaration prefixes.
 * @returns {string} Concatenated pure-fns source, safe for vm.runInContext.
 */
export function loadPureFnsScriptSource() {
  const source = [
    'pure-fns-format.js',
    'pure-fns-validate.js',
    'pure-fns-tasks.js',
    'pure-fns-hours-entry.js',
    'pure-fns-export.js',
    'pure-fns-gapreport.js',
    'pure-fns-weeklyreport.js',
    'pure-fns-rollingsummary.js',
    'pure-fns-backup.js',
    'pure-fns-epics.js',
  ]
    .map((f) => readFileSync(join(__dirname, '../../src/js/' + f), 'utf8'))
    .join('\n');
  // All sub-module imports are single-line; stripEsmSyntax handles them correctly.
  return stripEsmSyntax(source);
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
 *
 * jsdom swallows an exception thrown inside an event listener and only logs
 * it, so a broken handler (e.g. a ReferenceError for a missing helper, #602)
 * would leave the test green. Each such error is therefore also collected on
 * `dom.uncaughtErrors`; call {@link assertNoUncaughtErrors} in `afterEach`.
 * @param {string} [html] - Markup for the document body.
 * @returns {import('jsdom').JSDOM & { uncaughtErrors: Error[] }} The JSDOM instance
 *   (`.window`, `.window.document`) plus the collected handler errors.
 */
export function createDom(html = '') {
  const uncaughtErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.forwardTo(console, { jsdomErrors: 'none' });
  virtualConsole.on('jsdomError', (error) => {
    uncaughtErrors.push(error.cause ?? error);
  });
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
    runScripts: 'outside-only',
    virtualConsole,
  });
  dom.uncaughtErrors = uncaughtErrors;
  return dom;
}

/**
 * Fails the current test if an event listener in the jsdom window threw.
 * @param {{ uncaughtErrors: Error[] }} dom - A DOM from {@link createDom}.
 * @returns {void}
 */
export function assertNoUncaughtErrors(dom) {
  assert.deepEqual(
    dom.uncaughtErrors.map((error) => String(error)),
    [],
    'an event handler threw inside the jsdom window'
  );
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
