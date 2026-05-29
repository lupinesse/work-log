/**
 * Unit tests for resolveAnthropicAuth() in lib/anthropic-auth.mjs.
 *
 * Covers: OAuth-token preference, API-key fallback, whitespace handling, and
 * the no-credential case — the regression that previously made the
 * claude-responds CI job exit whenever CLAUDE_CODE_OAUTH_TOKEN was unset even
 * though an API key was available.
 *
 * Run: node --test .github/scripts/test/anthropic-auth.test.mjs
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnthropicAuth } from '../lib/anthropic-auth.mjs';

describe('resolveAnthropicAuth', () => {
  test('prefers the OAuth token (Bearer) when present', () => {
    const auth = resolveAnthropicAuth({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-abc' });
    assert.deepStrictEqual(auth, {
      headers: { Authorization: 'Bearer oauth-abc' },
      source: 'CLAUDE_CODE_OAUTH_TOKEN',
    });
  });

  test('falls back to the API key (x-api-key) when no OAuth token', () => {
    const auth = resolveAnthropicAuth({ ANTHROPIC_API_KEY: 'sk-key' });
    assert.deepStrictEqual(auth, {
      headers: { 'x-api-key': 'sk-key' },
      source: 'ANTHROPIC_API_KEY',
    });
  });

  test('prefers the OAuth token even when both are set', () => {
    const auth = resolveAnthropicAuth({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-abc',
      ANTHROPIC_API_KEY: 'sk-key',
    });
    assert.equal(auth.source, 'CLAUDE_CODE_OAUTH_TOKEN');
    assert.equal(auth.headers.Authorization, 'Bearer oauth-abc');
    assert.equal(auth.headers['x-api-key'], undefined);
  });

  test('returns null when neither credential is set', () => {
    assert.equal(resolveAnthropicAuth({}), null);
  });

  test('treats a whitespace-only OAuth token as absent and falls back', () => {
    const auth = resolveAnthropicAuth({
      CLAUDE_CODE_OAUTH_TOKEN: '   ',
      ANTHROPIC_API_KEY: 'sk-key',
    });
    assert.equal(auth.source, 'ANTHROPIC_API_KEY');
  });

  test('treats whitespace-only values for both as no credential', () => {
    assert.equal(
      resolveAnthropicAuth({ CLAUDE_CODE_OAUTH_TOKEN: ' ', ANTHROPIC_API_KEY: '\t' }),
      null
    );
  });
});
