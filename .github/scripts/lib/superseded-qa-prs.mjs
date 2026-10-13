/**
 * Pure selection of QA report PRs that a newer report has superseded.
 *
 * Weekly QA reports land as a draft PR because `main` is protected — nothing
 * ever merges them, so without a rule they pile up and every week reads as a
 * failed merge. The rule is: the newest report supersedes older report PRs.
 *
 * Matching used to key off a `claude/qa-review-YYYY-MM-DD` head-branch prefix.
 * That broke in practice: QA reports have also landed via branches named
 * `claude/weekly-qa-YYYY-MM-DD` and session-generated names such as
 * `claude/fervent-bardeen-prafg5` (whatever branch the agent that ran the
 * review happened to create), so the prefix never matched and PRs #629 and
 * #638 were never closed. The PR *title* is what this workflow and `gh pr
 * create` actually standardise on ("Weekly QA report YYYY-MM-DD"), so matching
 * is now anchored on that instead — exact, full-string, so an unrelated PR
 * that merely mentions "QA" in its title is still never caught by it.
 */

/** Exact title pattern that identifies a weekly QA report PR. */
export const QA_REPORT_TITLE_PATTERN = /^Weekly QA report \d{4}-\d{2}-\d{2}$/;

/**
 * Pick the open QA report PRs that are not the current report's PR.
 *
 * @param {string} rawJson - Raw stdout from `gh pr list --json number,title`.
 * @param {string} currentTitle - Title of the report PR just created, e.g.
 *   "Weekly QA report 2026-10-12".
 * @returns {number[]} PR numbers to close as superseded, in input order.
 * @throws {Error} If `rawJson` is not a JSON array, if `currentTitle` is not a
 *   QA report title, or if an entry lacks a numeric `number` or string
 *   `title` — a malformed `gh` response must surface loudly, never be read as
 *   "nothing to close".
 * @example
 * selectSupersededPrs('[{"number":3,"title":"Weekly QA report 2026-09-21"}]',
 *   'Weekly QA report 2026-09-28') // → [3]
 */
export function selectSupersededPrs(rawJson, currentTitle) {
  const parsed = JSON.parse(rawJson);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected an array from "gh pr list --json number,title", got: ${rawJson}`);
  }
  if (!QA_REPORT_TITLE_PATTERN.test(currentTitle)) {
    throw new Error(
      `Current PR title "${currentTitle}" is not a QA report title (expected "Weekly QA report YYYY-MM-DD")`
    );
  }
  return parsed
    .filter((pr) => {
      if (typeof pr?.number !== 'number' || typeof pr?.title !== 'string') {
        throw new Error(`Unexpected PR entry from gh: ${JSON.stringify(pr)}`);
      }
      return QA_REPORT_TITLE_PATTERN.test(pr.title) && pr.title !== currentTitle;
    })
    .map((pr) => pr.number);
}
