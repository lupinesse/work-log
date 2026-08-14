/**
 * Unit tests for lib/duplicate-changelog-entries.mjs.
 *
 * Regression coverage for the duplication that reached `main` on 2026-08-14:
 * PRs #331 and #332 both documented the Log-view sort fix (#326) and merged
 * eleven minutes apart. Their bullets landed at different line offsets, so git
 * merged both without a conflict and the file described one change twice until
 * #340 removed a copy.
 *
 * The two real labels differed by a single word, so the exact-match check the
 * obvious implementation would use is itself under test here: REAL_LABEL_331
 * and REAL_LABEL_332 are the verbatim strings that shipped.
 *
 * Run: node --test .github/scripts/test/duplicate-changelog-entries.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_SECTION_COUNT,
  SIMILARITY_THRESHOLD,
  findDuplicateChangelogEntries,
  formatDuplicateReport,
  labelSimilarity,
  normalizeEntryLabel,
  parseChangelogEntries,
  parseChangelogSections,
} from '../lib/duplicate-changelog-entries.mjs';

/** Verbatim label from PR #331, filed under `## Unreleased`. */
const REAL_LABEL_331 = 'Log view entries now sort by start time, not insertion order';

/** Verbatim label from PR #332, filed under `## [1.9.2]`. One word apart. */
const REAL_LABEL_332 = 'Log view entries sort by start time, not insertion order';

/**
 * Build a changelog fixture with the real structure: an Unreleased section, a
 * `---` separator, then dated release sections.
 *
 * @param {object} sections - Maps a `## ` heading to its bullet labels.
 * @returns {string} Fixture text with LF endings.
 */
function buildChangelog(sections) {
  const lines = ['# Changelog', ''];
  for (const [heading, labels] of Object.entries(sections)) {
    lines.push(`## ${heading}`, '');
    if (labels.length > 0) lines.push('### Fixed');
    for (const label of labels) lines.push(`- **${label}** — details of the change.`);
    lines.push('', '---', '');
  }
  return lines.join('\n');
}

const CLEAN = buildChangelog({
  Unreleased: [],
  '[1.9.2] — 2026-08-14': [REAL_LABEL_332, 'Gap check skips non-billable entries'],
  '[1.9.1] — 2026-08-03': ['Ad-hoc log row did nothing on a zero-entry day'],
});

const DUPLICATED = buildChangelog({
  Unreleased: [REAL_LABEL_331],
  '[1.9.2] — 2026-08-14': [REAL_LABEL_332, 'Gap check skips non-billable entries'],
  '[1.9.1] — 2026-08-03': ['Ad-hoc log row did nothing on a zero-entry day'],
});

describe('normalizeEntryLabel', () => {
  test('lowercases and drops punctuation', () => {
    assert.deepEqual(normalizeEntryLabel('Sort, Fast!'), new Set(['sort', 'fast']));
  });

  test('drops stop words, including the "now" that alone separated #331 from #332', () => {
    assert.ok(!normalizeEntryLabel('entries now sort').has('now'));
  });

  test('keeps the text inside backticks rather than dropping the span', () => {
    // Dropping backticked spans wholesale collapsed "`.plan-text` colour" and
    // "`.jira-task-key` colour" to just "colour" — a false 100% match on two
    // unrelated real entries.
    const words = normalizeEntryLabel('`.plan-text` colour');
    assert.ok(words.has('plan'), 'identifier text must survive normalisation');
    assert.ok(words.has('text'));
  });

  test('returns an empty set for a label with no significant words', () => {
    assert.equal(normalizeEntryLabel('the and of').size, 0);
  });
});

describe('labelSimilarity', () => {
  test('scores identical word sets 1', () => {
    assert.equal(labelSimilarity(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
  });

  test('scores disjoint word sets 0', () => {
    assert.equal(labelSimilarity(new Set(['a']), new Set(['b'])), 0);
  });

  test('scores an empty set 0 rather than dividing by zero', () => {
    assert.equal(labelSimilarity(new Set(), new Set(['a'])), 0);
    assert.ok(Number.isFinite(labelSimilarity(new Set(), new Set())));
  });

  test('the two real labels score at or above the threshold', () => {
    const score = labelSimilarity(
      normalizeEntryLabel(REAL_LABEL_331),
      normalizeEntryLabel(REAL_LABEL_332)
    );
    assert.ok(
      score >= SIMILARITY_THRESHOLD,
      `real duplicate scored ${score}, below threshold ${SIMILARITY_THRESHOLD}`
    );
  });

  test('the closest genuinely-different real pair stays below the threshold', () => {
    // Highest-scoring non-duplicate pair measured across the real CHANGELOG.
    // If a future threshold change breaks this, the check starts crying wolf.
    const score = labelSimilarity(
      normalizeEntryLabel('End-of-day export warnings section'),
      normalizeEntryLabel('End-of-day export reminder')
    );
    assert.ok(
      score < SIMILARITY_THRESHOLD,
      `distinct entries scored ${score}, at or above threshold ${SIMILARITY_THRESHOLD}`
    );
  });
});

describe('parseChangelogEntries', () => {
  test('tags each entry with its nearest preceding section and 1-indexed line', () => {
    const entries = parseChangelogEntries('# Changelog\n\n## Unreleased\n\n- **A thing** — x');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].label, 'A thing');
    assert.equal(entries[0].section, 'Unreleased');
    assert.equal(entries[0].line, 5);
  });

  test('ignores bullets without a bold label and ### sub-headings', () => {
    const entries = parseChangelogEntries('## Unreleased\n\n### Fixed\n- plain bullet\n');
    assert.deepEqual(entries, []);
  });

  test('handles CRLF input identically to LF', () => {
    // The repo is developed on Windows with core.autocrlf=true, so a
    // working-tree read is CRLF while CI reads LF. A trailing \r would
    // otherwise contaminate the last word of every label.
    const lf = parseChangelogEntries(CLEAN);
    const crlf = parseChangelogEntries(CLEAN.replace(/\n/g, '\r\n'));
    assert.deepEqual(crlf, lf);
  });

  test('returns an empty array for an empty file', () => {
    assert.deepEqual(parseChangelogEntries(''), []);
  });
});

describe('parseChangelogSections', () => {
  test('lists every heading in file order, including empty ones', () => {
    // Regression: deriving section order from entries instead of headings
    // skipped an empty `## Unreleased` — the state of the file immediately
    // after a release is cut — which slid the "active" window down into
    // frozen history and flipped both assertions below.
    assert.deepEqual(parseChangelogSections(CLEAN), [
      'Unreleased',
      '[1.9.2] — 2026-08-14',
      '[1.9.1] — 2026-08-03',
    ]);
  });

  test('handles CRLF input', () => {
    assert.deepEqual(
      parseChangelogSections(CLEAN.replace(/\n/g, '\r\n')),
      parseChangelogSections(CLEAN)
    );
  });

  test('ignores ### sub-headings and # titles', () => {
    assert.deepEqual(parseChangelogSections('# Changelog\n## Unreleased\n### Fixed'), [
      'Unreleased',
    ]);
  });
});

describe('findDuplicateChangelogEntries', () => {
  test('regression: catches the real #331/#332 duplicate across two sections', () => {
    const duplicates = findDuplicateChangelogEntries(DUPLICATED);
    assert.equal(duplicates.length, 1);
    const sections = [duplicates[0].first.section, duplicates[0].second.section];
    assert.ok(sections.some((s) => s === 'Unreleased'));
    assert.ok(sections.some((s) => s.startsWith('[1.9.2]')));
  });

  test('regression: exact string matching would have missed that duplicate', () => {
    // The whole reason detection is similarity-based rather than exact.
    assert.notEqual(REAL_LABEL_331, REAL_LABEL_332);
  });

  test('reports nothing for the equivalent clean file', () => {
    assert.deepEqual(findDuplicateChangelogEntries(CLEAN), []);
  });

  test('catches a duplicate repeated within a single section', () => {
    const sameSection = buildChangelog({
      Unreleased: [REAL_LABEL_331, REAL_LABEL_332],
      '[1.9.1] — 2026-08-03': [],
    });
    assert.equal(findDuplicateChangelogEntries(sameSection).length, 1);
  });

  test('ignores a duplicate confined to frozen release history', () => {
    // Two old sections repeating each other cannot be fixed by the PR that
    // trips the check, so failing on them would block unrelated work.
    const oldOnly = buildChangelog({
      Unreleased: [],
      '[1.9.2] — 2026-08-14': [],
      '[1.9.1] — 2026-08-03': [REAL_LABEL_331],
      '[1.9.0] — 2026-06-12': [REAL_LABEL_332],
    });
    assert.deepEqual(findDuplicateChangelogEntries(oldOnly), []);
  });

  test('honours an overridden threshold', () => {
    const distinct = buildChangelog({
      Unreleased: ['Alpha beta gamma delta'],
      '[1.9.2] — 2026-08-14': ['Alpha beta gamma epsilon'],
    });
    assert.deepEqual(findDuplicateChangelogEntries(distinct), []);
    assert.equal(findDuplicateChangelogEntries(distinct, { threshold: 0.5 }).length, 1);
  });

  test('honours an overridden active-section count', () => {
    const oldOnly = buildChangelog({
      Unreleased: [],
      '[1.9.2] — 2026-08-14': [],
      '[1.9.1] — 2026-08-03': [REAL_LABEL_331],
      '[1.9.0] — 2026-06-12': [REAL_LABEL_332],
    });
    assert.equal(findDuplicateChangelogEntries(oldOnly, { activeSectionCount: 4 }).length, 1);
  });

  test('sorts the most similar pair first', () => {
    const many = buildChangelog({
      Unreleased: [REAL_LABEL_331, 'Alpha beta gamma delta epsilon'],
      '[1.9.2] — 2026-08-14': [REAL_LABEL_332, 'Alpha beta gamma delta zeta'],
    });
    const duplicates = findDuplicateChangelogEntries(many, { threshold: 0.5 });
    assert.ok(duplicates.length >= 2);
    assert.ok(duplicates[0].similarity >= duplicates[1].similarity);
  });

  test('throws an informative TypeError on non-string input', () => {
    // Without the guard the failure surfaces as "changelog.split is not a
    // function" from two frames deeper, which does not say what was wrong.
    for (const bad of [undefined, null, 42, {}]) {
      assert.throws(() => findDuplicateChangelogEntries(bad), {
        name: 'TypeError',
        message: /expects the changelog text as a string/,
      });
    }
  });

  test('defaults are the exported constants', () => {
    assert.equal(SIMILARITY_THRESHOLD, 0.85);
    assert.equal(ACTIVE_SECTION_COUNT, 2);
  });
});

describe('formatDuplicateReport', () => {
  test('returns an empty string when there is nothing to report', () => {
    assert.equal(formatDuplicateReport([]), '');
  });

  test('names both files, lines, sections, and labels', () => {
    const report = formatDuplicateReport(findDuplicateChangelogEntries(DUPLICATED));
    assert.match(report, /CHANGELOG\.md:\d+/);
    assert.match(report, /Unreleased/);
    assert.match(report, /% similar/);
    assert.ok(report.includes(REAL_LABEL_331));
    assert.ok(report.includes(REAL_LABEL_332));
  });
});
