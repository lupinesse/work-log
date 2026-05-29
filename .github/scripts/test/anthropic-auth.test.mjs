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
  resolveAnthropicAuthChain,
  isAuthFailureStatus,
  shouldFallThrough,
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

describe('resolveAnthropicAuthChain', () => {
  test('lists both credentials with OAuth first when both are set', () => {
    const chain = resolveAnthropicAuthChain({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-abc',
      ANTHROPIC_API_KEY: 'sk-key',
    });
    assert.equal(chain.length, 2);
    assert.deepStrictEqual(
      chain.map((a) => a.source),
      ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']
    );
    assert.equal(chain[0].headers.Authorization, 'Bearer oauth-abc');
    assert.equal(chain[1].headers['x-api-key'], 'sk-key');
  });

  test('returns a single entry when only one credential is set', () => {
    assert.deepStrictEqual(
      resolveAnthropicAuthChain({ ANTHROPIC_API_KEY: 'sk-key' }).map((a) => a.source),
      ['ANTHROPIC_API_KEY']
    );
  });

  test('returns an empty array when no credential is set', () => {
    assert.deepStrictEqual(resolveAnthropicAuthChain({}), []);
  });

  test('skips whitespace-only credentials', () => {
    const chain = resolveAnthropicAuthChain({
      CLAUDE_CODE_OAUTH_TOKEN: '   ',
      ANTHROPIC_API_KEY: 'sk-key',
    });
    assert.deepStrictEqual(
      chain.map((a) => a.source),
      ['ANTHROPIC_API_KEY']
    );
  });

  test('resolveAnthropicAuth returns the first chain entry (preferred credential)', () => {
    const auth = resolveAnthropicAuth({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-abc',
      ANTHROPIC_API_KEY: 'sk-key',
    });
    assert.equal(auth.source, 'CLAUDE_CODE_OAUTH_TOKEN');
  });
});

describe('isAuthFailureStatus', () => {
  test('treats 401 and 403 as auth failures (try the next credential)', () => {
    assert.equal(isAuthFailureStatus(401), true);
    assert.equal(isAuthFailureStatus(403), true);
  });

  test('treats other statuses as not auth failures (do not switch credential)', () => {
    for (const status of [200, 400, 404, 429, 500, 529]) {
      assert.equal(isAuthFailureStatus(status), false);
    }
  });
});

describe('shouldFallThrough', () => {
  test('falls through on 401, 403, and 429', () => {
    assert.equal(shouldFallThrough(401), true);
    assert.equal(shouldFallThrough(403), true);
    assert.equal(shouldFallThrough(429), true);
  });

  test('does not fall through on transient server errors or success', () => {
    for (const status of [200, 400, 404, 500, 529]) {
      assert.equal(shouldFallThrough(status), false);
    }
  });
});

describe('selectModel', () => {
  test('defaults the OAuth path to claude-sonnet-4-6', () => {
    assert.equal(selectModel('CLAUDE_CODE_OAUTH_TOKEN'), 'claude-sonnet-4-6');
  });

  test('defaults the API-key path to claude-sonnet-4-6', () => {
    assert.equal(selectModel('ANTHROPIC_API_KEY'), 'claude-sonnet-4-6');
  });

  test('an explicit override wins over the per-source default', () => {
    assert.equal(selectModel('ANTHROPIC_API_KEY', 'claude-haiku-4-5'), 'claude-haiku-4-5');
    assert.equal(selectModel('CLAUDE_CODE_OAUTH_TOKEN', 'claude-opus-4-7'), 'claude-opus-4-7');
  });

  test('falls back to the API-key default for an unrecognised source', () => {
    assert.equal(selectModel('SOMETHING_ELSE'), DEFAULT_MODEL_BY_SOURCE.ANTHROPIC_API_KEY);
    assert.equal(selectModel('SOMETHING_ELSE'), 'claude-sonnet-4-6');
  });

  test('an empty override is ignored in favour of the default', () => {
    assert.equal(selectModel('ANTHROPIC_API_KEY', ''), 'claude-sonnet-4-6');
  });
});
