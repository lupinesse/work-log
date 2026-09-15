/**
 * Regression test for issue #424: chatgpt-review.mjs's DEFAULT_PROMPT told
 * the reviewer to enforce "use wlLog.warn/error — never silent catch"
 * repo-wide. wlLog is a browser global defined in src/js/00-config.js and
 * bundled into the page — it has no meaning in .github/scripts/, which is
 * plain Node run by GitHub Actions. On PR #422 this produced a blocking
 * finding asking for `console.error` in a CI script to be replaced with
 * `wlLog.error`, which would have thrown a ReferenceError at runtime.
 *
 * chatgpt-review.mjs runs `main()` unconditionally at import time (no
 * `import.meta.url` guard), so it cannot be imported directly in a test —
 * doing so would attempt a real OpenAI/GitHub API call. This test instead
 * reads the file as source text and asserts against the prompt string
 * itself, the same approach workflow-event-guards.test.mjs uses for YAML.
 *
 * Run: node --test .github/scripts/test/chatgpt-review-prompt.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const source = readFileSync(
  path.join(repoRoot, '.github', 'scripts', 'chatgpt-review.mjs'),
  'utf8'
);

describe('chatgpt-review.mjs DEFAULT_PROMPT — wlLog rule scoping (#424)', () => {
  it('does not tell the reviewer to enforce wlLog repo-wide', () => {
    // The exact unscoped phrasing that shipped and produced the false
    // positive on PR #422 — must never reappear verbatim.
    assert.ok(
      !source.includes('use wlLog.warn/error — never silent catch'),
      'the unscoped wlLog rule text should not be present'
    );
  });

  it('scopes the wlLog rule to src/js/ app code', () => {
    const focusLine = source.split('\n').find((line) => line.startsWith('Focus on:'));
    assert.ok(focusLine, 'expected a "Focus on:" line in the prompt');
    assert.match(focusLine, /wlLog\.warn\/error/);
    assert.match(focusLine, /src\/js\//);
  });

  it('tells the reviewer CI scripts use console.error/warn instead', () => {
    const focusLine = source.split('\n').find((line) => line.startsWith('Focus on:'));
    assert.match(focusLine, /\.github\/scripts\//);
    assert.match(focusLine, /console\.error\/warn/);
  });

  it('still requires no silent catch, regardless of directory', () => {
    const focusLine = source.split('\n').find((line) => line.startsWith('Focus on:'));
    assert.match(focusLine, /never a silent catch/);
  });
});
