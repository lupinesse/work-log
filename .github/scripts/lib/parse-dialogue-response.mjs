/**
 * Pure parsing of Claude's Phase 2 JSON response in the chatgpt/claude
 * PR-review dialogue.
 *
 * Extracted to its own module so the response-parsing logic can be unit-tested
 * without importing claude-chatgpt-dialogue.mjs, which has module-level side
 * effects (env-var validation via must() and a top-level main() call).
 */

import { coerceThreadIndex } from './parse-reply-action.mjs';

/** Verdicts Claude emits in Phase 2 thread responses. */
const VALID_VERDICTS = new Set(['agree_fix', 'agree_noted', 'disagree', 'partial']);

/**
 * @typedef {{ index: number, verdict: string, reply: string }} ThreadResponse
 * @typedef {{ thread_responses: ThreadResponse[], invalidResponses: unknown[] }} DialogueResponse
 */

/**
 * Parse Claude's raw Phase 2 response text into a structured dialogue result.
 *
 * Normalises recoverable values (numeric-string indices are coerced via
 * {@link coerceThreadIndex}; missing verdict defaults to `"agree_noted"`) and
 * collects unrecoverable entries in `invalidResponses` so the caller can
 * surface them in the fallback comment instead of silently dropping them —
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
 * @throws {Error} If the JSON is malformed or if `thread_responses` is absent.
 */
export function parseResponse(rawText, threadCount) {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed.thread_responses)) {
    throw new Error('Missing required field: thread_responses');
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
    // Normalise verdict: absent/null defaults to 'agree_noted'; present values
    // must be trimmed and validated — unknown strings are rejected to
    // invalidResponses so the caller can surface them rather than silently
    // passing them to the dispatch loop.
    let verdict;
    if (r.verdict == null) {
      verdict = 'agree_noted';
    } else {
      const trimmed = typeof r.verdict === 'string' ? r.verdict.trim() : '';
      if (!VALID_VERDICTS.has(trimmed)) {
        invalidResponses.push(r);
        continue;
      }
      verdict = trimmed;
    }
    thread_responses.push({
      index: idx,
      verdict,
      reply,
    });
  }

  return { thread_responses, invalidResponses };
}
