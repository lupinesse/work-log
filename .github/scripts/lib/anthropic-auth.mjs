/**
 * Anthropic API authentication resolution for the CI dialogue scripts.
 *
 * Extracted to its own module so the credential-selection logic can be
 * unit-tested without importing the dialogue scripts, which have module-level
 * side effects (env-var validation and a top-level main() call).
 *
 * Authentication uses the Claude subscription OAuth token, sent as
 * `Authorization: Bearer …` (obtained via `claude setup-token`).
 */

/**
 * @typedef {{ headers: Record<string, string>, source: string }} AnthropicAuth
 */

/**
 * Resolve the Anthropic credential from the environment.
 *
 * Only `CLAUDE_CODE_OAUTH_TOKEN` is supported. Returns a one-element array
 * when the token is present, or an empty array when it is absent or
 * whitespace-only. The array shape is kept for interface compatibility with
 * callers that iterate the chain.
 *
 * @param {Record<string, string|undefined>} env - Environment bag (e.g. `process.env`).
 * @returns {AnthropicAuth[]} Auth options; empty array if the token is not set.
 * @example
 * resolveAnthropicAuthChain({ CLAUDE_CODE_OAUTH_TOKEN: 'abc' })
 * // → [ { headers: { Authorization: 'Bearer abc' }, source: 'CLAUDE_CODE_OAUTH_TOKEN' } ]
 * resolveAnthropicAuthChain({}) // → []
 */
export function resolveAnthropicAuthChain(env) {
  const oauthToken = (env.CLAUDE_CODE_OAUTH_TOKEN || '').trim();
  if (!oauthToken) return [];
  return [
    {
      headers: { Authorization: `Bearer ${oauthToken}` },
      source: 'CLAUDE_CODE_OAUTH_TOKEN',
    },
  ];
}

/**
 * Resolve the single Anthropic auth entry, or `null` when no credential is set.
 *
 * @param {Record<string, string|undefined>} env - Environment bag (e.g. `process.env`).
 * @returns {AnthropicAuth|null}
 */
export function resolveAnthropicAuth(env) {
  return resolveAnthropicAuthChain(env)[0] || null;
}

/**
 * Whether an HTTP status indicates the credential itself was rejected (as
 * opposed to a transient or request error), and so a different credential is
 * worth trying. `401 Unauthorized` and `403 Forbidden` are the auth-failure
 * statuses the Anthropic API returns for a bad/expired key or token.
 *
 * @param {number} status - HTTP response status code.
 * @returns {boolean} True for 401/403.
 */
export function isAuthFailureStatus(status) {
  return status === 401 || status === 403;
}

/**
 * Whether a failed HTTP response should cause the caller to fall through to
 * the next credential in the chain. True for both hard auth failures (401/403)
 * and rate-limit responses (429) — a rate-limited credential and a rejected
 * one are both worth retrying with a different key, since they use separate
 * quota buckets.
 *
 * @param {number} status - HTTP response status code.
 * @returns {boolean}
 */
export function shouldFallThrough(status) {
  return isAuthFailureStatus(status) || status === 429;
}

/** Default model used when no `MODEL` env override is set. */
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Choose the Anthropic model id for a run. An explicit override (e.g. the
 * `MODEL` env var) always wins; otherwise {@link DEFAULT_MODEL} is used.
 *
 * @param {string} _source - Auth source label (unused; kept for call-site compatibility).
 * @param {string} [override] - Explicit model id; takes precedence when truthy.
 * @returns {string} The model id to use.
 * @example
 * selectModel('CLAUDE_CODE_OAUTH_TOKEN')        // → 'claude-sonnet-4-6'
 * selectModel('CLAUDE_CODE_OAUTH_TOKEN', 'x')  // → 'x' (override wins)
 */
export function selectModel(_source, override) {
  return override || DEFAULT_MODEL;
}
