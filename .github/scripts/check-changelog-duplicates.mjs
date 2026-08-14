#!/usr/bin/env node
/**
 * CI guard: assert that no change is documented twice in CHANGELOG.md.
 *
 * Entry point only — the detection logic lives in
 * lib/duplicate-changelog-entries.mjs. Run via `npm run test:changelog`; wired
 * into the `lint` job in ci.yml so a duplicate fails a required check at PR
 * time instead of landing on `main`.
 *
 * Exists because git cannot see this class of mistake: PRs #331 and #332 both
 * documented the Log-view sort fix (#326) and merged eleven minutes apart, and
 * because their bullets were inserted at different line offsets, the merge was
 * conflict-free. The duplication reached `main` and needed a third PR (#340)
 * to undo.
 *
 * Exits 0 when the file is clean, 1 when it is not.
 */

import { readFileSync } from 'node:fs';

import {
  ACTIVE_SECTION_COUNT,
  SIMILARITY_THRESHOLD,
  findDuplicateChangelogEntries,
  formatDuplicateReport,
  parseChangelogEntries,
  parseChangelogSections,
} from './lib/duplicate-changelog-entries.mjs';

const CHANGELOG_PATH = 'CHANGELOG.md';

/**
 * Read CHANGELOG.md, report any duplicated entries, and pick an exit code.
 *
 * @returns {number} 0 when clean, 1 when duplicates were found or the file
 *   could not be read.
 */
function main() {
  let changelog;
  try {
    changelog = readFileSync(CHANGELOG_PATH, 'utf8');
  } catch (err) {
    console.error(`✖ could not read ${CHANGELOG_PATH} — ${err.message}`);
    return 1;
  }

  const threshold = `${Math.round(SIMILARITY_THRESHOLD * 100)}%`;
  const entries = parseChangelogEntries(changelog);
  const activeSections = parseChangelogSections(changelog).slice(0, ACTIVE_SECTION_COUNT);

  // Log the configuration actually in effect before doing the work, so a run
  // that reports "clean" also shows what it compared and how strictly.
  console.log(
    `changelog        ${CHANGELOG_PATH} (${entries.length} entries)\n` +
      `threshold        ${threshold} similarity\n` +
      `active sections  ${activeSections.join(', ') || '(none)'}`
  );

  const duplicates = findDuplicateChangelogEntries(changelog);

  if (duplicates.length === 0) {
    console.log(`✔ no duplicated CHANGELOG entries (nothing at or above ${threshold} similarity)`);
    return 0;
  }

  const plural = duplicates.length === 1 ? 'pair' : 'pairs';
  console.error(
    `✖ ${duplicates.length} ${plural} of CHANGELOG entries look like the same change documented twice:\n`
  );
  console.error(formatDuplicateReport(duplicates));
  console.error(
    '\nKeep one entry. If the change has already shipped in a tagged release,' +
      '\nkeep the copy in that release section — not the one under Unreleased,' +
      '\nwhich would announce it a second time under the next version.' +
      '\n\nIf these really are two distinct changes, reword one label so they' +
      `\nread differently, or revisit SIMILARITY_THRESHOLD (currently ${threshold}).`
  );
  return 1;
}

process.exit(main());
