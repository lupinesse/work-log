#!/usr/bin/env node
/**
 * CI guard: fail if ARCHITECTURE.md's documented per-module line counts
 * have drifted from the real files.
 *
 * Entry point only — the parsing/comparison logic lives in
 * lib/architecture-line-counts.mjs. Run via `npm run
 * test:architecture-line-counts`; wired into the `lint` job in ci.yml.
 *
 * Five consecutive weekly QA reviews found these counts wrong because they
 * were corrected by hand whenever a review happened to notice — and a full
 * re-audit on 2026-09-28 found three times as many drifted entries as the
 * ones already tracked in issues. This script regenerates every count on
 * every PR so drift is caught the same day it's introduced, not weeks later.
 *
 * Exits 0 when every documented count matches, 1 when any has drifted.
 */

import { readFileSync } from 'node:fs';

import { findMismatches, readFromSrcJs } from './lib/architecture-line-counts.mjs';

/**
 * Reads ARCHITECTURE.md, checks its documented counts, and reports drift.
 *
 * @returns {number} 0 when every count matches, 1 otherwise.
 */
function main() {
  const markdown = readFileSync('ARCHITECTURE.md', 'utf8');
  const mismatches = findMismatches(markdown, readFromSrcJs);

  if (mismatches.length === 0) {
    console.log('✔ every ARCHITECTURE.md per-module line count matches its file');
    return 0;
  }

  console.error(`✖ ${mismatches.length} ARCHITECTURE.md line count(s) out of date:`);
  for (const { file, documented, actual } of mismatches) {
    if (actual === null) {
      console.error(`  ${file}: documented ${documented} lines, but src/js/${file} was not found`);
    } else {
      console.error(`  ${file}: documented ${documented} lines, actual ${actual}`);
    }
  }
  console.error(
    '\nUpdate the "(N lines)" count(s) above in ARCHITECTURE.md to match ' +
      '`grep -c . src/js/<file>` (the convention the document itself states at the top).'
  );
  return 1;
}

process.exit(main());
