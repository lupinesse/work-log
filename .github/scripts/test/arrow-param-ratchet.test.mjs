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
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

import {
  BASELINE_COUNT,
  countArrowParamWarnings,
  evaluateRatchet,
  isSuspiciouslyZero,
} from '../lib/arrow-param-ratchet.mjs';

describe('countArrowParamWarnings', () => {
  test('counts only messages with the no-restricted-syntax ruleId', () => {
    const messages = [
      { ruleId: 'no-restricted-syntax', message: 'Single-letter arrow-function parameter (...)' },
      { ruleId: 'no-restricted-syntax', message: 'Single-letter arrow-function parameter (...)' },
      { ruleId: 'no-unused-vars', message: "'x' is defined but never used." },
    ];
    assert.equal(countArrowParamWarnings(messages), 2);
  });

  test('returns 0 for an empty or unrelated message list', () => {
    assert.equal(countArrowParamWarnings([]), 0);
    assert.equal(countArrowParamWarnings([{ ruleId: 'no-var', message: 'no-var' }]), 0);
  });

  test('keeps matching after the human-readable message text changes', () => {
    // Regression for matching on message text instead of ruleId: a copy
    // edit to eslint.config.js's warning text must not silently zero this
    // out. ruleId is what NO_SINGLE_LETTER_ARROW_PARAM is registered under
    // and cannot drift independently of the rule itself.
    const messages = [{ ruleId: 'no-restricted-syntax', message: 'Totally reworded warning text' }];
    assert.equal(countArrowParamWarnings(messages), 1);
  });
});

describe('isSuspiciouslyZero', () => {
  test('flags exactly 0 as suspicious', () => {
    assert.equal(isSuspiciouslyZero(0), true);
  });

  test('does not flag any positive count', () => {
    assert.equal(isSuspiciouslyZero(1), false);
    assert.equal(isSuspiciouslyZero(292), false);
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
  test('verifies the current count of single-letter arrow params in src/js/ has not grown beyond the baseline', async () => {
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

  test('does not measure 0 — the pre-existing pile was never bulk-renamed', async () => {
    // Guards against exactly the failure mode this ratchet almost shipped
    // with: a matcher that silently stops matching real ESLint messages
    // reads as "0 violations, ratchet holds" forever instead of failing.
    const eslint = new ESLint();
    const results = await eslint.lintFiles(['src/js/**/*.js']);
    const messages = results.flatMap((result) => result.messages);
    const count = countArrowParamWarnings(messages);
    assert.ok(
      !isSuspiciouslyZero(count),
      'measured 0 single-letter arrow params against a baseline of ' +
        `${BASELINE_COUNT} — the rule/ruleId coupling is broken, not the codebase clean`
    );
  });
});

describe('check-arrow-param-count.mjs failure reporting', () => {
  test('reports an informative error and exits 1 when ESLint itself cannot run', () => {
    // Regression test: the entry point was `main().then(code => process.exit(code))`
    // with no .catch(), so anything thrown inside main() — most plausibly an
    // ESLint upgrade moving the Node API this check depends on — surfaced as a
    // bare unhandled-rejection trace. Still a non-zero exit, but with nothing
    // saying which check broke or that the count was never measured at all.
    const scriptPath = fileURLToPath(new URL('../check-arrow-param-count.mjs', import.meta.url));
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'arrow-ratchet-'));

    try {
      // A flat config that throws on import is the cheapest way to make
      // ESLint fail the way a broken/incompatible install would.
      fs.writeFileSync(
        path.join(sandbox, 'eslint.config.js'),
        "throw new Error('deliberately broken eslint config');\n"
      );
      fs.mkdirSync(path.join(sandbox, 'src', 'js'), { recursive: true });
      fs.writeFileSync(path.join(sandbox, 'src', 'js', 'sample.js'), 'export const value = 1;\n');

      const result = spawnSync(process.execPath, [scriptPath], {
        cwd: sandbox,
        encoding: 'utf8',
      });

      assert.equal(result.status, 1, 'exits 1 rather than crashing with an unhandled rejection');
      assert.match(
        result.stderr,
        /could not run, so the count was never measured/,
        'names the check and says the count was never measured'
      );
      assert.doesNotMatch(
        result.stderr,
        /UnhandledPromiseRejection/,
        'the rejection is handled, not left to Node to report'
      );
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
