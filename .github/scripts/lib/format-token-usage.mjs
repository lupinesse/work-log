/**
 * Formatting of the OpenAI `usage` object for the review scripts' logs.
 *
 * chatgpt-review.mjs and chatgpt-claude-dialogue.mjs each carried the same
 * five-line block; one shared pure function keeps the wording identical and
 * lets the missing-field behaviour be unit-tested.
 */

/**
 * Builds the one-line token summary the review scripts log after an OpenAI call.
 *
 * @param {{ prompt_tokens?: number, completion_tokens?: number, total_tokens?: number }} [usage]
 *   The `usage` field of an OpenAI chat-completions response; may be missing.
 * @returns {string} e.g. `  tokens: 120 in / 45 out / 165 total`; missing counts show as `?`
 *   and the total is omitted when the API did not report one.
 * @example
 * formatTokenUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })
 * // → '  tokens: 10 in / 5 out / 15 total'
 */
export function formatTokenUsage(usage = {}) {
  const promptTokens = usage.prompt_tokens ?? '?';
  const completionTokens = usage.completion_tokens ?? '?';
  const total = usage.total_tokens != null ? ` / ${usage.total_tokens} total` : '';
  return `  tokens: ${promptTokens} in / ${completionTokens} out${total}`;
}
