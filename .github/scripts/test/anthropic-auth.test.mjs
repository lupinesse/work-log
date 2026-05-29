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
import {
  resolveAnthropicAuth,
  selectModel,
  DEFAULT_MODEL_BY_SOURCE,
} from '../lib/anthropic-auth.mjs';

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

describe('selectModel', () => {
  test('defaults the subscription (OAuth) path to Opus', () => {
    assert.equal(selectModel('CLAUDE_CODE_OAUTH_TOKEN'), 'claude-opus-4-7');
  });

  test('defaults the per-token (API key) path to the cheaper Haiku model', () => {
    assert.equal(selectModel('ANTHROPIC_API_KEY'), 'claude-haiku-4-5');
    // Guard against an accidental future edit putting Opus back on the metered path
    assert.notEqual(selectModel('ANTHROPIC_API_KEY'), 'claude-opus-4-7');
  });

  test('an explicit override wins over the per-source default', () => {
    assert.equal(selectModel('ANTHROPIC_API_KEY', 'claude-sonnet-4-6'), 'claude-sonnet-4-6');
    assert.equal(selectModel('CLAUDE_CODE_OAUTH_TOKEN', 'claude-sonnet-4-6'), 'claude-sonnet-4-6');
  });

  test('falls back to the subscription default for an unrecognised source', () => {
    assert.equal(selectModel('SOMETHING_ELSE'), DEFAULT_MODEL_BY_SOURCE.CLAUDE_CODE_OAUTH_TOKEN);
  });

  test('an empty override is ignored in favour of the default', () => {
    assert.equal(selectModel('ANTHROPIC_API_KEY', ''), 'claude-haiku-4-5');
  });
});
