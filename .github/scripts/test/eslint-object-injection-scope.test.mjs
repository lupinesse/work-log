/**
 * Regression test for the scope of `security/detect-object-injection` in
 * eslint.config.js (#484).
 *
 * The rule used to be switched off for every glob, so a new bracket lookup with
 * an untrusted key never warned anywhere. It is now a warning for every config
 * block — node tooling, CI scripts, browser bundle (`src/js`), and tests.
 * Every existing bracket-notation site in those files carries an inline disable
 * comment naming why its key is safe; new sites warn on the first lint run.
 * This test pins that behaviour using the real ESLint API, so it cannot drift
 * silently.
 *
 * Run: node --test .github/scripts/test/eslint-object-injection-scope.test.mjs
 */

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { ESLint } from 'eslint';

const UNTRUSTED_LOOKUP = 'export const read = (store, key) => store[key];\n';
const UNTRUSTED_LOOKUP_SCRIPT = 'const read = (store, key) => store[key];\n';
const UNTRUSTED_LOOKUP_COMMONJS = 'module.exports = (store, key) => store[key];\n';

/**
 * Lints a snippet as if it were the given file and returns only the messages
 * from the rule under test.
 *
 * @param {string} code - Source text to lint.
 * @param {string} filePath - Virtual path used for config-block matching.
 * @returns {Promise<import('eslint').Linter.LintMessage[]>} Messages from
 *   `security/detect-object-injection`.
 */
async function lintObjectInjection(code, filePath) {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === 'security/detect-object-injection');
}

describe('security/detect-object-injection scope (eslint.config.js)', () => {
  const WARNS = [
    ['a CI script', '.github/scripts/scratch-fixture.mjs', UNTRUSTED_LOOKUP],
    ['a CI script library', '.github/scripts/lib/scratch-fixture.mjs', UNTRUSTED_LOOKUP],
    ['workstation tooling', 'scripts/lib/scratch-fixture.mjs', UNTRUSTED_LOOKUP],
    ['a root CommonJS file', 'scratch-fixture.cjs', UNTRUSTED_LOOKUP_COMMONJS],
    ['the browser bundle (src/js)', 'src/js/scratch-fixture.js', UNTRUSTED_LOOKUP_SCRIPT],
    ['unit tests', 'test/unit/scratch-fixture.mjs', UNTRUSTED_LOOKUP],
  ];
  for (const [label, filePath, code] of WARNS) {
    test(`warns on a variable-keyed lookup in ${label}`, async () => {
      const messages = await lintObjectInjection(code, filePath);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].severity, 1, 'a warning, not an error');
    });
  }

  test('an inline disable that names a reason silences exactly the next line', async () => {
    const code = [
      'export const read = (store, key) => {',
      '  // eslint-disable-next-line security/detect-object-injection -- key is a literal at every call site',
      '  const first = store[key];',
      '  return first + store[key];',
      '};',
      '',
    ].join('\n');
    const messages = await lintObjectInjection(code, '.github/scripts/scratch-fixture.mjs');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].line, 4);
  });
});
