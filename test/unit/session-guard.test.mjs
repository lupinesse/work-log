/**
 * Unit tests for the session collision guard (issue #268).
 *
 * The guard's job is to make one session's working-tree changes visible to
 * another session sharing the same checkout, so these tests cover both the
 * parsing/diffing logic and the on-disk lock round-trip.
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_STALE_AFTER_MS,
  buildLock,
  diffWorkingTree,
  findWorktreeCollisions,
  formatAge,
  formatDriftReport,
  formatSessionList,
  isDriftEmpty,
  isLockStale,
  lockFilePath,
  lockStatusMap,
  parseArgs,
  parsePorcelainStatus,
  pruneStaleLocks,
  readLocks,
  removeLock,
  resolveSessionId,
  sanitizeSessionId,
  selectSessions,
  sessionLockDir,
  unquotePath,
  writeLock,
} from '../../scripts/lib/session-guard.mjs';

const NOW_MS = Date.parse('2026-08-21T12:00:00.000Z');
const NOW_ISO = new Date(NOW_MS).toISOString();

/** Temp directories created by the file-backed tests, removed on teardown. */
const tempDirs = [];

/**
 * Create a throwaway lock directory.
 *
 * @returns {string} Absolute path of a fresh empty directory.
 */
function makeTempLockDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-guard-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Build a lock record with sensible defaults for tests.
 *
 * @param {object} overrides Fields to override on the default record.
 * @returns {object} A lock record.
 */
function lockFixture(overrides = {}) {
  return buildLock({
    sessionId: 'session-a',
    worktree: path.join(os.tmpdir(), 'worklog'),
    branch: 'main',
    head: 'a'.repeat(40),
    status: new Map(),
    nowIso: NOW_ISO,
    ...overrides,
  });
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parsePorcelainStatus / unquotePath
// ---------------------------------------------------------------------------

describe('parsePorcelainStatus', () => {
  it('returns an empty map for empty input', () => {
    assert.equal(parsePorcelainStatus('').size, 0);
    assert.equal(parsePorcelainStatus(undefined).size, 0);
  });

  const cases = [
    { name: 'unstaged modification', line: ' M .gitignore', path: '.gitignore', code: ' M' },
    { name: 'staged modification', line: 'M  build.js', path: 'build.js', code: 'M ' },
    { name: 'untracked file', line: '?? notes.txt', path: 'notes.txt', code: '??' },
    { name: 'staged addition', line: 'A  src/js/new.js', path: 'src/js/new.js', code: 'A ' },
    { name: 'deletion', line: ' D src/js/old.js', path: 'src/js/old.js', code: ' D' },
  ];

  for (const testCase of cases) {
    it(`parses a ${testCase.name}`, () => {
      const status = parsePorcelainStatus(testCase.line);
      assert.deepEqual([...status.keys()], [testCase.path]);
      assert.equal(status.get(testCase.path), testCase.code);
    });
  }

  it('records a rename under its destination path', () => {
    const status = parsePorcelainStatus('R  src/js/old.js -> src/js/new.js');
    assert.deepEqual([...status.keys()], ['src/js/new.js']);
  });

  it('keeps a literal " -> " in a non-rename path', () => {
    const status = parsePorcelainStatus('?? docs/a -> b.md');
    assert.deepEqual([...status.keys()], ['docs/a -> b.md']);
  });

  it('handles CRLF line endings and blank lines', () => {
    const status = parsePorcelainStatus(' M a.js\r\n\r\n?? b.js\r\n');
    assert.deepEqual([...status.keys()], ['a.js', 'b.js']);
  });

  it('decodes a quoted non-ASCII path', () => {
    const status = parsePorcelainStatus('?? "caf\\303\\251.txt"');
    assert.deepEqual([...status.keys()], ['café.txt']);
  });
});

describe('unquotePath', () => {
  it('leaves an unquoted path untouched', () => {
    assert.equal(unquotePath('src/js/app.js'), 'src/js/app.js');
    assert.equal(unquotePath('a "b" c'), 'a "b" c');
  });

  it('decodes octal escapes as UTF-8 bytes', () => {
    assert.equal(unquotePath('"J\\303\\244rvinen.md"'), 'Järvinen.md');
  });

  it('decodes simple C escapes', () => {
    assert.equal(unquotePath('"a\\tb"'), 'a\tb');
    assert.equal(unquotePath('"say \\"hi\\""'), 'say "hi"');
    assert.equal(unquotePath('"back\\\\slash"'), 'back\\slash');
  });
});

// ---------------------------------------------------------------------------
// diffWorkingTree
// ---------------------------------------------------------------------------

describe('diffWorkingTree', () => {
  it('reports nothing for identical snapshots', () => {
    const snapshot = parsePorcelainStatus(' M a.js\n?? b.js');
    const drift = diffWorkingTree(snapshot, parsePorcelainStatus(' M a.js\n?? b.js'));
    assert.ok(isDriftEmpty(drift));
  });

  it('reproduces issue #268: a foreign staged file appears on a clean baseline', () => {
    const baseline = parsePorcelainStatus('');
    const current = parsePorcelainStatus('M  .github/workflows/a11y-audit.yml');
    const drift = diffWorkingTree(baseline, current);

    assert.equal(isDriftEmpty(drift), false);
    assert.deepEqual(drift.appeared, [{ path: '.github/workflows/a11y-audit.yml', code: 'M ' }]);
    assert.deepEqual(drift.vanished, []);
    assert.deepEqual(drift.changed, []);
  });

  it('reports a path that disappeared from the tree', () => {
    const drift = diffWorkingTree(parsePorcelainStatus(' M a.js'), parsePorcelainStatus(''));
    assert.deepEqual(drift.vanished, [{ path: 'a.js', code: ' M' }]);
  });

  it('reports a status code that changed in place', () => {
    const drift = diffWorkingTree(parsePorcelainStatus(' M a.js'), parsePorcelainStatus('M  a.js'));
    assert.deepEqual(drift.changed, [{ path: 'a.js', before: ' M', after: 'M ' }]);
  });

  it('sorts each bucket by path', () => {
    const drift = diffWorkingTree(
      parsePorcelainStatus(''),
      parsePorcelainStatus('?? c.js\n?? a.js\n?? b.js')
    );
    assert.deepEqual(
      drift.appeared.map((entry) => entry.path),
      ['a.js', 'b.js', 'c.js']
    );
  });
});

// ---------------------------------------------------------------------------
// Lock records
// ---------------------------------------------------------------------------

describe('buildLock / lockStatusMap', () => {
  it('round-trips a snapshot through JSON', () => {
    const status = parsePorcelainStatus(' M a.js\n?? b.js');
    const lock = JSON.parse(JSON.stringify(lockFixture({ status })));
    assert.deepEqual(
      [...lockStatusMap(lock).entries()],
      [
        ['a.js', ' M'],
        ['b.js', '??'],
      ]
    );
  });

  it('keeps the original claim time when refreshing', () => {
    const claimedAt = '2026-08-21T09:00:00.000Z';
    const lock = lockFixture({ claimedAt });
    assert.equal(lock.claimedAt, claimedAt);
    assert.equal(lock.updatedAt, NOW_ISO);
  });

  it('returns an empty map for a lock with no usable snapshot', () => {
    assert.equal(lockStatusMap({}).size, 0);
    assert.equal(lockStatusMap({ status: 'nonsense' }).size, 0);
    assert.equal(lockStatusMap({ status: [['a.js']] }).size, 0);
  });
});

describe('isLockStale', () => {
  const oneHour = 60 * 60 * 1000;

  it('accepts a lock refreshed within the TTL', () => {
    const lock = lockFixture({ nowIso: new Date(NOW_MS - oneHour).toISOString() });
    assert.equal(isLockStale(lock, NOW_MS, DEFAULT_STALE_AFTER_MS), false);
  });

  it('rejects a lock older than the TTL', () => {
    const lock = lockFixture({ nowIso: new Date(NOW_MS - 9 * oneHour).toISOString() });
    assert.equal(isLockStale(lock, NOW_MS, DEFAULT_STALE_AFTER_MS), true);
  });

  it('rejects a lock with no readable timestamp', () => {
    assert.equal(isLockStale({ updatedAt: 'never' }, NOW_MS), true);
    assert.equal(isLockStale({}, NOW_MS), true);
    assert.equal(isLockStale(null, NOW_MS), true);
  });
});

describe('selectSessions', () => {
  const oneHour = 60 * 60 * 1000;

  it('separates this session, live sessions, and expired ones', () => {
    const locks = [
      lockFixture({ sessionId: 'session-a' }),
      lockFixture({ sessionId: 'session-b' }),
      lockFixture({
        sessionId: 'session-c',
        nowIso: new Date(NOW_MS - 20 * oneHour).toISOString(),
      }),
    ];
    const { mine, others, stale } = selectSessions(locks, {
      nowMs: NOW_MS,
      sessionId: 'session-a',
    });

    assert.equal(mine.sessionId, 'session-a');
    assert.deepEqual(
      others.map((lock) => lock.sessionId),
      ['session-b']
    );
    assert.deepEqual(
      stale.map((lock) => lock.sessionId),
      ['session-c']
    );
  });

  it('returns a null lock when this session has not claimed', () => {
    const { mine, others } = selectSessions([lockFixture({ sessionId: 'session-b' })], {
      nowMs: NOW_MS,
      sessionId: 'session-a',
    });
    assert.equal(mine, null);
    assert.equal(others.length, 1);
  });

  it('sorts other sessions by id', () => {
    const locks = ['session-c', 'session-a', 'session-b'].map((id) =>
      lockFixture({ sessionId: id })
    );
    const { others } = selectSessions(locks, { nowMs: NOW_MS, sessionId: 'mine' });
    assert.deepEqual(
      others.map((lock) => lock.sessionId),
      ['session-a', 'session-b', 'session-c']
    );
  });
});

describe('findWorktreeCollisions', () => {
  it('finds another session in the same directory regardless of case', () => {
    const shared = path.join(os.tmpdir(), 'worklog');
    const others = [
      lockFixture({ sessionId: 'session-b', worktree: shared.toUpperCase() }),
      lockFixture({ sessionId: 'session-c', worktree: path.join(os.tmpdir(), 'worklog-other') }),
    ];
    const collisions = findWorktreeCollisions(others, shared);
    assert.deepEqual(
      collisions.map((lock) => lock.sessionId),
      ['session-b']
    );
  });

  it('returns nothing when every session has its own worktree', () => {
    const others = [lockFixture({ sessionId: 'session-b', worktree: '/tmp/other' })];
    assert.deepEqual(findWorktreeCollisions(others, '/tmp/mine'), []);
  });
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe('formatAge', () => {
  const cases = [
    [0, '0m'],
    [90 * 1000, '2m'],
    [45 * 60 * 1000, '45m'],
    [3 * 60 * 60 * 1000, '3h'],
    [-5000, '0m'],
  ];
  for (const [ageMs, expected] of cases) {
    it(`renders ${ageMs}ms as ${expected}`, () => assert.equal(formatAge(ageMs), expected));
  }
});

describe('formatDriftReport', () => {
  const emptyDrift = diffWorkingTree(new Map(), new Map());

  it('confirms a clean tree', () => {
    const report = formatDriftReport({
      drift: emptyDrift,
      headMoved: null,
      branchMoved: null,
      others: [],
      collisions: [],
      nowMs: NOW_MS,
    });
    assert.match(report, /^✔ nothing changed/);
  });

  it('lists every kind of drift under one failure headline', () => {
    const drift = diffWorkingTree(
      parsePorcelainStatus(' M gone.js\n M kept.js'),
      parsePorcelainStatus('M  kept.js\n?? new.js')
    );
    const report = formatDriftReport({
      drift,
      headMoved: { from: 'a'.repeat(40), to: 'b'.repeat(40) },
      branchMoved: { from: 'main', to: 'feat/x' },
      others: [],
      collisions: [],
      nowMs: NOW_MS,
    });

    assert.match(report, /^✖ the checkout changed/);
    assert.match(report, /branch moved {5}main → feat\/x/);
    assert.match(report, /HEAD moved {7}aaaaaaa → bbbbbbb/);
    assert.match(report, /appeared {2}\[\?\?\] new\.js/);
    assert.match(report, /vanished {2}\[ M\] gone\.js/);
    assert.match(report, /changed {3}\[ M → M \] kept\.js/);
  });

  it('warns loudly about another session in the same directory', () => {
    const collision = lockFixture({ sessionId: 'session-b' });
    const report = formatDriftReport({
      drift: emptyDrift,
      headMoved: null,
      branchMoved: null,
      others: [collision],
      collisions: [collision],
      nowMs: NOW_MS,
    });
    assert.match(report, /⚠ session session-b is working in this same directory/);
    assert.match(report, /also active: session-b on main \(0m ago\)/);
  });
});

describe('formatSessionList', () => {
  it('says so when nobody has claimed the checkout', () => {
    assert.match(formatSessionList([], NOW_MS), /no active sessions/);
  });

  it('shows id, branch, dirty count, age, and worktree', () => {
    const lock = lockFixture({ status: parsePorcelainStatus(' M a.js\n?? b.js') });
    const line = formatSessionList([lock], NOW_MS + 60 * 60 * 1000);
    assert.match(line, /session-a {2}main {2}2 dirty path\(s\) {2}seen 1h ago/);
  });
});

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults to no verb and no options', () => {
    assert.deepEqual(parseArgs([]), {
      verb: null,
      sessionId: null,
      accept: false,
      ttlMs: null,
      help: false,
      unknown: [],
    });
  });

  const verbs = ['claim', 'check', 'release', 'list'];
  for (const verb of verbs) {
    it(`recognises the ${verb} verb`, () => assert.equal(parseArgs([verb]).verb, verb));
  }

  it('reads --session, --accept, and --ttl-hours', () => {
    const args = parseArgs(['check', '--session=abc', '--accept', '--ttl-hours=2']);
    assert.equal(args.sessionId, 'abc');
    assert.equal(args.accept, true);
    assert.equal(args.ttlMs, 2 * 60 * 60 * 1000);
  });

  it('collects anything it does not recognise', () => {
    const args = parseArgs(['check', '--ttl-hours=zero', 'claim', '--force']);
    assert.deepEqual(args.unknown, ['--ttl-hours=zero', 'claim', '--force']);
  });

  it('treats -h and --help as help', () => {
    assert.equal(parseArgs(['-h']).help, true);
    assert.equal(parseArgs(['check', '--help']).help, true);
  });
});

describe('resolveSessionId', () => {
  const worktree = path.join(os.tmpdir(), 'worklog-issue-268');

  it('prefers the explicit flag', () => {
    assert.equal(resolveSessionId('flag', { WORKLOG_SESSION_ID: 'env' }, worktree, 'host'), 'flag');
  });

  it('falls back to WORKLOG_SESSION_ID, then CLAUDE_SESSION_ID', () => {
    assert.equal(resolveSessionId(null, { WORKLOG_SESSION_ID: 'w' }, worktree, 'host'), 'w');
    assert.equal(resolveSessionId(null, { CLAUDE_SESSION_ID: 'c' }, worktree, 'host'), 'c');
  });

  it('derives a stable id from the host and worktree name', () => {
    assert.equal(resolveSessionId(null, {}, worktree, 'laptop'), 'laptop-worklog-issue-268');
  });
});

describe('sanitizeSessionId', () => {
  const cases = [
    ['simple-id', 'simple-id'],
    ['C:\\Users\\x\\worklog', 'C-Users-x-worklog'],
    // Dots survive, but the separators that would make them traverse do not.
    ['../../escape', '..-..-escape'],
    ['a/b/c', 'a-b-c'],
    ['', 'unnamed-session'],
    [null, 'unnamed-session'],
  ];
  for (const [input, expected] of cases) {
    it(`maps ${JSON.stringify(input)} to ${expected}`, () => {
      assert.equal(sanitizeSessionId(input), expected);
    });
  }

  it('keeps a lock file inside its directory', () => {
    const lockDir = path.join(os.tmpdir(), 'locks');
    assert.equal(path.dirname(lockFilePath(lockDir, '../../etc/passwd')), lockDir);
  });
});

// ---------------------------------------------------------------------------
// Lock files on disk
// ---------------------------------------------------------------------------

describe('lock file storage', () => {
  it('creates the lock directory on first write', () => {
    const lockDir = path.join(makeTempLockDir(), 'nested', 'locks');
    writeLock(lockDir, lockFixture());
    assert.ok(fs.existsSync(lockDir));
  });

  it('round-trips a lock through write and read', () => {
    const lockDir = makeTempLockDir();
    const written = lockFixture({ status: parsePorcelainStatus(' M a.js') });
    writeLock(lockDir, written);

    const { locks, malformed } = readLocks(lockDir);
    assert.deepEqual(malformed, []);
    assert.equal(locks.length, 1);
    assert.deepEqual(locks[0], JSON.parse(JSON.stringify(written)));
  });

  it('reports a corrupt lock without hiding the healthy ones', () => {
    const lockDir = makeTempLockDir();
    writeLock(lockDir, lockFixture({ sessionId: 'session-a' }));
    fs.writeFileSync(path.join(lockDir, 'broken.json'), '{ not json', 'utf8');
    fs.writeFileSync(path.join(lockDir, 'wrong-shape.json'), '[1,2,3]', 'utf8');
    fs.writeFileSync(path.join(lockDir, 'ignored.txt'), 'not a lock', 'utf8');

    const { locks, malformed } = readLocks(lockDir);
    assert.deepEqual(
      locks.map((lock) => lock.sessionId),
      ['session-a']
    );
    assert.deepEqual(malformed.map((entry) => entry.file).sort(), [
      'broken.json',
      'wrong-shape.json',
    ]);
  });

  it('returns nothing for a lock directory that does not exist', () => {
    const { locks, malformed } = readLocks(path.join(makeTempLockDir(), 'absent'));
    assert.deepEqual(locks, []);
    assert.deepEqual(malformed, []);
  });

  it('removes a lock, and reports when there was none to remove', () => {
    const lockDir = makeTempLockDir();
    writeLock(lockDir, lockFixture({ sessionId: 'session-a' }));
    assert.equal(removeLock(lockDir, 'session-a'), true);
    assert.equal(removeLock(lockDir, 'session-a'), false);
    assert.deepEqual(readLocks(lockDir).locks, []);
  });

  it('prunes only the stale locks', () => {
    const lockDir = makeTempLockDir();
    const fresh = lockFixture({ sessionId: 'fresh' });
    const expired = lockFixture({
      sessionId: 'expired',
      nowIso: new Date(NOW_MS - 30 * 60 * 60 * 1000).toISOString(),
    });
    writeLock(lockDir, fresh);
    writeLock(lockDir, expired);

    const { stale } = selectSessions(readLocks(lockDir).locks, {
      nowMs: NOW_MS,
      sessionId: 'nobody',
    });
    assert.deepEqual(pruneStaleLocks(lockDir, stale), ['expired']);
    assert.deepEqual(
      readLocks(lockDir).locks.map((lock) => lock.sessionId),
      ['fresh']
    );
  });
});

describe('sessionLockDir', () => {
  it('places locks beside the git common directory', () => {
    const gitDir = path.join(os.tmpdir(), 'worklog', '.git');
    assert.equal(sessionLockDir(gitDir), path.join(gitDir, 'worklog-session-locks'));
  });
});
