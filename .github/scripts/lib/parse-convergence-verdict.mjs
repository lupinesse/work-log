/**
 * Parse the ## Verdict section from a Phase 3 convergence summary comment.
 *
 * The convergence summary (posted by claude-convergence-summary.mjs) always
 * ends with a `## Verdict` section containing exactly one sentence:
 *
 *   "Blocked on N agreed fixes."
 *   "Clean — no blocking issues."
 *   "Blocked on N agreed fixes; N counter-positions on record for Phase 4."
 *
 * This module is the canonical parser used by both the claude-verdict-gate job
 * (inline copy) and the test suite. Any change to the verdict format must be
 * reflected here and in the workflow job's inline script.
 */

/**
 * Extract the verdict sentence from a Phase 3 convergence summary comment body.
 *
 * Matches the first non-empty line that follows a `## Verdict` heading anywhere
 * in the comment. Returns `null` when the heading or a sentence after it is not
 * found (e.g. the comment belongs to a different phase, or the section is empty).
 *
 * @param {string} body - Full PR comment body text.
 * @returns {string|null} The trimmed verdict sentence, or null if not found.
 * @example
 * extractVerdictLine('## Verdict\nBlocked on 2 agreed fixes.\n\n---')
 * // → 'Blocked on 2 agreed fixes.'
 *
 * extractVerdictLine('## Verdict\nClean — no blocking issues.')
 * // → 'Clean — no blocking issues.'
 *
 * extractVerdictLine('No verdict section here.')
 * // → null
 */
export function extractVerdictLine(body) {
  if (typeof body !== 'string') return null;
  const match = body.match(/^##\s+Verdict\s*\n+([^\n]+)/m);
  if (!match) return null;
  const trimmed = match[1].trim();
  return trimmed || null;
}

/**
 * Return `true` if the verdict sentence indicates the PR is blocked.
 *
 * A verdict is blocking when it starts with the word "Blocked" (case-sensitive,
 * matching the exact format the convergence summary system prompt produces).
 * `null` input (no verdict found) is treated as non-blocking so that PRs that
 * pre-date the dialogue or are too small to trigger Phase 3 are not gated.
 *
 * @param {string|null} verdictLine - The sentence from {@link extractVerdictLine}.
 * @returns {boolean} `true` if the verdict is blocking.
 * @example
 * isBlockingVerdict('Blocked on 2 agreed fixes.')      // → true
 * isBlockingVerdict('Clean — no blocking issues.')     // → false
 * isBlockingVerdict(null)                              // → false
 */
export function isBlockingVerdict(verdictLine) {
  if (!verdictLine) return false;
  return verdictLine.startsWith('Blocked');
}

/**
 * Extract the short commit SHA from a Phase 3 convergence summary comment footer.
 *
 * The footer written by `claude-convergence-summary.mjs` always ends with:
 *   `*Convergence summary by Claude \`model\` · commit \`abc1234\`*`
 *
 * Returns the 7-character short SHA, or `null` if the footer is absent (e.g.
 * the comment belongs to a different phase or was written by an older version).
 *
 * @param {string} body - Full PR comment body text.
 * @returns {string|null} The 7-char short SHA, or null if not found.
 * @example
 * extractCommentCommitSha('## Verdict\nClean.\n\n---\n*Convergence summary by Claude `m` · commit `abc1234`*')
 * // → 'abc1234'
 *
 * extractCommentCommitSha('some other comment')
 * // → null
 */
export function extractCommentCommitSha(body) {
  if (typeof body !== 'string') return null;
  const match = body.match(/·\s+commit\s+`([0-9a-f]{7,40})`/);
  return match ? match[1].slice(0, 7) : null;
}
