/**
 * Unit tests for selectSupersededPrs() in lib/superseded-qa-prs.mjs.
 *
 * Run: node --test .github/scripts/test/superseded-qa-prs.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSupersededPrs } from '../lib/superseded-qa-prs.mjs';

const CURRENT = 'Weekly QA report 2026-09-28';
const prList = (...entries) =>
  JSON.stringify(entries.map(([number, title]) => ({ number, title })));

describe('selectSupersededPrs', () => {
  const cases = [
    ['empty list', prList(), []],
    ['only the current report PR', prList([9, CURRENT]), []],
    [
      'older QA report PRs',
      prList([7, 'Weekly QA report 2026-09-14'], [8, 'Weekly QA report 2026-09-21'], [9, CURRENT]),
      [7, 8],
    ],
    [
      'unrelated PRs are never selected',
      prList(
        [1, 'Add QA dashboard'],
        [2, 'fix(#442): QA flakiness'],
        [3, 'Weekly QA report draft notes']
      ),
      [],
    ],
  ];
  for (const [name, rawJson, expected] of cases) {
    test(name, () => {
      assert.deepStrictEqual(selectSupersededPrs(rawJson, CURRENT), expected);
    });
  }

  // Regression: the real report PRs (#629, #638) landed on branches named
  // `claude/qa-review-...`, `claude/weekly-qa-...`, and session-generated
  // names (e.g. `claude/fervent-bardeen-prafg5`) — none sharing a prefix.
  // Only the title stayed consistent, so matching must key off that alone.
  test('older report PRs are matched by title regardless of head-branch naming', () => {
    const rawJson = prList(
      [629, 'Weekly QA report 2026-10-04'],
      [638, 'Weekly QA report 2026-10-05'],
      [651, 'Weekly QA report 2026-10-12']
    );
    assert.deepStrictEqual(selectSupersededPrs(rawJson, 'Weekly QA report 2026-10-12'), [629, 638]);
  });

  test('throws on malformed JSON', () => {
    assert.throws(() => selectSupersededPrs('not json', CURRENT));
  });

  test('throws on empty input, as when gh prints nothing', () => {
    assert.throws(() => selectSupersededPrs('', CURRENT));
  });

  test('throws on non-array JSON', () => {
    assert.throws(() => selectSupersededPrs('null', CURRENT), /Expected an array/);
  });

  test('throws on an entry missing title rather than skipping it', () => {
    assert.throws(() => selectSupersededPrs('[{"number":4}]', CURRENT), /Unexpected PR entry/);
  });

  test('refuses a current title that is not a QA report title', () => {
    // An empty or wrong title would otherwise make every QA PR look superseded.
    assert.throws(() => selectSupersededPrs('[]', ''), /not a QA report title/);
    assert.throws(() => selectSupersededPrs('[]', 'Weekly QA report'), /not a QA report title/);
    assert.throws(
      () => selectSupersededPrs('[]', 'Weekly QA report notes 2026-09-28'),
      /not a QA report title/
    );
  });
});
