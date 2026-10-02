import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readMaxCompletionTokens } from '../lib/max-completion-tokens.mjs';

describe('readMaxCompletionTokens', () => {
  const quiet = () => {};

  it('prefers MAX_COMPLETION_TOKENS over the legacy name', () => {
    const env = { MAX_COMPLETION_TOKENS: '2048', MAX_TOKENS: '999' };
    assert.equal(readMaxCompletionTokens(env, 3072, quiet), 2048);
  });

  it('falls back to MAX_TOKENS and warns about the deprecation', () => {
    const warnings = [];
    assert.equal(
      readMaxCompletionTokens({ MAX_TOKENS: '1500' }, 3072, (m) => warnings.push(m)),
      1500
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /MAX_COMPLETION_TOKENS/);
  });

  it('does not warn when only the new name is used', () => {
    const warnings = [];
    readMaxCompletionTokens({ MAX_COMPLETION_TOKENS: '10' }, 3072, (m) => warnings.push(m));
    assert.equal(warnings.length, 0);
  });

  it('uses the default when neither is set, or when they are empty', () => {
    assert.equal(readMaxCompletionTokens({}, 3072, quiet), 3072);
    assert.equal(
      readMaxCompletionTokens({ MAX_COMPLETION_TOKENS: '', MAX_TOKENS: '' }, 3072, quiet),
      3072
    );
  });

  const INVALID = ['abc', '0', '-5', '12.5', '1e3'];
  for (const value of INVALID) {
    it(`rejects ${JSON.stringify(value)} with the variable name in the message`, () => {
      assert.throws(
        () => readMaxCompletionTokens({ MAX_COMPLETION_TOKENS: value }, 3072, quiet),
        /MAX_COMPLETION_TOKENS must be a positive integer/
      );
    });
  }
});
