/**
 * Unit tests for resolveAnthropicAuth() in lib/anthropic-auth.mjs.
 *
 * Covers: OAuth-token resolution, whitespace handling, and the no-credential
 * case. ANTHROPIC_API_KEY is no longer supported — only CLAUDE_CODE_OAUTH_TOKEN
 * is accepted.
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
  DEFAULT_MODEL,
} from '../lib/anthropic-auth.mjs';

describe('resolveAnthropicAuth', () => {
  test('returns Bearer auth when CLAUDE_CODE_OAUTH_TOKEN is set', () => {
    const auth = resolveAnthropicAuth({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-abc' });
    assert.deepStrictEqual(auth, {
      headers: { Authorization: 'Bearer oauth-abc' },
      source: 'CLAUDE_CODE_OAUTH_TOKEN',
    });
  });

  test('returns null when no credential is set', () => {
    assert.equal(resolveAnthropicAuth({}), null);
  });

  test('ignores ANTHROPIC_API_KEY — only the OAuth token is accepted', () => {
    assert.equal(resolveAnthropicAuth({ ANTHROPIC_API_KEY: 'sk-key' }), null);
  });

  test('treats a whitespace-only OAuth token as absent', () => {
    assert.equal(resolveAnthropicAuth({ CLAUDE_CODE_OAUTH_TOKEN: '   ' }), null);
  });

  test('treats whitespace-only token with API key present as no credential', () => {
    assert.equal(
      resolveAnthropicAuth({ CLAUDE_CODE_OAUTH_TOKEN: ' ', ANTHROPIC_API_KEY: 'sk-key' }),
      null
    );
  });
});

describe('resolveAnthropicAuthChain', () => {
  test('returns a one-element array when CLAUDE_CODE_OAUTH_TOKEN is set', () => {
    const chain = resolveAnthropicAuthChain({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-abc' });
    assert.equal(chain.length, 1);
    assert.equal(chain[0].source, 'CLAUDE_CODE_OAUTH_TOKEN');
    assert.equal(chain[0].headers.Authorization, 'Bearer oauth-abc');
  });

  test('returns an empty array when no credential is set', () => {
    assert.deepStrictEqual(resolveAnthropicAuthChain({}), []);
  });

  test('ignores ANTHROPIC_API_KEY', () => {
    assert.deepStrictEqual(resolveAnthropicAuthChain({ ANTHROPIC_API_KEY: 'sk-key' }), []);
  });

  test('skips a whitespace-only OAuth token', () => {
    assert.deepStrictEqual(resolveAnthropicAuthChain({ CLAUDE_CODE_OAUTH_TOKEN: '   ' }), []);
  });

  test('resolveAnthropicAuth returns the first chain entry', () => {
    const auth = resolveAnthropicAuth({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-abc' });
    assert.equal(auth.source, 'CLAUDE_CODE_OAUTH_TOKEN');
  });
});

describe('isAuthFailureStatus', () => {
  test('treats 401 and 403 as auth failures', () => {
    assert.equal(isAuthFailureStatus(401), true);
    assert.equal(isAuthFailureStatus(403), true);
  });

  test('treats other statuses as not auth failures', () => {
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
  test('returns the default model when no override is given', () => {
    assert.equal(selectModel('CLAUDE_CODE_OAUTH_TOKEN'), DEFAULT_MODEL);
    assert.equal(selectModel('CLAUDE_CODE_OAUTH_TOKEN'), 'claude-sonnet-4-6');
  });

  test('an explicit override wins over the default', () => {
    assert.equal(selectModel('CLAUDE_CODE_OAUTH_TOKEN', 'claude-haiku-4-5'), 'claude-haiku-4-5');
  });

  test('an empty override is ignored in favour of the default', () => {
    assert.equal(selectModel('CLAUDE_CODE_OAUTH_TOKEN', ''), 'claude-sonnet-4-6');
  });

  test('source argument is ignored — any source returns the default', () => {
    assert.equal(selectModel('SOMETHING_ELSE'), DEFAULT_MODEL);
  });
});
