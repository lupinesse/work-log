/**
 * Anthropic API authentication resolution for the CI dialogue scripts.
 *
 * Extracted to its own module so the credential-selection logic can be
 * unit-tested without importing the dialogue scripts, which have module-level
 * side effects (env-var validation and a top-level main() call).
 *
 * The Anthropic Messages API accepts two mutually exclusive credentials:
 *   - a Claude subscription OAuth token, sent as `Authorization: Bearer …`
 *     (obtained via `claude setup-token`); and
 *   - a standard API key, sent as `x-api-key: …`.
 *
 * CI may have either configured, so this resolver prefers the OAuth token and
 * falls back to the API key, reporting which one it picked for logging.
 */

/**
 * @typedef {{ headers: Record<string, string>, source: string }} AnthropicAuth
 */

/**
 * Resolve every usable Anthropic credential, in preference order.
 *
 * Order: `CLAUDE_CODE_OAUTH_TOKEN` (Bearer) first, then `ANTHROPIC_API_KEY`
 * (`x-api-key`). Whitespace-only values are treated as absent. Returns the
 * options as a list so a caller can try them in turn — falling through to the
 * next when one is rejected (e.g. an expired OAuth token returns 401), which a
 * single-credential resolver cannot recover from.
 *
 * @param {Record<string, string|undefined>} env - Environment bag (e.g. `process.env`).
 * @returns {AnthropicAuth[]} Ordered auth options; empty array if none are set.
 * @example
 * resolveAnthropicAuthChain({ CLAUDE_CODE_OAUTH_TOKEN: 'abc', ANTHROPIC_API_KEY: 'sk-x' })
 * // → [ { headers: { Authorization: 'Bearer abc' }, source: 'CLAUDE_CODE_OAUTH_TOKEN' },
 * //     { headers: { 'x-api-key': 'sk-x' },         source: 'ANTHROPIC_API_KEY' } ]
 * resolveAnthropicAuthChain({}) // → []
 */
export function resolveAnthropicAuthChain(env) {
  const chain = [];

  const oauthToken = (env.CLAUDE_CODE_OAUTH_TOKEN || '').trim();
  if (oauthToken) {
    chain.push({
      headers: { Authorization: `Bearer ${oauthToken}` },
      source: 'CLAUDE_CODE_OAUTH_TOKEN',
    });
  }

  const apiKey = (env.ANTHROPIC_API_KEY || '').trim();
  if (apiKey) {
    chain.push({
      headers: { 'x-api-key': apiKey },
      source: 'ANTHROPIC_API_KEY',
    });
  }

  return chain;
}

/**
 * Resolve the single preferred Anthropic auth — the first entry of
 * {@link resolveAnthropicAuthChain}, or `null` when no credential is set.
 *
 * Note: this picks by *presence*, not validity. An expired-but-present OAuth
 * token still wins here; callers that need to recover from a rejected
 * credential should iterate the full chain instead.
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

/**
 * Default model for all auth sources.
 *
 * Both the OAuth and API-key paths use `claude-sonnet-4-6` so the dialogue
 * produces consistent results regardless of which credential is active. An
 * explicit `MODEL` env override always wins over this default.
 *
 * @type {Record<string, string>}
 */
export const DEFAULT_MODEL_BY_SOURCE = {
  CLAUDE_CODE_OAUTH_TOKEN: 'claude-sonnet-4-6',
  ANTHROPIC_API_KEY: 'claude-sonnet-4-6',
};

/**
 * Choose the Anthropic model id for a run. An explicit override (e.g. the
 * `MODEL` env var) always wins; otherwise `claude-sonnet-4-6` is used for
 * all sources. The `source` argument is kept for forward compatibility.
 *
 * @param {string} source - Auth source label from {@link resolveAnthropicAuth}.
 * @param {string} [override] - Explicit model id; takes precedence when truthy.
 * @returns {string} The model id to use.
 * @example
 * selectModel('ANTHROPIC_API_KEY')               // → 'claude-sonnet-4-6'
 * selectModel('CLAUDE_CODE_OAUTH_TOKEN')         // → 'claude-sonnet-4-6'
 * selectModel('ANTHROPIC_API_KEY', 'x-model')   // → 'x-model' (override wins)
 */
export function selectModel(source, override) {
  if (override) return override;
  return DEFAULT_MODEL_BY_SOURCE[source] ?? DEFAULT_MODEL_BY_SOURCE.ANTHROPIC_API_KEY;
}
