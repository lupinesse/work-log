/**
 * Regression tests for the `npm test` wiring in package.json.
 *
 * `npm test` is the gate CLAUDE.md's PR workflow tells a developer to run
 * locally ("npm run build && npm run lint && npm test"). It used to end with
 * `node .github/scripts/test/ci-scripts.test.mjs` — one hard-coded file —
 * while CI ran `npm run test:scripts`, which globs the whole directory. Every
 * script test added since (the arrow-param ratchet's 11 among them) therefore
 * ran in CI but never under the documented local gate, so a developer could
 * follow CLAUDE.md exactly and still push a change those tests would catch.
 *
 * Run: node --test .github/scripts/test/test-script-wiring.test.mjs
 */

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts;

describe('npm test covers every test suite CI runs', () => {
  test('delegates to the test:scripts glob rather than naming one script test', () => {
    assert.match(
      scripts.test,
      /npm run test:scripts/,
      '`npm test` must run the whole .github/scripts/test glob, not a single file'
    );
    assert.doesNotMatch(
      scripts.test,
      /ci-scripts\.test\.mjs/,
      'naming one script test directly is what left the rest out of the local gate'
    );
  });

  test('delegates to the test:unit glob', () => {
    assert.match(scripts.test, /npm run test:unit/);
  });

  test('still runs the smoke tests', () => {
    assert.match(scripts.test, /npm run test:smoke/);
    assert.match(scripts['test:smoke'], /smoke-tests\.cjs/);
  });

  test('test:scripts globs the directory that holds these tests', () => {
    // The glob is what makes a newly added *.test.mjs run without anyone
    // remembering to register it — including this file.
    assert.match(scripts['test:scripts'], /\.github\/scripts\/test\/\*\.test\.mjs/);

    const testDir = path.join(repoRoot, '.github', 'scripts', 'test');
    const suites = fs.readdirSync(testDir).filter((name) => name.endsWith('.test.mjs'));
    assert.ok(
      suites.includes('test-script-wiring.test.mjs'),
      'this suite sits in the globbed directory, so it is covered by its own rule'
    );
  });
});
