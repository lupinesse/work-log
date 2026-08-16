/**
 * @file utils-categories.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname, loadPureFnsScriptSource } from './_helpers.mjs';

/**
 * Loads 02-utils.js into a VM sandbox with a minimal fake DOM. Every
 * `document.getElementById(id)` call returns the same object per id (a Map
 * keyed by id), each supporting `.style`, `.dataset`, `.value`, `.innerHTML`,
 * and an `addEventListener` that records the handler on `._listeners`.
 * @param {Object} [overrides] - Properties merged into the sandbox before eval.
 * @returns {Object} The populated sandbox, plus `_elements` (the id → element Map).
 */
function loadTagRowSandbox(overrides = {}) {
  const pureSrc = loadPureFnsScriptSource();
  const utilsSrc = readFileSync(join(__dirname, '../../src/js/02-utils.js'), 'utf8');
  const elements = new Map();
  const mockEl = (id) => {
    if (!elements.has(id)) {
      const el = {
        id,
        style: {},
        dataset: {},
        value: '',
        innerHTML: '',
        _listeners: {},
        focus: () => {},
        select: () => {},
        addEventListener: (type, handler) => {
          el._listeners[type] = handler;
        },
      };
      elements.set(id, el);
    }
    return elements.get(id);
  };

  const sandbox = {
    document: { getElementById: mockEl },
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    categories: [{ id: 'work', label: 'Work', color: '#378ADD' }],
    selectedTag: 'work',
    planTasks: [],
    save: () => {},
    savePlan: () => {},
    render: () => {},
    renderPlan: () => {},
    renderTimeblock: () => {},
    renderCompleted: () => {},
    nextDistinctColor: () => '#000000',
    ...overrides,
  };
  vm.createContext(sandbox);
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(utilsSrc, sandbox);
  sandbox._elements = elements;
  return sandbox;
}

describe('renderTagRow — colour sanitisation (regression, issue #267)', () => {
  it('sanitises a malicious value entering via the quick colour picker "input" handler', () => {
    const sandbox = loadTagRowSandbox();
    sandbox.renderTagRow();
    const pick = sandbox._elements.get('catQuickColorPick');
    pick.value = '"><script>alert(1)</script>';
    pick._listeners.input();
    const dot = sandbox._elements.get('catDotPreview');
    assert.equal(dot.style.background, '#888780');
  });

  it('sanitises a malicious value entering via the quick colour picker "change" handler before it reaches persisted state', () => {
    const sandbox = loadTagRowSandbox();
    sandbox.renderTagRow();
    const pick = sandbox._elements.get('catQuickColorPick');
    pick.value = 'javascript:alert(1)';
    pick._listeners.change();
    const cat = sandbox.categories.find((c) => c.id === 'work');
    assert.equal(cat.color, '#888780');
  });

  it('passes through a legitimate hex value unchanged via both handlers', () => {
    const sandbox = loadTagRowSandbox();
    sandbox.renderTagRow();
    const pick = sandbox._elements.get('catQuickColorPick');

    pick.value = '#ff00aa';
    pick._listeners.input();
    const dot = sandbox._elements.get('catDotPreview');
    assert.equal(dot.style.background, '#ff00aa');

    pick._listeners.change();
    const cat = sandbox.categories.find((c) => c.id === 'work');
    assert.equal(cat.color, '#ff00aa');
  });

  // Passes before and after the source fix — getCat()'s own sanitisation is
  // the actual upstream barrier here, so this only guards the invariant.
  it('never lets a malicious persisted colour reach the rendered template', () => {
    const sandbox = loadTagRowSandbox({
      categories: [{ id: 'work', label: 'Work', color: '"><script>alert(1)</script>' }],
    });
    sandbox.renderTagRow();
    const row = sandbox._elements.get('tagRow');
    assert.ok(row.innerHTML.includes('value="#888780"'));
    assert.ok(!row.innerHTML.includes('<script>'));
  });
});

describe('getCat / getCatColor — colour sanitisation', () => {
  it('getCat() sanitises a malicious persisted colour', () => {
    const sandbox = loadTagRowSandbox({
      categories: [{ id: 'work', label: 'Work', color: 'red; background:url(x)' }],
    });
    assert.equal(sandbox.getCat('work').color, '#888780');
  });

  it('getCatColor() sanitises a malicious persisted colour', () => {
    const sandbox = loadTagRowSandbox({
      categories: [{ id: 'work', label: 'Work', color: '"><script>alert(1)</script>' }],
    });
    assert.equal(sandbox.getCatColor('work'), '#888780');
    assert.ok(!sandbox.getCatColor('work').includes('<script>'));
  });

  it('getCatColor() passes a legitimate hex colour through unchanged', () => {
    const sandbox = loadTagRowSandbox({
      categories: [{ id: 'work', label: 'Work', color: '#ff00aa' }],
    });
    assert.equal(sandbox.getCatColor('work'), '#ff00aa');
  });

  it('getCatColor() sanitises the fallback "other" category too', () => {
    const sandbox = loadTagRowSandbox({
      categories: [{ id: 'other', label: 'other', color: 'javascript:alert(1)' }],
    });
    assert.equal(sandbox.getCatColor('missing-id'), '#888780');
  });
});

describe('viewEntries — sorts by start time (regression)', () => {
  it('orders newest-first by ts regardless of insertion order', () => {
    const viewDate = new Date(2026, 4, 26, 12, 0, 0);
    const late = { id: '1', date: '2026-05-26', ts: 1000 * 60 * 60 * 15 }; // 15:00
    const early = { id: '2', date: '2026-05-26', ts: 1000 * 60 * 60 * 8 }; // 08:00 — added after `late`
    const mid = { id: '3', date: '2026-05-26', ts: 1000 * 60 * 60 * 11 }; // 11:00
    const sandbox = loadTagRowSandbox({
      viewDate,
      entries: [late, early, mid],
    });
    const result = sandbox.viewEntries();
    assert.deepEqual(
      result.map((e) => e.id),
      ['1', '3', '2']
    );
  });

  it('only includes entries matching the viewed date', () => {
    const viewDate = new Date(2026, 4, 26, 12, 0, 0);
    const today = { id: 'a', date: '2026-05-26', ts: 1000 };
    const otherDay = { id: 'b', date: '2026-05-25', ts: 2000 };
    const sandbox = loadTagRowSandbox({
      viewDate,
      entries: [otherDay, today],
    });
    const result = sandbox.viewEntries();
    assert.deepEqual(
      result.map((e) => e.id),
      ['a']
    );
  });
});
