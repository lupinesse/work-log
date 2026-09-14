/**
 * @file arrow-param-ratchet.mjs
 * Pure logic for the single-letter-arrow-param ratchet check.
 *
 * eslint.config.js's `no-restricted-syntax` rule for a single-letter arrow
 * parameter (`NO_SINGLE_LETTER_ARROW_PARAM`) is deliberately `'warn'`, not
 * `'error'` — the pre-existing instances across `src/js/` were never going to
 * be bulk-renamed, so failing lint on them would just make `npm run lint`
 * permanently red for no fix anyone intends to make. But a warning alone did
 * not stop the count growing: it rose from 294 to 297 over two weekly QA
 * reviews before unrelated refactors brought it back down. This ratchet is the
 * actual enforcement those reviews kept recommending — new code cannot add to
 * the pile, even though the existing pile is left alone.
 *
 * `BASELINE_COUNT` below is the only place the current size of that pile is
 * recorded. Prose here deliberately doesn't restate it: the figure was
 * duplicated across this docblock and eslint.config.js's comment, and both
 * copies were left saying 292 when a rebase moved the real baseline to 289.
 */

/** Baseline as measured on `main` on 2026-09-14. Never raise this by hand —
 * only a genuine drop in the real count should lower it. */
export const BASELINE_COUNT = 289;

/**
 * `no-restricted-syntax` is used for exactly one selector in
 * `eslint.config.js` (`NO_SINGLE_LETTER_ARROW_PARAM`), so its `ruleId`
 * alone identifies every message this ratchet cares about. Matching on
 * `ruleId` rather than the human-readable message text means a future
 * copy edit to that text can't silently break the count down to a
 * permanent, undetected 0 — the same pattern the rule's own sibling test
 * (`eslint-single-letter-arrow.test.mjs`) already relies on.
 */
const RATCHETED_RULE_ID = 'no-restricted-syntax';

/**
 * Counts how many of the given ESLint messages are from the single-letter
 * arrow-param rule.
 *
 * @param {import('eslint').Linter.LintMessage[]} messages - Flattened
 *   messages from one or more `ESLint#lintFiles()` results.
 * @returns {number} How many messages match the rule.
 */
export function countArrowParamWarnings(messages) {
  return messages.filter((message) => message.ruleId === RATCHETED_RULE_ID).length;
}

/**
 * Decides the ratchet's verdict for a measured count against the baseline.
 *
 * @param {number} count - The count measured this run.
 * @param {number} [baseline] - The baseline to ratchet against.
 * @returns {{ok: boolean, count: number, baseline: number}} `ok` — false
 *   only when `count` exceeds `baseline`, true when it is equal or lower.
 *   `count` — the measured count, echoed back unchanged. `baseline` — the
 *   baseline it was compared against, echoed back unchanged.
 */
export function evaluateRatchet(count, baseline = BASELINE_COUNT) {
  return { ok: count <= baseline, count, baseline };
}

/**
 * Flags a measured count of exactly 0 as implausible rather than clean.
 *
 * The pre-existing pile in `src/js/` — hundreds strong — is not going to be
 * bulk-renamed (that's the whole reason this is a ratchet and not a hard
 * lint error), so a real run can never legitimately measure 0 — a 0
 * reading means `countArrowParamWarnings()` stopped matching real ESLint
 * output (rule renamed, disabled, or its message coupling broken), not
 * that the codebase got clean. Left uncaught, `evaluateRatchet(0, ...)`
 * reports `ok: true` forever, silently defeating the whole ratchet.
 *
 * @param {number} count - The count measured this run.
 * @returns {boolean} True when `count` is 0 and therefore suspicious.
 */
export function isSuspiciouslyZero(count) {
  return count === 0;
}
