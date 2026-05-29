/**
 * Unit tests for parseResponse() in lib/parse-dialogue-response.mjs.
 *
 * Covers: happy path, markdown-fenced JSON, missing required fields, invalid
 * entries (null, non-object, non-string reply), blank/whitespace index,
 * out-of-range index bounds check (regression for the silent-misroute bug),
 * numeric-string index coercion, and default verdict.
 *
 * Run: node --test .github/scripts/test/parse-dialogue-response.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse } from '../lib/parse-dialogue-response.mjs';

/** Build a minimal valid raw JSON string for parseResponse. */
function makeRaw(thread_responses, synthesis = 'Looks good.') {
  return JSON.stringify({ thread_responses, synthesis });
}

// ─────────────────────────── happy paths ───────────────────────────

describe('parseResponse — valid input', () => {
  test('returns thread_responses and synthesis for a well-formed response', () => {
    const raw = makeRaw([{ index: 0, verdict: 'disagree', reply: 'No issue here.' }]);
    const result = parseResponse(raw, 2);
    assert.strictEqual(result.thread_responses.length, 1);
    assert.deepStrictEqual(result.thread_responses[0], {
      index: 0,
      verdict: 'disagree',
      reply: 'No issue here.',
    });
    assert.strictEqual(result.synthesis, 'Looks good.');
    assert.deepStrictEqual(result.invalidResponses, []);
  });

  test('strips a markdown code fence before parsing', () => {
    const inner = makeRaw([{ index: 0, verdict: 'agree_fix', reply: 'Fixed.' }]);
    const fenced = `\`\`\`json\n${inner}\n\`\`\``;
    const result = parseResponse(fenced, 1);
    assert.strictEqual(result.thread_responses.length, 1);
  });

  test('defaults missing verdict to "comment"', () => {
    const raw = makeRaw([{ index: 0, reply: 'No verdict field.' }]);
    const result = parseResponse(raw, 1);
    assert.strictEqual(result.thread_responses[0].verdict, 'comment');
  });

  test('stores the trimmed reply text (not the raw padded string)', () => {
    const raw = makeRaw([{ index: 0, reply: '  Fixed in this commit.  ' }]);
    const result = parseResponse(raw, 1);
    assert.strictEqual(result.thread_responses[0].reply, 'Fixed in this commit.');
  });

  test('coerces a numeric-string index to an integer', () => {
    const raw = makeRaw([{ index: '1', verdict: 'disagree', reply: 'ok' }]);
    const result = parseResponse(raw, 3);
    assert.strictEqual(result.thread_responses[0].index, 1);
    assert.deepStrictEqual(result.invalidResponses, []);
  });

  test('accepts index 0 (first thread)', () => {
    const raw = makeRaw([{ index: 0, reply: 'first' }]);
    const result = parseResponse(raw, 1);
    assert.strictEqual(result.thread_responses[0].index, 0);
  });

  test('accepts the last valid index (threadCount - 1)', () => {
    const raw = makeRaw([{ index: 4, reply: 'last' }]);
    const result = parseResponse(raw, 5);
    assert.strictEqual(result.thread_responses[0].index, 4);
  });
});

// ─────────────────────────── invalid top-level ───────────────────────────

describe('parseResponse — invalid top-level structure', () => {
  test('throws when thread_responses is missing', () => {
    assert.throws(
      () => parseResponse(JSON.stringify({ synthesis: 'ok' }), 1),
      /Missing required fields/
    );
  });

  test('throws when synthesis is missing', () => {
    assert.throws(
      () => parseResponse(JSON.stringify({ thread_responses: [] }), 1),
      /Missing required fields/
    );
  });

  test('throws when the JSON is malformed', () => {
    assert.throws(() => parseResponse('not json', 1));
  });

  test('throws when synthesis is whitespace-only (regression: must not post blank summary)', () => {
    // typeof '   ' === 'string' and Boolean('   ') is truthy, so without
    // the trim() check the whitespace value would be accepted and returned.
    assert.throws(
      () => parseResponse(JSON.stringify({ thread_responses: [], synthesis: '   ' }), 1),
      /Missing required fields/
    );
  });

  test('throws when synthesis is a truthy non-string (regression: Number/Object coercion)', () => {
    // {} is truthy, so without the typeof check it would pass !parsed.synthesis
    // and be coerced to '[object Object]' via String().
    assert.throws(
      () => parseResponse(JSON.stringify({ thread_responses: [], synthesis: {} }), 1),
      /Missing required fields/
    );
  });
});

// ─────────────────────────── invalid entries → invalidResponses ──────────────

describe('parseResponse — invalid entries moved to invalidResponses', () => {
  test('moves a null entry to invalidResponses', () => {
    const raw = makeRaw([null]);
    const result = parseResponse(raw, 1);
    assert.strictEqual(result.thread_responses.length, 0);
    assert.strictEqual(result.invalidResponses.length, 1);
  });

  test('moves a non-object entry to invalidResponses', () => {
    const raw = makeRaw(['not an object']);
    const result = parseResponse(raw, 1);
    assert.strictEqual(result.invalidResponses.length, 1);
  });

  test('moves an entry with a non-string reply to invalidResponses', () => {
    const raw = makeRaw([{ index: 0, reply: 42 }]);
    const result = parseResponse(raw, 1);
    assert.strictEqual(result.invalidResponses.length, 1);
  });

  test('moves a whitespace-only reply to invalidResponses (regression: must not post empty comment)', () => {
    // typeof '   ' === 'string' and Boolean('   ') is truthy, so without
    // .trim() the empty text would pass validation and post a blank reply.
    const raw = makeRaw([{ index: 0, reply: '   ' }]);
    const result = parseResponse(raw, 1);
    assert.strictEqual(result.thread_responses.length, 0);
    assert.strictEqual(result.invalidResponses.length, 1);
  });

  test('moves an empty-string reply to invalidResponses', () => {
    const raw = makeRaw([{ index: 0, reply: '' }]);
    const result = parseResponse(raw, 1);
    assert.strictEqual(result.invalidResponses.length, 1);
  });

  test('moves a blank-string index to invalidResponses (regression: must not coerce to thread 0)', () => {
    // Number('') === 0 — without coerceThreadIndex this would silently post
    // to thread 0 instead of landing in invalidResponses.
    const raw = makeRaw([{ index: '', reply: 'x' }]);
    const result = parseResponse(raw, 3);
    assert.strictEqual(result.thread_responses.length, 0);
    assert.strictEqual(result.invalidResponses.length, 1);
  });

  test('moves a whitespace-only index to invalidResponses', () => {
    const raw = makeRaw([{ index: '   ', reply: 'x' }]);
    const result = parseResponse(raw, 3);
    assert.strictEqual(result.invalidResponses.length, 1);
  });

  test('moves an out-of-range index to invalidResponses (regression: must not cause undefined-thread lookup)', () => {
    // Without the bounds check, index 999 would pass validation and the dispatch
    // loop would attempt threads[999] which is undefined.
    const raw = makeRaw([{ index: 999, reply: 'x' }]);
    const result = parseResponse(raw, 2);
    assert.strictEqual(result.thread_responses.length, 0);
    assert.strictEqual(result.invalidResponses.length, 1);
  });

  test('moves a negative index to invalidResponses', () => {
    const raw = makeRaw([{ index: -1, reply: 'x' }]);
    const result = parseResponse(raw, 3);
    assert.strictEqual(result.invalidResponses.length, 1);
  });

  test('moves an index equal to threadCount (one past last) to invalidResponses', () => {
    const raw = makeRaw([{ index: 3, reply: 'x' }]);
    const result = parseResponse(raw, 3);
    assert.strictEqual(result.invalidResponses.length, 1);
  });

  test('separates valid and invalid entries in the same response', () => {
    const raw = makeRaw([
      { index: 0, reply: 'valid' },
      { index: 99, reply: 'out of range' },
      { index: 1, reply: 'also valid' },
    ]);
    const result = parseResponse(raw, 2);
    assert.strictEqual(result.thread_responses.length, 2);
    assert.strictEqual(result.invalidResponses.length, 1);
  });
});
