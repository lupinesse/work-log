/**
 * Unit tests for parsePhase4Response() in lib/parse-phase4-response.mjs.
 *
 * Phase 4 only accepts type:"reply" — any type:"new" or unknown type must be
 * moved to invalidActions rather than posted as a new thread.
 *
 * Run: node --test .github/scripts/test/parse-phase4-response.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhase4Response } from '../lib/parse-phase4-response.mjs';

/** Build a raw JSON string with the given thread_actions array. */
function makeRaw(thread_actions, extra = {}) {
  return JSON.stringify({ thread_actions, ...extra });
}

// ─────────────────────────── happy paths ───────────────────────────

describe('parsePhase4Response — valid reply actions', () => {
  test('accepts a well-formed reply action', () => {
    const raw = makeRaw([{ type: 'reply', thread_index: 0, body: 'Verified.' }]);
    const result = parsePhase4Response(raw, 2);
    assert.strictEqual(result.actions.length, 1);
    assert.strictEqual(result.actions[0].type, 'reply');
    assert.strictEqual(result.actions[0].threadIndex, 0);
    assert.deepStrictEqual(result.invalidActions, []);
  });

  test('strips a markdown code fence before parsing', () => {
    const inner = makeRaw([{ type: 'reply', thread_index: 0, body: 'ok' }]);
    const fenced = `\`\`\`json\n${inner}\n\`\`\``;
    const result = parsePhase4Response(fenced, 1);
    assert.strictEqual(result.actions.length, 1);
  });

  test('accepts resolve: true', () => {
    const raw = makeRaw([{ type: 'reply', thread_index: 0, body: '✅ Verified.', resolve: true }]);
    const result = parsePhase4Response(raw, 1);
    assert.strictEqual(result.actions[0].resolve, true);
  });

  test('accepts unresolve: true', () => {
    const raw = makeRaw([
      { type: 'reply', thread_index: 0, body: '🔁 Reopened — fix missing.', unresolve: true },
    ]);
    const result = parsePhase4Response(raw, 1);
    assert.strictEqual(result.actions[0].unresolve, true);
  });

  test('returns empty actions when thread_actions is absent', () => {
    const result = parsePhase4Response(JSON.stringify({}), 5);
    assert.strictEqual(result.actions.length, 0);
    assert.strictEqual(result.invalidActions.length, 0);
  });

  test('surfaces legacy new_findings as invalidActions instead of silently discarding', () => {
    const raw = JSON.stringify({
      new_findings: [
        { path: 'src/foo.js', line: 10, body: 'Missing null check.' },
        { path: 'src/bar.js', line: 20, body: 'Race condition.' },
      ],
    });
    const result = parsePhase4Response(raw, 3);
    assert.strictEqual(result.actions.length, 0);
    assert.strictEqual(result.invalidActions.length, 2);
  });

  test('returns empty actions for an empty thread_actions array', () => {
    const result = parsePhase4Response(makeRaw([]), 5);
    assert.strictEqual(result.actions.length, 0);
  });

  test('ignores the optional summary field — it is not an action', () => {
    const raw = makeRaw([{ type: 'reply', thread_index: 0, body: 'ok' }], {
      summary: 'All resolved.',
    });
    const result = parsePhase4Response(raw, 1);
    assert.strictEqual(result.actions.length, 1);
    assert.strictEqual(result.invalidActions.length, 0);
  });
});

// ─────────────────────────── new actions rejected ───────────────────────────

describe('parsePhase4Response — new actions rejected (Phase 4 constraint)', () => {
  test('moves type:"new" to invalidActions', () => {
    const raw = makeRaw([
      { type: 'new', path: 'src/foo.js', line: 10, body: '🔴 Blocking: undefined access.' },
    ]);
    const result = parsePhase4Response(raw, 0);
    assert.strictEqual(result.actions.length, 0);
    assert.strictEqual(result.invalidActions.length, 1);
  });

  test('accepts a reply action even when a new action is also present', () => {
    const raw = makeRaw([
      { type: 'new', path: 'src/foo.js', line: 10, body: 'new finding' },
      { type: 'reply', thread_index: 0, body: '✅ Verified.' },
    ]);
    const result = parsePhase4Response(raw, 1);
    assert.strictEqual(result.actions.length, 1);
    assert.strictEqual(result.actions[0].type, 'reply');
    assert.strictEqual(result.invalidActions.length, 1);
  });

  test('moves null type to invalidActions', () => {
    const raw = makeRaw([{ type: null, thread_index: 0, body: 'some text' }]);
    const result = parsePhase4Response(raw, 1);
    assert.strictEqual(result.actions.length, 0);
    assert.strictEqual(result.invalidActions.length, 1);
  });

  test('moves absent type to invalidActions (no legacy default to "new")', () => {
    const raw = makeRaw([{ thread_index: 0, body: 'some text' }]);
    const result = parsePhase4Response(raw, 1);
    assert.strictEqual(result.actions.length, 0);
    assert.strictEqual(result.invalidActions.length, 1);
  });

  test('moves unknown type string to invalidActions', () => {
    const raw = makeRaw([{ type: 'APPROVE', body: 'ok' }]);
    const result = parsePhase4Response(raw, 1);
    assert.strictEqual(result.invalidActions.length, 1);
  });
});

// ─────────────────────────── invalid reply actions ─────────────────────────

describe('parsePhase4Response — invalid reply actions', () => {
  test('moves a null entry to invalidActions', () => {
    const result = parsePhase4Response(makeRaw([null]), 1);
    assert.strictEqual(result.invalidActions.length, 1);
  });

  test('moves a reply with empty body to invalidActions', () => {
    const raw = makeRaw([{ type: 'reply', thread_index: 0, body: '' }]);
    const result = parsePhase4Response(raw, 1);
    assert.strictEqual(result.invalidActions.length, 1);
  });

  test('moves a reply with whitespace-only body to invalidActions', () => {
    const raw = makeRaw([{ type: 'reply', thread_index: 0, body: '   ' }]);
    const result = parsePhase4Response(raw, 1);
    assert.strictEqual(result.invalidActions.length, 1);
  });

  test('moves a reply with out-of-range thread_index to invalidActions', () => {
    const raw = makeRaw([{ type: 'reply', thread_index: 99, body: 'ok' }]);
    const result = parsePhase4Response(raw, 5);
    assert.strictEqual(result.invalidActions.length, 1);
  });

  test('moves a reply with both resolve and unresolve true to invalidActions', () => {
    const raw = makeRaw([
      { type: 'reply', thread_index: 0, body: 'ok', resolve: true, unresolve: true },
    ]);
    const result = parsePhase4Response(raw, 1);
    assert.strictEqual(result.invalidActions.length, 1);
  });

  test('throws when the JSON is malformed', () => {
    assert.throws(() => parsePhase4Response('not json', 1));
  });

  test('separates valid replies from invalid in the same response', () => {
    const raw = makeRaw([
      { type: 'reply', thread_index: 0, body: 'valid' },
      { type: 'new', path: 'src/foo.js', line: 5, body: 'rejected' },
      { type: 'reply', thread_index: 1, body: 'also valid' },
    ]);
    const result = parsePhase4Response(raw, 3);
    assert.strictEqual(result.actions.length, 2);
    assert.strictEqual(result.invalidActions.length, 1);
  });
});
