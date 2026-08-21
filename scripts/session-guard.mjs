#!/usr/bin/env node
/**
 * Session collision guard — CLI entry point.
 *
 * Entry point only: every decision lives in `lib/session-guard.mjs`. This file
 * reads git state, calls that module, prints the result, and picks an exit
 * code.
 *
 * Exists because of issue #268: this checkout is driven by several concurrent
 * Claude Code sessions, and a working-tree mutation carries no attribution, so
 * `git status` can show another session's in-flight work as if it were yours.
 * Acting on that — staging it, discarding it, `reset --hard` — silently
 * destroys work. Claiming the checkout records a baseline; checking it says
 * what moved since, and who else is active.
 *
 * Usage:
 *   npm run session:claim                start (or re-baseline) this session
 *   npm run session:check                what changed since the baseline
 *   npm run session:check -- --accept    adopt the current tree as the baseline
 *   npm run session:list                 every session active on this checkout
 *   npm run session:release              drop this session's lock
 *
 * Options: `--session=ID`, `--ttl-hours=N`.
 *
 * Exit codes: 0 clean, 1 attention needed (drift, collision, or no baseline),
 * 2 usage or git error.
 */

import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import process from 'node:process';

import {
  DEFAULT_STALE_AFTER_MS,
  VERBS,
  buildLock,
  diffWorkingTree,
  findWorktreeCollisions,
  formatDriftReport,
  formatSessionList,
  formatAge,
  isDriftEmpty,
  isLockStale,
  lockStatusMap,
  parseArgs,
  parsePorcelainStatus,
  pruneStaleLocks,
  readLocks,
  removeLock,
  resolveSessionId,
  selectSessions,
  sessionLockDir,
  writeLock,
} from './lib/session-guard.mjs';

const EXIT_CLEAN = 0;
const EXIT_ATTENTION = 1;
const EXIT_ERROR = 2;

/** Shortest TTL `--ttl-hours` may set, in milliseconds. */
const MINIMUM_TTL_MS = 30 * 60 * 1000;

/**
 * Run a git command and return its output.
 *
 * @param {string[]} args Arguments passed to git.
 * @returns {string} Standard output with trailing whitespace removed. Leading
 *   whitespace is preserved, because porcelain status codes begin with it.
 */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trimEnd();
}

/**
 * Read everything the guard needs to know about the current checkout.
 *
 * @returns {{commonDir: string, worktree: string, branch: string, head: string,
 *   status: Map<string, string>}} Git state for this working tree.
 */
function readGitState() {
  return {
    commonDir: git(['rev-parse', '--path-format=absolute', '--git-common-dir']),
    worktree: git(['rev-parse', '--show-toplevel']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    head: git(['rev-parse', 'HEAD']),
    // core.quotepath=false leaves non-ASCII paths readable; this repo lives
    // under a directory with a non-ASCII character in it.
    status: parsePorcelainStatus(git(['-c', 'core.quotepath=false', 'status', '--porcelain'])),
  };
}

/**
 * Everything a verb needs to do its work, assembled once by `main`.
 *
 * @typedef {object} RunContext
 * @property {string} lockDir Directory holding the lock files.
 * @property {string} sessionId Identifier this session is registered under.
 * @property {{commonDir: string, worktree: string, branch: string, head: string,
 *   status: Map<string, string>}} state Git state read for this working tree.
 * @property {number} nowMs Current time in epoch milliseconds.
 * @property {string} nowIso The same instant as an ISO 8601 string.
 * @property {object|null} existing This session's lock, or null when unclaimed.
 * @property {object[]} others Live locks belonging to other sessions.
 * @property {boolean} accept Whether `--accept` was passed.
 * @property {number} ttlMs Age after which a lock counts as stale.
 */

/**
 * Record, or re-record, this session's baseline.
 *
 * @param {RunContext} context Resolved run context.
 * @returns {number} Process exit code.
 */
function runClaim({ lockDir, sessionId, state, nowIso, existing }) {
  const lock = buildLock({
    sessionId,
    worktree: state.worktree,
    branch: state.branch,
    head: state.head,
    status: state.status,
    nowIso,
    claimedAt: existing?.claimedAt,
  });
  writeLock(lockDir, lock);
  console.log(
    `${existing ? 're-baselined' : 'claimed'} — ${state.status.size} dirty path(s) recorded on ` +
      `${state.branch} at ${state.head.slice(0, 7)}`
  );
  return EXIT_CLEAN;
}

/**
 * Rewrite this session's lock, either as a heartbeat or as a new baseline.
 *
 * @param {RunContext} context Resolved run context. `accept` decides whether
 *   the current tree replaces the recorded baseline or only its timestamp.
 * @returns {void}
 */
function refreshLock({ lockDir, sessionId, state, nowIso, existing, accept }) {
  writeLock(
    lockDir,
    buildLock({
      sessionId,
      worktree: state.worktree,
      branch: accept ? state.branch : existing.branch,
      head: accept ? state.head : existing.head,
      status: accept ? state.status : lockStatusMap(existing),
      nowIso,
      claimedAt: existing.claimedAt,
    })
  );
}

/**
 * Compare the checkout against this session's baseline and report what moved.
 *
 * @param {RunContext} context Resolved run context.
 * @returns {number} Process exit code.
 */
function runCheck(context) {
  const { state, nowMs, existing, others, accept, ttlMs } = context;

  if (!existing) {
    console.error(
      `no baseline for session ${context.sessionId} — run \`npm run session:claim\` first`
    );
    return EXIT_ATTENTION;
  }

  // Say so before the drift list: against a baseline this old, every ordinary
  // hour of work reads as drift, and the age is the finding rather than the
  // paths are.
  if (isLockStale(existing, nowMs, ttlMs)) {
    console.warn(
      `⚠ this session's baseline is ${formatAge(nowMs - Date.parse(existing.updatedAt))} old — ` +
        're-claim before trusting what follows'
    );
  }

  const drift = diffWorkingTree(lockStatusMap(existing), state.status);
  const headMoved = existing.head === state.head ? null : { from: existing.head, to: state.head };
  const branchMoved =
    existing.branch === state.branch ? null : { from: existing.branch, to: state.branch };
  const collisions = findWorktreeCollisions(others, state.worktree);

  console.log(formatDriftReport({ drift, headMoved, branchMoved, others, collisions, nowMs }));

  // Refresh either way: `--accept` adopts the current tree as the new baseline,
  // a plain check only proves this session is still alive.
  refreshLock(context);

  if (accept) {
    console.log('baseline updated to the current working tree');
    return EXIT_CLEAN;
  }
  const clean = isDriftEmpty(drift) && !headMoved && !branchMoved && collisions.length === 0;
  return clean ? EXIT_CLEAN : EXIT_ATTENTION;
}

/**
 * Drop this session's lock.
 *
 * @param {RunContext} context Resolved run context.
 * @returns {number} Process exit code.
 */
function runRelease({ lockDir, sessionId }) {
  const removed = removeLock(lockDir, sessionId);
  console.log(removed ? `released ${sessionId}` : `no lock held by ${sessionId}`);
  return EXIT_CLEAN;
}

/**
 * List every session currently registered on this checkout.
 *
 * @param {RunContext} context Resolved run context.
 * @returns {number} Process exit code.
 */
function runList({ sessionId, others, existing, nowMs }) {
  const live = existing ? [existing, ...others] : others;
  console.log(formatSessionList(live, nowMs));
  if (others.length > 0) console.log(`\nthis session: ${sessionId}`);
  return EXIT_CLEAN;
}

/**
 * Orchestrate one run: read state, dispatch the verb, return an exit code.
 *
 * @param {string[]} argv Arguments after the script name.
 * @param {NodeJS.ProcessEnv} [env] Environment to read.
 * @returns {number} Process exit code.
 */
function main(argv, env = process.env) {
  const args = parseArgs(argv);

  if (args.help || args.verb === null || args.unknown.length > 0) {
    if (args.unknown.length > 0)
      console.error(`unrecognised argument(s): ${args.unknown.join(' ')}`);
    console.log(`usage: node scripts/session-guard.mjs <${VERBS.join('|')}> [options]

  claim      record this session's baseline for the current checkout
  check      report what changed since that baseline, and who else is active
  release    drop this session's lock
  list       show every session registered on this checkout

  --session=ID     identify this session explicitly
  --ttl-hours=N    treat a lock older than N hours as stale (floor: 0.5)
  --accept         (check only) adopt the current tree as the new baseline`);
    return args.help ? EXIT_CLEAN : EXIT_ERROR;
  }

  let state;
  try {
    state = readGitState();
  } catch (err) {
    console.error(`✖ could not read git state — ${err.message}`);
    return EXIT_ERROR;
  }

  const lockDir = sessionLockDir(state.commonDir);
  const sessionId = resolveSessionId(args.sessionId, env, state.worktree, hostname());
  // Floor the TTL: pruning deletes other sessions' baselines, and a guard
  // against destroying another session's state must not be the thing that
  // does it because of a mistyped flag.
  const ttlMs = Math.max(args.ttlMs ?? DEFAULT_STALE_AFTER_MS, MINIMUM_TTL_MS);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  console.log(
    `verb             ${args.verb}${args.accept ? ' --accept' : ''}\n` +
      `session          ${sessionId}\n` +
      `worktree         ${state.worktree}\n` +
      `lock directory   ${lockDir}\n` +
      `stale after      ${(ttlMs / 3600000).toFixed(1)}h\n`
  );

  const { locks, malformed } = readLocks(lockDir);
  for (const bad of malformed) console.warn(`⚠ ignoring lock file ${bad.file} — ${bad.reason}`);

  const { mine, others, stale } = selectSessions(locks, { nowMs, sessionId, ttlMs });
  const pruned = pruneStaleLocks(lockDir, stale);
  for (const id of pruned) console.log(`pruned stale lock: ${id}`);

  const context = {
    lockDir,
    sessionId,
    state,
    nowMs,
    nowIso,
    existing: mine,
    others,
    accept: args.accept,
    ttlMs,
  };

  switch (args.verb) {
    case 'claim':
      return runClaim(context);
    case 'check':
      return runCheck(context);
    case 'release':
      return runRelease(context);
    default:
      return runList(context);
  }
}

process.exit(main(process.argv.slice(2)));
