/**
 * Pure detection of the same change being documented twice in CHANGELOG.md.
 *
 * Written after PRs #331 and #332 both documented the Log-view sort fix (#326)
 * and merged eleven minutes apart, leaving `main` describing it twice — once
 * under `## Unreleased`, once under `## [1.9.2]`. Git raised no conflict: the
 * two bullets were inserted at different line offsets, so the duplication was
 * semantic, not textual, and nothing in the pipeline was looking for it.
 *
 * Exact string matching would not have caught that case. The two labels were
 * "Log view entries now sort by start time, not insertion order" and "Log view
 * entries sort by start time, not insertion order" — one word apart. Detection
 * is therefore similarity-based, over normalised word sets.
 */

/**
 * Dice-coefficient score above which two entry labels are treated as the same
 * change documented twice.
 *
 * Derived from the real file rather than guessed. Measured across all 11,628
 * label pairs in CHANGELOG.md at the time of writing (153 entries):
 *
 * - highest-scoring pair of genuinely *different* entries: **0.667**
 *   ("End-of-day export warnings section" vs "End-of-day export reminder")
 * - the real #331/#332 duplicate: **1.000**
 *
 * 0.85 leaves a wide margin on both sides. It sits far enough above 0.667 that
 * a blocking check will not cry wolf over two genuinely distinct entries that
 * happen to share a topic, and far enough below 1.000 to still catch a
 * duplicate whose wording drifted by a word or two — the realistic failure
 * mode when two authors describe the same commit.
 */
export const SIMILARITY_THRESHOLD = 0.85;

/**
 * How many `## ` sections, counted from the top of the file, are treated as
 * still open to new bullets.
 *
 * Released sections below these are frozen — they cannot gain a duplicate
 * without someone editing history — so restricting comparisons to pairs that
 * touch an active section removes most of the false-positive surface without
 * losing real detections. Two covers the realistic editing window: `##
 * Unreleased` plus the most recent release, which is exactly where #331 and
 * #332 landed.
 */
export const ACTIVE_SECTION_COUNT = 2;

/**
 * Words carrying no distinguishing signal between two changelog entries.
 *
 * Deliberately short. Every word removed here raises the similarity of every
 * pair, so this list is limited to articles, prepositions, and the handful of
 * connectives that routinely differ between two descriptions of one change
 * ("now", "no longer") — including the "now" that was the sole difference
 * between the #331 and #332 labels.
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'its',
  'longer',
  'no',
  'not',
  'now',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'when',
  'with',
]);

/** Matches a top-level list item opening with bold text: `- **Label** — …`. */
const ENTRY_PATTERN = /^- \*\*(.+?)\*\*/;

/**
 * Reduce an entry label to the set of words that distinguish it.
 *
 * Punctuation and Markdown emphasis are stripped rather than the spans they
 * wrap: dropping backticked code spans wholesale collapsed "`.plan-text`
 * colour" and "`.jira-task-key` colour" to the single word "colour", scoring a
 * false 1.000 on two unrelated entries. Keeping the identifier text and
 * splitting it on punctuation scores those two 0.286 instead.
 *
 * @param {string} label - Raw label text from between the `**` markers.
 * @returns {Set<string>} Lowercased, de-duplicated significant words.
 * @example
 * normalizeEntryLabel('Log view entries **now** sort by `ts`')
 * // → Set { 'log', 'view', 'entries', 'sort', 'ts' }
 */
export function normalizeEntryLabel(label) {
  return new Set(
    label
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 0 && !STOP_WORDS.has(word))
  );
}

/**
 * Score how alike two normalised labels are, using the Dice coefficient.
 *
 * Dice rather than Jaccard because it weights the shared words more heavily,
 * which suits labels of unequal length — a duplicate that gained a trailing
 * clause should still score high.
 *
 * @param {Set<string>} first - Normalised words of one label.
 * @param {Set<string>} second - Normalised words of the other.
 * @returns {number} Similarity in the range 0–1; 0 if either set is empty.
 * @example
 * labelSimilarity(new Set(['a', 'b']), new Set(['a', 'b'])) // → 1
 */
export function labelSimilarity(first, second) {
  if (first.size === 0 || second.size === 0) return 0;

  let shared = 0;
  for (const word of first) {
    if (second.has(word)) shared += 1;
  }
  return (2 * shared) / (first.size + second.size);
}

/**
 * Extract every bold-labelled bullet from a changelog, tagged with its section.
 *
 * Line endings are normalised first: this repo is developed on Windows with
 * `core.autocrlf=true`, so a working-tree read yields CRLF while CI reads LF,
 * and a trailing `\r` would otherwise leak into the final word of each label.
 *
 * @param {string} changelog - Full CHANGELOG.md text.
 * @returns {Array<{label: string, section: string, line: number}>} Entries in
 *   file order. `section` is the nearest preceding `## ` heading (empty string
 *   before the first one); `line` is 1-indexed.
 * @example
 * parseChangelogEntries('## Unreleased\n- **Fixed a thing** — details')
 * // → [{ label: 'Fixed a thing', section: 'Unreleased', line: 2 }]
 */
export function parseChangelogEntries(changelog) {
  const entries = [];
  let section = '';

  changelog.split('\n').forEach((rawLine, index) => {
    const line = rawLine.replace(/\r$/, '');

    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      return;
    }

    const match = ENTRY_PATTERN.exec(line);
    if (match) {
      entries.push({ label: match[1], section, line: index + 1 });
    }
  });

  return entries;
}

/**
 * List every `## ` heading in file order.
 *
 * Derived from the headings themselves rather than from the sections entries
 * happen to sit in: `## Unreleased` is routinely empty right after a release
 * is cut, and counting only populated sections would silently slide the active
 * window down into frozen history — making an old, unfixable duplicate fail
 * the check while a genuinely new one went unnoticed.
 *
 * @param {string} changelog - Full CHANGELOG.md text.
 * @returns {string[]} Headings, in order, without the leading `## `.
 * @example
 * parseChangelogSections('## Unreleased\n\n## [1.0.0] — 2026-01-01')
 * // → ['Unreleased', '[1.0.0] — 2026-01-01']
 */
export function parseChangelogSections(changelog) {
  return changelog
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim());
}

/**
 * Compare every pair of entries and collect those scoring at or above the
 * threshold.
 *
 * Pairs where neither side sits in an active section are skipped, so frozen
 * release history cannot fail the check on its own.
 *
 * The scan is O(n²) in the number of entries, which is the honest cost of
 * "compare everything to everything" and is not worth optimising away at this
 * scale: measured at 0.94 ms for the real file (153 entries, 11,628 pairs) and
 * 12.6 ms for a synthetic file ten times that size (1,554 entries, ~1.2M
 * pairs). At roughly 50 entries per release this stays negligible for years.
 * Revisit only if the file reaches five figures.
 *
 * @param {Array<{section: string, words: Set<string>}>} entries - Parsed
 *   entries with their normalised word sets.
 * @param {Set<string>} activeSections - Sections still open to new bullets.
 * @param {number} threshold - Score at or above which a pair is collected.
 * @returns {Array<{similarity: number, first: object, second: object}>} Pairs
 *   in discovery order.
 */
function collectSimilarPairs(entries, activeSections, threshold) {
  const pairs = [];

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const first = entries[i];
      const second = entries[j];

      const touchesActiveSection =
        activeSections.has(first.section) || activeSections.has(second.section);
      if (!touchesActiveSection) continue;

      const similarity = labelSimilarity(first.words, second.words);
      if (similarity >= threshold) {
        pairs.push({ similarity, first, second });
      }
    }
  }

  return pairs;
}

/**
 * Find changes that appear to be documented more than once.
 *
 * Orchestration only: parsing, normalisation, and pair scanning each live in
 * their own function. Only pairs where at least one side sits in an active
 * section are compared, so frozen release history cannot fail the check.
 *
 * @throws {TypeError} When `changelog` is not a string — a bare `.split()`
 *   failure deeper in the call stack would not say what was actually wrong.
 *
 * @param {string} changelog - Full CHANGELOG.md text.
 * @param {object} [options] - Overrides, for tests and future tuning.
 * @param {number} [options.threshold=SIMILARITY_THRESHOLD] - Score at or above
 *   which a pair is reported.
 * @param {number} [options.activeSectionCount=ACTIVE_SECTION_COUNT] - How many
 *   leading sections count as active.
 * @returns {Array<{similarity: number, first: object, second: object}>} Pairs
 *   sorted most-similar first; empty when the file is clean.
 * @example
 * findDuplicateChangelogEntries(text).length === 0 // → clean
 */
export function findDuplicateChangelogEntries(changelog, options = {}) {
  if (typeof changelog !== 'string') {
    throw new TypeError(
      `findDuplicateChangelogEntries expects the changelog text as a string, received ${typeof changelog}`
    );
  }

  const { threshold = SIMILARITY_THRESHOLD, activeSectionCount = ACTIVE_SECTION_COUNT } = options;

  const entries = parseChangelogEntries(changelog).map((entry) => ({
    ...entry,
    words: normalizeEntryLabel(entry.label),
  }));
  const activeSections = new Set(parseChangelogSections(changelog).slice(0, activeSectionCount));

  return collectSimilarPairs(entries, activeSections, threshold).sort(
    (a, b) => b.similarity - a.similarity
  );
}

/**
 * Render duplicates as an operator-facing report.
 *
 * @param {Array<{similarity: number, first: object, second: object}>} duplicates
 *   Result of {@link findDuplicateChangelogEntries}.
 * @returns {string} Human-readable report; empty string when there is nothing
 *   to report.
 */
export function formatDuplicateReport(duplicates) {
  if (duplicates.length === 0) return '';

  return duplicates
    .map(({ similarity, first, second }) => {
      const score = `${Math.round(similarity * 100)}% similar`;
      return (
        `  ${score}\n` +
        `    CHANGELOG.md:${first.line}  [${first.section}]  ${first.label}\n` +
        `    CHANGELOG.md:${second.line}  [${second.section}]  ${second.label}`
      );
    })
    .join('\n\n');
}
