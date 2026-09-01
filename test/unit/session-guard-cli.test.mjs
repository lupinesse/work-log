/**
 * End-to-end tests for the session guard's command line (issue #268).
 *
 * These run the real CLI against a real throwaway git repository, because the
 * things most likely to break — verb dispatch, exit codes, and where the lock
 * file lands relative to the git common directory — only exist once git is
 * actually involved. The pure logic is covered separately in
 * `session-guard.test.mjs`.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCK_DIR_NAME } from '../../scripts/lib/session-guard.mjs';

const GUARD = fileURLToPath(new URL('../../scripts/session-guard.mjs', import.meta.url));
const SESSION = 'cli-test-session';

/** Throwaway repository shared by every case in this file. */
let repo;

/**
 * Run the guard inside the test repository.
 *
 * @param {string[]} args Arguments to pass to the CLI.
 * @param {string} [sessionId] Session to run as; defaults to this file's own.
 * @returns {{status: number, stdout: string, stderr: string}} Exit code and
 *   captured output, whichever way the process exited.
 */
function runGuard(args, sessionId = SESSION) {
  const result = spawnSync(process.execPath, [GUARD, ...args, `--session=${sessionId}`], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Run a git command inside the test repository.
 *
 * @param {string[]} args Arguments to pass to git.
 * @returns {string} Standard output.
 */
function gitInRepo(args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
}

/**
 * Absolute path of the lock directory belonging to the test repository.
 *
 * @returns {string} Path under the repository's `.git` directory.
 */
function lockDir() {
  return path.join(repo, '.git', LOCK_DIR_NAME);
}

before(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'session-guard-cli-')));
  gitInRepo(['init', '--initial-branch=main']);
  gitInRepo(['config', 'user.email', 'test@example.com']);
  gitInRepo(['config', 'user.name', 'Session Guard Test']);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'hello\n');
  gitInRepo(['add', 'tracked.txt']);
  gitInRepo(['commit', '--no-verify', '-m', 'chore: seed the test repository']);
});

after(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('session-guard CLI', () => {
  it('refuses an unknown verb with the usage text', () => {
    const result = runGuard(['demolish']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unrecognised argument\(s\): demolish/);
    assert.match(result.stdout, /usage: node scripts\/session-guard\.mjs/);
  });

  it('prints usage and exits cleanly for --help', () => {
    const result = runGuard(['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--ttl-hours=N/);
  });

  it('names the flag when --ttl-hours carries a value it cannot use', () => {
    const result = runGuard(['list', '--ttl-hours=zero']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /invalid value for --ttl-hours: "zero"/);
  });

  it('tells an unclaimed session to claim before it can check', () => {
    const result = runGuard(['check']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no baseline for session cli-test-session/);
  });

  it('claims the checkout and writes one lock beside the git common directory', () => {
    const result = runGuard(['claim']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /claimed — 0 dirty path\(s\) recorded on main/);
    assert.deepEqual(fs.readdirSync(lockDir()), [`${SESSION}.json`]);
  });

  it('refuses a second claim under the same identifier instead of absorbing its work', () => {
    // Regression for the collision the derived default identifier makes
    // possible: two sessions in one directory resolve to the same id, so an
    // overwriting claim would fold session A's uncommitted file into session
    // B's baseline and the next check would call the tree clean.
    runGuard(['claim', '--accept']); // session A already holds the checkout
    fs.writeFileSync(path.join(repo, 'work-in-progress.txt'), 'session A is mid-edit\n');

    const second = runGuard(['claim']);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /already holds this checkout/);
    assert.match(second.stderr, /npm run session:claim -- --session=<id>/);

    // The first session's baseline survived, so the file is still reported.
    const check = runGuard(['check']);
    assert.equal(check.status, 1);
    assert.match(check.stdout, /appeared {2}\[\?\?\] work-in-progress\.txt/);

    fs.rmSync(path.join(repo, 'work-in-progress.txt'));
  });

  it('re-baselines when a repeat claim says --accept', () => {
    fs.writeFileSync(path.join(repo, 'accepted.txt'), 'mine, and I know it\n');
    const claimed = runGuard(['claim', '--accept']);

    assert.equal(claimed.status, 0);
    assert.match(claimed.stdout, /re-baselined — 1 dirty path\(s\)/);
    assert.equal(runGuard(['check']).status, 0);

    fs.rmSync(path.join(repo, 'accepted.txt'));
    runGuard(['claim', '--accept']);
  });

  it('claims over a lock that has gone stale', () => {
    const lockFile = path.join(lockDir(), `${SESSION}.json`);
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock.updatedAt = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));

    const result = runGuard(['claim']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /re-baselined/);
  });

  it('reports a clean tree after claiming', () => {
    const result = runGuard(['check']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /nothing changed since this session/);
  });

  it('reproduces issue #268: a file this session never touched is reported', () => {
    fs.writeFileSync(path.join(repo, 'foreign.txt'), 'another session wrote this\n');
    const result = runGuard(['check']);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /the checkout changed since this session/);
    assert.match(result.stdout, /appeared {2}\[\?\?\] foreign\.txt/);
  });

  it('adopts the current tree as the baseline under --accept', () => {
    assert.equal(runGuard(['check', '--accept']).status, 0);
    const afterAccept = runGuard(['check']);
    assert.equal(afterAccept.status, 0);
    assert.match(afterAccept.stdout, /nothing changed since this session/);
  });

  it('reports a change made to a tracked file', () => {
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'edited by someone else\n');
    const result = runGuard(['check']);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /appeared {2}\[ M\] tracked\.txt/);
    gitInRepo(['checkout', '--', 'tracked.txt']);
  });

  it('warns when another session holds the same working tree', () => {
    assert.equal(runGuard(['claim'], 'second-session').status, 0);
    const result = runGuard(['check']);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /⚠ session second-session is working in this same directory/);

    const listing = runGuard(['list']);
    assert.equal(listing.status, 0);
    assert.match(listing.stdout, /second-session {2}main/);
    assert.match(listing.stdout, new RegExp(`${SESSION} {2}main`));

    runGuard(['release'], 'second-session');
  });

  it('reports a HEAD that moved under the session', () => {
    gitInRepo(['commit', '--no-verify', '--allow-empty', '-m', 'chore: someone else committed']);
    const result = runGuard(['check']);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /HEAD moved/);
  });

  it('releases the lock, and says so when there is nothing to release', () => {
    const released = runGuard(['release']);
    assert.equal(released.status, 0);
    assert.match(released.stdout, new RegExp(`released ${SESSION}`));

    const again = runGuard(['release']);
    assert.equal(again.status, 0);
    assert.match(again.stdout, new RegExp(`no lock held by ${SESSION}`));
    assert.deepEqual(fs.readdirSync(lockDir()), []);
  });

  it('ignores a corrupt lock file instead of failing the run', () => {
    fs.writeFileSync(path.join(lockDir(), 'corrupt.json'), '{ truncated', 'utf8');
    const result = runGuard(['list']);

    assert.equal(result.status, 0);
    assert.match(result.stderr, /⚠ ignoring lock file corrupt\.json/);
    fs.rmSync(path.join(lockDir(), 'corrupt.json'));
  });

  it('refuses to let --ttl-hours drop below the pruning floor', () => {
    runGuard(['claim'], 'bystander');
    const result = runGuard(['list', '--ttl-hours=0.0001']);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /stale after {6}0\.5h/);
    assert.match(result.stdout, /bystander/);
    runGuard(['release'], 'bystander');
  });

  it('fails with a git error outside a repository', () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'session-guard-bare-'));
    try {
      const result = spawnSync(process.execPath, [GUARD, 'list', `--session=${SESSION}`], {
        cwd: notARepo,
        encoding: 'utf8',
      });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /could not read git state/);
    } finally {
      fs.rmSync(notARepo, { recursive: true, force: true });
    }
  });
});
