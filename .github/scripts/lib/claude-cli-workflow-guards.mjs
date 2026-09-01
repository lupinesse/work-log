/**
 * Guards for the GitHub Actions steps that invoke the `claude` CLI.
 *
 * In August 2026 the `scss-audit` and `dead-code` workflows failed on every
 * run for days without anyone noticing, for two compounding reasons:
 *
 *   1. Both preferred `ANTHROPIC_API_KEY` over `CLAUDE_CODE_OAUTH_TOKEN`,
 *      discarding a working subscription token in favour of a pay-as-you-go
 *      key that had run out of credit. `pr-review.yml` never did this and kept
 *      working, which is what isolated the cause.
 *   2. The CLI's only diagnostic was redirected into a file, and under
 *      `bash -e` the non-zero exit aborted the step before anything read that
 *      file — so the job surfaced a bare "exit code 1" and nothing else.
 *
 * Two independent failure modes fall out of (2), and they are checked
 * separately because a workflow can hit either one alone:
 *
 *   - **Aborting silently** — the step dies on a non-zero exit before any
 *     later step can report it. Checked per step: does it survive the failure?
 *   - **Never revealing** — the file is written but nothing in the workflow
 *     ever prints it. Checked per workflow, because the reveal legitimately
 *     happens in a *later* step (`auto-fix-ci.yml` tails its output into a PR
 *     comment). Counting lines with `wc` is not revealing.
 *
 * A third, unrelated mistake gets the same treatment: `pr-review.yml`
 * shipped a `claude -p` step whose indentation implied a continuation of
 * `--allowedTools`, but the flag itself was never written, so the intended
 * tool allowlist was silently dropped and the step ran unsandboxed.
 *
 * These predicates are pure functions over a workflow's YAML source, kept in
 * their own module so they can be unit-tested without a YAML parser, a network
 * call, or a live Actions run. The companion test applies them to every real
 * workflow in `.github/workflows/`, so a *new* workflow that repeats any of
 * these mistakes fails CI too — the guard is not pinned to the files that broke.
 */

/** A `claude -p …` invocation at the start of a line. */
const CLAUDE_INVOCATION = /^[ \t]*claude[ \t]+-p\b/m;

/** `unset CLAUDE_CODE_OAUTH_TOKEN` — the credential-selection bug itself. */
const DISCARDS_OAUTH = /\bunset[ \t]+CLAUDE_CODE_OAUTH_TOKEN\b/;

/** `--allowedTools` restricts the CLI to an explicit tool allowlist. */
const HAS_ALLOWED_TOOLS = /--allowedTools\b/;

/** `x=$?` or `x=${PIPESTATUS[0]}` — an explicit exit-status capture. */
const STATUS_CAPTURE = /^[ \t]*[A-Za-z_][A-Za-z0-9_]*=\$(?:\?|\{PIPESTATUS\[\d+\]\})/m;

/** `|| true` — the other legitimate way to stop `bash -e` aborting the step. */
const TOLERATES_FAILURE = /\|\|[ \t]*true\b/;

/** Commands that actually put a file's contents in front of a human. */
const REVEALING_COMMANDS = ['cat', 'tail', 'head', 'tee'];

/**
 * The same set as a single static pattern. Kept static (rather than built from
 * {@link REVEALING_COMMANDS} at call time) so no user-supplied text is ever
 * compiled into a regex — the file name is matched with `includes` instead,
 * which needs no escaping and cannot misread a dot as a wildcard.
 */
const REVEALING_COMMAND = /\b(?:cat|tail|head|tee)\b/;

/**
 * A `>` / `>>` redirect target.
 *
 * Requires a dotted file name, which is what keeps shell and Actions specials
 * out: `2>&1`, `>> "$GITHUB_OUTPUT"` and `> /dev/null` all lack a `.` and are
 * correctly ignored. The tradeoff is deliberate and worth stating plainly —
 * **a redirect to an extension-less path is not detected.** Nothing in this
 * repository does that, and the alternative (matching any token after `>`)
 * mistakes `$GITHUB_OUTPUT` for captured output on almost every step. Use
 * `| tee`, matched unconditionally by {@link TEE_TARGET}, when a capture must
 * be recognised regardless of its name.
 */
const REDIRECT_TARGET = />[ \t]*(\S+\.[A-Za-z0-9]+)\b/g;

/** A `| tee <file>` target. Any file name, extension or not. */
const TEE_TARGET = /\|[ \t]*tee[ \t]+(\S+)/g;

/**
 * Split a workflow's source into its individual `- name:` step blocks.
 *
 * Splitting on the six-space `- name:` marker rather than parsing YAML keeps
 * this dependency-free; each returned block runs from one step's `- name:`
 * line up to the next one (or end of file).
 *
 * @param {string} workflowText - Raw contents of a workflow YAML file.
 * @returns {string[]} One string per step, in document order. Empty when the
 *   file declares no steps.
 * @example
 * splitWorkflowSteps('jobs:\n  a:\n    steps:\n      - name: One\n        run: x\n')
 * // → ['      - name: One\n        run: x\n']
 */
export function splitWorkflowSteps(workflowText) {
  const normalized = workflowText.split('\r\n').join('\n');
  const marker = /^ {6}- name: /gm;
  const starts = [];
  let match;
  while ((match = marker.exec(normalized)) !== null) starts.push(match.index);
  return starts.map((start, index) =>
    normalized.slice(start, index + 1 < starts.length ? starts[index + 1] : undefined)
  );
}

/**
 * Select the steps of a workflow that invoke the `claude` CLI.
 *
 * @param {string} workflowText - Raw contents of a workflow YAML file.
 * @returns {string[]} The step blocks containing a `claude -p` invocation.
 */
export function findClaudeCliSteps(workflowText) {
  return splitWorkflowSteps(workflowText).filter((step) => CLAUDE_INVOCATION.test(step));
}

/**
 * Read a step's `- name:` label, for use in an actionable failure message.
 *
 * @param {string} stepText - A single step block.
 * @returns {string} The step's name, or `'(unnamed)'` when it has none.
 */
export function stepName(stepText) {
  const match = stepText.match(/^ {6}- name: (.*)$/m);
  return match ? match[1].trim() : '(unnamed)';
}

/**
 * Whether a step throws away the OAuth subscription token.
 *
 * This is the exact regression that broke `scss-audit` and `dead-code`:
 * `unset CLAUDE_CODE_OAUTH_TOKEN` makes `ANTHROPIC_API_KEY` the primary
 * credential, so a key with no credit takes down a run that a perfectly valid
 * token would have completed.
 *
 * @param {string} stepText - A single step block.
 * @returns {boolean} True when the step unsets `CLAUDE_CODE_OAUTH_TOKEN`.
 */
export function discardsOAuthToken(stepText) {
  return DISCARDS_OAUTH.test(stepText);
}

/**
 * Whether a step restricts the CLI to an explicit `--allowedTools` list.
 *
 * `pr-review.yml` shipped a step whose indentation implied a continuation of
 * this flag onto the next line, but the flag itself was never written — the
 * quoted tool names were silently swallowed as dangling positional arguments
 * to `-p`, so the CLI ran with no tool sandboxing at all. Every other
 * `claude -p` step in this repo passes `--allowedTools` explicitly; this
 * guard keeps that true.
 *
 * @param {string} stepText - A single step block.
 * @returns {boolean} True when the step passes --allowedTools.
 */
export function hasAllowedTools(stepText) {
  return HAS_ALLOWED_TOOLS.test(stepText);
}

/**
 * The files a step sends the CLI's output to, via `>` redirect or `| tee`.
 *
 * Redirects are matched by {@link REDIRECT_TARGET}, which requires a dotted
 * file name — see that constant for why, and for the one case this does not
 * cover (a redirect to an extension-less path).
 *
 * @param {string} stepText - A single step block.
 * @returns {string[]} Deduplicated file names, in first-seen order. Empty when
 *   the step lets its output go to the step log.
 * @example
 * captureFiles('claude -p "/x" > a.txt 2>b.log\n') // → ['a.txt', 'b.log']
 * captureFiles('claude -p "/x" >> "$GITHUB_OUTPUT" 2>&1\n') // → [] (not a capture)
 */
export function captureFiles(stepText) {
  const found = [];
  for (const pattern of [REDIRECT_TARGET, TEE_TARGET]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(stepText)) !== null) {
      if (!found.includes(match[1])) found.push(match[1]);
    }
  }
  return found;
}

/**
 * Whether a step survives a non-zero CLI exit long enough to report it.
 *
 * Under `bash -e` an unguarded failure aborts the step immediately, skipping
 * whatever would have surfaced the diagnostic. Capturing the status
 * (`status=$?` / `status=${PIPESTATUS[0]}`) or appending `|| true` both avoid
 * that; either is accepted.
 *
 * @param {string} stepText - A single step block.
 * @returns {boolean} True when the step handles a non-zero exit explicitly.
 */
export function toleratesNonZeroExit(stepText) {
  return STATUS_CAPTURE.test(stepText) || TOLERATES_FAILURE.test(stepText);
}

/**
 * Whether anywhere in the workflow prints the named file's contents.
 *
 * Workflow-scoped on purpose: the reveal is often a later step, such as the
 * `tail -200 fix-output.txt` that `auto-fix-ci.yml` puts into a PR comment.
 * `wc -l < file` deliberately does not count — it reports a line count and
 * shows none of them, which is precisely how a diagnostic stays hidden.
 *
 * @param {string} workflowText - Raw contents of a workflow YAML file.
 * @param {string} fileName - The captured file to look for.
 * @returns {boolean} True when a revealing command reads that file.
 */
export function revealsFile(workflowText, fileName) {
  return workflowText
    .split('\n')
    .some((line) => REVEALING_COMMAND.test(line) && line.includes(fileName));
}

/**
 * Audit one workflow's `claude` steps and describe every guard they break.
 *
 * @param {string} workflowText - Raw contents of a workflow YAML file.
 * @returns {string[]} One human-readable problem per violation; empty when the
 *   workflow is clean, or invokes the CLI not at all.
 * @example
 * auditClaudeCliSteps(textThatUnsetsTheOAuthToken)
 * // → ['step "Run SCSS audit" unsets CLAUDE_CODE_OAUTH_TOKEN …']
 */
export function auditClaudeCliSteps(workflowText) {
  const problems = [];

  for (const step of findClaudeCliSteps(workflowText)) {
    const name = stepName(step);

    if (discardsOAuthToken(step)) {
      problems.push(
        `step "${name}" unsets CLAUDE_CODE_OAUTH_TOKEN, making ANTHROPIC_API_KEY the ` +
          'primary credential — prefer the OAuth token and fall back to the key'
      );
    }

    if (!hasAllowedTools(step)) {
      problems.push(
        `step "${name}" invokes the CLI without --allowedTools, so it runs with no tool ` +
          'sandboxing — pass an explicit allowlist'
      );
    }

    const captured = captureFiles(step);
    if (captured.length === 0) continue;

    if (!toleratesNonZeroExit(step)) {
      problems.push(
        `step "${name}" sends the CLI's output to a file but lets \`bash -e\` abort on ` +
          'a non-zero exit, so no later step runs to report it — capture the status ' +
          '(`status=$?` / `${PIPESTATUS[0]}`) or append `|| true`'
      );
    }

    for (const file of captured) {
      if (!revealsFile(workflowText, file)) {
        problems.push(
          `step "${name}" writes ${file} but nothing in this workflow ever prints it ` +
            `(\`wc -l\` counts lines without showing them) — ${REVEALING_COMMANDS.join('/')} ` +
            'it on the failure path, or the error is invisible'
        );
      }
    }
  }

  return problems;
}
