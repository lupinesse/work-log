/**
 * @file migration.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname, loadPureFnsScriptSource } from './_helpers.mjs';

/**
 * Creates a VM sandbox with pure-fns.js and 20-migration.js loaded.
 * Promotes _migItems and _migIdx to var so tests can mutate them via the
 * sandbox object without reloading the module.
 *
 * @param {Object} [overrides] - Properties to merge into the sandbox before evaluation.
 * @returns {{ sandbox: Object, getBodyHtml: () => string }}
 */
function loadMigrationSandbox(overrides = {}) {
  const pureSrc = loadPureFnsScriptSource();
  const migSrc = readFileSync(join(__dirname, '../../src/js/20-migration.js'), 'utf8')
    .replace(/\blet (_migItems)\b/, 'var $1')
    .replace(/\blet (_migIdx)\b/, 'var $1');

  let capturedBodyHtml = '';
  const bodyEl = {
    set innerHTML(v) {
      capturedBodyHtml = v;
    },
    get innerHTML() {
      return capturedBodyHtml;
    },
  };

  const sandbox = {
    document: {
      getElementById: (id) => {
        if (id === 'migrationBody') return bodyEl;
        return { addEventListener: () => {}, style: {}, textContent: '' };
      },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    alert: () => {},
    planTasks: [],
    categories: [],
    STORE_MIGRATION: 'wl_migration_v1',
    getCat: (id) => ({ id, label: id, color: '#888780' }),
    carryMigTask: () => {},
    scheduleMigTask: () => {},
    dropMigTask: () => {},
    render: () => {},
    save: () => {},
    ...overrides,
  };

  vm.createContext(sandbox);
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(migSrc, sandbox);
  return { sandbox, getBodyHtml: () => capturedBodyHtml };
}

describe('renderMigrationStep', () => {
  it('sanitises a malicious cat.color value via safeCssColor', () => {
    const malicious = 'red; background:url(x)';
    const { sandbox, getBodyHtml } = loadMigrationSandbox({
      getCat: () => ({ id: 'evil', label: 'Evil', color: malicious }),
    });
    sandbox._migItems = [{ tag: 'evil', text: 'Task', date: '2026-05-01' }];
    sandbox._migIdx = 0;
    sandbox.renderMigrationStep();
    const html = getBodyHtml();
    assert.ok(!html.includes(malicious), 'raw malicious value must not appear in innerHTML');
    assert.ok(html.includes('background:#888780'), 'safeCssColor fallback must be used');
  });

  it('passes a valid hex colour through unchanged', () => {
    const { sandbox, getBodyHtml } = loadMigrationSandbox({
      getCat: () => ({ id: 'work', label: 'Work', color: '#4a90e2' }),
    });
    sandbox._migItems = [{ tag: 'work', text: 'Valid task', date: '2026-05-01' }];
    sandbox._migIdx = 0;
    sandbox.renderMigrationStep();
    assert.ok(getBodyHtml().includes('background:#4a90e2'));
  });

  it('renders the done screen when all items are resolved', () => {
    const { sandbox, getBodyHtml } = loadMigrationSandbox();
    sandbox._migItems = [{ tag: 'other', text: 'Done task', date: '2026-05-01' }];
    sandbox._migIdx = 1;
    sandbox.renderMigrationStep();
    assert.ok(getBodyHtml().includes('mig-done'));
  });
});
