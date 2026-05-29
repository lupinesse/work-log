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
 * Default model per auth source.
 *
 * The OAuth path is covered by the Claude subscription at a flat cost, so it
 * uses the most capable model. The API-key path is billed per token, so it
 * defaults to the cheapest current model to avoid surprise costs if the
 * fallback is ever exercised — the dialogue job is not latency- or
 * quality-critical enough to justify Opus pricing on metered billing.
 *
 * @type {Record<string, string>}
 */
export const DEFAULT_MODEL_BY_SOURCE = {
  CLAUDE_CODE_OAUTH_TOKEN: 'claude-opus-4-7',
  ANTHROPIC_API_KEY: 'claude-haiku-4-5',
};

/**
 * Choose the Anthropic model id for a run. An explicit override (e.g. the
 * `MODEL` env var) always wins; otherwise the per-source default applies, with
 * the subscription default as the final fallback for an unrecognised source.
 *
 * @param {string} source - Auth source label from {@link resolveAnthropicAuth}.
 * @param {string} [override] - Explicit model id; takes precedence when truthy.
 * @returns {string} The model id to use.
 * @example
 * selectModel('ANTHROPIC_API_KEY')            // → 'claude-haiku-4-5' (cheap)
 * selectModel('CLAUDE_CODE_OAUTH_TOKEN')      // → 'claude-opus-4-7'
 * selectModel('ANTHROPIC_API_KEY', 'x-model') // → 'x-model' (override wins)
 */
export function selectModel(source, override) {
  if (override) return override;
  return DEFAULT_MODEL_BY_SOURCE[source] || DEFAULT_MODEL_BY_SOURCE.CLAUDE_CODE_OAUTH_TOKEN;
}
