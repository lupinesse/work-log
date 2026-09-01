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
        _classes: new Set(),
        classList: {
          add: (cls) => elements.get(id)._classes.add(cls),
          remove: (cls) => elements.get(id)._classes.delete(cls),
          contains: (cls) => elements.get(id)._classes.has(cls),
        },
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
    entries: [],
    // tidyStaleEpics() gates on confirm(); tests override these to drive the
    // accept / decline paths and to capture the message shown to the user.
    window: { confirm: () => true, alert: () => {} },
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

describe('deleteSelectedEpic — confirm before hard delete (regression)', () => {
  // Regression: catDelBtn used to hard-delete with zero confirmation, so one
  // misclick silently and permanently orphaned every log entry/task tagged
  // with that epic (they fall back to grey "other" forever, since delete —
  // unlike tidyStaleEpics()/archive — removes the record rather than flagging
  // it). These tests drive the real click handler end to end.

  it('deletes the selected epic when the user confirms, and resets selectedTag to work', () => {
    const saves = [];
    const sandbox = loadTagRowSandbox({
      categories: [
        { id: 'work', label: 'Work', color: '#378ADD' },
        { id: 'cat_x', label: 'AITO-111', color: '#E8A33D' },
      ],
      selectedTag: 'cat_x',
      save: () => saves.push(true),
      window: { confirm: () => true, alert: () => {} },
    });
    sandbox.renderTagRow();
    sandbox._elements.get('catDelBtn')._listeners.click();

    assert.equal(
      sandbox.categories.find((c) => c.id === 'cat_x'),
      undefined,
      'the category record is removed entirely'
    );
    assert.equal(sandbox.selectedTag, 'work');
    assert.equal(saves.length, 1);
  });

  it('leaves the epic alone when the user declines the confirm', () => {
    const sandbox = loadTagRowSandbox({
      categories: [
        { id: 'work', label: 'Work', color: '#378ADD' },
        { id: 'cat_x', label: 'AITO-111', color: '#E8A33D' },
      ],
      selectedTag: 'cat_x',
      window: { confirm: () => false, alert: () => {} },
    });
    sandbox.renderTagRow();
    sandbox._elements.get('catDelBtn')._listeners.click();

    assert.ok(
      sandbox.categories.some((c) => c.id === 'cat_x'),
      'the epic still exists'
    );
    assert.equal(sandbox.selectedTag, 'cat_x', 'selection is untouched');
  });

  it('names the epic and counts affected entries/tasks in the confirm text', () => {
    let confirmText = '';
    const sandbox = loadTagRowSandbox({
      categories: [
        { id: 'work', label: 'Work', color: '#378ADD' },
        { id: 'cat_x', label: 'AITO-111', color: '#E8A33D' },
      ],
      selectedTag: 'cat_x',
      entries: [
        { id: 'e1', tag: 'cat_x', date: '2026-08-10' },
        { id: 'e2', tag: 'cat_x', date: '2026-08-11' },
        { id: 'e3', tag: 'work', date: '2026-08-11' },
      ],
      planTasks: [{ id: 't1', tag: 'cat_x', status: 'todo', date: '2026-08-11' }],
      window: {
        confirm: (msg) => {
          confirmText = msg;
          return false;
        },
        alert: () => {},
      },
    });
    sandbox.renderTagRow();
    sandbox._elements.get('catDelBtn')._listeners.click();

    assert.ok(confirmText.includes('AITO-111'), 'names the epic being deleted');
    assert.ok(confirmText.includes('3 log entr'), 'counts 2 entries + 1 task as 3');
    assert.ok(/cannot be undone/i.test(confirmText));
  });

  it('says an unused epic has no entries or tasks, rather than "0 log entries"', () => {
    let confirmText = '';
    const sandbox = loadTagRowSandbox({
      categories: [
        { id: 'work', label: 'Work', color: '#378ADD' },
        { id: 'cat_x', label: 'AITO-111', color: '#E8A33D' },
      ],
      selectedTag: 'cat_x',
      window: {
        confirm: (msg) => {
          confirmText = msg;
          return false;
        },
        alert: () => {},
      },
    });
    sandbox.renderTagRow();
    sandbox._elements.get('catDelBtn')._listeners.click();

    assert.ok(confirmText.includes('no log entries or tasks'));
  });

  it('refuses to delete a built-in epic, even if somehow selected', () => {
    const saves = [];
    const alerts = [];
    const sandbox = loadTagRowSandbox({
      categories: [{ id: 'work', label: 'Work', color: '#378ADD' }],
      selectedTag: 'work',
      save: () => saves.push(true),
      window: { confirm: () => true, alert: (msg) => alerts.push(msg) },
    });
    sandbox.renderTagRow();
    sandbox._elements.get('catDelBtn')._listeners.click();

    assert.ok(
      sandbox.categories.some((c) => c.id === 'work'),
      'work is never removed'
    );
    assert.equal(saves.length, 0, 'nothing is persisted');
    assert.equal(
      alerts.length,
      1,
      'the user is told why, rather than the click doing nothing visible'
    );
    assert.ok(alerts[0].includes('Work'));
  });
});
describe('epics modal — archive and restore', () => {
  const STALE = { id: 'cat_stale', label: 'AITO-111: Old epic', color: '#E8A33D' };
  const FRESH = { id: 'cat_fresh', label: 'AITO-222: Live epic', color: '#1D9E75' };

  // Local noon, so dk() — which reads local calendar components — reports
  // 2026-08-21 in every timezone the suite might run in.
  const TODAY_MS = new Date(2026, 7, 21, 12, 0, 0).getTime();

  /**
   * Builds a `Date` replacement whose argument-less form is pinned to
   * `fixedMs`, leaving `new Date(value)` and the static helpers untouched so
   * the cutoff arithmetic in pure-fns-epics.js still works.
   *
   * The code under test runs in its own realm (`vm.createContext`), and
   * `mock.timers` patches only the test realm's globals — so it never reached
   * the sandbox and `tidyStaleEpics()` silently read the real clock. Injecting
   * the clock as a sandbox global is what actually pins it (regression: the
   * suite passed only on 2026-08-21, the day it was written).
   * @param {number} fixedMs - The instant to report as "now", in epoch ms.
   * @returns {typeof Date} A Date subclass to install as the sandbox's `Date`.
   */
  function fixedDateAt(fixedMs) {
    return class FixedDate extends Date {
      constructor(...args) {
        if (args.length === 0) super(fixedMs);
        else super(...args);
      }

      static now() {
        return fixedMs;
      }
    };
  }

  /**
   * Builds a sandbox holding one built-in, one recently used and one long-idle
   * epic, with today pinned inside the sandbox realm so the 21-day window is
   * deterministic. The epics modal is wired up ready to drive.
   * @param {Object} [overrides] - Extra sandbox properties.
   * @returns {Object} The populated sandbox.
   */
  function staleSandbox(overrides = {}) {
    const sandbox = loadTagRowSandbox({
      Date: fixedDateAt(TODAY_MS),
      categories: [{ id: 'work', label: 'Work', color: '#378ADD' }, { ...FRESH }, { ...STALE }],
      entries: [{ id: 'e1', text: 'live work', tag: FRESH.id, date: '2026-08-20' }],
      planTasks: [],
      ...overrides,
    });
    sandbox.bindEpicsManager();
    return sandbox;
  }

  /**
   * Builds a sandbox whose only non-built-in epic is already archived, with
   * the modal wired and opened so its restore rows are rendered.
   * @param {Object} [overrides] - Extra sandbox properties.
   * @returns {Object} The populated sandbox.
   */
  function archivedSandbox(overrides = {}) {
    const sandbox = loadTagRowSandbox({
      categories: [
        { id: 'work', label: 'Work', color: '#378ADD' },
        { ...STALE, archived: true },
      ],
      ...overrides,
    });
    sandbox.bindEpicsManager();
    sandbox._elements.get('epicsBtn')._listeners.click();
    return sandbox;
  }

  it('omits an archived epic from the dropdown but keeps it resolvable for history', () => {
    const sandbox = loadTagRowSandbox({
      categories: [
        { id: 'work', label: 'Work', color: '#378ADD' },
        { ...STALE, archived: true },
      ],
    });
    sandbox.renderTagRow();
    const html = sandbox._elements.get('tagRow').innerHTML;
    assert.ok(!html.includes('AITO-111'), 'archived epic is not offered in the picker');
    assert.equal(
      sandbox.getCatLabel(STALE.id),
      STALE.label,
      'label still resolves for old entries'
    );
    assert.equal(sandbox.getCatColor(STALE.id), STALE.color, 'colour still resolves too');
  });

  it('keeps the selected epic in the dropdown even once archived', () => {
    const sandbox = loadTagRowSandbox({
      categories: [
        { id: 'work', label: 'Work', color: '#378ADD' },
        { ...STALE, archived: true },
      ],
      selectedTag: STALE.id,
    });
    sandbox.renderTagRow();
    assert.ok(sandbox._elements.get('tagRow').innerHTML.includes('AITO-111'));
  });

  it('opens the modal and lists each archived epic with a restore button', () => {
    const sandbox = archivedSandbox();
    assert.ok(sandbox._elements.get('epicsOverlay')._classes.has('show'), 'the overlay is shown');
    const html = sandbox._elements.get('epicsManagerBody').innerHTML;
    assert.ok(html.includes('AITO-111'), 'the archived epic is listed');
    assert.ok(html.includes('id="epicRestore-0"'), 'it has an index-keyed restore button');
  });

  it('shows an empty state when no epic is archived', () => {
    const sandbox = loadTagRowSandbox();
    sandbox.bindEpicsManager();
    sandbox._elements.get('epicsBtn')._listeners.click();
    assert.ok(sandbox._elements.get('epicsManagerBody').innerHTML.includes('No archived epics'));
  });

  it('escapes an archived epic label instead of rendering it as markup', () => {
    const sandbox = archivedSandbox({
      categories: [
        { id: 'work', label: 'Work', color: '#378ADD' },
        { id: 'cat_x', label: '"><img src=x onerror=alert(1)>', color: '#E8A33D', archived: true },
      ],
    });
    const html = sandbox._elements.get('epicsManagerBody').innerHTML;
    assert.ok(!html.includes('<img'), 'the label never reaches the markup as a tag');
    assert.ok(html.includes('&lt;img'), 'it is escaped instead');
  });

  it('archives only the idle epic when tidy is confirmed', () => {
    const saves = [];
    const sandbox = staleSandbox({ save: () => saves.push(true) });
    sandbox._elements.get('epicsTidyBtn')._listeners.click();

    const byId = Object.fromEntries(sandbox.categories.map((c) => [c.id, c]));
    assert.equal(byId[STALE.id].archived, true, 'idle epic is archived');
    assert.equal(byId[FRESH.id].archived, undefined, 'recently used epic is untouched');
    assert.equal(byId.work.archived, undefined, 'built-in epic is never archived');
    assert.equal(sandbox.categories.length, 3, 'no record is deleted');
    assert.equal(saves.length, 1, 'the change is persisted once');
  });

  it('leaves every epic alone when the user declines the confirm', () => {
    const sandbox = staleSandbox({ window: { confirm: () => false, alert: () => {} } });
    sandbox._elements.get('epicsTidyBtn')._listeners.click();
    assert.ok(sandbox.categories.every((c) => !c.archived));
  });

  it('alerts instead of archiving when nothing is stale', () => {
    const alerts = [];
    const sandbox = staleSandbox({
      categories: [{ id: 'work', label: 'Work', color: '#378ADD' }, { ...FRESH }],
      window: { confirm: () => true, alert: (msg) => alerts.push(msg) },
    });
    sandbox._elements.get('epicsTidyBtn')._listeners.click();
    assert.equal(alerts.length, 1);
    assert.ok(alerts[0].includes('2026-08-01'), 'the alert names the cutoff date');
    assert.ok(sandbox.categories.every((c) => !c.archived));
  });

  it('restores an archived epic back into the pickers', () => {
    const saves = [];
    const sandbox = archivedSandbox({ save: () => saves.push(true) });
    sandbox._elements.get('epicRestore-0')._listeners.click();

    const restored = sandbox.categories.find((c) => c.id === STALE.id);
    assert.equal('archived' in restored, false, 'the archived flag is cleared');
    assert.equal(saves.length, 1, 'the restore is persisted');
    sandbox.renderTagRow();
    assert.ok(
      sandbox._elements.get('tagRow').innerHTML.includes('AITO-111'),
      'the epic is offered in the picker again'
    );
  });

  it('archived epics stay out of the pickers until restored (round trip)', () => {
    const sandbox = staleSandbox();
    sandbox._elements.get('epicsTidyBtn')._listeners.click();
    sandbox.renderTagRow();
    assert.ok(!sandbox._elements.get('tagRow').innerHTML.includes('AITO-111'));

    sandbox._elements.get('epicRestore-0')._listeners.click();
    sandbox.renderTagRow();
    assert.ok(sandbox._elements.get('tagRow').innerHTML.includes('AITO-111'));
  });
});

describe('epics modal — dismissal', () => {
  const STALE = { id: 'cat_stale', label: 'AITO-111: Old epic', color: '#E8A33D' };

  /**
   * Builds a sandbox with one archived epic, the modal wired and opened, and
   * focus calls on the open button recorded so the tests can assert that
   * dismissal hands focus back.
   * @returns {{sandbox: Object, focusCalls: number[]}} The sandbox and a
   *   one-element counter array holding how many times #epicsBtn was focused.
   */
  function openedSandbox() {
    const sandbox = loadTagRowSandbox({
      categories: [
        { id: 'work', label: 'Work', color: '#378ADD' },
        { ...STALE, archived: true },
      ],
    });
    sandbox.bindEpicsManager();
    const openBtn = sandbox._elements.get('epicsBtn');
    const focusCalls = [0];
    openBtn.focus = () => {
      focusCalls[0] += 1;
    };
    openBtn._listeners.click();
    return { sandbox, focusCalls };
  }

  it('closes on the Close button and returns focus to the toolbar button', () => {
    const { sandbox, focusCalls } = openedSandbox();
    assert.ok(sandbox._elements.get('epicsOverlay')._classes.has('show'));

    sandbox._elements.get('epicsClose')._listeners.click();
    assert.ok(!sandbox._elements.get('epicsOverlay')._classes.has('show'), 'the overlay is hidden');
    assert.equal(focusCalls[0], 1, 'focus returns to the button that opened it');
  });

  it('closes on Escape', () => {
    const { sandbox, focusCalls } = openedSandbox();
    sandbox._elements.get('epicsOverlay')._listeners.keydown({ key: 'Escape' });
    assert.ok(!sandbox._elements.get('epicsOverlay')._classes.has('show'));
    assert.equal(focusCalls[0], 1);
  });

  it('ignores other keys', () => {
    const { sandbox } = openedSandbox();
    sandbox._elements.get('epicsOverlay')._listeners.keydown({ key: 'a' });
    assert.ok(sandbox._elements.get('epicsOverlay')._classes.has('show'), 'still open');
  });

  it('closes on a backdrop click but not on a click inside the modal', () => {
    const { sandbox } = openedSandbox();
    const overlay = sandbox._elements.get('epicsOverlay');

    overlay._listeners.click({ target: sandbox._elements.get('epicsManagerBody') });
    assert.ok(overlay._classes.has('show'), 'a click inside the modal does not dismiss it');

    overlay._listeners.click({ target: overlay });
    assert.ok(!overlay._classes.has('show'), 'a click on the backdrop dismisses it');
  });
});

describe('buildTagRowHtml / bindTagRowEvents — markup and wiring are separable', () => {
  it('buildTagRowHtml() returns the row markup without touching the DOM', () => {
    const sandbox = loadTagRowSandbox();
    const html = sandbox.buildTagRowHtml();

    assert.match(html, /id="catSelect"/);
    assert.match(html, /id="catManageRow"/);
    assert.equal(
      sandbox._elements.size,
      0,
      'building markup must not resolve or mutate any element'
    );
  });

  it('renderTagRow() assigns exactly what buildTagRowHtml() produced', () => {
    const sandbox = loadTagRowSandbox();
    const built = sandbox.buildTagRowHtml();
    sandbox.renderTagRow();

    assert.equal(sandbox._elements.get('tagRow').innerHTML, built);
  });

  it('buildManageRowHtml() renders each inline mode from the module-level flags', () => {
    const sandbox = loadTagRowSandbox();
    const selCat = sandbox.getCat('work');

    // Idle: the button strip, and no inline editor.
    const idle = sandbox.buildManageRowHtml(selCat);
    assert.match(idle, /id="catRenBtn"/);
    assert.equal(idle.includes('id="catEditInput"'), false);

    // Archive/restore moved to the epics modal in #385, so the manage row must
    // no longer offer them — this is the regression guard for that boundary.
    assert.equal(idle.includes('id="catTidyBtn"'), false);
    assert.equal(idle.includes('id="catRestoreBtn"'), false);
  });

  it('bindTagRowEvents() runs standalone, without renderTagRow() having built the row', () => {
    const sandbox = loadTagRowSandbox();
    // This sandbox's getElementById auto-creates any id on demand, so the point
    // here is only that the binder no longer depends on the builder having run
    // first - not that the markup exists. Whether the two halves still agree on
    // ids is what the suites above cover, since those drive the real handlers
    // through rendered markup.
    sandbox.bindTagRowEvents();

    assert.ok(sandbox._elements.get('catSelect')._listeners.change, 'select change is wired');
    assert.ok(sandbox._elements.get('catSettingsBtn')._listeners.click, 'settings click is wired');
  });
});
