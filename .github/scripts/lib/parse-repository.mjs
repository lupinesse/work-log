/**
 * Pure parsing of the `GITHUB_REPOSITORY` environment value.
 *
 * The review scripts used `must('GITHUB_REPOSITORY').split('/')` and
 * destructured the result, so a value without a slash left `repo` undefined and
 * surfaced later as an unhelpful 404 from the GitHub API. Validating the shape
 * once, here, fails at startup with a message that names the bad value.
 */

/**
 * Splits an `owner/repo` string into its two parts.
 *
 * @param {string} value - Raw `GITHUB_REPOSITORY` value, e.g. `lupinesse/work-log`.
 * @returns {{ owner: string, repo: string }} The owner and repository names.
 * @throws {Error} If `value` is not exactly two non-empty, slash-separated parts.
 * @example
 * parseRepository('lupinesse/work-log') // → { owner: 'lupinesse', repo: 'work-log' }
 */
export function parseRepository(value) {
  const parts = String(value).split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`GITHUB_REPOSITORY must look like "owner/repo", got: ${JSON.stringify(value)}`);
  }
  return { owner: parts[0], repo: parts[1] };
}
