/**
 * PR size-gate constants and classifier.
 *
 * Single source of truth shared by auto-label-pr.yml, pr-review.yml, and
 * chatgpt-pr-review.yml. Every workflow that decides whether a PR is "large"
 * (and therefore warrants the ChatGPT dialogue) imports from here so the
 * thresholds and generated-file pattern cannot drift between files.
 *
 * @module pr-size-gate
 */

/** Source-line change count at or above which a PR is considered large. */
export const LINES_THRESHOLD = 200;

/** Source-file count at or above which a PR is considered large. */
export const FILES_THRESHOLD = 4;

/** Label applied to PRs that meet the size threshold. */
export const LABEL = 'chatgpt-review';

/**
 * Matches generated / build-output files that are excluded from size counts.
 * Changes to these files do not count toward either threshold.
 */
export const GENERATED = /^(script\.js|styles\.css|docs\/.+\.html|package-lock\.json)$/;

/**
 * Matches documentation-only files. A PR whose every source file (after
 * generated-file exclusion) matches this pattern is skipped by automated
 * reviewers regardless of threshold.
 */
export const DOCS_ONLY = /\.(md|txt|rst)$|^(LICENSE|CODEOWNERS)$/i;

/**
 * Classifies a pull request by size relative to the shared thresholds.
 *
 * @param {Array<{filename: string, additions: number, deletions: number}>} files
 *   Changed-file objects as returned by the GitHub list-files API.
 * @returns {{
 *   sourceFiles: Array<{filename: string, additions: number, deletions: number}>,
 *   totalLines: number,
 *   fileCount: number,
 *   meetsThreshold: boolean,
 *   isDocsOnly: boolean
 * }}
 */
export function classifyPR(files) {
  const sourceFiles = files.filter((f) => !GENERATED.test(f.filename));
  const totalLines = sourceFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const fileCount = sourceFiles.length;
  const meetsThreshold = totalLines >= LINES_THRESHOLD || fileCount >= FILES_THRESHOLD;
  const isDocsOnly = fileCount > 0 && sourceFiles.every((f) => DOCS_ONLY.test(f.filename));

  return { sourceFiles, totalLines, fileCount, meetsThreshold, isDocsOnly };
}
