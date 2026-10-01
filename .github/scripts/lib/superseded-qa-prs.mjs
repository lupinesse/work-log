/**
 * Pure selection of QA report PRs that a newer report has superseded.
 *
 * Weekly QA reports land via a dated branch (`claude/qa-review-YYYY-MM-DD`) and
 * a draft PR, because `main` is protected. Nothing ever merges those PRs, so
 * without a rule they pile up and every week reads as a failed merge. The rule
 * is: the newest report supersedes older report PRs. Matching on the branch
 * prefix rather than a title search keeps unrelated PRs that merely mention
 * "QA" safe from being closed.
 */

/** Head-branch prefix that identifies a weekly QA report PR. */
export const QA_REPORT_BRANCH_PREFIX = 'claude/qa-review-';

/**
 * Pick the open QA report PRs that are not the current report's PR.
 *
 * @param {string} rawJson - Raw stdout from `gh pr list --json number,headRefName`.
 * @param {string} currentBranch - Head branch of the report just created.
 * @returns {number[]} PR numbers to close as superseded, in input order.
 * @throws {Error} If `rawJson` is not a JSON array, or an entry lacks a numeric
 *   `number` or string `headRefName` — a malformed `gh` response must surface
 *   loudly, never be read as "nothing to close".
 * @example
 * selectSupersededPrs('[{"number":3,"headRefName":"claude/qa-review-2026-09-21"}]',
 *   'claude/qa-review-2026-09-28') // → [3]
 */
export function selectSupersededPrs(rawJson, currentBranch) {
  const parsed = JSON.parse(rawJson);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Expected an array from "gh pr list --json number,headRefName", got: ${rawJson}`
    );
  }
  if (!currentBranch.startsWith(QA_REPORT_BRANCH_PREFIX)) {
    throw new Error(
      `Current branch "${currentBranch}" is not a QA report branch (expected prefix "${QA_REPORT_BRANCH_PREFIX}")`
    );
  }
  return parsed
    .filter((pr) => {
      if (typeof pr?.number !== 'number' || typeof pr?.headRefName !== 'string') {
        throw new Error(`Unexpected PR entry from gh: ${JSON.stringify(pr)}`);
      }
      return pr.headRefName.startsWith(QA_REPORT_BRANCH_PREFIX) && pr.headRefName !== currentBranch;
    })
    .map((pr) => pr.number);
}
