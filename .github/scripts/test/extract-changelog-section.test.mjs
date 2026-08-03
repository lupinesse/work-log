/**
 * Unit tests for extractChangelogSection() in lib/extract-changelog-section.mjs.
 *
 * Regression coverage for the bug confirmed in PR #293: release.yml's prior
 * `awk` step did an exact match for a line reading literally "## v1.9.1",
 * but CHANGELOG.md has used the Keep a Changelog "## [X.Y.Z] — <date>"
 * heading format since the v1.9.0 consolidation (#216). The exact match
 * never matched, so the live v1.9.0 GitHub Release shipped with an empty
 * changelog body.
 *
 * Run: node --test .github/scripts/test/extract-changelog-section.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractChangelogSection } from '../lib/extract-changelog-section.mjs';

// Fixture mirrors the real CHANGELOG.md structure: an empty Unreleased
// section, a "---" separator, then dated version sections separated by
// "---", each with ### sub-headings — built from the actual headings in
// this repo's CHANGELOG.md (## Unreleased, ## [1.9.1], ## [1.9.0]).
const FIXTURE = [
  '# Changelog',
  '',
  '## Unreleased',
  '',
  '---',
  '',
  '## [1.9.1] — 2026-08-03',
  '',
  '### Changed',
  '- Non-billable relabeled as "internal".',
  '',
  '### Fixed',
  '- npm ci + commit broken on any fresh clone or worktree.',
  '',
  '---',
  '',
  '## [1.9.0] — 2026-06-12',
  '',
  '### Added',
  '- Merge entries from backup.',
  '',
].join('\n');

describe('extractChangelogSection', () => {
  test('extracts the matching version section, excluding the heading line', () => {
    const result = extractChangelogSection(FIXTURE, '1.9.1');
    assert.match(result, /Non-billable relabeled/);
    assert.match(result, /npm ci \+ commit broken/);
    assert.doesNotMatch(result, /## \[1\.9\.1\]/);
  });

  test('stops at the next "## " heading, excluding older sections', () => {
    const result = extractChangelogSection(FIXTURE, '1.9.1');
    assert.doesNotMatch(result, /Merge entries from backup/);
    assert.doesNotMatch(result, /## \[1\.9\.0\]/);
  });

  test('extracts an older section correctly too (regression check)', () => {
    const result = extractChangelogSection(FIXTURE, '1.9.0');
    assert.match(result, /Merge entries from backup/);
    assert.doesNotMatch(result, /Non-billable relabeled/);
  });

  test('trims leading and trailing blank lines', () => {
    const result = extractChangelogSection(FIXTURE, '1.9.1');
    assert.strictEqual(result[0], '#');
    assert.notStrictEqual(result.at(-1), '');
  });

  test('returns an empty string when no heading matches the version', () => {
    assert.strictEqual(extractChangelogSection(FIXTURE, '9.9.9'), '');
  });

  test('regression: the old exact-match convention ("## v1.9.1") would never have matched', () => {
    // This is the literal bug that shipped an empty v1.9.0 release: the old
    // awk script looked for a line equal to "## " + tag (e.g. "## v1.9.1"),
    // which never appears in this project's CHANGELOG — only the bracketed
    // "## [1.9.1] — <date>" form does.
    assert.ok(!FIXTURE.includes('## v1.9.1'));
    assert.notStrictEqual(extractChangelogSection(FIXTURE, '1.9.1'), '');
  });
});
