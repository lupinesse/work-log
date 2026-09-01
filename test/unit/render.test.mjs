/**
 * @file render.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname, loadPureFnsScriptSource, loadRenderScriptSource } from './_helpers.mjs';

// buildEntryMetaHtml moved to 04a-render-entry-meta.js in the 04-render.js
// split (QA finding: module size) — read that file directly rather than the
// full render-family concat, since the regex below extracts just this one
// function block.
const entryMetaSrc = readFileSync(join(__dirname, '../../src/js/04a-render-entry-meta.js'), 'utf8');

/**
 * Evaluates just the buildEntryMetaHtml function from 04a-render-entry-meta.js
 * in a minimal VM sandbox. The function only touches escHtml and the
 * module-level `_pendingNoteConfirm` state — both stubbed as plain,
 * externally-mutable sandbox properties (the source's own
 * `let _pendingNoteConfirm` declaration is deliberately excluded from the
 * extracted snippet, since a `let` binding created inside a vm context isn't
 * reachable as a sandbox property from the host afterwards).
 * @param {Record<string, unknown>} [overrides]
 * @returns {Object} Populated VM sandbox.
 */
function loadEntryMetaSandbox(overrides = {}) {
  const match = entryMetaSrc.match(
    /\/\*\*\r?\n \* Builds the proof-link[\s\S]*?(?=\/\*\*\r?\n \* Builds the category picker)/
  );
  if (!match) throw new Error('buildEntryMetaHtml block not found in 04a-render-entry-meta.js');
  const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const sandbox = {
    escHtml: (s) => String(s).replace(/[&<>"']/g, (c) => escapeMap[c]),
    _pendingNoteConfirm: null,
    ...overrides,
  };
  vm.createContext(sandbox);
  vm.runInContext(match[0], sandbox);
  return sandbox;
}

describe('buildEntryMetaHtml — restart note-confirmation banner', () => {
  it('shows no banner in read-only (non-editing) mode, even with a pending confirmation', () => {
    const sandbox = loadEntryMetaSandbox({ _pendingNoteConfirm: { id: '1', note: 'Wrote tests' } });
    const html = sandbox.buildEntryMetaHtml({ id: '1' }, false);
    assert.doesNotMatch(html, /emeta-restart-confirm/);
  });

  it('shows no banner while editing when nothing is pending', () => {
    const sandbox = loadEntryMetaSandbox();
    const html = sandbox.buildEntryMetaHtml({ id: '1' }, true);
    assert.doesNotMatch(html, /emeta-restart-confirm/);
  });

  it('shows no banner when the pending confirmation belongs to a different entry', () => {
    const sandbox = loadEntryMetaSandbox({ _pendingNoteConfirm: { id: '2', note: 'Wrote tests' } });
    const html = sandbox.buildEntryMetaHtml({ id: '1' }, true);
    assert.doesNotMatch(html, /emeta-restart-confirm/);
  });

  it('shows the confirm banner with the escaped prior note when editing the pending entry', () => {
    const sandbox = loadEntryMetaSandbox({
      _pendingNoteConfirm: { id: '1', note: 'Wrote <b>tests</b>' },
    });
    const html = sandbox.buildEntryMetaHtml({ id: '1' }, true);
    assert.match(html, /emeta-restart-confirm/);
    assert.match(html, /Same note as last time\?/);
    assert.match(html, /Wrote &lt;b&gt;tests&lt;\/b&gt;/);
    assert.doesNotMatch(html, /Wrote <b>tests<\/b>/);
  });
});

/**
 * Creates a VM sandbox with pure-fns.js and the render-family files loaded,
 * exposing buildEntryCatPickerHtml (04a-render-entry-meta.js) for direct
 * testing.
 * @param {Object} [overrides] - Properties merged into the sandbox before eval.
 * @returns {Object} The populated sandbox.
 */
function loadRenderSandbox(overrides = {}) {
  const renderSrc = loadRenderScriptSource();
  const pureSrc = loadPureFnsScriptSource();

  const sandbox = {
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    ...overrides,
  };

  vm.createContext(sandbox);
  vm.runInContext(pureSrc, sandbox);
  vm.runInContext(renderSrc, sandbox);
  return sandbox;
}

describe('buildEntryCatPickerHtml', () => {
  const categoryList = [
    { id: 'work', label: 'Work', color: '#4a90e2' },
    { id: 'meeting', label: 'Meeting', color: '#e67e22' },
  ];

  it('renders a "+ new epic" control so a new epic can be created from a log entry', () => {
    const sandbox = loadRenderSandbox();
    const html = sandbox.buildEntryCatPickerHtml({ id: 'e1', tag: 'work' }, categoryList);
    assert.ok(html.includes('pcat-add-btn'), 'must render the + new epic button');
    assert.ok(html.includes('+ new epic'));
    assert.ok(html.includes('pcat-add-input'), 'must render the inline name input');
    assert.ok(html.includes('pcat-add-ok'), 'must render the save control');
  });

  it("renders one button per category, marking the entry's current tag selected", () => {
    const sandbox = loadRenderSandbox();
    const html = sandbox.buildEntryCatPickerHtml({ id: 'e1', tag: 'meeting' }, categoryList);
    assert.ok(html.includes('>Work<'));
    assert.ok(html.includes('>Meeting<'));
    const meetingBtn = html.match(
      /<button class="cat-opt[^"]*" data-id="e1" data-cat="meeting"[^>]*>/
    )[0];
    assert.ok(meetingBtn.includes('sel'));
  });

  it('escapes a malicious category label via escHtml', () => {
    const sandbox = loadRenderSandbox();
    const malicious = [{ id: 'x', label: '<img src=x onerror=alert(1)>', color: '#4a90e2' }];
    const html = sandbox.buildEntryCatPickerHtml({ id: 'e1', tag: 'x' }, malicious);
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
    assert.ok(html.includes('&lt;img'));
  });

  it('sanitises a malicious category color via safeCssColor', () => {
    const sandbox = loadRenderSandbox();
    const malicious = [{ id: 'x', label: 'Evil', color: 'red; background:url(x)' }];
    const html = sandbox.buildEntryCatPickerHtml({ id: 'e1', tag: 'x' }, malicious);
    assert.ok(!html.includes('red; background:url(x)'));
  });

  it("uses an ecaf- prefixed form id, distinct from the board picker's pcaf- id", () => {
    const sandbox = loadRenderSandbox();
    const html = sandbox.buildEntryCatPickerHtml({ id: 'e1', tag: 'work' }, categoryList);
    assert.ok(html.includes('id="ecaf-e1"'));
  });
});

const renderSrc = loadRenderScriptSource();

describe('regression: ad-hoc log row binds even when render() takes the empty-state branch', () => {
  /**
   * Creates a mock DOM element supporting the subset of the Element API that
   * the render-family files touch: style/classList/dataset stubs, an addEventListener
   * that records handlers by event type (so tests can invoke them directly),
   * and a querySelectorAll that returns no nodes (the non-empty render branch
   * is never exercised by these tests).
   * @returns {object} Mock element.
   */
  function makeMockElement() {
    return {
      _listeners: {},
      style: {},
      classList: {
        add() {},
        remove() {},
        contains() {
          return false;
        },
      },
      dataset: {},
      textContent: '',
      innerHTML: '',
      value: '',
      disabled: false,
      addEventListener(type, handler) {
        (this._listeners[type] = this._listeners[type] || []).push(handler);
      },
      focus() {},
      querySelectorAll() {
        return [];
      },
    };
  }

  /**
   * Builds a vm sandbox with the render-family files (04-render.js plus its
   * 04a-04d siblings) loaded and every cross-file global they call
   * (renderHeroCard, renderPlan, etc. — each defined in a different
   * concatenated source file in the real build) stubbed as a no-op, same
   * pattern as loadTimeflowSandbox above. `entries` and `document` are real,
   * mutable objects so the ad-hoc commit flow can be observed end to end.
   * @param {object} overrides
   */
  function makeRenderSandbox(overrides = {}) {
    const elements = {};
    const getElementById = (id) => (elements[id] ??= makeMockElement());
    const sb = {
      entries: [],
      viewDate: new Date('2026-05-29T12:00:00'),
      selectedTag: null,
      categories: [{ id: 'other', label: 'Other', color: '#888' }],
      activeTimer: null,
      isToday: () => true,
      viewEntries: () => sb.entries,
      dk: (d) => d.toISOString().slice(0, 10),
      fmtLabel: () => 'label',
      mondayOfWeek: () => 0,
      calcStreak: () => 0,
      parseJiraLabel: (label) => ({ ticket: null, name: label }),
      escHtml: (s) => s,
      fmtDur: (ms) => String(ms),
      safeRoundedStart: () => Date.now(),
      save: () => {},
      renderHeroCard: () => {},
      renderLocation: () => {},
      renderSodBtn: () => {},
      renderEodBtn: () => {},
      renderEodReminder: () => {},
      updateTimerBar: () => {},
      updateTimerBtn: () => {},
      renderQuickPick: () => {},
      renderPlan: () => {},
      renderPlanReviewReminder: () => {},
      renderCompleted: () => {},
      renderTodayFlow: () => {},
      renderTrackers: () => {},
      document: {
        getElementById,
        querySelectorAll: () => [],
      },
      ...overrides,
      _elements: elements,
    };
    vm.createContext(sb);
    vm.runInContext(renderSrc, sb);
    return sb;
  }

  it('binds a click handler on #tlAdHocBtn when the viewed day has zero entries', () => {
    const sb = makeRenderSandbox();
    vm.runInContext('render();', sb);

    const btn = sb._elements['tlAdHocBtn'];
    const clickHandlers = (btn && btn._listeners.click) || [];
    assert.equal(
      clickHandlers.length,
      1,
      'render() must call bindAdHocRow() on the empty-state branch, not just the entry-list branch'
    );
  });

  it('committing the ad-hoc row on a zero-entry day adds the entry', () => {
    const sb = makeRenderSandbox();
    vm.runInContext('render();', sb);

    // Swap the real render() for a spy before triggering the click, so the
    // commit flow's own render() call (which would take the non-empty
    // branch, requiring a much larger DOM/entry-row stub surface) doesn't
    // need to be modelled here — this test only asserts the commit itself.
    sb.render = () => {
      sb._rerenderCount = (sb._rerenderCount || 0) + 1;
    };

    const input = sb._elements['tlAdHocInput'];
    const btn = sb._elements['tlAdHocBtn'];
    input.value = 'new task';
    btn._listeners.click[0]();

    assert.equal(sb.entries.length, 1, 'clicking + log should commit the ad-hoc entry');
    assert.equal(sb.entries[0].text, 'new task');
    assert.equal(sb._rerenderCount, 1, 'commitAdHoc should re-render after saving');
  });

  it('pressing Enter in #tlAdHocInput also commits the entry on a zero-entry day', () => {
    const sb = makeRenderSandbox();
    vm.runInContext('render();', sb);
    sb.render = () => {};

    const input = sb._elements['tlAdHocInput'];
    input.value = 'entered via keyboard';
    const keydownHandlers = input._listeners.keydown || [];
    keydownHandlers.forEach((handler) => handler({ key: 'Enter', code: 'Enter' }));

    assert.equal(sb.entries.length, 1);
    assert.equal(sb.entries[0].text, 'entered via keyboard');
  });

  it('does not throw and leaves entries untouched when the input is empty', () => {
    const sb = makeRenderSandbox();
    vm.runInContext('render();', sb);
    sb.render = () => {};

    const btn = sb._elements['tlAdHocBtn'];
    btn._listeners.click[0]();

    assert.equal(sb.entries.length, 0);
  });
});

describe('regression: non-billable relabeled as "internal"', () => {
  const tasksRowSrc = readFileSync(join(__dirname, '../../src/js/10a-tasks-row.js'), 'utf8');

  function loadTasksRowSandbox() {
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(tasksRowSrc, sb);
    return sb;
  }

  it('billBtnHtml titles a billable task row "mark internal"', () => {
    const sb = loadTasksRowSandbox();
    const html = sb.billBtnHtml({ id: '1', billable: true }, 'inprogress');
    assert.match(html, /title="mark internal"/);
    assert.doesNotMatch(html, /non-billable/);
  });

  it('billBtnHtml titles an internal (billable:false) task row "mark billable"', () => {
    const sb = loadTasksRowSandbox();
    const html = sb.billBtnHtml({ id: '1', billable: false }, 'inprogress');
    assert.match(html, /title="mark billable"/);
  });

  it('the entry-row toggle, category-manager button, and export summary all say "internal", not "non-billable"', () => {
    // Checks the specific literals this PR changed — NOT a blanket absence of
    // "non-billable" in these files, since 02-utils.js still legitimately uses
    // that word in developer comments describing the underlying boolean
    // (e.g. "Non-billable entries keep their exact timestamps…"), which is
    // accurate and was intentionally left as-is; only the UI-facing copy moved.
    //
    // This used to also check the chart legend's "mixed billable/internal" /
    // "internal">💸 titles, but that markup lived entirely inside
    // renderChart()'s dead body — unreachable ever since the standalone
    // #chart element was removed (see CLAUDE.md's June 2026 architecture
    // note) — and was deleted along with the rest of that body when
    // 04-render.js was split (QA finding: module size). Nothing renders it
    // any more, so there's nothing left to assert here.
    const utilsSrcCheck = readFileSync(join(__dirname, '../../src/js/02-utils.js'), 'utf8');
    const renderSrcCheck = loadRenderScriptSource();
    const exportSrcCheck = readFileSync(join(__dirname, '../../src/js/05a-export.js'), 'utf8');

    assert.match(utilsSrcCheck, /💸 internal/);
    assert.doesNotMatch(utilsSrcCheck, /💸 non-billable/);

    assert.match(renderSrcCheck, /title="toggle billable\/internal"/);
    assert.doesNotMatch(renderSrcCheck, /title="[^"]*non-billable/);

    assert.match(exportSrcCheck, /💸 Internal:/);
    assert.doesNotMatch(exportSrcCheck, /💸 Non-billable/);
  });
});
