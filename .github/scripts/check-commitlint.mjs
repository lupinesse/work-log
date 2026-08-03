#!/usr/bin/env node
/**
 * CI guard: assert that commitlint still loads its preset and still enforces it.
 *
 * Entry point only — the pass/fail logic lives in lib/commitlint-selftest.mjs.
 * Run via `npm run test:commitlint`; wired into the `lint` job in ci.yml so a
 * dependency skew that breaks the local `commit-msg` hook fails a required
 * check instead of surfacing on a contributor's next clean checkout.
 *
 * Exits 0 when both sample messages behave as expected, 1 otherwise.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import {
  CONFORMING_SAMPLE,
  NON_CONFORMING_SAMPLE,
  interpretSelfTest,
} from './lib/commitlint-selftest.mjs';

const require = createRequire(import.meta.url);

/**
 * Locate the commitlint CLI's JS entry point.
 *
 * Resolved through the package's own `bin` field rather than hard-coding
 * `cli.js`, so a future layout change surfaces as a clear error here instead of
 * an `ERR_PACKAGE_PATH_NOT_EXPORTED` that looks identical to the #251
 * dependency-skew regression this whole check exists to detect.
 *
 * @returns {string} Absolute path to the CLI entry point.
 * @throws {Error} With a message naming the actual cause — package missing, or
 *   present but no longer exposing its bin entry.
 */
function resolveCommitlintCli() {
  let binField;
  try {
    ({ bin: binField } = require('@commitlint/cli/package.json'));
  } catch (err) {
    throw new Error(
      `@commitlint/cli could not be resolved — is it installed? Try \`npm ci\`. (${err.message})`,
      { cause: err }
    );
  }

  const binPath = typeof binField === 'string' ? binField : binField?.commitlint;
  if (!binPath) {
    throw new Error(
      '@commitlint/cli is installed but declares no `commitlint` bin entry — ' +
        'its package layout changed and this check needs updating.'
    );
  }

  try {
    return require.resolve(`@commitlint/cli/${binPath.replace(/^\.\//, '')}`);
  } catch (err) {
    throw new Error(
      `@commitlint/cli is installed but its bin entry (${binPath}) is not importable — ` +
        `the package added an \`exports\` map or moved the file. (${err.message})`,
      { cause: err }
    );
  }
}

/**
 * Run commitlint once against a message supplied on stdin.
 *
 * Spawns the CLI's JS entry point with the current Node binary rather than
 * shelling out to `npx` or `node_modules/.bin/commitlint`: the bin shim is
 * `.cmd` on Windows and would need `shell: true`, and this repo is used on both
 * Windows and Linux CI.
 *
 * Assumption worth knowing: `.husky/commit-msg` invokes commitlint as
 * `npx --no -- commitlint --edit`, which is a *different* resolution path from
 * this one. Both load the same config and the same dependency tree, so the
 * preset-resolution breakage this check targets reproduces under either — but a
 * failure isolated to the bin shim or to `npx` itself would leave the hook dead
 * while this check stays green.
 *
 * @param {string} message - The commit message to lint.
 * @returns {import('./lib/commitlint-selftest.mjs').CommitlintRun}
 * @throws {Error} If commitlint cannot be located or spawned at all — that is a
 *   broken install rather than a lint result, so it must not be reported as an
 *   ordinary failure.
 */
function runCommitlint(message) {
  const cliPath = resolveCommitlintCli();
  const result = spawnSync(process.execPath, [cliPath], {
    input: message,
    encoding: 'utf8',
  });

  if (result.error) throw result.error;

  return {
    exitCode: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/**
 * Run both sample messages through commitlint and report the verdict.
 *
 * @returns {number} Process exit code: 0 on success, 1 on failure.
 */
function main() {
  console.log('commitlint self-test — checking the preset loads and still enforces rules');

  let conformingRun;
  let nonConformingRun;
  try {
    conformingRun = runCommitlint(CONFORMING_SAMPLE);
    nonConformingRun = runCommitlint(NON_CONFORMING_SAMPLE);
  } catch (err) {
    console.error(`✖ could not run commitlint at all — ${err.message}`);
    return 1;
  }

  console.log(
    `  conforming     "${CONFORMING_SAMPLE}" → exit ${conformingRun.exitCode}\n` +
      `  non-conforming "${NON_CONFORMING_SAMPLE}" → exit ${nonConformingRun.exitCode}`
  );

  const { ok, failures } = interpretSelfTest(conformingRun, nonConformingRun);

  if (ok) {
    console.log('✔ commitlint loads its preset and rejects non-conforming messages');
    return 0;
  }

  console.error('✖ commitlint self-test failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  return 1;
}

process.exit(main());
