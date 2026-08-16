/**
 * @file tasks-board.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dk } from '../../src/js/pure-fns.js';
import { __dirname, loadPureFnsScriptSource } from './_helpers.mjs';

/**
 * Creates a VM sandbox with pure-fns.js and 10-tasks.js loaded.
 * The sandbox exposes `flatSort` as a property (function declaration = global).
 *
 * @param {Object} [overrides] - Properties to merge into the sandbox before evaluation.
 * @returns {Object} The populated VM sandbox.
 */
function loadFlatSortSandbox(overrides = {}) {
  const pureSrc = loadPureFnsScriptSource();
  const tasksSrc = readFileSync(join(__dirname, '../../src/js/10-tasks.js'), 'utf8');
  const sandbox = {
    document: {
      getElementById: () => ({
        addEventListener: () => {},
        style: {},
        classList: { toggle: () => {} },
      }),
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    // Stubs for collapse-state helpers defined in 07-lifecycle.js (not loaded here).
    readCollapseState: (_id, defaultCollapsed) => defaultCollapsed,
    writeCollapseState: () => {},
    console,
    activeTimer: null,
    entries: [],
    planTasks: [],
    categories: [{ id: 'other', label: 'Other', color: '#888' }],
    viewDate: new Date(),
    pendingCollapsed: false,
    planCollapsed: false,
    wlLog: { warn: () => {}, error: () => {}, info: () => {} },
    validPlanTask: () => true,
    selectedTag: 'other',
    render: () => {},
    renderPlan: () => {},
    getCat: (id) => ({ id, label: id, color: '#888', billable: true }),
    safeRoundedStart: () => Date.now(),
    ...overrides,
  };
  vm.createContext(sandbox);
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(tasksSrc, sandbox);
  return sandbox;
}

describe('flatSort', () => {
  it('orders tasks by status: inprogress → todo → pending → blocked → done', () => {
    const { flatSort } = loadFlatSortSandbox();
    const tasks = [
      { id: '1', text: 'done task', status: 'done' },
      { id: '2', text: 'blocked task', status: 'blocked' },
      { id: '3', text: 'pending task', status: 'pending' },
      { id: '4', text: 'todo task', status: 'todo' },
      { id: '5', text: 'live task', status: 'inprogress' },
    ];
    const result = flatSort(tasks);
    assert.equal(result[0].status, 'inprogress');
    assert.equal(result[1].status, 'todo');
    assert.equal(result[2].status, 'pending');
    assert.equal(result[3].status, 'blocked');
    assert.equal(result[4].status, 'done');
  });

  it('orders by priority within same status: high(1) > normal(0) > low(-1)', () => {
    const { flatSort } = loadFlatSortSandbox();
    const tasks = [
      { id: '1', text: 'low pri', status: 'todo', priority: -1 },
      { id: '2', text: 'normal pri', status: 'todo' },
      { id: '3', text: 'high pri', status: 'todo', priority: 1 },
    ];
    const result = flatSort(tasks);
    assert.equal(result[0].priority, 1);
    assert.equal(result[1].id, '2', 'normal-priority task sorts between high and low');
    assert.equal(result[1].priority, undefined);
    assert.equal(result[2].priority, -1);
  });

  it('places child immediately after its parent', () => {
    const { flatSort } = loadFlatSortSandbox();
    const tasks = [
      { id: 'p1', text: 'beta parent', status: 'todo' },
      { id: 'c1', text: 'child of beta', status: 'todo', parentId: 'p1' },
      { id: 'p2', text: 'alpha parent', status: 'todo' },
    ];
    const result = flatSort(tasks);
    const p1Idx = result.findIndex((t) => t.id === 'p1');
    const c1Idx = result.findIndex((t) => t.id === 'c1');
    assert.equal(c1Idx, p1Idx + 1, 'child must immediately follow its parent');
  });

  it('appends orphaned children (missing parent) at the end', () => {
    const { flatSort } = loadFlatSortSandbox();
    const tasks = [
      { id: 'p1', text: 'parent', status: 'todo' },
      { id: 'orphan', text: 'orphan', status: 'todo', parentId: 'deleted-parent-id' },
    ];
    const result = flatSort(tasks);
    assert.equal(result[result.length - 1].id, 'orphan');
  });

  it('sorts the live-timer matching task first regardless of status', () => {
    const sandbox = loadFlatSortSandbox();
    sandbox.activeTimer = { entryId: 'e1' };
    sandbox.entries = [
      { id: 'e1', text: 'Active work', tag: 'other', ts: Date.now(), date: '2026-05-28' },
    ];
    const tasks = [
      { id: '1', text: 'done task', status: 'done' },
      { id: '2', text: 'Active work', status: 'todo' },
    ];
    const result = sandbox.flatSort(tasks);
    assert.equal(result[0].id, '2', 'live-timer task must sort first');
  });

  it('uses alphabetical tiebreaker within same status and priority', () => {
    const { flatSort } = loadFlatSortSandbox();
    const tasks = [
      { id: '1', text: 'zebra', status: 'todo' },
      { id: '2', text: 'apple', status: 'todo' },
      { id: '3', text: 'mango', status: 'todo' },
    ];
    const result = flatSort(tasks);
    assert.equal(result[0].text, 'apple');
    assert.equal(result[1].text, 'mango');
    assert.equal(result[2].text, 'zebra');
  });

  it('returns empty array unchanged', () => {
    const { flatSort } = loadFlatSortSandbox();
    assert.equal(flatSort([]).length, 0);
  });
});

/**
 * Loads 10-tasks.js into a VM sandbox so promoteMatchingTaskToInProgress can
 * be called directly. The file declares `planTasks` as a top-level `let`
 * (not a plain sandbox property), so a lexical binding inside the loaded
 * script — not a global object property — holds the array; direct
 * `sandbox.planTasks = …` assignment from outside would not be visible to
 * functions defined in the script. `_setPlanTasks`/`_getPlanTasks` injector
 * functions (defined in the same context, after the file loads) bridge that
 * gap. Several top-level statements call `document.getElementById(id).addEventListener(...)`
 * without a null-check, so getElementById must return a dummy element for
 * every id, not null.
 * @returns {Object} The populated sandbox, with _setPlanTasks/_getPlanTasks helpers.
 */
function loadTasksSandbox() {
  const pureSrc = loadPureFnsScriptSource();
  const tasksSrc = readFileSync(join(__dirname, '../../src/js/10-tasks.js'), 'utf8');
  const dummyEl = () => ({
    addEventListener: () => {},
    classList: { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false },
  });

  const sandbox = {
    document: { getElementById: () => dummyEl(), addEventListener: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    readCollapseState: () => false,
    writeCollapseState: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(tasksSrc, sandbox);
  vm.runInContext(
    'function _setPlanTasks(arr) { planTasks = arr; } function _getPlanTasks() { return planTasks; }',
    sandbox
  );
  return sandbox;
}

describe('promoteMatchingTaskToInProgress', () => {
  const TODAY = dk(new Date());

  it('promotes a matching todo task to inprogress and clears completedAt', () => {
    const sandbox = loadTasksSandbox();
    sandbox._setPlanTasks([
      { id: 't1', text: 'Ship feature', date: TODAY, status: 'todo', completedAt: 12345 },
    ]);
    sandbox.promoteMatchingTaskToInProgress('Ship feature');
    const [task] = sandbox._getPlanTasks();
    assert.equal(task.status, 'inprogress');
    assert.equal(task.completedAt, undefined);
  });

  it('promotes the parent task when a todo subtask is promoted', () => {
    const sandbox = loadTasksSandbox();
    sandbox._setPlanTasks([
      { id: 'parent', text: 'Epic', date: TODAY, status: 'todo' },
      { id: 'child', text: 'Subtask', date: TODAY, status: 'todo', parentId: 'parent' },
    ]);
    sandbox.promoteMatchingTaskToInProgress('Subtask');
    const [parent, child] = sandbox._getPlanTasks();
    assert.equal(child.status, 'inprogress');
    assert.equal(parent.status, 'inprogress');
  });

  it('does not demote a parent that is already past todo', () => {
    const sandbox = loadTasksSandbox();
    sandbox._setPlanTasks([
      { id: 'parent', text: 'Epic', date: TODAY, status: 'pending' },
      { id: 'child', text: 'Subtask', date: TODAY, status: 'todo', parentId: 'parent' },
    ]);
    sandbox.promoteMatchingTaskToInProgress('Subtask');
    const [parent] = sandbox._getPlanTasks();
    assert.equal(parent.status, 'pending');
  });

  it('is a no-op when no plan task matches the text', () => {
    const sandbox = loadTasksSandbox();
    sandbox._setPlanTasks([{ id: 't1', text: 'Other task', date: TODAY, status: 'todo' }]);
    sandbox.promoteMatchingTaskToInProgress('Ship feature');
    const [task] = sandbox._getPlanTasks();
    assert.equal(task.status, 'todo');
  });

  it('is a no-op when the matching task is already inprogress', () => {
    const sandbox = loadTasksSandbox();
    sandbox._setPlanTasks([{ id: 't1', text: 'Ship feature', date: TODAY, status: 'inprogress' }]);
    sandbox.promoteMatchingTaskToInProgress('Ship feature');
    const [task] = sandbox._getPlanTasks();
    assert.equal(task.status, 'inprogress');
  });
});

const boardSrc = readFileSync(join(__dirname, '../../src/js/10c-tasks-board.js'), 'utf8');

describe('regression #218: initBoardTabs warns on localStorage errors', () => {
  function makeBoardSandbox(overrides = {}) {
    const warned = [];
    const tabs = [];
    const cols = [];
    const sb = {
      wlLog: {
        warn: (...args) => warned.push(args),
        info: () => {},
        error: () => {},
        debug: () => {},
      },
      localStorage: {
        getItem: () => {
          throw new Error('storage unavailable');
        },
        setItem: () => {
          throw new Error('quota exceeded');
        },
      },
      planTasks: [],
      activeTimer: null,
      entries: [],
      viewDate: new Date(),
      dk: (d) => d.toISOString().slice(0, 10),
      savePlan: () => {},
      save: () => {},
      render: () => {},
      renderPlan: () => {},
      document: {
        querySelectorAll: (sel) => {
          if (sel === '.board-tab') return tabs;
          if (sel === '.kb-col[data-col]') return cols;
          return [];
        },
        getElementById: () => null,
        addEventListener: () => {},
      },
      ...overrides,
      _warned: warned,
    };
    vm.createContext(sb);
    vm.runInContext(boardSrc, sb);
    return sb;
  }

  it('calls wlLog.warn when localStorage.getItem throws during init', () => {
    const sb = makeBoardSandbox();
    vm.runInContext('initBoardTabs();', sb);
    const getItemWarning = sb._warned.find((w) => w[0].includes('localStorage.getItem'));
    assert.ok(getItemWarning, 'should warn on localStorage.getItem failure');
    // Error thrown by outer mock; check it's a non-null object (cross-context instanceof is unreliable)
    assert.ok(
      getItemWarning[1] !== null && typeof getItemWarning[1] === 'object',
      'second arg should be the caught error object'
    );
  });

  it('calls wlLog.warn when localStorage.setItem throws during tab activation', () => {
    const sb = makeBoardSandbox({
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota exceeded');
        },
      },
    });
    vm.runInContext('initBoardTabs();', sb);
    const setItemWarning = sb._warned.find((w) => w[0].includes('localStorage.setItem'));
    assert.ok(setItemWarning, 'should warn on localStorage.setItem failure');
    // Error thrown by outer mock; check it's a non-null object (cross-context instanceof is unreliable)
    assert.ok(
      setItemWarning[1] !== null && typeof setItemWarning[1] === 'object',
      'second arg should be the caught error object'
    );
  });
});
