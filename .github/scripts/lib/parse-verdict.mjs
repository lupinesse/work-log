/**
 * Normalise and validate a top-level GitHub PR review verdict.
 *
 * Extracted so both Phase 1 (chatgpt-review.mjs) and Phase 4
 * (chatgpt-claude-dialogue.mjs) share the same validation rules and cannot
 * drift from each other.
 */

/** GitHub review states accepted by the pull-request reviews API. */
export const VALID_GITHUB_VERDICTS = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];

/**
 * Trim and validate a raw verdict value against the allowed GitHub review
 * states.
 *
 * Trimming catches models that emit trailing/leading whitespace (e.g.
 * `"COMMENT "`). Non-string values and unknown strings throw so callers
 * surface the error rather than silently passing a bad state to `upsertReview`.
 *
 * @param {*} raw Candidate verdict from the model's JSON output.
 * @returns {string} Trimmed, valid verdict string.
 * @throws {Error} If `raw` is not a string or is not one of the valid states.
 * @example
 * normaliseGithubVerdict('APPROVE')         // → 'APPROVE'
 * normaliseGithubVerdict('COMMENT ')        // → 'COMMENT'  (trimmed)
 * normaliseGithubVerdict('approve')         // throws — wrong case
 * normaliseGithubVerdict(true)              // throws — non-string
 * normaliseGithubVerdict(undefined)         // throws — absent
 */
export function normaliseGithubVerdict(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : null;
  if (!trimmed || !VALID_GITHUB_VERDICTS.includes(trimmed)) {
    throw new Error(`invalid GitHub review verdict: ${JSON.stringify(raw)}`);
  }
  return trimmed;
}
