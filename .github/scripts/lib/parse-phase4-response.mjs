/**
 * Pure parsing of OpenAI's Phase 4 JSON response in the chatgpt/claude
 * PR-review dialogue.
 *
 * Phase 4 only accepts `type: "reply"` actions — its job is to close the
 * dialogue loop (verify fixes, accept/challenge Claude's counter-positions,
 * flag regressions). Raising new findings is Phase 1's role; any `type: "new"`
 * or unknown type is moved to `invalidActions` rather than posted.
 *
 * Extracted to its own module so the parsing logic can be unit-tested without
 * importing chatgpt-claude-dialogue.mjs, which has module-level side effects.
 */

import { normaliseReplyAction } from './parse-reply-action.mjs';

/**
 * @typedef {{ type: 'reply', threadIndex: number, body: string, resolve: boolean, unresolve: boolean }} ReplyAction
 * @typedef {{ actions: ReplyAction[], invalidActions: unknown[] }} Phase4Response
 */

/**
 * Parse OpenAI's raw Phase 4 response text into a structured result.
 *
 * Only `type: "reply"` actions are accepted. Any other type (including the
 * formerly-allowed `"new"`) is moved to `invalidActions` and surfaced in the
 * fallback comment rather than posted as a new inline thread.
 *
 * @param {string} rawText      Raw text from the OpenAI API response.
 * @param {number} threadCount  Length of the thread list. Reply actions whose
 *   `thread_index` is outside `[0, threadCount)` are rejected to
 *   `invalidActions` via {@link normaliseReplyAction}.
 * @returns {Phase4Response}
 * @throws {Error} If the JSON is malformed.
 */
export function parsePhase4Response(rawText, threadCount) {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const parsed = JSON.parse(cleaned);

  const rawActions = Array.isArray(parsed.thread_actions) ? parsed.thread_actions : [];

  // Legacy schema: if OpenAI returns { new_findings: [...] } instead of { thread_actions: [...] },
  // surface those entries as invalidActions rather than silently discarding them.
  if (!Array.isArray(parsed.thread_actions) && Array.isArray(parsed.new_findings)) {
    return { actions: [], invalidActions: parsed.new_findings };
  }

  const actions = [];
  const invalidActions = [];

  for (const a of rawActions) {
    if (!a || typeof a !== 'object') {
      invalidActions.push(a);
      continue;
    }
    const rawType = a.type;
    const type = typeof rawType === 'string' ? rawType.trim() : null;
    if (type !== 'reply') {
      invalidActions.push(a);
      continue;
    }
    const body = typeof a.body === 'string' ? a.body.trim() : null;
    if (!body) {
      invalidActions.push(a);
      continue;
    }
    let normalised;
    try {
      normalised = normaliseReplyAction(a, threadCount);
    } catch (err) {
      console.warn(
        `  invalid reply action (thread_index=${a.thread_index}) — ${err.message} — moved to fallback`
      );
      invalidActions.push(a);
      continue;
    }
    actions.push({ type: 'reply', ...normalised });
  }

  return { actions, invalidActions };
}
