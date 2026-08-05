/**
 * Unit tests for the pure logic in lib/actionlint-selftest.mjs.
 *
 * Regression coverage for the two silent-CI-breakage incidents this check
 * exists to prevent (PR #256's `secrets` in a step `if:`, PR #299's invalid
 * `permissions:` scope). Both made a workflow file unparseable, so GitHub
 * scheduled zero jobs and reported nothing.
 *
 * These tests never invoke actionlint — they cover how its output is
 * interpreted, so they run anywhere, including on a machine with no binary
 * installed. The binary itself is exercised by `npm run test:actionlint`.
 *
 * Run: node --test .github/scripts/test/actionlint-selftest.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPECTED_FINDINGS,
  IGNORED_FINDING_PATTERNS,
  parseActionlintFindings,
  interpretFixtureRun,
  interpretWorkflowsRun,
  interpretSelfTest,
} from '../lib/actionlint-selftest.mjs';

/**
 * Build an ActionlintRun fixture.
 *
 * @param {number|null} exitCode - Process exit code, or null if signalled.
 * @param {object[]} [findings] - Findings to serialise as actionlint's JSON output.
 * @param {string} [stderr] - Captured stderr.
 * @returns {{ exitCode: number|null, stdout: string, stderr: string }}
 */
const run = (exitCode, findings = null, stderr = '') => ({
  exitCode,
  stdout: findings === null ? '' : JSON.stringify(findings),
  stderr,
});

/**
 * Build one actionlint finding.
 *
 * @param {string} message - The finding's message text.
 * @param {string} [kind] - The rule tag actionlint attributes it to.
 * @returns {{ message: string, filepath: string, line: number, column: number, kind: string }}
 */
const finding = (message, kind = 'expression') => ({
  message,
  filepath: '.github/workflows/example.yml',
  line: 7,
  column: 12,
  kind,
});

/** The message actionlint v1.7.12 emits for PR #299's bug. */
const PERMISSION_SCOPE_MESSAGE =
  'unknown permission scope "workflows". all available permission scopes are ' +
  '"actions", "attestations", "checks", "contents", "deployments", "discussions"';

/**
 * The message actionlint v1.7.12 emits for PR #256's bug — verbatim from a real
 * run (PR #312's CI).
 *
 * Worth keeping exact. An earlier guess at this string assumed "is not
 * available at ..."; v1.7.12 actually says "is not allowed here". The fixture
 * caught that immediately by failing, which is the behaviour these tests exist
 * to protect — a pattern that matches nothing must never pass quietly.
 */
const SECRETS_IN_IF_MESSAGE =
  'context "secrets" is not allowed here. available contexts are "env", "github", ' +
  '"inputs", "job", "matrix", "needs", "runner", "steps", "strategy", "vars". see ' +
  'https://docs.github.com/en/actions/learn-github-actions/contexts#context-availability ' +
  'for more details';

const permissionExpectation = EXPECTED_FINDINGS.find(
  (e) => e.fixture === 'invalid-permission-scope.yaml'
);
const secretsExpectation = EXPECTED_FINDINGS.find((e) => e.fixture === 'secrets-in-step-if.yaml');

describe('EXPECTED_FINDINGS', () => {
  test('covers both historical incidents', () => {
    assert.ok(permissionExpectation, 'missing the PR #299 permission-scope fixture');
    assert.ok(secretsExpectation, 'missing the PR #256 secrets-in-if fixture');
    assert.equal(EXPECTED_FINDINGS.length, 2);
  });

  test('each pattern matches the message actionlint actually emits', () => {
    assert.match(PERMISSION_SCOPE_MESSAGE, permissionExpectation.pattern);
    assert.match(SECRETS_IN_IF_MESSAGE, secretsExpectation.pattern);
  });

  test('patterns are specific enough not to match each other', () => {
    assert.doesNotMatch(SECRETS_IN_IF_MESSAGE, permissionExpectation.pattern);
    assert.doesNotMatch(PERMISSION_SCOPE_MESSAGE, secretsExpectation.pattern);
  });

  // The context-availability message has been worded both ways upstream, so the
  // pattern accepts either rather than pinning to whatever v1.7.12 happens to
  // say. It must still require the "secrets" context specifically.
  test('the context pattern tolerates both known phrasings', () => {
    assert.match(SECRETS_IN_IF_MESSAGE, secretsExpectation.pattern);
    assert.match(
      'context "secrets" is not available at "jobs.<job_id>.steps.if"',
      secretsExpectation.pattern
    );
  });

  test('the context pattern does not match a different unavailable context', () => {
    assert.doesNotMatch(
      'context "job" is not allowed here. available contexts are "env", "github"',
      secretsExpectation.pattern
    );
  });
});

describe('IGNORED_FINDING_PATTERNS', () => {
  // The danger of any ignore list is that it grows until it swallows something
  // that mattered. These patterns exist only to mute actionlint's stale
  // create-github-app-token schema; if one is ever widened enough to hide a
  // fixture's expected finding, the self-test would go green while checking
  // nothing — the exact failure this module is built to prevent.
  test('cannot suppress either historical bug', () => {
    for (const pattern of IGNORED_FINDING_PATTERNS) {
      assert.ok(!SECRETS_IN_IF_MESSAGE.includes(pattern), `"${pattern}" would mute PR #256`);
      assert.ok(!PERMISSION_SCOPE_MESSAGE.includes(pattern), `"${pattern}" would mute PR #299`);
    }
  });

  // actionlint reads these as Go regexps. Keeping them free of metacharacters
  // means substring matching is equivalent, which is what makes the assertions
  // above a faithful test of the real behaviour rather than an approximation.
  test('contain no regex metacharacters, so they match literally', () => {
    for (const pattern of IGNORED_FINDING_PATTERNS) {
      assert.doesNotMatch(
        pattern,
        /[\\^$.|?*+()[\]{}]/,
        `"${pattern}" has regex syntax — its match semantics are no longer obvious`
      );
    }
  });

  test('each is scoped to the specific action it excuses', () => {
    for (const pattern of IGNORED_FINDING_PATTERNS) {
      assert.match(
        pattern,
        /actions\/create-github-app-token/,
        'an ignore that names no action would mute that rule repo-wide'
      );
    }
  });

  test('matches the false positives it is meant to mute', () => {
    const falsePositives = [
      'input "client-id" is not defined in action "actions/create-github-app-token@v3". available inputs are "app-id"',
      'missing input "app-id" which is required by action "actions/create-github-app-token@v3". all required inputs are "app-id", "private-key"',
    ];
    for (const message of falsePositives) {
      assert.ok(
        IGNORED_FINDING_PATTERNS.some((pattern) => message.includes(pattern)),
        `no ignore pattern matched: ${message}`
      );
    }
  });
});

describe('parseActionlintFindings', () => {
  test('returns an empty array for a clean run (actionlint prints nothing)', () => {
    assert.deepEqual(parseActionlintFindings(''), []);
    assert.deepEqual(parseActionlintFindings('   \n  '), []);
  });

  test('parses a JSON array of findings', () => {
    const parsed = parseActionlintFindings(JSON.stringify([finding('boom')]));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].message, 'boom');
  });

  test('throws on non-JSON output rather than reporting a clean run', () => {
    assert.throws(() => parseActionlintFindings('panic: runtime error'), {
      message: /not JSON/,
    });
  });

  // Valid JSON that is not a findings array. `null` is the one worth spelling
  // out: `typeof null === 'object'`, so a naive shape check would wave it
  // through as "an object, close enough" and then read zero findings off it.
  test('throws when JSON parses but is not an array', () => {
    for (const notAnArray of ['{"message":"boom"}', '{}', 'null', '42', '"a string"']) {
      assert.throws(
        () => parseActionlintFindings(notAnArray),
        { message: /not an array/ },
        `should reject ${notAnArray}`
      );
    }
  });
});

describe('interpretFixtureRun', () => {
  test('passes when the expected finding is reported', () => {
    const result = interpretFixtureRun(
      permissionExpectation,
      run(1, [finding(PERMISSION_SCOPE_MESSAGE, 'permissions')])
    );
    assert.deepEqual(result, []);
  });

  test('passes when the expected finding appears alongside unrelated ones', () => {
    const result = interpretFixtureRun(
      secretsExpectation,
      run(1, [finding('some unrelated gripe'), finding(SECRETS_IN_IF_MESSAGE)])
    );
    assert.deepEqual(result, []);
  });

  // The core regression guard: a rule that stops firing must fail loudly rather
  // than leaving a green check that proves nothing.
  test('fails when the fixture is clean — the rule stopped firing', () => {
    const [failure] = interpretFixtureRun(secretsExpectation, run(0, []));
    assert.match(failure, /did not report it/);
    assert.match(failure, /no findings reported/);
    assert.match(failure, /PR #256/);
  });

  test('fails when the run is non-zero but for an unrelated reason', () => {
    const [failure] = interpretFixtureRun(
      permissionExpectation,
      run(1, [finding('unexpected key "runs-onn"', 'syntax-check')])
    );
    assert.match(failure, /did not report it/);
    assert.match(failure, /runs-onn/, 'should surface what was reported instead');
  });

  test('fails when actionlint was killed by a signal', () => {
    const [failure] = interpretFixtureRun(secretsExpectation, run(null, null, 'killed'));
    assert.match(failure, /killed by a signal/);
  });

  test('fails informatively when output cannot be parsed', () => {
    const [failure] = interpretFixtureRun(permissionExpectation, {
      exitCode: 1,
      stdout: 'flag provided but not defined: -format',
      stderr: '',
    });
    assert.match(failure, /could not read actionlint's output/);
  });

  // Regression: an operational failure writes usage text to stderr and nothing
  // to stdout. Read naively that parses to zero findings, so the fixture would
  // be blamed for "the rule stopped firing" and the reader sent to actionlint's
  // changelog, while the real cause sat unread on stderr.
  test('blames the operational failure, not the rule, when actionlint errors out', () => {
    const [failure] = interpretFixtureRun(secretsExpectation, {
      exitCode: 2,
      stdout: '',
      stderr: 'flag provided but not defined: -shellcheck',
    });
    assert.match(failure, /operational failure/);
    assert.match(failure, /flag provided but not defined/);
    assert.doesNotMatch(failure, /renamed or dropped upstream/);
  });
});

describe('interpretWorkflowsRun', () => {
  test('passes when no findings are reported', () => {
    assert.deepEqual(interpretWorkflowsRun(run(0, [])), []);
    assert.deepEqual(interpretWorkflowsRun(run(0)), []);
  });

  test('fails and lists every finding with its location', () => {
    const [failure] = interpretWorkflowsRun(
      run(1, [finding(SECRETS_IN_IF_MESSAGE), finding(PERMISSION_SCOPE_MESSAGE, 'permissions')])
    );
    assert.match(failure, /reported 2 problem\(s\)/);
    assert.match(failure, /\.github\/workflows\/example\.yml:7:12/);
    assert.match(failure, /\[permissions\]/);
  });

  test('fails when actionlint was killed by a signal', () => {
    const [failure] = interpretWorkflowsRun(run(null, null, 'out of memory'));
    assert.match(failure, /killed by a signal/);
  });

  // The hole this module exists to avoid: a run that checked nothing must never
  // read as "clean". actionlint exits 2 with usage on stderr and an empty
  // stdout, which parses to zero findings.
  test('does NOT report a clean run when actionlint failed operationally', () => {
    const [failure] = interpretWorkflowsRun({
      exitCode: 2,
      stdout: '',
      stderr: 'flag provided but not defined: -pyflakes',
    });
    assert.ok(failure, 'an operational failure must not pass as clean');
    assert.match(failure, /operational failure/);
    assert.match(failure, /nothing was actually checked/);
    assert.match(failure, /flag provided but not defined/);
  });

  test('fails when a non-zero exit reports no findings (output format changed)', () => {
    const [failure] = interpretWorkflowsRun(run(1, []));
    assert.match(failure, /reported no findings/);
  });

  test('fails when a zero exit reports findings (exit code and output disagree)', () => {
    const [failure] = interpretWorkflowsRun(run(0, [finding('a problem')]));
    assert.match(failure, /disagree/);
  });
});

describe('interpretSelfTest', () => {
  /** Both fixtures reporting exactly what they should. */
  const healthyFixtureRuns = () => [
    {
      expectation: permissionExpectation,
      run: run(1, [finding(PERMISSION_SCOPE_MESSAGE, 'permissions')]),
    },
    { expectation: secretsExpectation, run: run(1, [finding(SECRETS_IN_IF_MESSAGE)]) },
  ];

  test('passes when workflows are clean and both fixtures trip their rule', () => {
    const { ok, failures } = interpretSelfTest(run(0, []), healthyFixtureRuns());
    assert.equal(ok, true);
    assert.deepEqual(failures, []);
  });

  test('fails when a real workflow has a problem', () => {
    const { ok, failures } = interpretSelfTest(
      run(1, [finding(PERMISSION_SCOPE_MESSAGE, 'permissions')]),
      healthyFixtureRuns()
    );
    assert.equal(ok, false);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /reported 1 problem\(s\)/);
  });

  test('fails when a fixture stops tripping, even with clean workflows', () => {
    const fixtureRuns = healthyFixtureRuns();
    fixtureRuns[1].run = run(0, []);
    const { ok, failures } = interpretSelfTest(run(0, []), fixtureRuns);
    assert.equal(ok, false);
    assert.match(failures[0], /PR #256/);
  });

  test('reports every failure at once rather than stopping at the first', () => {
    const fixtureRuns = healthyFixtureRuns();
    fixtureRuns[0].run = run(0, []);
    fixtureRuns[1].run = run(0, []);
    const { ok, failures } = interpretSelfTest(run(1, [finding('a real problem')]), fixtureRuns);
    assert.equal(ok, false);
    assert.equal(failures.length, 3);
  });
});
