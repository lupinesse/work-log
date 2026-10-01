/**
 * Validation of the release tag passed to render-release-notes.mjs.
 *
 * release.yml runs on a pushed `v*` tag and, by hand, on a typed `tag` input.
 * A typo there (no leading "v", a branch name) used to surface only as a
 * confusing `gh release` failure several steps later; checking the shape first
 * names the problem and the expected format.
 */

const RELEASE_TAG = /^v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;

/**
 * Extracts the version from a release tag such as `v1.9.2`.
 *
 * @param {string} tag - The tag to validate; must start with `v` followed by a
 *   semantic version (optionally with a `-prerelease` or `+build` suffix).
 * @returns {string} The version without the leading `v`, e.g. `1.9.2`.
 * @throws {Error} If `tag` does not look like `vMAJOR.MINOR.PATCH`.
 * @example
 * parseReleaseTag('v1.9.2') // → '1.9.2'
 */
export function parseReleaseTag(tag) {
  const match = RELEASE_TAG.exec(String(tag));
  if (!match) {
    throw new Error(
      `Release tag must look like "v1.2.3" (a leading "v" and MAJOR.MINOR.PATCH), got: ${JSON.stringify(tag)}`
    );
  }
  return match[1];
}
