/**
 * Session collision guard — shared-checkout drift detection.
 *
 * Several Claude Code sessions and tools drive this repository from the same
 * checkout at once. Issue #268 recorded a session finding a *staged* edit it
 * had never made: nothing in git attributes a working-tree mutation to the
 * actor that caused it, so one session can stage, discard, or `reset --hard`
 * another session's in-progress work without either noticing.
 *
 * This module holds the logic behind `scripts/session-guard.mjs`. A session
 * records a baseline (branch, HEAD, `git status --porcelain`) when it claims
 * the checkout; a later check diffs the tree against that baseline and against
 * the other sessions registered on the same repository. It only ever reports —
 * nothing here writes to the working tree.
 *
 * Locks live under the git *common* directory rather than inside a working
 * tree, because linked worktrees do not share each other's files but do share
 * `.git`. That makes the lock set visible to every session on the checkout,
 * and keeps it out of the repository itself.
 *
 * @module session-guard
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Directory name, under the git common dir, that holds the lock files. */
export const LOCK_DIR_NAME = 'worklog-session-locks';

/** Verbs the command line accepts. */
export const VERBS = ['claim', 'check', 'release', 'list'];

/** Extension used for lock files. */
export const LOCK_FILE_EXTENSION = '.json';

/**
 * How long a lock stays trustworthy without being refreshed, in milliseconds.
 *
 * Liveness is judged by age alone: every `session-guard` invocation is a
 * short-lived `npm run` process, so a recorded process id would say nothing
 * about whether the session that wrote it is still working.
 */
export const DEFAULT_STALE_AFTER_MS = 8 * 60 * 60 * 1000;

/**
 * Build the lock directory path for a repository.
 *
 * @param {string} gitCommonDir Absolute path of the repository's git common
 *   directory, as reported by `git rev-parse --path-format=absolute
 *   --git-common-dir`. It is shared by the main checkout and every linked
 *   worktree.
 * @returns {string} Absolute path of the directory holding the lock files.
 */
export function sessionLockDir(gitCommonDir) {
  return path.join(gitCommonDir, LOCK_DIR_NAME);
}

/**
 * Parse the guard's command line.
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {{verb: string|null, sessionId: string|null, accept: boolean,
 *   ttlMs: number|null, help: boolean, unknown: string[]}} The parsed options;
 *   `verb` is null when none was given, and `unknown` collects anything not
 *   recognised so the caller can refuse to act on a mistyped command.
 */
export function parseArgs(argv) {
  const parsed = {
    verb: null,
    sessionId: null,
    accept: false,
    ttlMs: null,
    help: false,
    unknown: [],
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--accept') parsed.accept = true;
    else if (arg.startsWith('--session=')) parsed.sessionId = arg.slice('--session='.length);
    else if (arg.startsWith('--ttl-hours=')) {
      const hours = Number(arg.slice('--ttl-hours='.length));
      if (Number.isFinite(hours) && hours > 0) parsed.ttlMs = hours * 60 * 60 * 1000;
      else parsed.unknown.push(arg);
    } else if (parsed.verb === null && VERBS.includes(arg)) parsed.verb = arg;
    else parsed.unknown.push(arg);
  }

  return parsed;
}

/**
 * Choose the identifier a session is registered under.
 *
 * An explicit flag wins, then the environment, then the working tree itself:
 * the convention is one worktree per session, so the directory name identifies
 * the session well enough to stay stable across separate `npm run`
 * invocations, which a process id could not.
 *
 * @param {string|null} flagValue Value of `--session=`, or null.
 * @param {object} env Environment to read `WORKLOG_SESSION_ID` and
 *   `CLAUDE_SESSION_ID` from.
 * @param {string} worktree Absolute path of the current working tree.
 * @param {string} hostName Name of the machine, to keep ids distinct when a
 *   checkout is shared over a network path.
 * @returns {string} The session identifier.
 */
export function resolveSessionId(flagValue, env, worktree, hostName) {
  return (
    flagValue ||
    env.WORKLOG_SESSION_ID ||
    env.CLAUDE_SESSION_ID ||
    `${hostName}-${path.basename(worktree)}`
  );
}

/**
 * Reduce a session identifier to a safe, stable file name stem.
 *
 * Session ids come from the environment and from worktree paths, so they can
 * carry separators and drive letters. Anything outside `[A-Za-z0-9._-]` is
 * collapsed to a hyphen, which keeps a lock file inside its own directory.
 *
 * @param {string} sessionId Raw session identifier.
 * @returns {string} File-name-safe identifier, never empty.
 */
export function sanitizeSessionId(sessionId) {
  const safe = String(sessionId ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return safe === '' ? 'unnamed-session' : safe;
}

/**
 * Decode a path as printed by `git status --porcelain`.
 *
 * Git wraps a path in double quotes and C-escapes it when it contains control
 * characters, quotes, or backslashes. Octal escapes are UTF-8 bytes, so they
 * are collected and decoded together rather than one character at a time.
 *
 * @param {string} raw Path field exactly as git printed it.
 * @returns {string} The decoded path.
 */
export function unquotePath(raw) {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;

  const body = raw.slice(1, -1);
  const bytes = [];
  const encoder = new TextEncoder();
  const simpleEscapes = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== '\\') {
      bytes.push(...encoder.encode(body[index]));
      continue;
    }
    const escape = body[index + 1];
    const octal = body.slice(index + 1, index + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      index += 3;
    } else if (escape !== undefined && Object.hasOwn(simpleEscapes, escape)) {
      bytes.push(simpleEscapes[escape]);
      index += 1;
    } else if (escape !== undefined) {
      bytes.push(...encoder.encode(escape));
      index += 1;
    }
  }

  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/**
 * Parse `git status --porcelain` (v1) output into a path → status-code map.
 *
 * Rename and copy entries are recorded under their destination path, which is
 * the path that now exists in the tree.
 *
 * @param {string} porcelainText Raw output of `git status --porcelain`.
 * @returns {Map<string, string>} Path mapped to its two-character status code.
 */
export function parsePorcelainStatus(porcelainText) {
  const status = new Map();
  if (!porcelainText) return status;

  for (const rawLine of porcelainText.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') continue;

    const code = line.slice(0, 2);
    const pathField = line.slice(3);
    const arrow = pathField.lastIndexOf(' -> ');
    const target = /[RC]/.test(code) && arrow !== -1 ? pathField.slice(arrow + 4) : pathField;
    status.set(unquotePath(target), code);
  }

  return status;
}

/**
 * Compare two working-tree snapshots.
 *
 * @param {Map<string, string>} before Baseline snapshot.
 * @param {Map<string, string>} after Current snapshot.
 * @returns {{appeared: Array<{path: string, code: string}>,
 *   vanished: Array<{path: string, code: string}>,
 *   changed: Array<{path: string, before: string, after: string}>}}
 *   Paths that gained, lost, or altered a status code, each sorted by path.
 */
export function diffWorkingTree(before, after) {
  const appeared = [];
  const vanished = [];
  const changed = [];

  for (const [filePath, code] of after) {
    if (!before.has(filePath)) {
      appeared.push({ path: filePath, code });
    } else if (before.get(filePath) !== code) {
      changed.push({ path: filePath, before: before.get(filePath), after: code });
    }
  }
  for (const [filePath, code] of before) {
    if (!after.has(filePath)) vanished.push({ path: filePath, code });
  }

  const byPath = (left, right) => left.path.localeCompare(right.path);
  return {
    appeared: appeared.sort(byPath),
    vanished: vanished.sort(byPath),
    changed: changed.sort(byPath),
  };
}

/**
 * Report whether a drift result contains anything at all.
 *
 * @param {ReturnType<typeof diffWorkingTree>} drift Result of `diffWorkingTree`.
 * @returns {boolean} True when every drift bucket is empty.
 */
export function isDriftEmpty(drift) {
  return drift.appeared.length === 0 && drift.vanished.length === 0 && drift.changed.length === 0;
}

/**
 * Build a lock record for a session.
 *
 * @param {object} options Lock contents.
 * @param {string} options.sessionId Identifier of the claiming session.
 * @param {string} options.worktree Absolute path of the working tree in use.
 * @param {string} options.branch Branch currently checked out there.
 * @param {string} options.head Commit SHA currently at HEAD.
 * @param {Map<string, string>} options.status Baseline working-tree snapshot.
 * @param {string} options.nowIso Timestamp for this write, ISO 8601.
 * @param {string} [options.claimedAt] Original claim time, when refreshing an
 *   existing lock rather than creating one.
 * @returns {object} A JSON-serialisable lock record.
 */
export function buildLock({ sessionId, worktree, branch, head, status, nowIso, claimedAt }) {
  return {
    sessionId,
    worktree,
    branch,
    head,
    claimedAt: claimedAt ?? nowIso,
    updatedAt: nowIso,
    status: [...status.entries()].sort(([left], [right]) => left.localeCompare(right)),
  };
}

/**
 * Restore the snapshot stored in a lock record.
 *
 * @param {object} lock Lock record read from disk.
 * @returns {Map<string, string>} Path mapped to status code; empty when the
 *   lock holds no usable snapshot.
 */
export function lockStatusMap(lock) {
  if (!Array.isArray(lock?.status)) return new Map();
  return new Map(lock.status.filter((entry) => Array.isArray(entry) && entry.length === 2));
}

/**
 * Decide whether a lock is too old to be believed.
 *
 * @param {object} lock Lock record read from disk.
 * @param {number} nowMs Current time in epoch milliseconds.
 * @param {number} [ttlMs] Age after which a lock counts as stale.
 * @returns {boolean} True when the lock has no readable timestamp or is past
 *   its TTL.
 */
export function isLockStale(lock, nowMs, ttlMs = DEFAULT_STALE_AFTER_MS) {
  const updatedMs = Date.parse(lock?.updatedAt ?? '');
  if (Number.isNaN(updatedMs)) return true;
  return nowMs - updatedMs > ttlMs;
}

/**
 * Split a set of locks into this session's, other live sessions', and stale ones.
 *
 * @param {object[]} locks Lock records read from disk.
 * @param {object} options Selection options.
 * @param {number} options.nowMs Current time in epoch milliseconds.
 * @param {string} options.sessionId Identifier of the calling session.
 * @param {number} [options.ttlMs] Age after which a lock counts as stale.
 * @returns {{mine: object|null, others: object[], stale: object[]}} The calling
 *   session's lock (or null), other sessions still within their TTL sorted by
 *   id, and the locks that have expired.
 */
export function selectSessions(locks, { nowMs, sessionId, ttlMs = DEFAULT_STALE_AFTER_MS }) {
  const stale = [];
  const others = [];
  let mine = null;

  for (const lock of locks) {
    if (lock?.sessionId === sessionId) {
      mine = lock;
      continue;
    }
    if (isLockStale(lock, nowMs, ttlMs)) stale.push(lock);
    else others.push(lock);
  }

  others.sort((left, right) => String(left.sessionId).localeCompare(String(right.sessionId)));
  return { mine, others, stale };
}

/**
 * Find other live sessions working in the very same directory.
 *
 * This is the #268 condition itself: two sessions editing one working tree,
 * where each sees the other's changes as unexplained `git status` output.
 *
 * @param {object[]} others Live locks belonging to other sessions.
 * @param {string} worktree Absolute path of this session's working tree.
 * @returns {object[]} The subset of `others` sharing that working tree.
 */
export function findWorktreeCollisions(others, worktree) {
  const normalise = (value) => path.resolve(String(value ?? '')).toLowerCase();
  const target = normalise(worktree);
  return others.filter((lock) => normalise(lock.worktree) === target);
}

/**
 * Render an age in whole minutes or hours.
 *
 * @param {number} ageMs Age in milliseconds.
 * @returns {string} Human-readable age, e.g. `12m` or `3h`.
 */
export function formatAge(ageMs) {
  const minutes = Math.max(0, Math.round(ageMs / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

/**
 * Render the report shown by the `check` verb.
 *
 * @param {object} report Report contents.
 * @param {ReturnType<typeof diffWorkingTree>} report.drift Working-tree drift.
 * @param {{from: string, to: string}|null} report.headMoved HEAD movement since
 *   the baseline, or null when HEAD is unchanged.
 * @param {{from: string, to: string}|null} report.branchMoved Branch change
 *   since the baseline, or null when the branch is unchanged.
 * @param {object[]} report.others Live locks belonging to other sessions.
 * @param {object[]} report.collisions Live locks sharing this working tree.
 * @param {number} report.nowMs Current time in epoch milliseconds.
 * @returns {string} A multi-line report, ready to print.
 */
export function formatDriftReport({ drift, headMoved, branchMoved, others, collisions, nowMs }) {
  const findings = [];

  if (branchMoved) findings.push(`branch moved     ${branchMoved.from} → ${branchMoved.to}`);
  if (headMoved) {
    findings.push(`HEAD moved       ${headMoved.from.slice(0, 7)} → ${headMoved.to.slice(0, 7)}`);
  }
  for (const entry of drift.appeared) findings.push(`appeared  [${entry.code}] ${entry.path}`);
  for (const entry of drift.vanished) findings.push(`vanished  [${entry.code}] ${entry.path}`);
  for (const entry of drift.changed) {
    findings.push(`changed   [${entry.before} → ${entry.after}] ${entry.path}`);
  }

  const lines =
    findings.length === 0
      ? ['✔ nothing changed since this session’s baseline']
      : ['✖ the checkout changed since this session’s baseline', ...findings];

  for (const lock of collisions) {
    lines.push(`⚠ session ${lock.sessionId} is working in this same directory`);
  }
  for (const lock of others) {
    const age = formatAge(nowMs - Date.parse(lock.updatedAt));
    lines.push(
      `  also active: ${lock.sessionId} on ${lock.branch} (${age} ago) — ${lock.worktree}`
    );
  }

  return lines.join('\n');
}

/**
 * Render the listing shown by the `list` verb.
 *
 * @param {object[]} locks Live lock records.
 * @param {number} nowMs Current time in epoch milliseconds.
 * @returns {string} A multi-line listing, ready to print.
 */
export function formatSessionList(locks, nowMs) {
  if (locks.length === 0) return 'no active sessions registered on this checkout';
  return locks
    .map((lock) => {
      const age = formatAge(nowMs - Date.parse(lock.updatedAt));
      const dirty = Array.isArray(lock.status) ? lock.status.length : 0;
      return `${lock.sessionId}  ${lock.branch}  ${dirty} dirty path(s)  seen ${age} ago  ${lock.worktree}`;
    })
    .join('\n');
}

/**
 * Build the path of one session's lock file.
 *
 * @param {string} lockDir Directory holding the lock files.
 * @param {string} sessionId Identifier of the session.
 * @returns {string} Absolute path of that session's lock file.
 */
export function lockFilePath(lockDir, sessionId) {
  return path.join(lockDir, `${sanitizeSessionId(sessionId)}${LOCK_FILE_EXTENSION}`);
}

/**
 * Read every lock file in a directory.
 *
 * A lock that cannot be parsed is reported rather than thrown on, so one
 * corrupt file cannot hide every other session from view.
 *
 * @param {string} lockDir Directory holding the lock files.
 * @returns {{locks: object[], malformed: Array<{file: string, reason: string}>}}
 *   Parsed locks, plus the files that could not be read.
 */
export function readLocks(lockDir) {
  const locks = [];
  const malformed = [];
  if (!existsSync(lockDir)) return { locks, malformed };

  for (const entry of readdirSync(lockDir)) {
    if (!entry.endsWith(LOCK_FILE_EXTENSION)) continue;
    const file = path.join(lockDir, entry);
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && typeof parsed.sessionId === 'string') {
        locks.push(parsed);
      } else {
        malformed.push({ file: entry, reason: 'not a lock record' });
      }
    } catch (err) {
      malformed.push({ file: entry, reason: err.message });
    }
  }

  return { locks, malformed };
}

/**
 * Write a session's lock file, creating the lock directory if needed.
 *
 * @param {string} lockDir Directory holding the lock files.
 * @param {object} lock Lock record to persist.
 * @returns {string} Absolute path of the file written.
 */
export function writeLock(lockDir, lock) {
  mkdirSync(lockDir, { recursive: true });
  const file = lockFilePath(lockDir, lock.sessionId);
  writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * Delete a session's lock file.
 *
 * @param {string} lockDir Directory holding the lock files.
 * @param {string} sessionId Identifier of the session to release.
 * @returns {boolean} True when a lock file was removed, false when none existed.
 */
export function removeLock(lockDir, sessionId) {
  const file = lockFilePath(lockDir, sessionId);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

/**
 * Delete the lock files of sessions that have passed their TTL.
 *
 * @param {string} lockDir Directory holding the lock files.
 * @param {object[]} staleLocks Locks already identified as stale.
 * @returns {string[]} Identifiers of the sessions whose locks were removed.
 */
export function pruneStaleLocks(lockDir, staleLocks) {
  return staleLocks
    .filter((lock) => removeLock(lockDir, lock.sessionId))
    .map((lock) => lock.sessionId);
}
