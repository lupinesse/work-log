/**
 * Pure validation and normalisation for "reply" actions in the Phase 4
 * AI dialogue response (chatgpt-claude-dialogue.mjs).
 *
 * Extracted to a separate module so this logic can be unit-tested without
 * importing chatgpt-claude-dialogue.mjs, which has module-level side effects
 * (env-var validation via must() and a top-level main() call).
 */

/**
 * @typedef {{
 *   threadIndex: number,
 *   body:        string,
 *   resolve:     boolean,
 *   unresolve:   boolean,
 * }} NormalisedReplyAction
 */

/**
 * Coerce a raw thread-index value to a non-negative-capable integer, or
 * `null` when it cannot be safely interpreted.
 *
 * Accepts integers and non-empty numeric strings only. `null`, `undefined`,
 * booleans, objects and — critically — blank or whitespace-only strings are
 * rejected: `Number('')` and `Number('   ')` both evaluate to `0`, so without
 * this guard a malformed model response (e.g. `thread_index: ''`) would
 * silently route a reply to thread `0` instead of being rejected. Bounds are
 * NOT checked here — callers validate against their own thread count — so an
 * in-range-looking but out-of-bounds integer is returned as-is; only
 * un-coercible values become `null`.
 *
 * @param {*} raw Candidate index — an integer or a numeric string.
 * @returns {number|null} The parsed integer, or `null` if not coercible.
 * @example
 * coerceThreadIndex(2)      // → 2
 * coerceThreadIndex('3')    // → 3
 * coerceThreadIndex('')     // → null   (would otherwise be Number('') === 0)
 * coerceThreadIndex('  ')   // → null
 * coerceThreadIndex('1.5')  // → null
 * coerceThreadIndex(null)   // → null
 */
export function coerceThreadIndex(raw) {
  if (Number.isInteger(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw.trim());
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

/**
 * Validate and normalise a raw "reply" action object from the AI model's JSON
 * output.
 *
 * Coerces numeric-string `thread_index` values to integers; validates the
 * index is within the known thread bounds; rejects the action when `resolve`
 * and `unresolve` are both true (the flags are mutually exclusive — one closes
 * the thread, the other re-opens it).
 *
 * @param {object} action              Raw action object whose `type` is 'reply'.
 * @param {*}      action.thread_index Thread index — may be an integer or a
 *                                     numeric string; non-integers are rejected.
 * @param {*}      action.body         Markdown reply body string.
 * @param {*}      [action.resolve]    When true, the thread is resolved after
 *                                     the reply is posted.
 * @param {*}      [action.unresolve]  When true, a resolved thread is re-opened
 *                                     before the reply is posted.
 * @param {number} threadCount         Length of the known thread list on the PR.
 *                                     Used to bound-check the index.
 * @returns {NormalisedReplyAction}  Normalised action ready for the dispatch loop.
 * @throws {Error} If the action is structurally invalid. Callers should move
 *                 the raw action to the invalid-actions fallback bucket and log
 *                 the error message so nothing is silently discarded.
 */
export function normaliseReplyAction(action, threadCount) {
  // Reject non-integers and blank/whitespace strings instead of silently
  // coercing them to thread 0 (see coerceThreadIndex for the rationale).
  const idx = coerceThreadIndex(action.thread_index);

  if (idx === null || idx < 0 || idx >= threadCount) {
    throw new Error(
      `thread_index ${JSON.stringify(action.thread_index)} is out of range ` +
        `(valid: 0..${threadCount - 1})`
    );
  }

  // resolve and unresolve are mutually exclusive — one closes the thread,
  // the other re-opens it. Setting both is always a model error; drop the
  // action so the mistake surfaces in the fallback block rather than
  // being silently coerced to an arbitrary state.
  if (action.resolve === true && action.unresolve === true) {
    throw new Error(
      `thread_index ${idx}: resolve and unresolve are mutually exclusive — ` +
        'never set both on the same reply'
    );
  }

  const body = String(action.body).trim();
  if (!body) {
    throw new Error(`thread_index ${idx}: body is empty or whitespace-only`);
  }

  return {
    threadIndex: idx,
    body,
    resolve: action.resolve === true,
    unresolve: action.unresolve === true,
  };
}
