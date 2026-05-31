/**
 * Unit tests for loadClaudeMd() in lib/load-claude-md.mjs.
 *
 * Run: node --test .github/scripts/test/load-claude-md.test.mjs
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadClaudeMd } from '../lib/load-claude-md.mjs';

let TMP;

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'load-claude-md-test-'));
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('loadClaudeMd — file present', () => {
  test('returns trimmed content when file exists', () => {
    writeFileSync(join(TMP, 'CLAUDE.md'), '  # Quality standard\n\nSome rules.\n  ');
    const result = loadClaudeMd(join(TMP, 'CLAUDE.md'));
    assert.strictEqual(result, '# Quality standard\n\nSome rules.');
  });

  test('returns non-empty string for a typical CLAUDE.md', () => {
    const content = '# Rules\n- Write tests\n- Use JSDoc';
    writeFileSync(join(TMP, 'CLAUDE.md'), content);
    const result = loadClaudeMd(join(TMP, 'CLAUDE.md'));
    assert.ok(typeof result === 'string' && result.length > 0);
  });
});

describe('loadClaudeMd — file absent', () => {
  test('returns null when file does not exist', () => {
    const result = loadClaudeMd(join(TMP, 'CLAUDE.md'));
    assert.strictEqual(result, null);
  });

  test('returns null for a completely non-existent path', () => {
    const result = loadClaudeMd('/nonexistent/path/CLAUDE.md');
    assert.strictEqual(result, null);
  });
});
