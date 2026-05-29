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
  // Only coerce string values — null, undefined, boolean, and object types
  // must NOT be silently coerced to 0 via Number(), so we restrict the
  // coercion path to typeof 'string'. Blank and whitespace-only strings also
  // coerce to 0 via Number('') / Number('   '), so trim first and reject the
  // empty result before handing to Number(); otherwise a malformed model
  // response (e.g., thread_index: '') would silently post to thread 0.
  const rawIdx = action.thread_index;
  let idx;
  if (Number.isInteger(rawIdx)) {
    idx = rawIdx;
  } else if (typeof rawIdx === 'string' && rawIdx.trim() !== '') {
    idx = Number(rawIdx.trim());
  } else {
    idx = NaN;
  }

  if (!Number.isInteger(idx) || idx < 0 || idx >= threadCount) {
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

  return {
    threadIndex: idx,
    body:        String(action.body).trim(),
    resolve:     action.resolve   === true,
    unresolve:   action.unresolve === true,
  };
}
