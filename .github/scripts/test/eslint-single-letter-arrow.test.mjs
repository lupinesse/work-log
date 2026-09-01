/**
 * Regression test for eslint.config.js's no-single-letter-arrow-param guard.
 *
 * `grep -rPo '\([a-z]\) =>' src/js/` has counted ~294 single-letter arrow
 * parameters unchanged across seven consecutive weekly QA reviews. The fix
 * those reviews recommended isn't a bulk rename — it's stopping the pile
 * from growing. This test proves the rule that does that actually fires
 * (and, just as importantly, doesn't fire where it shouldn't) rather than
 * trusting the config by inspection alone.
 *
 * Run: node --test .github/scripts/test/eslint-single-letter-arrow.test.mjs
 */

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { ESLint } from 'eslint';

/**
 * Lint a source snippet as if it were the given src/js/ file, and return
 * only the messages from the rule under test.
 *
 * @param {string} code - Source text to lint.
 * @param {string} filePath - Virtual path used for config-block matching;
 *   the file need not exist on disk.
 * @returns {Promise<import('eslint').Linter.LintMessage[]>} Messages from
 *   `no-restricted-syntax`.
 */
async function lintArrowParams(code, filePath) {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax');
}

describe('no-single-letter-arrow-param (eslint.config.js)', () => {
  test('flags a new single-letter arrow-function parameter in src/js/', async () => {
    const messages = await lintArrowParams('const f = (a) => a.x;\n', 'src/js/scratch-fixture.js');
    assert.equal(messages.length, 1);
    assert.match(messages[0].message, /Single-letter arrow-function parameter/);
  });

  test('does not flag an informative parameter name', async () => {
    const messages = await lintArrowParams(
      'const f = (item) => item.x;\n',
      'src/js/scratch-fixture.js'
    );
    assert.deepEqual(messages, []);
  });

  test('does not flag a two-parameter arrow function, even with short names', async () => {
    const messages = await lintArrowParams(
      'const f = (a, b) => a + b;\n',
      'src/js/scratch-fixture.js'
    );
    assert.deepEqual(messages, []);
  });

  test('also flags a single-letter parameter in a leaf ES module', async () => {
    const messages = await lintArrowParams(
      'export const f = (a) => a.x;\n',
      'src/js/date-labels.js'
    );
    assert.equal(messages.length, 1);
  });

  test('is a warning, not an error, so existing code does not fail the lint job', async () => {
    const eslint = new ESLint();
    const [result] = await eslint.lintText('const f = (a) => a.x;\n', {
      filePath: 'src/js/scratch-fixture.js',
    });
    assert.equal(result.errorCount, 0);
    assert.equal(result.warningCount, 1);
  });
});
