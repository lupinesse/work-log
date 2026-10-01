/**
 * Regression tests for the ARCHITECTURE.md line-count drift check.
 *
 * Five consecutive weekly QA reviews (2026-08-03 through 2026-09-21) found
 * documented per-module line counts drifted from reality, and a full
 * re-audit on 2026-09-28 found 19 drifted entries — three times as many as
 * the 6 already tracked in issues. These tests cover both documented forms
 * (top-level module header, barrel sub-module list) and the two real
 * regressions found that day: `pure-fns.js` (65 documented vs. 87 actual)
 * and `pure-fns-validate.js` (264 documented vs. 331 actual).
 *
 * Run: node --test .github/scripts/test/architecture-line-counts.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  countNonBlankLines,
  extractDocumentedCounts,
  findMismatches,
} from '../lib/architecture-line-counts.mjs';

describe('extractDocumentedCounts', () => {
  test('extracts a top-level module header count', () => {
    const markdown = '#### **04-render.js** (56 lines) — Top-Level Render Orchestrator';
    assert.deepEqual(extractDocumentedCounts(markdown), [{ file: '04-render.js', documented: 56 }]);
  });

  test('extracts a barrel sub-module list count', () => {
    const markdown = '- `pure-fns-format.js` (216 lines) — String, colour, and duration formatters';
    assert.deepEqual(extractDocumentedCounts(markdown), [
      { file: 'pure-fns-format.js', documented: 216 },
    ]);
  });

  test('extracts multiple entries in document order', () => {
    const markdown = [
      '#### **pure-fns.js** (87 lines) — Pure Utility Library',
      '- `pure-fns-format.js` (216 lines) — formatters',
      '- `pure-fns-epics.js` (158 lines) — epic archive/restore',
    ].join('\n');
    assert.deepEqual(extractDocumentedCounts(markdown), [
      { file: 'pure-fns.js', documented: 87 },
      { file: 'pure-fns-format.js', documented: 216 },
      { file: 'pure-fns-epics.js', documented: 158 },
    ]);
  });

  test('returns an empty array when nothing is documented', () => {
    assert.deepEqual(extractDocumentedCounts('# Work Log Architecture\n\nNo counts here.'), []);
  });
});

describe('countNonBlankLines', () => {
  test('counts lines with content, excluding blank lines', () => {
    assert.equal(countNonBlankLines('a\n\nb\nc\n'), 3);
  });

  test('counts whitespace-only lines, matching grep -c .', () => {
    assert.equal(countNonBlankLines('a\n   \n\tb\n'), 3);
  });

  test('returns 0 for an empty file', () => {
    assert.equal(countNonBlankLines(''), 0);
  });
});

describe('findMismatches', () => {
  test('reports nothing when every documented count matches', () => {
    const markdown = '#### **foo.js** (3 lines) — Foo';
    const read = () => 'a\nb\nc\n';
    assert.deepEqual(findMismatches(markdown, read), []);
  });

  test('reports a mismatch when the actual count differs', () => {
    const markdown = '#### **foo.js** (3 lines) — Foo';
    const read = () => 'a\nb\n';
    assert.deepEqual(findMismatches(markdown, read), [
      { file: 'foo.js', documented: 3, actual: 2 },
    ]);
  });

  test('reports actual: null when the documented file cannot be read', () => {
    const markdown = '#### **missing.js** (10 lines) — Gone';
    const read = () => {
      throw new Error('ENOENT');
    };
    assert.deepEqual(findMismatches(markdown, read), [
      { file: 'missing.js', documented: 10, actual: null },
    ]);
  });

  // ─── Real regressions found in the 2026-09-28 full re-audit ───

  test('regression: pure-fns.js documented 65 lines, actually 87 (barrel undercounted after #409)', () => {
    const markdown = '#### **pure-fns.js** (65 lines) — Pure Utility Library';
    const read = () => Array.from({ length: 87 }, (_, i) => `line ${i}`).join('\n');
    assert.deepEqual(findMismatches(markdown, read), [
      { file: 'pure-fns.js', documented: 65, actual: 87 },
    ]);
  });

  test('regression: pure-fns-validate.js documented 264 lines, actually 331 (undetected since 2026-09-01)', () => {
    const markdown = '- `pure-fns-validate.js` (264 lines) — Per-record validators';
    const read = () => Array.from({ length: 331 }, (_, i) => `line ${i}`).join('\n');
    assert.deepEqual(findMismatches(markdown, read), [
      { file: 'pure-fns-validate.js', documented: 264, actual: 331 },
    ]);
  });

  test('only reports files that actually drifted, not every documented file', () => {
    const markdown = [
      '#### **ok.js** (2 lines) — Fine',
      '#### **drifted.js** (2 lines) — Not fine',
    ].join('\n');
    const read = (file) => (file === 'ok.js' ? 'a\nb' : 'a\nb\nc');
    assert.deepEqual(findMismatches(markdown, read), [
      { file: 'drifted.js', documented: 2, actual: 3 },
    ]);
  });
});
