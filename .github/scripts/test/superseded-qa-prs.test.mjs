/**
 * Unit tests for selectSupersededPrs() in lib/superseded-qa-prs.mjs.
 *
 * Run: node --test .github/scripts/test/superseded-qa-prs.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSupersededPrs } from '../lib/superseded-qa-prs.mjs';

const CURRENT = 'claude/qa-review-2026-09-28';
const prList = (...entries) =>
  JSON.stringify(entries.map(([number, headRefName]) => ({ number, headRefName })));

describe('selectSupersededPrs', () => {
  const cases = [
    ['empty list', prList(), []],
    ['only the current report PR', prList([9, CURRENT]), []],
    [
      'older QA report PRs',
      prList([7, 'claude/qa-review-2026-09-14'], [8, 'claude/qa-review-2026-09-21'], [9, CURRENT]),
      [7, 8],
    ],
    [
      'unrelated PRs are never selected',
      prList([1, 'feat/qa-dashboard'], [2, 'fix/issue-442-qa'], [3, 'claude/dead-code-2026-09-21']),
      [],
    ],
  ];
  for (const [name, rawJson, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(selectSupersededPrs(rawJson, CURRENT), expected);
    });
  }

  test('throws on malformed JSON', () => {
    assert.throws(() => selectSupersededPrs('not json', CURRENT));
  });

  test('throws on empty input, as when gh prints nothing', () => {
    assert.throws(() => selectSupersededPrs('', CURRENT));
  });

  test('throws on non-array JSON', () => {
    assert.throws(() => selectSupersededPrs('null', CURRENT), /Expected an array/);
  });

  test('throws on an entry missing headRefName rather than skipping it', () => {
    assert.throws(() => selectSupersededPrs('[{"number":4}]', CURRENT), /Unexpected PR entry/);
  });

  test('refuses a current branch that is not a QA report branch', () => {
    // An empty or wrong branch would otherwise make every QA PR look superseded.
    assert.throws(() => selectSupersededPrs('[]', ''), /not a QA report branch/);
    assert.throws(() => selectSupersededPrs('[]', 'main'), /not a QA report branch/);
  });
});
