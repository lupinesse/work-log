/**
 * Pure logic for the commitlint self-test.
 *
 * The `commit-msg` Husky hook is the only thing enforcing Conventional Commits,
 * and it runs solely on contributors' machines — never in CI. That gap bit us:
 * PR #251 bumped `@commitlint/config-conventional` without a matching
 * `@commitlint/cli`, and the resulting peer skew made *every* local `git commit`
 * fail at the hook with `ERR_PACKAGE_PATH_NOT_EXPORTED`, regardless of message
 * content. Nothing caught it until a contributor did a clean `npm ci` weeks
 * later (see docs/qa-reports/qa-review-2026-08-03.md, priority 3).
 *
 * The fix (#290) pinned the transitive dependency, but a pin is exactly the kind
 * of thing that rots silently. This self-test is the guard: it asserts that
 * commitlint can still load its preset *and* still enforces it, by running it
 * against one conforming and one non-conforming sample message.
 *
 * Deliberately does not lint the PR's real commit messages — that would police
 * contributors rather than detect dependency breakage, and would fail on
 * historical commits that predate the convention.
 *
 * Extracted from check-commitlint.mjs so the interpretation of the two runs can
 * be unit-tested without spawning commitlint.
 */

/**
 * A message that must pass: conventional type, colon, non-empty subject.
 *
 * commitlint echoes the input back in its output, which is then matched against
 * {@link RESOLUTION_ERROR_PATTERNS} — so this must not contain any phrase from
 * that list ("cannot find module", "failed to load"), or a plain lint failure
 * would be misreported as a broken dependency tree.
 */
export const CONFORMING_SAMPLE = 'feat: add a sample commit message';

/** A message that must fail: no conventional type prefix at all. */
export const NON_CONFORMING_SAMPLE = 'this sample message has no type prefix';

/**
 * @typedef {{ exitCode: number|null, output: string }} CommitlintRun
 *   One commitlint invocation. `output` is stdout and stderr concatenated;
 *   `exitCode` is null when the process was killed by a signal.
 * @typedef {{ ok: boolean, failures: string[] }} SelfTestResult
 */

/**
 * Signatures of a preset that failed to load, as opposed to a message that
 * failed to lint. All of these mean the dependency tree is broken, which is the
 * specific regression this check exists to catch.
 */
const RESOLUTION_ERROR_PATTERNS = [
  /ERR_PACKAGE_PATH_NOT_EXPORTED/,
  /ERR_MODULE_NOT_FOUND/,
  /ERR_REQUIRE_ESM/,
  /Cannot find module/i,
  /failed to load/i,
  // The preset resolved but contributed nothing — a different fault from the
  // ones above, though it has the same cause (a broken or empty preset) and the
  // same remedy, so it is reported alongside them.
  /Please add rules to your `commitlint\.config\.js`/,
];

/**
 * Decide whether commitlint output indicates a broken dependency tree rather
 * than an ordinary lint failure.
 *
 * @param {string} output - Combined stdout/stderr from a commitlint run.
 * @returns {boolean} True if the output looks like preset-resolution breakage.
 */
export function isPresetResolutionFailure(output) {
  return RESOLUTION_ERROR_PATTERNS.some((pattern) => pattern.test(output));
}

/**
 * Pick the CLI entry path out of a package's `bin` field.
 *
 * npm allows `bin` to be either a bare string (single binary) or a map of
 * name → path; both forms appear in the wild, and @commitlint/cli has used the
 * map form. Kept here rather than inline in the runner so the shapes that
 * *don't* yield a path are unit-testable without mocking module resolution.
 *
 * @param {string|Record<string, string>|undefined|null} binField - A package.json
 *   `bin` value.
 * @returns {string|null} The entry path with any leading `./` stripped, ready to
 *   append to the package name for `require.resolve`; null if the field
 *   declares no usable commitlint entry.
 */
export function selectCommitlintBinPath(binField) {
  const binPath = typeof binField === 'string' ? binField : binField?.commitlint;
  if (typeof binPath !== 'string' || binPath.trim() === '') return null;
  return binPath.replace(/^\.\//, '');
}

/**
 * Interpret the two sample runs into a pass/fail verdict.
 *
 * Two independent things must hold, and they fail in different ways:
 *   - the conforming sample must exit 0 — if it does not, either the preset
 *     could not be resolved (the dependency-skew regression) or the config has
 *     become stricter than the convention it claims to implement;
 *   - the non-conforming sample must exit non-zero — if it exits 0, commitlint
 *     loaded but is enforcing nothing, so the hook would wave anything through.
 *
 * @param {CommitlintRun} conformingRun - Run against {@link CONFORMING_SAMPLE}.
 * @param {CommitlintRun} nonConformingRun - Run against {@link NON_CONFORMING_SAMPLE}.
 * @returns {SelfTestResult} `ok` is true only when both expectations hold;
 *   `failures` holds one human-readable line per broken expectation.
 */
export function interpretSelfTest(conformingRun, nonConformingRun) {
  const failures = [];

  if (conformingRun.exitCode !== 0) {
    failures.push(
      isPresetResolutionFailure(conformingRun.output)
        ? `commitlint could not load its preset — the dependency tree is broken, not the message. ` +
            `Check that @commitlint/cli and @commitlint/config-conventional are compatible ` +
            `and that the conventional-changelog-conventionalcommits override still resolves.\n` +
            indent(conformingRun.output)
        : `a conforming message was rejected (exit ${conformingRun.exitCode}): ` +
            `"${CONFORMING_SAMPLE}"\n${indent(conformingRun.output)}`
    );
  }

  if (nonConformingRun.exitCode === 0) {
    failures.push(
      `a non-conforming message was accepted: "${NON_CONFORMING_SAMPLE}". ` +
        `commitlint ran but is enforcing no rules, so the commit-msg hook would ` +
        `let any message through.`
    );
  } else if (nonConformingRun.exitCode === null) {
    // Any non-zero exit means "rejected", which is what we want here — but a
    // signalled process (OOM, timeout) also reads as non-zero while proving
    // nothing. Treated as its own failure so a crash cannot pass as a rejection.
    failures.push(
      `commitlint was killed by a signal while linting the non-conforming sample, ` +
        `so it never reported a verdict. This check cannot confirm rules are enforced.\n` +
        indent(nonConformingRun.output)
    );
  }

  return { ok: failures.length === 0, failures };
}

/**
 * Indent a block of captured process output so it reads as nested detail under
 * a failure line.
 *
 * @param {string} text - Raw captured output; may be empty.
 * @returns {string} The text with every line indented, or `'    (no output)'`.
 */
function indent(text) {
  const trimmed = text.trim();
  if (!trimmed) return '    (no output)';
  return trimmed
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}
