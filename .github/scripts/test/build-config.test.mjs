/**
 * Unit tests for readModuleExports() in build-config.js.
 *
 * Regression coverage for issue #336: readModuleExports() (generalised from
 * the old pure-fns.js-only readPureFnsExports()) is what keeps build.js's
 * and vite.config.js's generated import lines in sync with each leaf
 * module's actual exports, with no hand-maintained list to drift out of
 * date. Tests run against the repo's own real leaf modules rather than
 * synthetic fixtures, since JS_SRC in build-config.js is a fixed 'src/js'
 * path relative to the working directory (not parameterisable per test)
 * and every genuine leaf module already exercises one of the two export
 * styles this function has to parse.
 *
 * Run: node --test .github/scripts/test/build-config.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readModuleExports } from '../../../build-config.js';

describe('readModuleExports', () => {
  test('parses plain declaration exports (app-constants.js)', () => {
    const exportsFound = readModuleExports('app-constants.js');
    // Exact list would make this test as brittle as the hand-maintained
    // list it replaces — assert on the stable, foundational names instead.
    assert.ok(exportsFound.includes('STORE_ENTRIES'));
    assert.ok(exportsFound.includes('DEFAULT_CATS'));
    assert.ok(exportsFound.includes('CUSTOM_PALETTE'));
  });

  test('parses barrel re-export statements (pure-fns.js)', () => {
    const exportsFound = readModuleExports('pure-fns.js');
    // pure-fns.js re-exports its sub-modules via `export { … } from …` —
    // escHtml is a foundational export unlikely to ever be removed.
    assert.ok(exportsFound.includes('escHtml'));
    assert.ok(exportsFound.includes('dk'));
  });

  test('returns an empty array for a file with no export statements', () => {
    // 01-state.js is a flat concatenated file, not an ES module — it has
    // zero top-level `export` keywords by design.
    assert.deepEqual(readModuleExports('01-state.js'), []);
  });

  test('throws when the file does not exist', () => {
    assert.throws(() => readModuleExports('this-file-does-not-exist.js'));
  });
});
