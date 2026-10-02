/**
 * Reads the OpenAI completion-token cap from the environment.
 *
 * The cap feeds OpenAI's `max_completion_tokens`, so the variable is named
 * `MAX_COMPLETION_TOKENS`. The older `MAX_TOKENS` is still honoured (with a
 * deprecation warning) for one release so existing workflow overrides keep
 * working; it will be removed after that.
 */

/**
 * Resolves the completion-token cap.
 *
 * @param {Record<string, string | undefined>} env - Environment to read, normally `process.env`.
 * @param {number} defaultValue - Cap used when neither variable is set.
 * @param {(message: string) => void} [warn] - Receives the deprecation warning.
 * @returns {number} A positive integer token cap.
 * @throws {Error} If the chosen variable is not a positive integer — a silent
 *   `NaN` would otherwise be sent to the API and fail there with a vaguer error.
 * @example
 * readMaxCompletionTokens({ MAX_COMPLETION_TOKENS: '2048' }, 3072) // → 2048
 * readMaxCompletionTokens({}, 3072)                                // → 3072
 */
export function readMaxCompletionTokens(env, defaultValue, warn = console.warn) {
  let name = 'MAX_COMPLETION_TOKENS';
  // eslint-disable-next-line security/detect-object-injection -- key is from CI pipeline config or structured API data, not user-controlled input
  let raw = env[name];
  if (raw === undefined || raw === '') {
    name = 'MAX_TOKENS';
    // eslint-disable-next-line security/detect-object-injection -- key is from CI pipeline config or structured API data, not user-controlled input
    raw = env[name];
    if (raw !== undefined && raw !== '') {
      warn('MAX_TOKENS is deprecated for the OpenAI scripts; use MAX_COMPLETION_TOKENS instead.');
    }
  }
  if (raw === undefined || raw === '') return defaultValue;
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${JSON.stringify(raw)}`);
  }
  return Number(raw);
}
