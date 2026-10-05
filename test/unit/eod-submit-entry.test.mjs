/**
 * @file eod-submit-entry.test.mjs
 * Regression tests for scripts/eod-submit.mjs entry-point behaviour.
 *
 * These tests spawn the script as a subprocess (without `playwright` or a
 * real browser) to verify that a missing EOD_SUBMIT_URL produces a clean,
 * user-readable error message via the existing main() catch block rather
 * than an uncaught module-load exception.
 *
 * Regression for: module-level `throw` that prevented `npm run eod:login`
 * from running when EOD_SUBMIT_URL was unset in the user's shell.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, '../../scripts/eod-submit.mjs');

/**
 * Spawns the entry-point script with the given extra env vars and argv.
 * EOD_SUBMIT_URL defaults to unset so tests exercise the missing-URL path.
 * @param {string[]} args - Extra arguments to pass to the script.
 * @param {Record<string, string>} extraEnv - Additional environment variables.
 * @returns {{status: number|null, stderr: string, stdout: string}} Process result.
 */
function runScript(args = [], extraEnv = {}) {
  // Omit EOD_SUBMIT_URL entirely unless explicitly supplied in extraEnv.
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...extraEnv }).filter(
      ([k, v]) => k !== 'EOD_SUBMIT_URL' || v !== undefined
    )
  );
  if (!('EOD_SUBMIT_URL' in extraEnv)) {
    delete env.EOD_SUBMIT_URL;
  }
  const result = spawnSync('node', [scriptPath, ...args], { env, encoding: 'utf8', timeout: 5000 });
  return { status: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? '' };
}

describe('eod-submit.mjs — missing EOD_SUBMIT_URL', () => {
  it('exits with code 1 (not an uncaught exception) when EOD_SUBMIT_URL is unset', () => {
    const { status } = runScript(['--login']);
    // A clean handled error exits 1; an uncaught module-load throw would exit
    // non-zero too, but with a different stderr signature (see next test).
    assert.equal(status, 1);
  });

  it('prints a user-readable message that names EOD_SUBMIT_URL when it is unset', () => {
    const { stderr } = runScript(['--login']);
    assert.match(stderr, /EOD_SUBMIT_URL/);
  });

  it('does not print an uncaught exception stack trace when EOD_SUBMIT_URL is unset', () => {
    const { stderr } = runScript(['--login']);
    // Uncaught exceptions start with "file://" in the error line.
    // A handled error message never contains "at async " from a stack trace.
    assert.doesNotMatch(stderr, /Error: EOD_SUBMIT_URL.*\n.*at async /s);
  });
});
