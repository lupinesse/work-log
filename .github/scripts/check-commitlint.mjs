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
 * Run commitlint once against a message supplied on stdin.
 *
 * Resolves and spawns the CLI's JS entry point with the current Node binary
 * rather than shelling out to `npx` or `node_modules/.bin/commitlint`: the bin
 * shim is `.cmd` on Windows and would need `shell: true`, and this repo is used
 * on both Windows and Linux CI.
 *
 * @param {string} message - The commit message to lint.
 * @returns {import('./lib/commitlint-selftest.mjs').CommitlintRun}
 * @throws {Error} If @commitlint/cli cannot be resolved at all — that is a
 *   missing devDependency rather than a lint result, so it must not be
 *   reported as an ordinary failure.
 */
function runCommitlint(message) {
  const cliPath = require.resolve('@commitlint/cli/cli.js');
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
    console.error('  Is @commitlint/cli installed? Try `npm ci`.');
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
