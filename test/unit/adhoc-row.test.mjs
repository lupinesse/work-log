/**
 * @file adhoc-row.test.mjs
 * jsdom coverage for bindAdHocRow() in 04c-render-timeline.js: Enter commits the
 * typed entry, and Space must not bubble out to the rapid-log shortcut (#525).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { __dirname, createDom } from './_helpers.mjs';

const timelineSrc = readFileSync(join(__dirname, '../../src/js/04c-render-timeline.js'), 'utf8');

const MARKUP = '<button id="tlAdHocBtn">add</button><input id="tlAdHocInput" />';

const STUBS = `
  var pushedEntries = [];
  var saveCalls = 0;
  var renderCalls = 0;
  var selectedTag = 'work';
  var getCategories = () => [{ id: 'work' }];
  var getEntries = () => pushedEntries;
  var safeRoundedStart = () => 1000;
  var dk = () => '2026-10-01';
  var save = () => { saveCalls += 1; };
  var render = () => { renderCalls += 1; };
`;

describe('bindAdHocRow keyboard handling (jsdom)', () => {
  let dom;
  let input;

  const press = (init) =>
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, ...init }));
  const read = (name) => vm.runInContext(name, dom.getInternalVMContext());

  beforeEach(() => {
    dom = createDom(MARKUP);
    const context = dom.getInternalVMContext();
    vm.runInContext(STUBS, context);
    vm.runInContext(timelineSrc, context);
    vm.runInContext('bindAdHocRow()', context);
    input = dom.window.document.getElementById('tlAdHocInput');
  });

  afterEach(() => dom.window.close());

  it('commits the typed text as a new entry on Enter', () => {
    input.value = '  write tests ';
    press({ key: 'Enter' });
    assert.equal(read('pushedEntries.length'), 1);
    assert.equal(read('pushedEntries[0].text'), 'write tests');
    assert.equal(read('saveCalls'), 1);
    assert.equal(read('renderCalls'), 1);
  });

  it('does not commit empty text on Enter', () => {
    input.value = '   ';
    press({ key: 'Enter' });
    assert.equal(read('pushedEntries.length'), 0);
  });

  it('stops Space from bubbling to document-level shortcuts', () => {
    let reachedDocument = false;
    dom.window.document.addEventListener('keydown', () => (reachedDocument = true));
    press({ key: ' ', code: 'Space' });
    assert.equal(reachedDocument, false);
  });

  it('lets other keys bubble normally', () => {
    let reachedDocument = false;
    dom.window.document.addEventListener('keydown', () => (reachedDocument = true));
    press({ key: 'a', code: 'KeyA' });
    assert.equal(reachedDocument, true);
  });
});
