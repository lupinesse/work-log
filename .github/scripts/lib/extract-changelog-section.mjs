/**
 * Pure extraction of a single version's section from CHANGELOG.md text.
 *
 * Ported from release.yml's prior inline `awk` step, whose exact-match
 * (`$0 == "## " tag`) never matched this project's actual Keep a Changelog
 * heading format (`## [X.Y.Z] — <date>`) — confirmed by checking the live
 * v1.9.0 GitHub Release, whose body has no changelog content at all. That
 * bug was only ever exercised live, once per release, on a tag push; this
 * module makes the extraction logic unit-testable against real CHANGELOG.md
 * fixtures instead.
 */

/**
 * Extract the changelog body for a given version.
 *
 * Collects every line after the matching `## [<version>] — ...` heading, up
 * to (but not including) the next `## ` heading or a `---` horizontal rule,
 * whichever comes first. Leading/trailing blank lines are trimmed.
 *
 * @param {string} changelog - Full CHANGELOG.md text.
 * @param {string} version - Bare semver, no leading "v" (e.g. "1.9.1").
 * @returns {string} The section body, or an empty string if no heading for
 *   `version` is found.
 * @example
 * extractChangelogSection(
 *   '## Unreleased\n\n---\n\n## [1.0.0] — 2026-01-01\n\nnotes\n\n---\n\n## [0.9.0] — 2025-12-01\n\nolder\n',
 *   '1.0.0'
 * )
 * // → 'notes'
 */
export function extractChangelogSection(changelog, version) {
  const headingPrefix = `## [${version}]`;
  const lines = changelog.split('\n');
  const collected = [];
  let found = false;

  for (const line of lines) {
    if (line.startsWith(headingPrefix)) {
      found = true;
      continue;
    }
    if (found && (line === '---' || line.startsWith('## '))) {
      break;
    }
    if (found) {
      collected.push(line);
    }
  }

  let start = 0;
  let end = collected.length;
  while (start < end && collected[start].trim() === '') start++;
  while (end > start && collected[end - 1].trim() === '') end--;

  return collected.slice(start, end).join('\n');
}
