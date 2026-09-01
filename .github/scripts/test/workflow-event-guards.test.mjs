/**
 * Unit + regression tests for lib/workflow-event-guards.mjs.
 *
 * The regression these exist for: `chatgpt-pr-review.yml` shipped
 * `types: [labeled, opened, reopened]` alongside a written-and-unreachable
 * `action === 'synchronize'` branch, so the five dialogue jobs — `merge-gate`
 * included — never re-ran after a push and the gate's verdict stayed pinned to
 * an older commit.
 *
 * The first fixture is that file's `on:` block and branch as they shipped, and
 * it must trip the guard. The final suite applies the guard to the repository's
 * real workflows, so the fix cannot regress and a new workflow repeating the
 * mistake fails CI too.
 *
 * Run: node --test .github/scripts/test/workflow-event-guards.test.mjs
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  branchedActions,
  onBlockLines,
  subscribedActions,
  unreachableActions,
} from '../lib/workflow-event-guards.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const workflowsDir = path.join(repoRoot, '.github', 'workflows');

/** chatgpt-pr-review.yml as it shipped broken: the branch exists, the event does not. */
const PRE_FIX_WORKFLOW = [
  'name: ChatGPT PR Review',
  'on:',
  '  pull_request:',
  '    types: [labeled, opened, reopened]',
  'jobs:',
  '  chatgpt-review:',
  '    steps:',
  '      - uses: actions/github-script@v9',
  '        with:',
  '          script: |',
  '            const action = context.payload.action;',
  "            if (action === 'synchronize') {",
  "              core.setOutput('should_run', 'false');",
  '            }',
].join('\n');

/** The same workflow once `synchronize` is subscribed. */
const POST_FIX_WORKFLOW = PRE_FIX_WORKFLOW.replace(
  'types: [labeled, opened, reopened]',
  'types: [labeled, opened, reopened, synchronize]'
);

describe('onBlockLines', () => {
  test('returns the indented lines under on:', () => {
    const lines = onBlockLines('name: X\non:\n  push:\n    branches: [main]\njobs:\n  a: {}\n');
    assert.deepEqual(lines, ['  push:', '    branches: [main]']);
  });

  test('returns nothing when the workflow has no on: key', () => {
    assert.deepEqual(onBlockLines('name: X\njobs:\n  a: {}\n'), []);
  });

  test('stops at the next top-level key', () => {
    const lines = onBlockLines('on:\n  push:\njobs:\n  a:\n    runs-on: x\n');
    assert.deepEqual(lines, ['  push:']);
  });
});

describe('subscribedActions', () => {
  test('reads a flow-sequence types list', () => {
    const actions = subscribedActions('on:\n  pull_request:\n    types: [opened, closed]\njobs:\n');
    assert.deepEqual([...actions].sort(), ['closed', 'opened']);
  });

  test('reads a block-sequence types list', () => {
    const actions = subscribedActions(
      'on:\n  issues:\n    types:\n      - labeled\n      - unlabeled\njobs:\n'
    );
    assert.deepEqual([...actions].sort(), ['labeled', 'unlabeled']);
  });

  test('falls back to an event default when there is no types filter', () => {
    const actions = subscribedActions('on:\n  pull_request:\n    branches: [main]\njobs:\n');
    assert.ok(actions.has('synchronize'));
  });

  test('contributes nothing for an event that carries no action', () => {
    const actions = subscribedActions('on:\n  push:\n    branches: [main]\njobs:\n');
    assert.equal(actions.size, 0);
  });

  test('merges the types of several events', () => {
    const actions = subscribedActions(
      'on:\n  push:\n    branches: [main]\n  pull_request:\n    types: [opened]\njobs:\n'
    );
    assert.deepEqual([...actions], ['opened']);
  });

  test('ignores comments inside the on: block', () => {
    const actions = subscribedActions(
      'on:\n  # a note\n  pull_request:\n    types: [opened]\njobs:\n'
    );
    assert.deepEqual([...actions], ['opened']);
  });

  test('gives up on an unknown event with no types filter rather than guessing', () => {
    assert.equal(subscribedActions('on:\n  some_future_event:\n    foo: bar\njobs:\n'), null);
  });

  test('returns null when there is no on: block at all', () => {
    assert.equal(subscribedActions('jobs:\n  a: {}\n'), null);
  });
});

describe('branchedActions', () => {
  test('finds a bare action comparison', () => {
    assert.deepEqual([...branchedActions("if (action === 'synchronize')")], ['synchronize']);
  });

  test('finds a comparison through context.payload', () => {
    assert.deepEqual([...branchedActions('context.payload.action == "labeled"')], ['labeled']);
  });

  test('finds a comparison in an Actions expression', () => {
    assert.deepEqual([...branchedActions("github.event.action == 'completed'")], ['completed']);
  });

  test('finds nothing when no action is compared', () => {
    assert.equal(branchedActions('const x = 1;').size, 0);
  });

  test('does not mistake an assignment for a comparison', () => {
    assert.equal(branchedActions('const action = context.payload.action;').size, 0);
  });
});

describe('unreachableActions', () => {
  test('flags the shipped chatgpt-pr-review bug', () => {
    assert.deepEqual(unreachableActions(PRE_FIX_WORKFLOW), ['synchronize']);
  });

  test('passes once the event is subscribed', () => {
    assert.deepEqual(unreachableActions(POST_FIX_WORKFLOW), []);
  });

  test('is quiet for a workflow that branches on an action it does receive', () => {
    const workflow = "on:\n  issues:\n    types: [labeled]\njobs:\n  # action === 'labeled'\n";
    assert.deepEqual(unreachableActions(workflow), []);
  });

  test('is quiet for an event whose default actions cover the branch', () => {
    const workflow = "on:\n  pull_request:\n    branches: [main]\njobs:\n  # action === 'opened'\n";
    assert.deepEqual(unreachableActions(workflow), []);
  });

  test('stays quiet rather than guessing about an unanalysable workflow', () => {
    const workflow = "on:\n  some_future_event:\n    foo: bar\njobs:\n  # action === 'opened'\n";
    assert.deepEqual(unreachableActions(workflow), []);
  });
});

describe('the repository’s own workflows', () => {
  const workflows = readdirSync(workflowsDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => ({ name, source: readFileSync(path.join(workflowsDir, name), 'utf8') }));

  test('there are workflows to check', () => {
    assert.ok(workflows.length > 0, 'no workflows found — the scan is broken, not clean');
  });

  for (const { name, source } of workflows) {
    test(`${name} subscribes to every action it branches on`, () => {
      assert.deepEqual(
        unreachableActions(source),
        [],
        `${name} branches on an action its "on:" block never delivers`
      );
    });
  }

  test('chatgpt-pr-review.yml receives synchronize', () => {
    // The specific regression: its script has a synchronize branch, so the
    // event has to be subscribed or that branch is dead and merge-gate goes
    // stale on every push.
    const source = readFileSync(path.join(workflowsDir, 'chatgpt-pr-review.yml'), 'utf8');
    assert.ok(branchedActions(source).has('synchronize'), 'expected a synchronize branch');
    assert.ok(subscribedActions(source).has('synchronize'), 'synchronize is not subscribed');
  });
});
