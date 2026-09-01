/**
 * Unit + regression tests for lib/claude-cli-workflow-guards.mjs.
 *
 * The regression these exist for: `scss-audit` and `dead-code` preferred
 * ANTHROPIC_API_KEY over CLAUDE_CODE_OAUTH_TOKEN and buried the CLI's only
 * diagnostic in a redirected file, so every run died with an unexplained
 * "exit code 1" for days.
 *
 * The three fixtures below are the shapes that actually shipped — the broken
 * credential order, a file written and never printed, and a reveal that
 * happens in a *later* step. They are what make these regression tests
 * meaningful: the first two must trip the guards and the third must not. The
 * final suite then applies the guards to the repository's real workflows.
 *
 * Run: node --test .github/scripts/test/claude-cli-workflow-guards.test.mjs
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  auditClaudeCliSteps,
  captureFiles,
  discardsOAuthToken,
  findClaudeCliSteps,
  hasAllowedTools,
  revealsFile,
  splitWorkflowSteps,
  stepName,
  toleratesNonZeroExit,
} from '../lib/claude-cli-workflow-guards.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const workflowsDir = path.join(repoRoot, '.github', 'workflows');

/** scss-audit.yml as it shipped broken: API key preferred, `bash -e` aborts. */
const PRE_FIX_STEP = [
  '      - name: Run SCSS audit',
  "        if: steps.key-check.outputs.present == 'true'",
  '        run: |',
  '          if [ -n "$ANTHROPIC_API_KEY" ]; then',
  '            unset CLAUDE_CODE_OAUTH_TOKEN',
  '          fi',
  '          claude -p "/scss-audit" \\',
  '            --model claude-sonnet-4-6 \\',
  '            > scss-output.txt 2>&1',
  '          echo "SCSS audit complete"',
  '',
].join('\n');

/** The fixed shape: OAuth preferred, status captured, output read back. */
const FIXED_STEP = [
  '      - name: Run SCSS audit',
  '        run: |',
  '          if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then',
  '            unset ANTHROPIC_API_KEY',
  '          fi',
  '          set +e',
  '          claude -p "/scss-audit" --allowedTools "Read" > scss-output.txt 2>&1',
  '          status=$?',
  '          set -e',
  '          if [ "$status" -ne 0 ]; then',
  '            cat scss-output.txt',
  '            exit "$status"',
  '          fi',
  '',
].join('\n');

/** The `tee` variant used by dead-code.yml. */
const TEE_STEP = [
  '      - name: Run dead code detection',
  '        run: |',
  '          set +e',
  '          claude -p "/dead-code" --allowedTools "Read" 2>&1 | tee dead-code-output.txt',
  '          status=${PIPESTATUS[0]}',
  '          set -e',
  '',
].join('\n');

/** auto-chore.yml as it shipped: exit captured, but `wc -l` only counts lines. */
const COUNTS_BUT_NEVER_PRINTS_STEP = [
  '      - name: Run Claude on the issue',
  '        run: |',
  '          set +e',
  '          claude -p "/chore-start" --allowedTools "Read" > chore-output.txt 2>&1',
  '          CLAUDE_EXIT=$?',
  '          set -e',
  '          echo "complete ($(wc -l < chore-output.txt) output lines)"',
  '',
].join('\n');

/** auto-fix-ci.yml's legitimate shape: the reveal lives in a later step. */
const REVEALED_IN_A_LATER_STEP = [
  '      - name: Run Claude auto-fix',
  '        run: |',
  '          claude -p "/ci-fix" --allowedTools "Read" > fix-output.txt 2>&1 || true',
  '',
  '      - name: Comment on the PR',
  '        run: |',
  '          tail -200 fix-output.txt',
  '',
].join('\n');

/** pr-review.yml as it shipped: indentation implies --allowedTools, but the
 *  flag is never written, so the quoted tool names are dangling positional
 *  arguments to `-p` rather than an allowlist. No output capture here — that
 *  is a separate concern already covered by the other fixtures above. */
const MISSING_ALLOWED_TOOLS_STEP = [
  '      - name: Run PR review',
  "        if: steps.key-check.outputs.present == 'true'",
  '        run: |',
  '          claude -p "/pr-review" \\',
  '            --model claude-sonnet-4-6 \\',
  '            --max-turns 20 \\',
  '                           "Bash(git log:*)" "Bash(git diff:*)" \\',
  '                           "Bash(git show:*)" "Bash(cat:*)" "Bash(wc:*)"',
  '',
].join('\n');

const wrap = (steps) => `jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;

describe('splitWorkflowSteps', () => {
  test('splits on the six-space "- name:" marker', () => {
    assert.equal(splitWorkflowSteps(wrap(PRE_FIX_STEP + TEE_STEP)).length, 2);
  });

  test('returns an empty list for a workflow with no steps', () => {
    assert.deepEqual(splitWorkflowSteps('name: nothing\non: push\n'), []);
  });

  test('handles CRLF sources (this repo stores its workflows with CRLF)', () => {
    const crlf = wrap(FIXED_STEP).split('\n').join('\r\n');
    assert.equal(splitWorkflowSteps(crlf).length, 1);
  });
});

describe('findClaudeCliSteps', () => {
  const checkout = '      - name: Check out\n        uses: actions/checkout@v7\n';

  test('selects only the steps that invoke the CLI', () => {
    assert.equal(findClaudeCliSteps(wrap(checkout + FIXED_STEP)).length, 1);
  });

  test('ignores a workflow that never calls the CLI', () => {
    assert.deepEqual(findClaudeCliSteps(wrap(checkout)), []);
  });
});

describe('stepName', () => {
  test('reads the step label so a failure message is actionable', () => {
    assert.equal(stepName(FIXED_STEP), 'Run SCSS audit');
  });

  test('falls back to a placeholder when there is no name', () => {
    assert.equal(stepName('        run: |\n          claude -p "/x"\n'), '(unnamed)');
  });
});

describe('discardsOAuthToken', () => {
  test('flags the pre-fix credential order', () => {
    assert.equal(discardsOAuthToken(PRE_FIX_STEP), true);
  });

  test('accepts the fixed credential order', () => {
    assert.equal(discardsOAuthToken(FIXED_STEP), false);
  });
});

describe('hasAllowedTools', () => {
  test('accepts a step that passes --allowedTools', () => {
    assert.equal(hasAllowedTools(FIXED_STEP), true);
  });

  test('flags a step where the flag is missing, even with quoted strings that look like a tool list', () => {
    assert.equal(hasAllowedTools(MISSING_ALLOWED_TOOLS_STEP), false);
  });
});

describe('captureFiles', () => {
  test('collects redirect targets, including stderr', () => {
    assert.deepEqual(captureFiles('claude -p "/x" > a.txt 2>b.log\n'), ['a.txt', 'b.log']);
  });

  test('collects a tee target', () => {
    assert.deepEqual(captureFiles(TEE_STEP), ['dead-code-output.txt']);
  });

  test('returns nothing when output goes to the step log', () => {
    assert.deepEqual(captureFiles('          claude -p "/x"\n'), []);
  });

  test('does not report the same file twice', () => {
    assert.deepEqual(captureFiles('claude -p "/x" > a.txt\ncat a.txt > a.txt\n'), ['a.txt']);
  });

  test('is not limited to .txt/.json/.log — any extension counts', () => {
    assert.deepEqual(captureFiles('claude -p "/x" > report.md\n'), ['report.md']);
    assert.deepEqual(captureFiles('claude -p "/x" > out.diff\n'), ['out.diff']);
  });

  test('ignores shell and Actions specials that are not captures', () => {
    // `2>&1`, `$GITHUB_OUTPUT` and `/dev/null` have no dotted file name, which
    // is exactly how they are excluded — see REDIRECT_TARGET.
    assert.deepEqual(captureFiles('claude -p "/x" 2>&1\n'), []);
    assert.deepEqual(captureFiles('echo "k=v" >> "$GITHUB_OUTPUT"\nclaude -p "/x"\n'), []);
    assert.deepEqual(captureFiles('claude -p "/x" > /dev/null\n'), []);
  });

  test('a tee target needs no extension at all', () => {
    assert.deepEqual(captureFiles('claude -p "/x" | tee capture\n'), ['capture']);
  });

  test('is repeatable — the module-level /g patterns do not carry lastIndex', () => {
    const step = 'claude -p "/x" > a.txt\n';
    assert.deepEqual(captureFiles(step), captureFiles(step));
  });
});

describe('toleratesNonZeroExit', () => {
  test('is false when bash -e would abort the step', () => {
    assert.equal(toleratesNonZeroExit(PRE_FIX_STEP), false);
  });

  test('accepts $?, ${PIPESTATUS[0]} and || true', () => {
    assert.equal(toleratesNonZeroExit(FIXED_STEP), true);
    assert.equal(toleratesNonZeroExit(TEE_STEP), true);
    assert.equal(toleratesNonZeroExit('          claude -p "/x" > a.txt || true\n'), true);
  });
});

describe('revealsFile', () => {
  test('accepts a reveal in a different step of the same workflow', () => {
    assert.equal(revealsFile(wrap(REVEALED_IN_A_LATER_STEP), 'fix-output.txt'), true);
  });

  test('does not count `wc -l`, which shows no lines at all', () => {
    assert.equal(revealsFile(wrap(COUNTS_BUT_NEVER_PRINTS_STEP), 'chore-output.txt'), false);
  });

  test('treats dots in the file name literally, not as regex wildcards', () => {
    assert.equal(revealsFile('cat scssXoutputYtxt\n', 'scss.output.txt'), false);
  });
});

describe('auditClaudeCliSteps', () => {
  test('reports the credential order and the silent abort for the pre-fix step', () => {
    const problems = auditClaudeCliSteps(wrap(PRE_FIX_STEP)).join('\n');
    assert.match(problems, /unsets CLAUDE_CODE_OAUTH_TOKEN/);
    assert.match(problems, /lets `bash -e` abort/);
  });

  test('reports a file that is written and never printed', () => {
    const problems = auditClaudeCliSteps(wrap(COUNTS_BUT_NEVER_PRINTS_STEP));
    assert.equal(problems.length, 1);
    assert.match(
      problems[0],
      /writes chore-output\.txt but nothing in this workflow ever prints it/
    );
  });

  test('does not flag a reveal that happens in a later step', () => {
    assert.deepEqual(auditClaudeCliSteps(wrap(REVEALED_IN_A_LATER_STEP)), []);
  });

  test('reports a step whose --allowedTools flag is missing, as pr-review.yml shipped', () => {
    const problems = auditClaudeCliSteps(wrap(MISSING_ALLOWED_TOOLS_STEP));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /invokes the CLI without --allowedTools/);
  });

  test('reports nothing for the fixed steps', () => {
    assert.deepEqual(auditClaudeCliSteps(wrap(FIXED_STEP + TEE_STEP)), []);
  });

  test('names the offending step', () => {
    assert.match(auditClaudeCliSteps(wrap(PRE_FIX_STEP))[0], /step "Run SCSS audit"/);
  });

  test('is silent about a workflow that never invokes the CLI', () => {
    assert.deepEqual(auditClaudeCliSteps(wrap('      - name: X\n        run: echo hi\n')), []);
  });
});

describe('the repository’s real workflows', () => {
  const workflows = readdirSync(workflowsDir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => ({ file, text: readFileSync(path.join(workflowsDir, file), 'utf8') }))
    .filter(({ text }) => findClaudeCliSteps(text).length > 0);

  test('the scan actually found workflows that invoke the CLI', () => {
    // Without this, a broken scan would leave the suite passing on an empty
    // set — the same silent-success failure mode this module exists to catch.
    assert.ok(
      workflows.length >= 4,
      `expected several workflows invoking the claude CLI, found ${workflows.length}`
    );
  });

  for (const { file, text } of workflows) {
    test(`${file} keeps every claude CLI guard`, () => {
      assert.deepEqual(auditClaudeCliSteps(text), []);
    });
  }
});
