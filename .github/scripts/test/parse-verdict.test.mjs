/**
 * Unit tests for normaliseGithubVerdict() in lib/parse-verdict.mjs.
 *
 * Regression coverage for malformed-but-truthy values that would otherwise
 * reach upsertReview() with an unsupported state string.
 *
 * Run: node --test .github/scripts/test/parse-verdict.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseGithubVerdict, VALID_GITHUB_VERDICTS } from '../lib/parse-verdict.mjs';

// ─────────────────────────── happy paths ───────────────────────────

describe('normaliseGithubVerdict — valid input', () => {
  test('accepts APPROVE unchanged', () => {
    assert.strictEqual(normaliseGithubVerdict('APPROVE'), 'APPROVE');
  });

  test('accepts REQUEST_CHANGES unchanged', () => {
    assert.strictEqual(normaliseGithubVerdict('REQUEST_CHANGES'), 'REQUEST_CHANGES');
  });

  test('accepts COMMENT unchanged', () => {
    assert.strictEqual(normaliseGithubVerdict('COMMENT'), 'COMMENT');
  });

  test('trims a verdict with trailing whitespace (regression: COMMENT  → COMMENT)', () => {
    // A model that emits "COMMENT " must not cause the whole review to fail —
    // trimming produces "COMMENT" which is a valid state.
    assert.strictEqual(normaliseGithubVerdict('COMMENT '), 'COMMENT');
    assert.strictEqual(normaliseGithubVerdict(' REQUEST_CHANGES '), 'REQUEST_CHANGES');
    assert.strictEqual(normaliseGithubVerdict('  APPROVE  '), 'APPROVE');
  });

  test('VALID_GITHUB_VERDICTS contains exactly the three expected states', () => {
    assert.deepStrictEqual([...VALID_GITHUB_VERDICTS].sort(), [
      'APPROVE',
      'COMMENT',
      'REQUEST_CHANGES',
    ]);
  });
});

// ─────────────────────────── malformed-but-truthy values ───────────────────────────

describe('normaliseGithubVerdict — malformed-but-truthy values throw', () => {
  test('throws on wrong-case verdict (regression: approve is not APPROVE)', () => {
    // 'approve' is truthy and passes !parsed.verdict, but it is not a valid
    // GitHub review state — the API would reject it.
    assert.throws(() => normaliseGithubVerdict('approve'), /invalid GitHub review verdict/);
    assert.throws(() => normaliseGithubVerdict('comment'), /invalid GitHub review verdict/);
    assert.throws(() => normaliseGithubVerdict('request_changes'), /invalid GitHub review verdict/);
  });

  test('throws on non-string boolean true (regression: truthy non-string bypasses !check)', () => {
    // `!true` is false so a plain truthiness check accepts it;
    // the typeof guard here correctly rejects it.
    assert.throws(() => normaliseGithubVerdict(true), /invalid GitHub review verdict/);
  });

  test('throws on non-string number', () => {
    assert.throws(() => normaliseGithubVerdict(1), /invalid GitHub review verdict/);
  });

  test('throws on null', () => {
    assert.throws(() => normaliseGithubVerdict(null), /invalid GitHub review verdict/);
  });

  test('throws on undefined (absent verdict field)', () => {
    assert.throws(() => normaliseGithubVerdict(undefined), /invalid GitHub review verdict/);
  });

  test('throws on empty string', () => {
    assert.throws(() => normaliseGithubVerdict(''), /invalid GitHub review verdict/);
  });

  test('throws on whitespace-only string', () => {
    assert.throws(() => normaliseGithubVerdict('   '), /invalid GitHub review verdict/);
  });

  test('throws on an unknown but plausible string (regression: "APPROVED" != "APPROVE")', () => {
    assert.throws(() => normaliseGithubVerdict('APPROVED'), /invalid GitHub review verdict/);
    assert.throws(
      () => normaliseGithubVerdict('CHANGES_REQUESTED'),
      /invalid GitHub review verdict/
    );
  });

  test('error message includes the raw value', () => {
    let msg = '';
    try {
      normaliseGithubVerdict('approve');
    } catch (err) {
      msg = err.message;
    }
    assert.ok(msg.includes('approve'), `expected raw value in: ${msg}`);
  });
});
