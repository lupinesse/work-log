/**
 * Pure parsing of `gh pr list --json number` output.
 *
 * Extracted so the "does an open PR already exist for this branch" decision
 * can be unit-tested without shelling out to `gh`. A prior version of this
 * check used `gh pr list ... -q '.[0].number // empty'` directly in bash —
 * a `jq` filter without the `// empty` fallback returns the literal string
 * `"null"` for an empty result (`.[0]` on `[]` is `null`, and `.number` on
 * `null` stays `null`), which is not an empty string, so a naive
 * `[ -z "$(...)" ]` check silently treats "no PR" as "PR already exists".
 * Parsing the JSON directly in Node sidesteps that class of bug entirely.
 */

/**
 * Decide whether `gh pr list --json number` reported an open PR.
 *
 * @param {string} rawJson - Raw stdout from `gh pr list --json number`.
 * @returns {boolean} True if the list contains at least one PR.
 * @throws {Error} If `rawJson` is not valid JSON, or does not parse to an
 *   array — `gh pr list --json number` always returns an array (empty or
 *   not), so any other shape means something unexpected happened and should
 *   surface loudly rather than be silently treated as "no PR exists".
 * @example
 * hasOpenPr('[]')           // → false
 * hasOpenPr('[{"number":7}]') // → true
 */
export function hasOpenPr(rawJson) {
  const parsed = JSON.parse(rawJson);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected an array from "gh pr list --json number", got: ${rawJson}`);
  }
  return parsed.length > 0;
}
