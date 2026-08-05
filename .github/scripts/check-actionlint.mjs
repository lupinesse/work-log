#!/usr/bin/env node
/**
 * CI guard: lint the repository's workflows, and assert actionlint still
 * catches the two bugs that have silently broken this repo's CI before.
 *
 * Entry point only — the pass/fail logic lives in lib/actionlint-selftest.mjs.
 * Run via `npm run test:actionlint`; wired into the `lint` job in ci.yml.
 *
 * Requires the `actionlint` binary on PATH (or at $ACTIONLINT_PATH). CI installs
 * a pinned, checksum-verified release; see CONTRIBUTING.md for local install.
 *
 * Exits 0 when the real workflows are clean and both fixtures still trip their
 * rule, 1 otherwise.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_FINDINGS,
  IGNORED_FINDING_PATTERNS,
  interpretSelfTest,
} from './lib/actionlint-selftest.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const fixtureDir = path.join(scriptDir, 'test', 'fixtures', 'actionlint');
/**
 * Reported at startup only. actionlint discovers this directory itself when
 * given no target paths — it is never passed as an argument (doing so fails
 * with `is a directory`).
 */
const workflowsDir = path.join(repoRoot, '.github', 'workflows');

/**
 * The actionlint executable to run.
 *
 * `ACTIONLINT_PATH` exists so a contributor who unpacked the binary somewhere
 * other than PATH can still run this locally without a global install.
 */
const ACTIONLINT_BIN = process.env.ACTIONLINT_PATH || 'actionlint';

/**
 * Flags applied to every run.
 *
 * `-format '{{json .}}'` gives structured findings instead of scraped text.
 *
 * The external shellcheck and pyflakes integrations are disabled: they lint the
 * *contents* of `run:` blocks across every existing workflow, which is a much
 * larger and unrelated cleanup than the workflow-schema validation this check
 * was added for. Turning them on is a deliberate, separate decision — do it by
 * dropping these two flags and fixing what surfaces, not by adding per-rule
 * ignores here.
 */
const COMMON_FLAGS = Object.freeze([
  '-format',
  '{{json .}}',
  '-shellcheck=',
  '-pyflakes=',
  ...IGNORED_FINDING_PATTERNS.flatMap((pattern) => ['-ignore', pattern]),
]);

/**
 * Run actionlint once.
 *
 * actionlint takes explicit *file* paths — handing it a directory fails with
 * `is a directory` and exit 3. To lint the repository's own workflows, pass no
 * targets at all: actionlint then discovers `.github/workflows/` itself,
 * relative to `cwd`.
 *
 * @param {string[]} targets - Workflow file paths, or `[]` to lint the
 *   repository's own `.github/workflows/`.
 * @returns {import('./lib/actionlint-selftest.mjs').ActionlintRun}
 * @throws {Error} If actionlint cannot be spawned at all — a missing binary is
 *   a broken environment, not a lint result, and must not read as a pass.
 */
function runActionlint(targets) {
  const result = spawnSync(ACTIONLINT_BIN, [...COMMON_FLAGS, ...targets], {
    encoding: 'utf8',
    cwd: repoRoot,
  });

  if (result.error) {
    const hint =
      result.error.code === 'ENOENT'
        ? ` — the actionlint binary was not found. Install it (see CONTRIBUTING.md, ` +
          `"Workflow linting") or set ACTIONLINT_PATH to its location.`
        : '';
    throw new Error(`failed to spawn ${ACTIONLINT_BIN}${hint} (${result.error.message})`, {
      cause: result.error,
    });
  }

  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Confirm every declared fixture is actually on disk.
 *
 * Without this, a renamed or deleted fixture would make actionlint fail to open
 * the file — which looks like "no findings reported" and would be blamed on the
 * rule rather than on the missing file.
 *
 * @returns {string[]} One line per missing fixture; empty when all are present.
 */
function findMissingFixtures() {
  return EXPECTED_FINDINGS.filter(
    (expectation) => !existsSync(path.join(fixtureDir, expectation.fixture))
  ).map(
    (expectation) =>
      `fixture ${expectation.fixture} is missing from ${path.relative(repoRoot, fixtureDir)} — ` +
      `it reproduces the ${expectation.incident} bug and this check cannot run without it.`
  );
}

/**
 * Lint the real workflows, then re-check both historical bugs.
 *
 * @returns {number} Process exit code: 0 on success, 1 on failure.
 */
function main() {
  console.log('actionlint self-test');
  console.log(`  binary        ${ACTIONLINT_BIN}`);
  console.log(`  workflows     ${path.relative(repoRoot, workflowsDir)}`);
  console.log(`  fixtures      ${EXPECTED_FINDINGS.map((e) => e.fixture).join(', ')}`);
  console.log(`  shellcheck    disabled (see COMMON_FLAGS)`);

  const missing = findMissingFixtures();
  if (missing.length) {
    console.error('✖ actionlint self-test could not run:');
    for (const failure of missing) console.error(`  - ${failure}`);
    return 1;
  }

  let workflowsRun;
  let fixtureRuns;
  try {
    workflowsRun = runActionlint([]);
    fixtureRuns = EXPECTED_FINDINGS.map((expectation) => ({
      expectation,
      run: runActionlint([path.join(fixtureDir, expectation.fixture)]),
    }));
  } catch (err) {
    console.error(`✖ could not run actionlint at all — ${err.message}`);
    return 1;
  }

  console.log(`  .github/workflows/ → exit ${workflowsRun.exitCode}`);
  for (const { expectation, run } of fixtureRuns) {
    console.log(`  ${expectation.fixture} → exit ${run.exitCode} (expected non-zero)`);
  }

  const { ok, failures } = interpretSelfTest(workflowsRun, fixtureRuns);

  if (ok) {
    console.log('✔ workflows are clean, and actionlint still catches both historical bugs');
    return 0;
  }

  console.error('✖ actionlint self-test failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  return 1;
}

process.exit(main());
