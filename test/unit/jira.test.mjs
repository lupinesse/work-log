/**
 * @file jira.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname, loadPureFnsScriptSource } from './_helpers.mjs';

/**
 * Creates a VM sandbox with pure-fns.js and 14-jira.js loaded.
 * Strips the IIFE wrapper so internal functions are sandbox-accessible.
 * Promotes jiraTasks, jiraSelected, jiraCatMap to var so tests can seed them.
 *
 * @param {Object} [overrides] - Properties merged into the sandbox before eval.
 * @returns {{ sandbox: Object, getContainerHtml: () => string }}
 */
function loadJiraSandbox(overrides = {}) {
  let jiraSrc = readFileSync(join(__dirname, '../../src/js/14-jira.js'), 'utf8');
  jiraSrc = jiraSrc.replace(/\(function initJiraImporter\(\)\s*\{\r?\n/, '');
  jiraSrc = jiraSrc.replace(/\r?\n\}\)\(\);\r?\n?$/, '');
  jiraSrc = jiraSrc.replace(
    /let jiraTasks = \[\],\r?\n\s*jiraSelected = new Set\(\),\r?\n\s*jiraCatMap = \{\};/,
    'var jiraTasks = [];\nvar jiraSelected = new Set();\nvar jiraCatMap = {};'
  );
  if (!jiraSrc.includes('function jiraRenderTasks'))
    throw new Error('loadJiraSandbox: IIFE strip or var-promotion failed — check 14-jira.js');
  if (jiraSrc.includes('(function initJiraImporter'))
    throw new Error('loadJiraSandbox: IIFE opening was not removed');
  const pureSrc = loadPureFnsScriptSource();

  let capturedHtml = '';
  const containerEl = {
    set innerHTML(v) {
      capturedHtml = v;
    },
    get innerHTML() {
      return capturedHtml;
    },
    style: {},
    querySelectorAll: () => [],
  };
  const stub = () => ({
    addEventListener: () => {},
    style: {},
    textContent: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    disabled: false,
  });

  const sandbox = {
    window: {},
    document: {
      getElementById: (id) => (id === 'jiraTaskRows' ? containerEl : stub()),
      addEventListener: () => {},
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    alert: () => {},
    planTasks: [],
    categories: [],
    getCat: () => null,
    addPlanTask: () => {},
    render: () => {},
    save: () => {},
    savePlan: () => {},
    renderPlan: () => {},
    readCollapseState: (_id, defaultVal) => defaultVal,
    writeCollapseState: () => {},
    ...overrides,
  };

  vm.createContext(sandbox);
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(jiraSrc, sandbox);
  return { sandbox, getContainerHtml: () => capturedHtml };
}

describe('jiraRenderTasks', () => {
  it('sanitises a malicious cat.color via safeCssColor', () => {
    const malicious = 'red; background:url(x)';
    const { sandbox, getContainerHtml } = loadJiraSandbox();
    // jiraGetCat(t) returns jiraCatMap[parentKey|parentSummary]
    sandbox.jiraCatMap = { '|': { id: 'evil', label: 'Evil', color: malicious } };
    sandbox.jiraTasks = [{ key: 'EVIL-1', summary: 'Bad task', status: 'todo' }];
    sandbox.jiraSelected = new Set();
    sandbox.jiraRenderTasks();
    const html = getContainerHtml();
    assert.ok(!html.includes(malicious), 'raw malicious value must not appear');
    assert.ok(html.includes('background:#888780'), 'safeCssColor fallback must be used');
  });

  it('passes a valid hex colour through unchanged', () => {
    const { sandbox, getContainerHtml } = loadJiraSandbox();
    sandbox.jiraCatMap = { '|': { id: 'work', label: 'Work', color: '#4a90e2' } };
    sandbox.jiraTasks = [{ key: 'WORK-1', summary: 'Good task', status: 'todo' }];
    sandbox.jiraSelected = new Set();
    sandbox.jiraRenderTasks();
    assert.ok(getContainerHtml().includes('background:#4a90e2'));
  });

  it('renders no cat-dot when the task has no matching category', () => {
    const { sandbox, getContainerHtml } = loadJiraSandbox();
    sandbox.jiraCatMap = {};
    sandbox.jiraTasks = [{ key: 'X-1', summary: 'Orphan', status: 'todo' }];
    sandbox.jiraSelected = new Set();
    sandbox.jiraRenderTasks();
    assert.ok(!getContainerHtml().includes('background:'));
  });
});
