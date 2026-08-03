/**
 * Unit tests for hasOpenPr() in lib/parse-pr-list.mjs.
 *
 * Regression coverage for the bug found in PR #288: `gh pr list -q
 * '.[0].number'` returns the literal string "null" (not empty) on an empty
 * result, which silently defeated a naive `[ -z "$(...)" ]` idempotency
 * check in three workflows (dead-code.yml, delivery-metrics.yml,
 * weekly-qa-review.yml).
 *
 * Run: node --test .github/scripts/test/parse-pr-list.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { hasOpenPr } from '../lib/parse-pr-list.mjs';

describe('hasOpenPr', () => {
  test('returns false for an empty PR list', () => {
    assert.strictEqual(hasOpenPr('[]'), false);
  });

  test('returns true for a single open PR', () => {
    assert.strictEqual(hasOpenPr('[{"number":42}]'), true);
  });

  test('returns true for multiple open PRs', () => {
    assert.strictEqual(hasOpenPr('[{"number":1},{"number":2}]'), true);
  });

  test('throws on malformed JSON', () => {
    assert.throws(() => hasOpenPr('not json'));
  });

  test('throws on non-array JSON', () => {
    // gh pr list --json number always returns an array; guard against a
    // malformed gh response shape rather than silently returning a verdict.
    assert.throws(() => hasOpenPr('null'));
  });
});
