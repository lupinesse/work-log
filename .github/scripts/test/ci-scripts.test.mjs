import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseParamNames, jsdocBefore, isImplicitArrow, bodyHasReturn } from '../jsdoc-check.mjs';

import { collectTestFiles, referencesModule, toPosixPath } from '../impact-check.mjs';

// ---------------------------------------------------------------------------
// parseParamNames
// ---------------------------------------------------------------------------

describe('parseParamNames', () => {
  it('returns [] for empty params', () => {
    assert.deepEqual(parseParamNames('()'), []);
    assert.deepEqual(parseParamNames('( )'), []);
  });

  it('parses simple named params', () => {
    assert.deepEqual(parseParamNames('(a, b, c)'), ['a', 'b', 'c']);
  });

  it('strips default values', () => {
    assert.deepEqual(parseParamNames('(a = 1, b = "x")'), ['a', 'b']);
  });

  it('strips spread operator', () => {
    assert.deepEqual(parseParamNames('(...args)'), ['args']);
  });

  it('marks destructured object as {destructured}', () => {
    assert.deepEqual(parseParamNames('({ a, b })'), ['{destructured}']);
  });

  it('marks destructured array as {destructured}', () => {
    assert.deepEqual(parseParamNames('([first, second])'), ['{destructured}']);
  });

  it('handles mixed named and destructured params', () => {
    assert.deepEqual(parseParamNames('({ a }, b)'), ['{destructured}', 'b']);
  });

  it('handles nested destructuring without splitting on inner commas', () => {
    assert.deepEqual(parseParamNames('({ a: { b, c } }, d)'), ['{destructured}', 'd']);
  });
});

// ---------------------------------------------------------------------------
// jsdocBefore
// ---------------------------------------------------------------------------

describe('jsdocBefore', () => {
  it('returns null when no JSDoc present', () => {
    const lines = ['export function foo() {}'];
    assert.equal(jsdocBefore(lines, 0), null);
  });

  it('returns null when a non-JSDoc line precedes the export', () => {
    const lines = ['const x = 1;', 'export function foo() {}'];
    assert.equal(jsdocBefore(lines, 1), null);
  });

  it('finds a JSDoc block immediately before the export', () => {
    const lines = ['/**', ' * Does a thing.', ' */', 'export function foo() {}'];
    const result = jsdocBefore(lines, 3);
    assert.ok(result !== null);
    assert.ok(result.includes('Does a thing.'));
  });

  it('skips blank lines between JSDoc and export', () => {
    const lines = ['/**', ' * Desc.', ' */', '', 'export function foo() {}'];
    assert.ok(jsdocBefore(lines, 4) !== null);
  });

  it('returns null when */ is present but /** is absent (malformed)', () => {
    const lines = [' * Desc.', ' */', 'export function foo() {}'];
    assert.equal(jsdocBefore(lines, 2), null);
  });

  it('returns null when a code line sits between JSDoc and export', () => {
    const lines = ['/**', ' * Desc.', ' */', 'const y = 2;', 'export function foo() {}'];
    assert.equal(jsdocBefore(lines, 4), null);
  });
});

// ---------------------------------------------------------------------------
// isImplicitArrow
// ---------------------------------------------------------------------------

describe('isImplicitArrow', () => {
  it('returns true for concise arrow with expression body', () => {
    assert.ok(isImplicitArrow('export const add = (a, b) => a + b;'));
  });

  it('returns false for arrow with block body', () => {
    assert.ok(!isImplicitArrow('export const add = (a, b) => { return a + b; }'));
  });

  it('returns false for non-arrow function', () => {
    assert.ok(!isImplicitArrow('export function foo(a) { return a; }'));
  });

  it('returns false when no arrow present', () => {
    assert.ok(!isImplicitArrow('export const x = 42;'));
  });
});

// ---------------------------------------------------------------------------
// bodyHasReturn — critical: must NOT fire on nested callbacks
// ---------------------------------------------------------------------------

describe('bodyHasReturn', () => {
  it('detects a top-level return', () => {
    const lines = ['export function foo(x) {', '  return x + 1;', '}'];
    assert.ok(bodyHasReturn(lines, 0));
  });

  it('does NOT fire on return inside a nested arrow callback', () => {
    const lines = [
      'export function foo(items) {',
      '  items.forEach(x => {',
      '    return x.value;', // depth 2 — should not count
      '  });',
      '}', // void function
    ];
    assert.ok(!bodyHasReturn(lines, 0));
  });

  it('does NOT fire on return inside an if-block (still depth 2)', () => {
    const lines = [
      'export function foo(x) {',
      '  if (x) {',
      '    return x;', // depth 2
      '  }',
      '}',
    ];
    // An if-block IS still at depth 2; this SHOULD return false with our check.
    // Note: semantically the function does return, but only inside a nested block.
    // Our heuristic requires depth === 1, so this is intentionally conservative.
    assert.ok(!bodyHasReturn(lines, 0));
  });

  it('detects return at depth 1 after a nested block', () => {
    const lines = [
      'export function foo(items) {',
      '  items.forEach(x => {',
      '    x.process();',
      '  });',
      '  return items.length;', // depth 1 after the forEach
      '}',
    ];
    assert.ok(bodyHasReturn(lines, 0));
  });

  it('returns false for a genuinely void function', () => {
    const lines = ['export function doSideEffect(el) {', '  el.classList.add("active");', '}'];
    assert.ok(!bodyHasReturn(lines, 0));
  });
});

// ---------------------------------------------------------------------------
// referencesModule
// ---------------------------------------------------------------------------

describe('referencesModule', () => {
  it('matches a bare import path', () => {
    assert.ok(referencesModule("import { foo } from './pure-fns.js';", 'pure-fns'));
  });

  it('matches without .js extension', () => {
    assert.ok(referencesModule("import { foo } from './pure-fns';", 'pure-fns'));
  });

  it('does NOT match partial name (super-set basename)', () => {
    assert.ok(!referencesModule("import x from './extra-pure-fns.js';", 'pure-fns'));
  });

  it('does NOT match partial name (sub-set basename)', () => {
    assert.ok(!referencesModule("import x from './fns.js';", 'pure-fns'));
  });

  it('matches a require() call', () => {
    assert.ok(referencesModule("const m = require('./04-render.js');", '04-render'));
  });

  it('handles hyphenated basenames (regex special chars escaped)', () => {
    // Hyphen in basename must not be treated as regex range
    assert.ok(referencesModule("import './pure-fns.js';", 'pure-fns'));
    assert.ok(!referencesModule("import './purebfns.js';", 'pure-fns'));
  });

  it('returns false for unrelated content', () => {
    assert.ok(!referencesModule('const x = 42;', 'pure-fns'));
  });
});

// ---------------------------------------------------------------------------
// toPosixPath
// ---------------------------------------------------------------------------

describe('toPosixPath', () => {
  it('leaves an already-POSIX path untouched', () => {
    assert.equal(toPosixPath('test/unit/render.test.mjs'), 'test/unit/render.test.mjs');
  });

  it('normalises whatever path.join produced on this platform', () => {
    assert.equal(
      toPosixPath(path.join('test', 'unit', 'render.test.mjs')),
      'test/unit/render.test.mjs'
    );
  });
});

// ---------------------------------------------------------------------------
// collectTestFiles
// ---------------------------------------------------------------------------

describe('collectTestFiles', () => {
  const tempDirs = [];

  after(() => {
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Build a throwaway test-directory tree and return its path.
   *
   * @param {Record<string, string[]>} tree - Subdirectory name → filenames.
   *   The `.` key holds files placed directly in the directory root.
   * @returns {string} Absolute path to the created directory.
   */
  function makeTestTree(tree) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-check-'));
    for (const [subdir, names] of Object.entries(tree)) {
      const target = subdir === '.' ? dir : path.join(dir, subdir);
      fs.mkdirSync(target, { recursive: true });
      for (const name of names) fs.writeFileSync(path.join(target, name), '');
    }
    tempDirs.push(dir);
    return dir;
  }

  it('discovers suites one level down (the test/unit/*.test.mjs layout)', () => {
    const dir = makeTestTree({ unit: ['render.test.mjs', 'state.test.mjs', '_helpers.mjs'] });
    const found = collectTestFiles(dir, []).map((f) => path.basename(f));
    assert.deepEqual(found, ['_helpers.mjs', 'render.test.mjs', 'state.test.mjs']);
  });

  it('discovers suites sitting directly in the test directory', () => {
    const dir = makeTestTree({ '.': ['unit.mjs', 'legacy.cjs'] });
    const found = collectTestFiles(dir, []).map((f) => path.basename(f));
    assert.deepEqual(found, ['legacy.cjs', 'unit.mjs']);
  });

  it('skips non-JavaScript files such as the Pester suite', () => {
    const dir = makeTestTree({ '.': ['calendar.Tests.ps1', 'unit.mjs'] });
    const found = collectTestFiles(dir, []).map((f) => path.basename(f));
    assert.deepEqual(found, ['unit.mjs']);
  });

  it('puts existing root suites first, and drops ones that do not exist', () => {
    // The root suite lives outside the scanned directory, mirroring the real
    // arrangement (smoke-tests.cjs at the repo root, unit suites under test/) —
    // so this asserts precedence rather than tolerating a duplicated entry.
    const rootDir = makeTestTree({ '.': ['smoke-tests.cjs'] });
    const testDir = makeTestTree({ unit: ['render.test.mjs'] });
    const presentRoot = path.join(rootDir, 'smoke-tests.cjs');
    const absentRoot = path.join(rootDir, 'gone.cjs');

    const found = collectTestFiles(testDir, [presentRoot, absentRoot]);

    assert.deepEqual(found, [presentRoot, path.join(testDir, 'unit', 'render.test.mjs')]);
  });

  it('returns an empty list when the test directory is missing', () => {
    assert.deepEqual(collectTestFiles(path.join(os.tmpdir(), 'impact-check-absent'), []), []);
  });

  /**
   * Regression guard for the #334 test split: the old hard-coded
   * ['smoke-tests.cjs', 'test/unit.mjs', 'test/unit.cjs'] list was filtered by
   * existsSync, so when unit.mjs was split into test/unit/*.test.mjs the list
   * silently collapsed to the smoke suite alone and every changed module
   * reported "❌ not found". Asserting against the repo's own real layout is
   * the only version of this test that would have failed before the fix.
   */
  it('finds the real repository unit suites, not just the smoke tests', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const found = collectTestFiles(path.join(repoRoot, 'test'), []);
    assert.ok(found.length > 1, 'expected more than one suite to be discovered');
    assert.ok(found.some((f) => f.endsWith('.test.mjs')));
  });
});
