/**
 * Pure logic for the actionlint self-test.
 *
 * A workflow file with an invalid key does not fail loudly — GitHub refuses to
 * parse the file and schedules **zero jobs**, reporting no error anywhere. The
 * run looks like it simply had nothing to do. This repo has been bitten twice:
 *
 *   - PR #256: `if: secrets.CLAUDE_REVIEWER_APP_ID != ''` at step level. The
 *     `secrets` context is not available in `jobs.<job_id>.steps.if`, so
 *     `a11y-audit.yml` was invalid and every run failed with zero jobs — for
 *     weeks, without ever posting a check.
 *   - PR #299: `workflows: write` in a job's `permissions:` block. `workflows`
 *     is not a real `GITHUB_TOKEN` permission scope (that is the separate PAT
 *     `workflow` OAuth scope), so `auto-chore.yml` became unparseable and every
 *     chore trigger silently did nothing until PR #300 removed it.
 *
 * Both were found by hand, by noticing `gh api .../jobs` returned an empty
 * list. actionlint catches both statically, so this check wires it into CI.
 *
 * But a linter that is present and enforcing nothing is worse than no linter,
 * because it reads as coverage. So rather than just running actionlint over the
 * real workflows, this self-test also runs it against fixtures that reproduce
 * both historical bugs and asserts it still reports them. If a future actionlint
 * version drops or renames either rule, this fails instead of going quietly
 * green.
 *
 * Extracted from check-actionlint.mjs so the interpretation of a run can be
 * unit-tested without the actionlint binary present.
 */

/**
 * @typedef {{ exitCode: number|null, stdout: string, stderr: string }} ActionlintRun
 *   One actionlint invocation. `exitCode` is null when the process was killed
 *   by a signal.
 * @typedef {{ message: string, filepath: string, line: number, column: number,
 *   kind: string }} ActionlintFinding
 *   One reported problem, as emitted by `-format '{{json .}}'`.
 * @typedef {{ ok: boolean, failures: string[] }} SelfTestResult
 */

/**
 * The historical bugs this check exists to catch, one fixture each.
 *
 * `pattern` deliberately matches actionlint's *message* rather than its `kind`
 * tag: the message text is what a contributor reads and is stable across
 * releases, whereas rule tags have been renamed before. The observed `kind` is
 * still surfaced in the runner's output for humans.
 *
 * @type {ReadonlyArray<{ fixture: string, pattern: RegExp, incident: string, summary: string }>}
 */
export const EXPECTED_FINDINGS = Object.freeze([
  Object.freeze({
    fixture: 'invalid-permission-scope.yaml',
    pattern: /unknown permission scope/i,
    incident: 'PR #299',
    summary: '`workflows: write` in a `permissions:` block is not a real scope',
  }),
  Object.freeze({
    fixture: 'secrets-in-step-if.yaml',
    pattern: /context "secrets" is not available/i,
    incident: 'PR #256',
    summary: '`secrets` is not available in a step-level `if:`',
  }),
]);

/**
 * Parse actionlint's `-format '{{json .}}'` output into findings.
 *
 * Empty output means "no problems found" — actionlint prints nothing at all in
 * that case rather than an empty array, so that is normalised here.
 *
 * @param {string} stdout - Raw stdout from an actionlint run.
 * @returns {ActionlintFinding[]} The reported findings; empty when clean.
 * @throws {Error} When output is non-empty but not the expected JSON array —
 *   that means actionlint failed in some way this check cannot interpret (a bad
 *   flag, a panic), which must not be mistaken for a clean run.
 */
export function parseActionlintFindings(stdout) {
  const trimmed = stdout.trim();
  if (trimmed === '') return [];

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `actionlint produced output that is not JSON — it likely failed rather than ` +
        `reporting findings. Raw output:\n${indent(trimmed)}`,
      { cause: err }
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `actionlint produced JSON that is not an array of findings (got ` +
        `${typeof parsed}). Raw output:\n${indent(trimmed)}`
    );
  }
  return parsed;
}

/** actionlint's exit code when it found nothing to report. */
const EXIT_CLEAN = 0;
/** actionlint's exit code when it found at least one problem. */
const EXIT_FOUND_PROBLEMS = 1;

/**
 * Read one actionlint run into findings, or explain why its result cannot be
 * trusted.
 *
 * The important case here is an *operational* failure — a rejected flag, a
 * panic, a missing file. actionlint then exits 2 with usage text on stderr and
 * writes nothing to stdout, which parses to zero findings. Read naively that is
 * indistinguishable from "clean", and this check would print a green
 * "workflows are clean" while having linted nothing at all — the same
 * silent-success failure mode it exists to catch in the workflows themselves.
 *
 * So the exit code and the findings must agree: exactly 0 or 1, and non-zero
 * only ever alongside at least one finding.
 *
 * @param {ActionlintRun} run - The run to read.
 * @param {string} target - What was linted, for error messages.
 * @returns {{ findings: ActionlintFinding[], error: null }
 *   | { findings: null, error: string }} The findings, or a human-readable
 *   explanation of why the run is uninterpretable.
 */
function readRun(run, target) {
  const fail = (reason) => ({ findings: null, error: reason });
  const captured = () => indent(run.stderr || run.stdout);

  if (run.exitCode === null) {
    return fail(
      `actionlint was killed by a signal while checking ${target}, so it never ` +
        `reported a verdict.\n${captured()}`
    );
  }

  if (run.exitCode !== EXIT_CLEAN && run.exitCode !== EXIT_FOUND_PROBLEMS) {
    return fail(
      `actionlint exited ${run.exitCode} while checking ${target}. That is an ` +
        `operational failure (a rejected flag, a missing file, a panic), not a ` +
        `lint result — nothing was actually checked.\n${captured()}`
    );
  }

  let findings;
  try {
    findings = parseActionlintFindings(run.stdout);
  } catch (err) {
    return fail(`could not read actionlint's output for ${target} — ${err.message}`);
  }

  if (run.exitCode === EXIT_FOUND_PROBLEMS && findings.length === 0) {
    return fail(
      `actionlint exited ${EXIT_FOUND_PROBLEMS} for ${target} but reported no ` +
        `findings. Its output format has changed, so this check can no longer ` +
        `tell a clean run from a failing one.\n${captured()}`
    );
  }

  if (run.exitCode === EXIT_CLEAN && findings.length > 0) {
    return fail(
      `actionlint exited ${EXIT_CLEAN} for ${target} but reported ` +
        `${findings.length} finding(s). Its exit code and output disagree, so ` +
        `neither can be trusted.\n${captured()}`
    );
  }

  return { findings, error: null };
}

/**
 * Check that a fixture run reported the specific problem it was written to
 * reproduce.
 *
 * A non-zero exit alone is not enough: actionlint exits non-zero for *any*
 * finding, so a fixture could "pass" because of an unrelated typo in it while
 * the rule under test has quietly stopped working. The message must match.
 *
 * @param {{ fixture: string, pattern: RegExp, incident: string, summary: string }} expectation -
 *   One entry from {@link EXPECTED_FINDINGS}.
 * @param {ActionlintRun} run - The run against that fixture.
 * @returns {string[]} One human-readable line per broken expectation; empty when
 *   the expected finding was reported.
 */
export function interpretFixtureRun(expectation, run) {
  const { fixture, pattern, incident, summary } = expectation;

  const { findings, error } = readRun(run, fixture);
  if (error) return [error];

  if (findings.some((finding) => pattern.test(finding.message))) return [];

  const observed = findings.length
    ? findings.map((finding) => `      [${finding.kind}] ${finding.message}`).join('\n')
    : '      (no findings reported)';

  return [
    `${fixture} reproduces the ${incident} bug — ${summary} — but actionlint did ` +
      `not report it.\n` +
      `    expected a message matching ${pattern}\n` +
      `    actionlint reported:\n${observed}\n` +
      `    This rule may have been renamed or dropped upstream. Do not silence ` +
      `this check — a workflow with this bug schedules zero jobs and reports ` +
      `nothing, which is why it needs a linter in the first place.`,
  ];
}

/**
 * Check that the repository's real workflows are clean.
 *
 * @param {ActionlintRun} run - An actionlint run over `.github/workflows/`.
 * @returns {string[]} One human-readable line if anything was reported; empty
 *   when clean.
 */
export function interpretWorkflowsRun(run) {
  const { findings, error } = readRun(run, '.github/workflows/');
  if (error) return [error];

  if (findings.length === 0) return [];

  const detail = findings
    .map((f) => `      ${f.filepath}:${f.line}:${f.column} [${f.kind}] ${f.message}`)
    .join('\n');
  return [`actionlint reported ${findings.length} problem(s) in .github/workflows/:\n${detail}`];
}

/**
 * Combine every run into a single verdict.
 *
 * @param {ActionlintRun} workflowsRun - Run over `.github/workflows/`.
 * @param {Array<{ expectation: object, run: ActionlintRun }>} fixtureRuns - One
 *   entry per {@link EXPECTED_FINDINGS} fixture.
 * @returns {SelfTestResult} `ok` is true only when the real workflows are clean
 *   *and* every fixture still trips its rule.
 */
export function interpretSelfTest(workflowsRun, fixtureRuns) {
  const failures = [
    ...interpretWorkflowsRun(workflowsRun),
    ...fixtureRuns.flatMap(({ expectation, run }) => interpretFixtureRun(expectation, run)),
  ];
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
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '    (no output)';
  return trimmed
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}
