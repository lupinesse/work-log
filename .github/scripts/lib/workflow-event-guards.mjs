/**
 * Guard for workflows that branch on an event action they never receive.
 *
 * In September 2026 `chatgpt-pr-review.yml` declared
 * `types: [labeled, opened, reopened]` while its "Decide whether to run" step
 * contained a fully written `if (action === 'synchronize') { … }` branch. The
 * event never arrived, so the branch was dead code and the five dialogue jobs —
 * `merge-gate` among them — never re-ran after a push. The gate's verdict stayed
 * pinned to whichever commit last triggered it, and a failure recorded there
 * could not clear itself. Nothing failed loudly; the workflow just quietly
 * stopped covering the commits it was meant to cover.
 *
 * The mistake is invisible by construction — YAML and the inline script are read
 * separately, and neither half looks wrong on its own — so fixing the one file is
 * not enough. This predicate compares the two halves, and the companion test
 * applies it to every workflow in `.github/workflows/`, so a new workflow making
 * the same mistake fails CI too.
 *
 * Pure functions over a workflow's YAML source: no YAML parser, no network, no
 * live Actions run. The `on:` block is read by indentation, which is exact for
 * this repository's 2-space workflow formatting and is why
 * {@link subscribedActions} returns null rather than guessing when it meets a
 * shape it cannot account for.
 */

/**
 * Actions GitHub delivers for an event subscribed without a `types:` filter.
 * Only events that carry an action need an entry; `push`, `schedule`, and
 * `workflow_dispatch` have none and contribute nothing.
 * @type {Record<string, string[]>}
 */
const DEFAULT_ACTIONS = {
  pull_request: ['opened', 'synchronize', 'reopened'],
  pull_request_target: ['opened', 'synchronize', 'reopened'],
  issue_comment: ['created', 'edited', 'deleted'],
  workflow_run: ['requested', 'in_progress', 'completed'],
};

/** Events that carry no action at all, so a missing `types:` is not a gap. */
const ACTIONLESS_EVENTS = new Set([
  'push',
  'schedule',
  'workflow_dispatch',
  'workflow_call',
  'release',
  'create',
  'delete',
  'fork',
  'watch',
  'page_build',
  'public',
  'repository_dispatch',
]);

/**
 * An action name compared against a string literal, in JavaScript or in an
 * Actions expression: `action === 'synchronize'`, `context.payload.action == "x"`,
 * `github.event.action == 'y'`. Matching on the `action` suffix covers all three
 * without needing to know which object it hangs off.
 */
const ACTION_COMPARISON = /\baction\s*===?\s*['"]([a-z_]+)['"]/g;

/** `types: [a, b, c]` — the flow-sequence form. */
const FLOW_TYPES = /^\s*types:\s*\[([^\]]*)\]/;

/** `types:` introducing a block sequence on the following lines. */
const BLOCK_TYPES = /^\s*types:\s*$/;

/** `  - name` inside a block sequence. */
const BLOCK_ITEM = /^\s*-\s*(['"]?)([a-z_]+)\1\s*$/;

/**
 * Extracts the `on:` block of a workflow, as lines with their original indent.
 *
 * @param {string} source - Full workflow YAML source.
 * @returns {string[]} Lines belonging to the block, empty if there is no `on:` key.
 * @example
 * onBlockLines('on:\n  push:\n    branches: [main]\njobs:\n')
 *   // → ['  push:', '    branches: [main]']
 */
export function onBlockLines(source) {
  const lines = String(source ?? '').split('\n');
  const start = lines.findIndex((line) => /^on:\s*$/.test(line) || /^on:\s*\S/.test(line));
  if (start === -1) return [];
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // a new top-level key ends the block
    block.push(line);
  }
  return block;
}

/**
 * The set of event actions a workflow can actually receive.
 *
 * Reads each event key in the `on:` block and takes its `types:` list, or the
 * event's default actions when it has no filter. Returns null when the block
 * contains an event that is neither in {@link DEFAULT_ACTIONS} nor known to be
 * actionless — the workflow is then unanalysable, and callers skip it rather
 * than report a gap that may not exist.
 *
 * @param {string} source - Full workflow YAML source.
 * @returns {Set<string>|null} Receivable action names, or null if unanalysable.
 * @example
 * subscribedActions('on:\n  pull_request:\n    types: [opened]\n')
 *   // → Set { 'opened' }
 */
export function subscribedActions(source) {
  const block = onBlockLines(source);
  if (block.length === 0) return null;

  const actions = new Set();
  /** @type {{name: string, types: string[], sawTypes: boolean}|null} */
  let event = null;
  let inBlockTypes = false;

  /** Folds the event just finished into the result, or gives up on it. */
  const closeEvent = () => {
    if (!event) return true;
    if (event.sawTypes) {
      event.types.forEach((type) => actions.add(type));
      return true;
    }
    if (ACTIONLESS_EVENTS.has(event.name)) return true;
    const defaults = DEFAULT_ACTIONS[event.name];
    if (!defaults) return false; // unknown event, no filter — cannot reason about it
    defaults.forEach((type) => actions.add(type));
    return true;
  };

  for (const line of block) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const eventKey = line.match(/^ {2}([a-z_]+):/);
    if (eventKey) {
      if (!closeEvent()) return null;
      event = { name: eventKey[1], types: [], sawTypes: false };
      inBlockTypes = false;
      continue;
    }
    if (!event) continue;

    const flow = line.match(FLOW_TYPES);
    if (flow) {
      event.sawTypes = true;
      inBlockTypes = false;
      flow[1]
        .split(',')
        .map((name) => name.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
        .forEach((name) => event.types.push(name));
      continue;
    }
    if (BLOCK_TYPES.test(line)) {
      event.sawTypes = true;
      inBlockTypes = true;
      continue;
    }
    if (inBlockTypes) {
      const item = line.match(BLOCK_ITEM);
      if (item) {
        event.types.push(item[2]);
        continue;
      }
      inBlockTypes = false;
    }
  }
  if (!closeEvent()) return null;
  return actions;
}

/**
 * The set of event actions a workflow's steps branch on.
 *
 * Matches equality comparisons only. A negated test (`action !== 'x'`) or a
 * membership test (`['a','b'].includes(action)`) is not detected, so the guard
 * under-reports rather than over-reports — the same bias as
 * {@link subscribedActions} returning null on a block it cannot read.
 *
 * @param {string} source - Full workflow YAML source.
 * @returns {Set<string>} Action names compared against a string literal.
 * @example
 * branchedActions("if (action === 'synchronize') { return }")
 *   // → Set { 'synchronize' }
 */
export function branchedActions(source) {
  const found = new Set();
  for (const match of String(source ?? '').matchAll(ACTION_COMPARISON)) found.add(match[1]);
  return found;
}

/**
 * Action names a workflow branches on but can never receive.
 *
 * @param {string} source - Full workflow YAML source.
 * @returns {string[]} Sorted unreachable action names; empty when the workflow is
 *   consistent, and empty when it cannot be analysed (see {@link subscribedActions}).
 * @example
 * unreachableActions("on:\n  pull_request:\n    types: [opened]\njobs:\n  x:\n    # action === 'synchronize'\n")
 *   // → ['synchronize']
 */
export function unreachableActions(source) {
  const subscribed = subscribedActions(source);
  if (subscribed === null) return [];
  return [...branchedActions(source)].filter((action) => !subscribed.has(action)).sort();
}
