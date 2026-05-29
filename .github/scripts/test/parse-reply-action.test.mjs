/**
 * Unit tests for normaliseReplyAction() in lib/parse-reply-action.mjs.
 *
 * Covers: index normalisation, bounds validation, and the mutually-exclusive
 * resolve/unresolve flag guard that prevents a buggy model response from
 * ambiguously both closing and re-opening a thread in one action.
 *
 * Run: node --test .github/scripts/test/parse-reply-action.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseReplyAction } from '../lib/parse-reply-action.mjs';

// ─────────────────────────── happy paths ───────────────────────────

describe('normaliseReplyAction — valid actions', () => {
  test('returns a normalised object for a plain reply with no flags', () => {
    const result = normaliseReplyAction(
      { thread_index: 2, body: 'Looks good to me.' },
      5
    );
    assert.deepStrictEqual(result, {
      threadIndex: 2,
      body:        'Looks good to me.',
      resolve:     false,
      unresolve:   false,
    });
  });

  test('accepts resolve: true with unresolve: false or absent', () => {
    const result = normaliseReplyAction(
      { thread_index: 0, body: '✅ Verified as fixed — wlLog.warn now at line 42.', resolve: true },
      3
    );
    assert.strictEqual(result.resolve,   true);
    assert.strictEqual(result.unresolve, false);
    assert.strictEqual(result.threadIndex, 0);
  });

  test('accepts unresolve: true with resolve: false or absent', () => {
    const result = normaliseReplyAction(
      { thread_index: 1, body: '🔁 Reopened — fix still missing.', unresolve: true },
      4
    );
    assert.strictEqual(result.unresolve,   true);
    assert.strictEqual(result.resolve,     false);
    assert.strictEqual(result.threadIndex, 1);
  });

  test('coerces a numeric-string thread_index to an integer', () => {
    const result = normaliseReplyAction(
      { thread_index: '3', body: 'reply body' },
      5
    );
    assert.strictEqual(result.threadIndex, 3);
    assert.strictEqual(typeof result.threadIndex, 'number');
  });

  test('accepts index 0 (first thread) without rejecting it as falsy', () => {
    const result = normaliseReplyAction({ thread_index: 0, body: 'first' }, 1);
    assert.strictEqual(result.threadIndex, 0);
  });

  test('accepts the last valid index (threadCount - 1)', () => {
    const result = normaliseReplyAction({ thread_index: 9, body: 'last' }, 10);
    assert.strictEqual(result.threadIndex, 9);
  });
});

// ─────────────────────────── resolve / unresolve guard ───────────────────────────

describe('normaliseReplyAction — mutually exclusive flag guard', () => {
  test('throws when both resolve and unresolve are true', () => {
    assert.throws(
      () => normaliseReplyAction(
        { thread_index: 0, body: 'ambiguous', resolve: true, unresolve: true },
        3
      ),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('mutually exclusive'),
          `expected "mutually exclusive" in: ${err.message}`
        );
        return true;
      }
    );
  });

  test('error message for flag conflict includes the thread_index', () => {
    let thrownMessage = '';
    try {
      normaliseReplyAction(
        { thread_index: 2, body: 'conflict', resolve: true, unresolve: true },
        5
      );
    } catch (err) {
      thrownMessage = err.message;
    }
    assert.ok(thrownMessage.includes('2'), `expected thread_index 2 in: ${thrownMessage}`);
  });
});

// ─────────────────────────── index bounds validation ───────────────────────────

describe('normaliseReplyAction — thread_index bounds', () => {
  test('throws when thread_index equals threadCount (one past the end)', () => {
    assert.throws(
      () => normaliseReplyAction({ thread_index: 3, body: 'x' }, 3),
      /out of range/
    );
  });

  test('throws when thread_index is negative', () => {
    assert.throws(
      () => normaliseReplyAction({ thread_index: -1, body: 'x' }, 5),
      /out of range/
    );
  });

  test('throws when thread_index is a non-numeric string', () => {
    assert.throws(
      () => normaliseReplyAction({ thread_index: 'abc', body: 'x' }, 5),
      /out of range/
    );
  });

  test('throws when thread_index is a float (not an integer)', () => {
    assert.throws(
      () => normaliseReplyAction({ thread_index: 1.5, body: 'x' }, 5),
      /out of range/
    );
  });

  test('throws when thread_index is null', () => {
    assert.throws(
      () => normaliseReplyAction({ thread_index: null, body: 'x' }, 5),
      /out of range/
    );
  });

  test('throws when thread_index is an empty string (regression: must not coerce to 0)', () => {
    // Regression test for the silent-coercion bug ChatGPT caught on PR #72:
    // Number('') returns 0, which would post the reply to thread 0 instead
    // of being routed to the invalid-actions bucket. Trim-and-reject before
    // Number() prevents this.
    assert.throws(
      () => normaliseReplyAction({ thread_index: '', body: 'x' }, 5),
      /out of range/
    );
  });

  test('throws when thread_index is whitespace-only (regression: must not coerce to 0)', () => {
    // Same bug class as the empty-string case: Number('   ') === 0.
    assert.throws(
      () => normaliseReplyAction({ thread_index: '   ', body: 'x' }, 5),
      /out of range/
    );
  });

  test('still accepts a whitespace-padded numeric string (e.g., " 3 ")', () => {
    // Trim-before-Number must not regress the documented numeric-string
    // coercion: a model that emits "  3  " should still map to thread 3.
    const result = normaliseReplyAction({ thread_index: '  3  ', body: 'reply' }, 5);
    assert.strictEqual(result.threadIndex, 3);
  });

  test('error message for out-of-range index includes the raw value', () => {
    let thrownMessage = '';
    try {
      normaliseReplyAction({ thread_index: 99, body: 'x' }, 3);
    } catch (err) {
      thrownMessage = err.message;
    }
    assert.ok(thrownMessage.includes('99'), `expected raw index in: ${thrownMessage}`);
    assert.ok(thrownMessage.includes('0..2'), `expected valid range in: ${thrownMessage}`);
  });
});
