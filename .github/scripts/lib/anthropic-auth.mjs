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
 * Resolve the Anthropic auth header from the available credentials.
 *
 * Preference order: `CLAUDE_CODE_OAUTH_TOKEN` (Bearer) first, then
 * `ANTHROPIC_API_KEY` (`x-api-key`). Whitespace-only values are treated as
 * absent. Returns `null` when neither credential is present so the caller can
 * fail fast with an actionable message.
 *
 * @param {Record<string, string|undefined>} env - Environment bag (e.g. `process.env`).
 * @returns {AnthropicAuth|null} The header to merge into the request plus a
 *   `source` label, or `null` if no usable credential is set.
 * @example
 * resolveAnthropicAuth({ CLAUDE_CODE_OAUTH_TOKEN: 'abc' })
 * // → { headers: { Authorization: 'Bearer abc' }, source: 'CLAUDE_CODE_OAUTH_TOKEN' }
 * resolveAnthropicAuth({ ANTHROPIC_API_KEY: 'sk-x' })
 * // → { headers: { 'x-api-key': 'sk-x' }, source: 'ANTHROPIC_API_KEY' }
 * resolveAnthropicAuth({}) // → null
 */
export function resolveAnthropicAuth(env) {
  const oauthToken = (env.CLAUDE_CODE_OAUTH_TOKEN || '').trim();
  if (oauthToken) {
    return {
      headers: { Authorization: `Bearer ${oauthToken}` },
      source: 'CLAUDE_CODE_OAUTH_TOKEN',
    };
  }

  const apiKey = (env.ANTHROPIC_API_KEY || '').trim();
  if (apiKey) {
    return {
      headers: { 'x-api-key': apiKey },
      source: 'ANTHROPIC_API_KEY',
    };
  }

  return null;
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
