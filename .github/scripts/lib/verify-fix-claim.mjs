/**
 * @file verify-fix-claim.mjs
 * Deterministic corroboration check for Phase 4's "resolve" claims in the
 * chatgpt/claude PR-review dialogue (chatgpt-claude-dialogue.mjs).
 *
 * Phase 4 is instructed to confirm Claude's agree_fix changes are present in
 * the current diff before posting "✅ Verified as fixed" and resolving the
 * thread — but an LLM told to check a diff can still assert a match without
 * having done so. Issue #416 found three confirmed cases where the
 * verification reply landed on the very same commit as Claude's "will fix"
 * reply, before any fix could exist, and the cited file still had the
 * original code.
 *
 * This module re-checks the model's own claim mechanically: it extracts the
 * specific code identifier or quoted phrase the reply cites as evidence and
 * confirms that text actually appears in an added line of the diff. It
 * cannot prove a fix is *correct* — only that the cited evidence is not
 * fabricated. A reply resolving a thread without citing any checkable
 * evidence is treated the same as one whose evidence doesn't match: a bare
 * "looks good" is not itself evidence.
 */

const QUOTED_SPAN = /`([^`]{2,})`|'([^']{4,})'|"([^"]{4,})"/g;

/**
 * Extracts the code identifiers and quoted phrases a review reply cites as
 * evidence — backtick code spans, and single/double-quoted phrases of at
 * least 4 characters (shorter quoted spans are usually punctuation, not
 * evidence).
 *
 * @param {string} text - A reply body, e.g. a "✅ Verified as fixed — ..." comment.
 * @returns {string[]} Distinct cited spans, in the order they first appear.
 */
export function extractCitedSpans(text) {
  const spans = [];
  const seen = new Set();
  for (const match of text.matchAll(QUOTED_SPAN)) {
    const span = match[1] ?? match[2] ?? match[3];
    if (span && !seen.has(span)) {
      seen.add(span);
      spans.push(span);
    }
  }
  return spans;
}

/**
 * Extracts only the added (`+`) content lines from a unified diff, excluding
 * the `+++` file-header lines (which also start with `+` but name a file,
 * not content).
 *
 * @param {string} diff - Unified diff text.
 * @returns {string[]} The text of each added line, with its leading `+` stripped.
 */
export function addedLines(diff) {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

// Extensions actually used for file references in this repo's review
// replies. Deliberately a plain whitelist checked by string comparison, not
// a regex like /\.\w{1,4}$/ — that generic form also matches ordinary short
// property/method names ("wlLog.warn", "console.info" — a 4-letter final
// segment), which would then get excluded from consideration as evidence by
// mistake, and a regex alternation this wide trips ESLint's
// security/detect-unsafe-regex heuristic for no actual ReDoS risk.
const PATH_EXTENSIONS = new Set([
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'json',
  'yml',
  'yaml',
  'md',
  'html',
  'htm',
  'css',
  'scss',
  'ps1',
  'sh',
  'cff',
  'txt',
]);

/**
 * True when a cited span looks like a file reference rather than a code
 * identifier or quoted phrase — contains a path separator, or ends in a
 * known source-file extension (optionally with a trailing `:line`).
 *
 * @param {string} span - A single span from {@link extractCitedSpans}.
 * @returns {boolean}
 */
function isPathLike(span) {
  if (span.includes('/') || span.includes('\\')) return true;
  const withoutLineNumber = span.replace(/:\d+$/, '');
  const dot = withoutLineNumber.lastIndexOf('.');
  if (dot === -1) return false;
  return PATH_EXTENSIONS.has(withoutLineNumber.slice(dot + 1).toLowerCase());
}

/**
 * Decides whether a "resolve" reply's fix claim is corroborated by the diff.
 *
 * Uses only the *last* cited span, not "any" of them, and ignores spans that
 * look like a file path — replies routinely back-tick the file they're
 * pointing at (`` `src/js/pure-fns-backup.js` ``), and that citation is a
 * location, not evidence.
 *
 * A rename-style claim naturally cites both names — "renamed `kept` to
 * `retainedEntries`", "replaced `console.error` with `wlLog.error`" — and
 * the old name is trivially still present in an added line of an *unfixed*
 * diff (it's exactly what should have changed away from), so matching on any
 * cited span lets a false claim pass on its own old-name citation. English
 * phrasing for both fixes and pure renames consistently puts the
 * destination/new value last, so the last non-path span is the one actually
 * claimed to be new.
 *
 * @param {string} replyBody - The proposed reply body (before attribution).
 * @param {string} diff - The PR's unified diff.
 * @returns {boolean} True when the last non-path cited span is present in an added line.
 */
export function isFixClaimCorroborated(replyBody, diff) {
  const cited = extractCitedSpans(replyBody);
  if (cited.length === 0) return false;
  const contentSpans = cited.filter((span) => !isPathLike(span));
  const candidates = contentSpans.length > 0 ? contentSpans : cited;
  const target = candidates[candidates.length - 1];
  return addedLines(diff).some((line) => line.includes(target));
}
