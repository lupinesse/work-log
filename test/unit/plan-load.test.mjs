/**
 * @file plan-load.test.mjs
 * Unit tests for loadPlan() in 10-tasks.js, which writes the shared plan-task
 * list through state.js's setPlanTasks() (#423): the valid parse, the
 * invalid-record drop, and the reset when the stored JSON is corrupt. The
 * function is cut out of the real source so the tests track it.
 *
 * Run: node --test test/unit/plan-load.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import { __dirname, extractFunctionSource, withStateAccessors } from './_helpers.mjs';

const source = readFileSync(join(__dirname, '../../src/js/10-tasks.js'), 'utf8');
const loadPlanSource = `const STORE_PLAN = 'wl_plan_v1';\n${extractFunctionSource(source, 'loadPlan')}`;

const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Loads loadPlan() into a sandbox over an in-memory localStorage.
 * @param {string|null} storedPlan - Raw value under the plan key, or null for none.
 * @param {Array<object>} [seedTasks] - What planTasks holds before loading.
 * @returns {{ sandbox: object, warnings: string[], errors: string[] }}
 */
function loadSandbox(storedPlan, seedTasks = []) {
  const warnings = [];
  const errors = [];
  const sandbox = {
    planTasks: seedTasks,
    localStorage: { getItem: () => storedPlan },
    validPlanTask: (task) => !!task && typeof task.id === 'string',
    wlLog: { warn: (message) => warnings.push(message), error: (message) => errors.push(message) },
  };
  vm.createContext(withStateAccessors(sandbox));
  vm.runInContext(loadPlanSource, sandbox);
  return { sandbox, warnings, errors };
}

describe('loadPlan() writes the shared plan-task list', () => {
  it('keeps valid stored tasks, drops invalid ones, and warns about the drop', () => {
    const { sandbox, warnings } = loadSandbox(JSON.stringify([{ id: 'a' }, { nope: true }]));
    sandbox.loadPlan();
    assert.deepEqual(plain(sandbox.planTasks), [{ id: 'a' }]);
    assert.match(warnings.join('\n'), /dropped 1 invalid task record/);
  });

  it('replaces whatever was held with an empty list and logs an error on corrupt JSON', () => {
    const { sandbox, errors } = loadSandbox('{not json', [{ id: 'stale' }]);
    sandbox.loadPlan();
    assert.deepEqual(plain(sandbox.planTasks), []);
    assert.match(errors.join('\n'), /loadPlan: failed to parse/);
  });

  it('replaces whatever was held with an empty list when nothing is stored', () => {
    const { sandbox } = loadSandbox(null, [{ id: 'stale' }]);
    sandbox.loadPlan();
    assert.deepEqual(plain(sandbox.planTasks), []);
  });

  it('treats a stored value that is not an array as no tasks', () => {
    const { sandbox } = loadSandbox(JSON.stringify({ id: 'a' }), [{ id: 'stale' }]);
    sandbox.loadPlan();
    assert.deepEqual(plain(sandbox.planTasks), []);
  });
});
