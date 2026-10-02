/**
 * @file architecture-line-counts.mjs
 * Pure logic for the ARCHITECTURE.md per-module line-count drift check.
 *
 * ARCHITECTURE.md documents each `src/js` module's non-blank line count
 * inline, e.g. `#### **04-render.js** (56 lines)` for a top-level module or
 * `` - `pure-fns-format.js` (216 lines) `` for a barrel sub-module. Five
 * consecutive weekly QA reviews (2026-08-03 through 2026-09-21) found these
 * counts drifted from reality — sometimes by a single line, once by 34% —
 * because they were corrected by hand, module by module, whenever a QA
 * review happened to notice. A 2026-09-28 full re-audit found 19 drifted
 * entries, not the 6 that had been individually tracked in issues so far.
 *
 * This module extracts every documented count from the markdown and
 * compares it against the file's real non-blank line count, so drift is
 * caught mechanically instead of by manual re-audit.
 */

import { readFileSync } from 'node:fs';

const HEADER_PATTERN = /\*\*([a-zA-Z0-9_.-]+\.js)\*\* \((\d+) lines\)/g;
const SUBMODULE_PATTERN = /`([a-zA-Z0-9_.-]+\.js)` \((\d+) lines\)/g;

/**
 * Extracts every documented `(N lines)` count for a `.js` file from
 * ARCHITECTURE.md's markdown, covering both the top-level module header
 * form (`**file.js** (N lines)`) and the barrel sub-module list form
 * (`` `file.js` (N lines) ``).
 *
 * @param {string} markdown - The full text of ARCHITECTURE.md.
 * @returns {{file: string, documented: number}[]} One entry per documented
 *   count, in the order they appear. A file documented in both forms (it
 *   shouldn't be, but nothing enforces that) yields two entries.
 */
export function extractDocumentedCounts(markdown) {
  const entries = [];
  for (const pattern of [HEADER_PATTERN, SUBMODULE_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of markdown.matchAll(pattern)) {
      entries.push({ file: match[1], documented: Number(match[2]) });
    }
  }
  return entries;
}

/**
 * Counts the non-blank lines in a file's contents, matching the convention
 * ARCHITECTURE.md states it uses (`grep -c .`): a line counts whenever it
 * contains any character, even whitespace; only a truly empty line is
 * excluded.
 *
 * @param {string} contents - The file's full text.
 * @returns {number} The non-blank line count.
 */
export function countNonBlankLines(contents) {
  return contents.split('\n').filter((line) => line.trimEnd() !== '').length;
}

/**
 * Compares every count ARCHITECTURE.md documents against the real file,
 * reading each file with the given loader.
 *
 * @param {string} markdown - The full text of ARCHITECTURE.md.
 * @param {(file: string) => string} readSourceFile - Given a bare filename
 *   (e.g. `04-render.js`), returns that file's full text. Throws (any error)
 *   if the file cannot be read — used to detect a documented file that no
 *   longer exists.
 * @returns {{file: string, documented: number, actual: number|null}[]}
 *   Only the entries that don't match: `actual` is `null` when the file
 *   could not be read at all (documented file is missing or moved).
 */
export function findMismatches(markdown, readSourceFile) {
  const mismatches = [];
  for (const { file, documented } of extractDocumentedCounts(markdown)) {
    let actual;
    try {
      actual = countNonBlankLines(readSourceFile(file));
    } catch {
      mismatches.push({ file, documented, actual: null });
      continue;
    }
    if (actual !== documented) {
      mismatches.push({ file, documented, actual });
    }
  }
  return mismatches;
}

/**
 * A {@link findMismatches} file reader backed by the real filesystem,
 * resolving each bare filename under `src/js/`.
 *
 * @param {string} file - Bare filename, e.g. `04-render.js`.
 * @returns {string} The file's contents.
 */
export function readFromSrcJs(file) {
  return readFileSync(`src/js/${file}`, 'utf8');
}
