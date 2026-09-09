/**
 * @file arrow-param-ratchet.mjs
 * Pure logic for the single-letter-arrow-param ratchet check.
 *
 * eslint.config.js's `no-restricted-syntax` rule for a single-letter arrow
 * parameter (`NO_SINGLE_LETTER_ARROW_PARAM`) is deliberately `'warn'`, not
 * `'error'` — the ~292 pre-existing instances across `src/js/` were never
 * going to be bulk-renamed, so failing lint on them would just make `npm run
 * lint` permanently red for no fix anyone intends to make. But a warning
 * alone did not stop the count growing: it rose from 294 to 297 over two
 * weeks before dropping back to 292 as unrelated refactors touched some of
 * the flagged files. This ratchet is the actual enforcement the weekly QA
 * review kept recommending — new code cannot add to the pile, even though
 * the existing pile is left alone.
 */

/** Baseline as measured on `main` on 2026-09-09. Never raise this by hand —
 * only a genuine drop in the real count should lower it. */
export const BASELINE_COUNT = 292;

const RULE_MESSAGE = /^Single-letter arrow-function parameter/;

/**
 * Counts how many of the given ESLint messages are from the single-letter
 * arrow-param rule.
 *
 * @param {import('eslint').Linter.LintMessage[]} messages - Flattened
 *   messages from one or more `ESLint#lintFiles()` results.
 * @returns {number} How many messages match the rule.
 */
export function countArrowParamWarnings(messages) {
  return messages.filter((message) => RULE_MESSAGE.test(message.message)).length;
}

/**
 * Decides the ratchet's verdict for a measured count against the baseline.
 *
 * @param {number} count - The count measured this run.
 * @param {number} [baseline] - The baseline to ratchet against.
 * @returns {{ok: boolean, count: number, baseline: number}} `ok` is false
 *   only when `count` exceeds `baseline` — equal or lower both pass.
 */
export function evaluateRatchet(count, baseline = BASELINE_COUNT) {
  return { ok: count <= baseline, count, baseline };
}
