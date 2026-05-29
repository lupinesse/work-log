/**
 * Pure parsing of Claude's Phase 2 JSON response in the chatgpt/claude
 * PR-review dialogue.
 *
 * Extracted to its own module so the response-parsing logic can be unit-tested
 * without importing claude-chatgpt-dialogue.mjs, which has module-level side
 * effects (env-var validation via must() and a top-level main() call).
 */

import { coerceThreadIndex } from './parse-reply-action.mjs';

/**
 * @typedef {{ index: number, verdict: string, reply: string }} ThreadResponse
 * @typedef {{ thread_responses: ThreadResponse[], invalidResponses: unknown[], synthesis: string }} DialogueResponse
 */

/**
 * Parse Claude's raw Phase 2 response text into a structured dialogue result.
 *
 * Normalises recoverable values (numeric-string indices are coerced via
 * {@link coerceThreadIndex}; missing verdict defaults to `"comment"`) and
 * collects unrecoverable entries in `invalidResponses` so the caller can
 * surface them in the synthesis comment instead of silently dropping them —
 * keeping the "every finding gets a reply" guarantee even when the model
 * occasionally returns a malformed entry.
 *
 * Out-of-range indices (outside `[0, threadCount)`) are rejected to
 * `invalidResponses` here so the dispatch loop never receives an index with
 * no matching thread.
 *
 * @param {string} rawText    Raw text from the Claude API response.
 * @param {number} threadCount Length of the available ChatGPT thread list.
 *   Responses whose `index` is outside `[0, threadCount)` are moved to
 *   `invalidResponses` rather than being accepted and then failing with an
 *   undefined-thread lookup in the dispatch loop.
 * @returns {DialogueResponse}
 * @throws {Error} If the JSON is malformed, if `thread_responses` is absent, or
 *   if `synthesis` is absent, not a string, or whitespace-only.
 */
export function parseResponse(rawText, threadCount) {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const parsed = JSON.parse(cleaned);

  const synthesis = typeof parsed.synthesis === 'string' ? parsed.synthesis.trim() : null;
  if (!Array.isArray(parsed.thread_responses) || !synthesis) {
    throw new Error('Missing required fields: thread_responses, synthesis');
  }

  const thread_responses = [];
  const invalidResponses = [];

  for (const r of parsed.thread_responses) {
    if (!r || typeof r !== 'object') {
      invalidResponses.push(r);
      continue;
    }
    // Reject non-integers, blank/whitespace strings, and out-of-range indices
    // so the dispatch loop never receives an index with no matching thread.
    const idx = coerceThreadIndex(r.index);
    const reply = typeof r.reply === 'string' ? r.reply.trim() : null;
    if (idx === null || idx < 0 || idx >= threadCount || !reply) {
      invalidResponses.push(r);
      continue;
    }
    thread_responses.push({
      index: idx,
      verdict: r.verdict || 'comment',
      reply,
    });
  }

  return { thread_responses, invalidResponses, synthesis };
}
