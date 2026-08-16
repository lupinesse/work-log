/**
 * @file rapid.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname, loadPureFnsScriptSource } from './_helpers.mjs';

/**
 * Creates a VM sandbox with pure-fns.js and 16-rapid.js loaded.
 * Injects getCat using the sandbox's `categories` array.
 *
 * @param {Object} [overrides] - Properties to merge into the sandbox before evaluation.
 * @returns {Object} The populated VM sandbox.
 */
function loadRapidSandbox(overrides = {}) {
  const pureSrc = loadPureFnsScriptSource();
  const rapidSrc = readFileSync(join(__dirname, '../../src/js/16-rapid.js'), 'utf8')
    .replace(/\blet (_qcFilterCat)\b/, 'var $1')
    .replace(/\blet (_qcSearch)\b/, 'var $1');

  const sandbox = {
    document: { getElementById: () => null, addEventListener: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    activeTimer: null,
    entries: [],
    planTasks: [],
    categories: [
      { id: 'other', label: 'Other', color: '#888780' },
      { id: 'work', label: 'Work', color: '#4a90e2', billable: true },
    ],
    fmtElapsed: () => '0:00',
    getElapsedMs: () => 0,
    selectedTag: 'other',
    startTimer: () => {},
    stopTimer: () => {},
    save: () => {},
    render: () => {},
    safeRoundedStart: () => Date.now(),
    ...overrides,
  };
  vm.createContext(sandbox);
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(
    `function getCat(id) {
       const cat = categories.find(function(c){ return c.id === id; })
                || categories.find(function(c){ return c.id === 'other'; });
       if (!cat) return { id: 'other', label: 'Other', color: '#888780' };
       return { id: cat.id, label: cat.label, color: cat.color };
     }`,
    sandbox
  );
  vm.runInContext(rapidSrc, sandbox);
  return sandbox;
}

describe('_qcBuildTaskGroups', () => {
  const TODAY = '2026-05-28';

  it('returns three empty arrays when there is no data', () => {
    const sandbox = loadRapidSandbox();
    const { inProgress, todo, recent } = sandbox._qcBuildTaskGroups('', TODAY);
    assert.equal(inProgress.length, 0);
    assert.equal(todo.length, 0);
    assert.equal(recent.length, 0);
  });

  it('puts the active-timer entry in inProgress', () => {
    const sandbox = loadRapidSandbox();
    sandbox.activeTimer = { entryId: 'e1' };
    sandbox.entries = [{ id: 'e1', text: 'Active work', tag: 'work', ts: 1, date: TODAY }];
    const { inProgress } = sandbox._qcBuildTaskGroups('', TODAY);
    assert.equal(inProgress.length, 1);
    assert.equal(inProgress[0].id, 'e1');
  });

  it('puts open plan tasks in todo, excludes done and _migrated', () => {
    const sandbox = loadRapidSandbox();
    sandbox.planTasks = [
      { id: 't1', text: 'open task', tag: 'work', status: 'todo', date: TODAY },
      { id: 't2', text: 'done task', tag: 'work', status: 'done', date: TODAY },
      { id: 't3', text: 'migrated', tag: 'work', status: 'todo', date: TODAY, _migrated: true },
    ];
    const { todo } = sandbox._qcBuildTaskGroups('', TODAY);
    assert.equal(todo.length, 1);
    assert.equal(todo[0].id, 't1');
  });

  it('puts closed today entries in recent, deduplicates by text', () => {
    const sandbox = loadRapidSandbox();
    sandbox.entries = [
      { id: 'e1', text: 'Task A', tag: 'work', ts: 1, date: TODAY },
      { id: 'e2', text: 'Task A', tag: 'work', ts: 2, date: TODAY },
    ];
    const { recent } = sandbox._qcBuildTaskGroups('', TODAY);
    assert.equal(recent.length, 1, 'duplicate texts must appear once only');
  });

  it('filters all groups by search string', () => {
    const sandbox = loadRapidSandbox();
    sandbox.planTasks = [
      { id: 't1', text: 'Design review', tag: 'work', status: 'todo', date: TODAY },
      { id: 't2', text: 'Unrelated task', tag: 'work', status: 'todo', date: TODAY },
    ];
    const { todo } = sandbox._qcBuildTaskGroups('design', TODAY);
    assert.equal(todo.length, 1);
    assert.equal(todo[0].id, 't1');
  });

  it('filters all groups by category when _qcFilterCat is set', () => {
    const sandbox = loadRapidSandbox();
    sandbox._qcFilterCat = 'work';
    sandbox.planTasks = [
      { id: 't1', text: 'Work task', tag: 'work', status: 'todo', date: TODAY },
      { id: 't2', text: 'Other task', tag: 'other', status: 'todo', date: TODAY },
    ];
    const { todo } = sandbox._qcBuildTaskGroups('', TODAY);
    assert.equal(todo.length, 1);
    assert.equal(todo[0].id, 't1');
  });
});

describe('_qcTaskListHtml', () => {
  it('returns a qc-empty div when all groups are empty', () => {
    const sandbox = loadRapidSandbox();
    const html = sandbox._qcTaskListHtml({ inProgress: [], todo: [], recent: [] }, '');
    assert.ok(html.includes('qc-empty'), 'empty-state div must be present');
  });

  it('shows the typed search text in the empty-state prompt', () => {
    const sandbox = loadRapidSandbox();
    const html = sandbox._qcTaskListHtml({ inProgress: [], todo: [], recent: [] }, 'design');
    assert.ok(html.includes('design'), 'empty-state must surface the user search text');
  });

  it('renders "In progress" group header when inProgress is non-empty', () => {
    const sandbox = loadRapidSandbox();
    const entry = { id: 'e1', text: 'Active', tag: 'work', ts: 1 };
    const html = sandbox._qcTaskListHtml({ inProgress: [entry], todo: [], recent: [] }, '');
    assert.ok(html.includes('In progress'), '"In progress" header must appear');
    assert.ok(html.includes('Active'), 'entry text must appear');
  });

  it('renders "To-do" group header and caps at 6 items', () => {
    const sandbox = loadRapidSandbox();
    const todo = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      text: `Task ${i}`,
      tag: 'work',
    }));
    const html = sandbox._qcTaskListHtml({ inProgress: [], todo, recent: [] }, '');
    assert.ok(html.includes('To-do'), '"To-do" header must appear');
    const matches = [...html.matchAll(/qc-task-row/g)];
    assert.ok(matches.length <= 6, `todo must be capped at 6 rows, got ${matches.length}`);
  });

  it('caps recent group at 5 items', () => {
    const sandbox = loadRapidSandbox();
    const recent = Array.from({ length: 7 }, (_, i) => ({
      id: `e${i}`,
      text: `Entry ${i}`,
      tag: 'other',
    }));
    const html = sandbox._qcTaskListHtml({ inProgress: [], todo: [], recent }, '');
    const matches = [...html.matchAll(/qc-task-row/g)];
    assert.ok(matches.length <= 5, `recent must be capped at 5 rows, got ${matches.length}`);
  });

  it('escapes HTML in task text to prevent XSS', () => {
    const sandbox = loadRapidSandbox();
    const entry = { id: 'e1', text: '<script>alert(1)</script>', tag: 'other' };
    const html = sandbox._qcTaskListHtml({ inProgress: [entry], todo: [], recent: [] }, '');
    assert.ok(!html.includes('<script>'), 'raw <script> tag must not appear in output');
    assert.ok(html.includes('&lt;script&gt;'), 'text must be HTML-escaped');
  });
});

describe('_qcActivateRow', () => {
  it('promotes the matching plan task when starting a "to do" row', () => {
    const calls = [];
    const sandbox = loadRapidSandbox({
      promoteMatchingTaskToInProgress: (text) => calls.push(text),
    });
    sandbox._qcActivateRow('plan:t1', 'Ship feature', 'work', false);
    assert.deepEqual(calls, ['Ship feature']);
  });

  it('promotes the matching plan task when resuming an existing log entry', () => {
    const calls = [];
    const sandbox = loadRapidSandbox({
      entries: [{ id: 'e1', text: 'Ship feature', tag: 'work', ts: 1 }],
      promoteMatchingTaskToInProgress: (text) => calls.push(text),
    });
    sandbox._qcActivateRow('e1', 'Ship feature', 'work', false);
    assert.deepEqual(calls, ['Ship feature']);
  });

  it('does nothing when the clicked row is already the active timer', () => {
    const calls = [];
    const sandbox = loadRapidSandbox({
      promoteMatchingTaskToInProgress: (text) => calls.push(text),
    });
    sandbox._qcActivateRow('e1', 'Ship feature', 'work', true);
    assert.deepEqual(calls, []);
  });
});
