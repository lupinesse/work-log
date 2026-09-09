/**
 * Regression tests for the single-letter-arrow-param ratchet.
 *
 * `.github/scripts/check-arrow-param-count.mjs` is the CI enforcement the
 * weekly QA review kept recommending: eslint.config.js's own rule for this
 * is `'warn'`, so nothing blocked the count from growing (294 → 297 over two
 * consecutive reviews) before this existed. These tests cover the pure
 * logic in lib/arrow-param-ratchet.mjs directly, and separately prove the
 * rule that feeds it still fires against real source via ESLint's API.
 *
 * Run: node --test .github/scripts/test/arrow-param-ratchet.test.mjs
 */

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { ESLint } from 'eslint';

import {
  BASELINE_COUNT,
  countArrowParamWarnings,
  evaluateRatchet,
} from '../lib/arrow-param-ratchet.mjs';

describe('countArrowParamWarnings', () => {
  test('counts only messages from the single-letter-arrow-param rule', () => {
    const messages = [
      { message: 'Single-letter arrow-function parameter — use an informative name (...)' },
      { message: 'Single-letter arrow-function parameter — use an informative name (...)' },
      { message: "'x' is defined but never used." },
    ];
    assert.equal(countArrowParamWarnings(messages), 2);
  });

  test('returns 0 for an empty or unrelated message list', () => {
    assert.equal(countArrowParamWarnings([]), 0);
    assert.equal(countArrowParamWarnings([{ message: 'no-var' }]), 0);
  });
});

describe('evaluateRatchet', () => {
  test('passes when the count equals the baseline', () => {
    assert.deepEqual(evaluateRatchet(292, 292), { ok: true, count: 292, baseline: 292 });
  });

  test('passes when the count is below the baseline', () => {
    const result = evaluateRatchet(290, 292);
    assert.equal(result.ok, true);
  });

  test('fails when the count exceeds the baseline — the regression this ratchet exists to catch', () => {
    const result = evaluateRatchet(297, 292);
    assert.equal(result.ok, false);
    assert.equal(result.count, 297);
    assert.equal(result.baseline, 292);
  });

  test('defaults to BASELINE_COUNT when no baseline is passed', () => {
    const result = evaluateRatchet(BASELINE_COUNT);
    assert.equal(result.ok, true);
  });
});

describe('the real src/js/ count, measured via ESLint', () => {
  test('is at or below BASELINE_COUNT on the current tree', async () => {
    const eslint = new ESLint();
    const results = await eslint.lintFiles(['src/js/**/*.js']);
    const messages = results.flatMap((result) => result.messages);
    const count = countArrowParamWarnings(messages);
    const { ok } = evaluateRatchet(count, BASELINE_COUNT);
    assert.ok(
      ok,
      `src/js/ now has ${count} single-letter arrow params, above the recorded baseline of ` +
        `${BASELINE_COUNT} — rename the new one(s), or lower BASELINE_COUNT only if the count ` +
        'genuinely dropped'
    );
  });
});
