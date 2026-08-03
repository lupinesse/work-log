/**
 * Unit tests for isPresetResolutionFailure() and interpretSelfTest() in
 * lib/commitlint-selftest.mjs.
 *
 * Regression coverage for the QA-2026-08-03 priority-3 finding: a
 * @commitlint/config-conventional bump without a matching @commitlint/cli left
 * the commit-msg hook dead with ERR_PACKAGE_PATH_NOT_EXPORTED on every message,
 * and nothing detected it. The first test below is that exact failure.
 *
 * Run: node --test .github/scripts/test/commitlint-selftest.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFORMING_SAMPLE,
  NON_CONFORMING_SAMPLE,
  isPresetResolutionFailure,
  interpretSelfTest,
} from '../lib/commitlint-selftest.mjs';

/**
 * Build a CommitlintRun fixture.
 *
 * @param {number|null} exitCode - Process exit code, or null if signalled.
 * @param {string} [output] - Combined stdout/stderr.
 * @returns {{ exitCode: number|null, output: string }}
 */
const run = (exitCode, output = '') => ({ exitCode, output });

/** A healthy pair of runs: conforming passes, non-conforming is rejected. */
const HEALTHY = {
  conforming: run(0),
  nonConforming: run(1, '✖ type may not be empty [type-empty]'),
};

// ─────────────────────── isPresetResolutionFailure ───────────────────────

describe('isPresetResolutionFailure', () => {
  const resolutionErrors = [
    [
      'the #251 regression verbatim',
      'Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined',
    ],
    ['a missing ESM module', 'Error [ERR_MODULE_NOT_FOUND]: Cannot find package'],
    ['a CJS/ESM mismatch', 'Error [ERR_REQUIRE_ESM]: require() of ES Module'],
    ['a missing package', 'Cannot find module @commitlint/config-conventional'],
    ['a preset that failed to load', 'failed to load config from commitlint.config.js'],
    ['an empty ruleset', 'Please add rules to your `commitlint.config.js`'],
  ];

  for (const [description, output] of resolutionErrors) {
    test(`detects ${description}`, () => {
      assert.strictEqual(isPresetResolutionFailure(output), true);
    });
  }

  test('does not flag an ordinary lint failure', () => {
    assert.strictEqual(
      isPresetResolutionFailure('✖ subject may not be empty [subject-empty]\n✖ found 1 problem'),
      false
    );
  });

  test('does not flag empty output', () => {
    assert.strictEqual(isPresetResolutionFailure(''), false);
  });
});

// ───────────────────────────── interpretSelfTest ─────────────────────────────

describe('interpretSelfTest — healthy commitlint', () => {
  test('passes when the preset loads and rules are enforced', () => {
    const result = interpretSelfTest(HEALTHY.conforming, HEALTHY.nonConforming);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.failures, []);
  });

  test('accepts any non-zero rejection code, not just 1', () => {
    const result = interpretSelfTest(HEALTHY.conforming, run(9, '✖ found 2 problems'));
    assert.strictEqual(result.ok, true);
  });
});

describe('interpretSelfTest — broken dependency tree', () => {
  const brokenPreset = run(1, 'Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined');

  test('fails when the conforming sample is rejected by a resolution error', () => {
    const result = interpretSelfTest(brokenPreset, run(1, 'same resolution error'));
    assert.strictEqual(result.ok, false);
  });

  test('names the dependency tree rather than the message', () => {
    const [failure] = interpretSelfTest(brokenPreset, HEALTHY.nonConforming).failures;
    assert.match(failure, /could not load its preset/);
    assert.match(failure, /dependency tree is broken/);
  });

  test('quotes the underlying commitlint output for diagnosis', () => {
    const [failure] = interpretSelfTest(brokenPreset, HEALTHY.nonConforming).failures;
    assert.match(failure, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
  });
});

describe('interpretSelfTest — config too strict', () => {
  const overStrict = run(1, '✖ subject may not be sentence-case [subject-case]');

  test('fails when a conforming message is rejected by a real rule', () => {
    const result = interpretSelfTest(overStrict, HEALTHY.nonConforming);
    assert.strictEqual(result.ok, false);
  });

  test('reports it as a rejected message, not a resolution failure', () => {
    const [failure] = interpretSelfTest(overStrict, HEALTHY.nonConforming).failures;
    assert.match(failure, /a conforming message was rejected/);
    assert.doesNotMatch(failure, /dependency tree is broken/);
  });

  test('quotes the sample that was rejected', () => {
    const [failure] = interpretSelfTest(overStrict, HEALTHY.nonConforming).failures;
    assert.ok(failure.includes(CONFORMING_SAMPLE));
  });
});

describe('interpretSelfTest — rules not enforced', () => {
  test('fails when a non-conforming message is accepted', () => {
    const result = interpretSelfTest(HEALTHY.conforming, run(0));
    assert.strictEqual(result.ok, false);
    assert.match(result.failures[0], /enforcing no rules/);
    assert.ok(result.failures[0].includes(NON_CONFORMING_SAMPLE));
  });
});

describe('interpretSelfTest — both expectations broken', () => {
  test('reports one failure line per broken expectation', () => {
    const result = interpretSelfTest(run(1, 'Cannot find module'), run(0));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failures.length, 2);
  });
});

describe('interpretSelfTest — signalled process', () => {
  test('treats a null exit code as a failure rather than a pass', () => {
    const result = interpretSelfTest(run(null, 'Killed'), HEALTHY.nonConforming);
    assert.strictEqual(result.ok, false);
  });
});

describe('interpretSelfTest — output formatting', () => {
  test('substitutes a placeholder when commitlint printed nothing', () => {
    const [failure] = interpretSelfTest(run(1, '   \n  '), HEALTHY.nonConforming).failures;
    assert.match(failure, /\(no output\)/);
  });
});
