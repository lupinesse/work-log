/**
 * Regression tests for the Phase 4 "resolve" corroboration guard.
 *
 * Issue #416 found three confirmed cases where the chatgpt/claude PR-review
 * dialogue's Phase 4 posted "✅ Verified as fixed" and resolved a thread on
 * the exact same commit as Claude's "will fix" reply — before the fix could
 * exist. These tests reproduce two of those real cases (PR #404's
 * console.error→wlLog.error claim, PR #409's kept→retainedEntries claim) as
 * fixtures: the guard must reject the claim against the diff that shipped
 * with the false "verified" comment, and accept it once the diff actually
 * contains the cited change.
 *
 * Run: node --test .github/scripts/test/verify-fix-claim.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addedLines, extractCitedSpans, isFixClaimCorroborated } from '../lib/verify-fix-claim.mjs';

describe('extractCitedSpans', () => {
  test('extracts a backtick code span', () => {
    assert.deepEqual(extractCitedSpans('Replaced with `wlLog.error`.'), ['wlLog.error']);
  });

  test('extracts a single-quoted phrase of at least 4 characters', () => {
    assert.deepEqual(extractCitedSpans("Rephrased to 'a clear description' here."), [
      'a clear description',
    ]);
  });

  test('extracts a double-quoted phrase of at least 4 characters', () => {
    assert.deepEqual(extractCitedSpans('Renamed to "retainedEntries" in the return value.'), [
      'retainedEntries',
    ]);
  });

  test('ignores quoted spans shorter than the minimum length', () => {
    // Single/double-quoted spans need 4+ chars; backtick spans need 2+.
    assert.deepEqual(extractCitedSpans("It's 'ok' now."), []);
  });

  test('extracts multiple distinct spans in order, de-duplicated', () => {
    const text = 'Renamed `kept` to `retainedEntries`, and `kept` again.';
    assert.deepEqual(extractCitedSpans(text), ['kept', 'retainedEntries']);
  });

  test('returns an empty array for a bare claim with no cited evidence', () => {
    assert.deepEqual(extractCitedSpans('Looks good, verified as fixed.'), []);
  });
});

describe('addedLines', () => {
  test('keeps only content lines starting with a single +', () => {
    const diff = [
      'diff --git a/f.js b/f.js',
      '--- a/f.js',
      '+++ b/f.js',
      '@@ -1,2 +1,2 @@',
      '-const x = 1;',
      '+const x = 2;',
      ' const y = 3;',
    ].join('\n');
    assert.deepEqual(addedLines(diff), ['const x = 2;']);
  });

  test('excludes the +++ file-header line', () => {
    const diff = '+++ b/pure-fns-backup.js\n+export function isWithinRetentionWindow() {}';
    assert.deepEqual(addedLines(diff), ['export function isWithinRetentionWindow() {}']);
  });

  test('returns an empty array for a diff with no additions', () => {
    const diff = '--- a/f.js\n+++ b/f.js\n@@ -1 +1 @@\n-const x = 1;\n';
    assert.deepEqual(addedLines(diff), []);
  });
});

describe('isFixClaimCorroborated', () => {
  test('rejects a claim citing no evidence at all', () => {
    const diff = '+++ b/f.js\n+const x = 2;';
    assert.equal(isFixClaimCorroborated('✅ Verified as fixed — looks good.', diff), false);
  });

  test('rejects a claim whose cited span is absent from every added line', () => {
    const diff = '+++ b/f.js\n+const x = 2;';
    assert.equal(
      isFixClaimCorroborated('✅ Verified as fixed — `wlLog.error` now used.', diff),
      false
    );
  });

  test('accepts a claim whose cited span appears in an added line', () => {
    const diff = '+++ b/f.js\n+  wlLog.error(message);';
    assert.equal(
      isFixClaimCorroborated('✅ Verified as fixed — `wlLog.error` now used.', diff),
      true
    );
  });

  test('accepts a claim citing a quoted phrase present verbatim in an added line', () => {
    const diff =
      "+++ b/test.mjs\n+  test('verifies the current count of single-letter arrow params in src/js/ has not grown beyond the baseline', async () => {";
    const reply =
      "✅ Verified as fixed — the test description has been rephrased to 'verifies the current count of single-letter arrow params in src/js/ has not grown beyond the baseline'.";
    assert.equal(isFixClaimCorroborated(reply, diff), true);
  });

  // ─── Real false-positive regressions (issue #416) ───

  test('PR #404: rejects the console.error→wlLog.error claim against the diff that actually shipped', () => {
    // The real diff at commit 65b238d — console.error was never touched.
    const diff = [
      '+++ b/.github/scripts/check-arrow-param-count.mjs',
      '+  console.error(',
      '+    `✖ ${count} single-letter arrow params found, up from a baseline of ${baseline}.\\n` +',
    ].join('\n');
    const reply =
      '✅ Verified as fixed — `console.error` has been replaced with `wlLog.error` at .github/scripts/check-arrow-param-count.mjs:56.';
    assert.equal(isFixClaimCorroborated(reply, diff), false);
  });

  test('PR #404: accepts the same claim once wlLog.error is genuinely in the diff', () => {
    const diff = [
      '+++ b/.github/scripts/check-arrow-param-count.mjs',
      '+  wlLog.error(',
      '+    `✖ ${count} single-letter arrow params found, up from a baseline of ${baseline}.\\n` +',
    ].join('\n');
    const reply =
      '✅ Verified as fixed — `console.error` has been replaced with `wlLog.error` at .github/scripts/check-arrow-param-count.mjs:56.';
    assert.equal(isFixClaimCorroborated(reply, diff), true);
  });

  test('PR #409: rejects the kept→retainedEntries claim against the diff that actually shipped', () => {
    // The real diff at commit 9b36749 — applyBackupRetention still returned `kept`.
    const diff = [
      '+++ b/src/js/pure-fns-backup.js',
      '+export function applyBackupRetention(entries, retentionDays, nowMs) {',
      '+  const kept = [];',
      '+  return { kept, dropped };',
      '+}',
    ].join('\n');
    const reply =
      '✅ Verified as fixed — the return property `kept` has been renamed to `retainedEntries` in `src/js/pure-fns-backup.js`.';
    assert.equal(isFixClaimCorroborated(reply, diff), false);
  });

  test('PR #409: accepts the same claim once retainedEntries is genuinely in the diff', () => {
    const diff = [
      '+++ b/src/js/pure-fns-backup.js',
      '+export function applyBackupRetention(entries, retentionDays, nowMs) {',
      '+  const retainedEntries = [];',
      '+  return { retainedEntries, dropped };',
      '+}',
    ].join('\n');
    const reply =
      '✅ Verified as fixed — the return property `kept` has been renamed to `retainedEntries` in `src/js/pure-fns-backup.js`.';
    assert.equal(isFixClaimCorroborated(reply, diff), true);
  });

  test('ignores a trailing backtick-quoted file path when picking the evidence span', () => {
    // Same claim as above, but the file path is the *last* backtick span —
    // without path-filtering, isFixClaimCorroborated would check for the
    // literal string "src/js/pure-fns-backup.js" instead of the rename.
    const diffMissingRename = '+++ b/src/js/pure-fns-backup.js\n+  const kept = [];';
    const reply =
      '✅ Verified as fixed — the return property `kept` has been renamed to `retainedEntries` in `src/js/pure-fns-backup.js`.';
    assert.equal(isFixClaimCorroborated(reply, diffMissingRename), false);
  });

  test('does not mistake a short method name for a file path (regression: `wlLog.warn`)', () => {
    // A generic "ends in .{1,4 word chars}" path test would misclassify
    // wlLog.warn as path-like (".warn" is 4 word characters) and fall back
    // to the actually-cited file-line reference instead — exactly the
    // failure mode this test guards against.
    const diff = '+++ b/12-meetings.js\n+  wlLog.warn(message);';
    const reply = '✅ Verified as fixed — `wlLog.warn` now in place at `12-meetings.js:73`.';
    assert.equal(isFixClaimCorroborated(reply, diff), true);
  });

  test('still rejects when the cited method name is genuinely absent, despite a file-path citation', () => {
    const diff = '+++ b/12-meetings.js\n+  console.warn(message);';
    const reply = '✅ Verified as fixed — `wlLog.warn` now in place at `12-meetings.js:73`.';
    assert.equal(isFixClaimCorroborated(reply, diff), false);
  });

  // ─── Multi-hunk diffs (issue #418) ───
  //
  // isFixClaimCorroborated searches every added line in the whole diff, not
  // just the hunk for the file named in the reply. That's fine when the last
  // cited span is genuinely new — but a diff can easily contain an unrelated
  // hunk whose added lines happen to contain the *old* name from a rename
  // claim (e.g. because that file does its own unrelated thing with a
  // similarly-named identifier). A naive "any cited span matches any added
  // line anywhere in the diff" implementation would treat that coincidental
  // match as corroboration; only checking the last non-path span guards
  // against it.

  test('rejects a rename claim when just an unrelated hunk happens to contain the old name', () => {
    const diff = [
      '+++ b/src/js/other-file.js',
      '+  const kept = legacyOldName();', // unrelated hunk, coincidentally contains the old span
      '+++ b/src/js/pure-fns-backup.js',
      '+  const somethingElse = 1;', // the file the claim is actually about — no rename here
    ].join('\n');
    const reply =
      '✅ Verified as fixed — the return property `kept` has been renamed to `retainedEntries` in `src/js/pure-fns-backup.js`.';
    assert.equal(isFixClaimCorroborated(reply, diff), false);
  });

  test('accepts a rename claim when the new name appears in a later hunk than an unrelated one', () => {
    const diff = [
      '+++ b/src/js/other-file.js',
      '+  const unrelatedChange = true;', // unrelated hunk, no relevant identifiers at all
      '+++ b/src/js/pure-fns-backup.js',
      '+  const retainedEntries = [];', // the actual rename, in a later hunk
    ].join('\n');
    const reply =
      '✅ Verified as fixed — the return property `kept` has been renamed to `retainedEntries` in `src/js/pure-fns-backup.js`.';
    assert.equal(isFixClaimCorroborated(reply, diff), true);
  });
});
