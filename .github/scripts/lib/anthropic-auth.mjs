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
