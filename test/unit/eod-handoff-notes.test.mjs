/**
 * @file eod-handoff-notes.test.mjs
 * jsdom coverage for saveEodHandoffNotes() / parseHandoffNotes() in
 * 12a-changelog.js: task names come from DOM attributes, so keys such as
 * `__proto__` must be stored as plain own keys and never reach
 * Object.prototype (#484 review).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { __dirname, createDom, assertNoUncaughtErrors } from './_helpers.mjs';

const changelogSrc = readFileSync(join(__dirname, '../../src/js/12a-changelog.js'), 'utf8');

const BOUND_IDS = [
  'eodBtn',
  'expiryBtn',
  'expirySave',
  'expiryCancel',
  'expiryOverlay',
  'expiryTextarea',
  'eodClose',
  'eodOverlay',
];
const TASK_NAMES = ['__proto__', 'constructor', 'ordinary task'];

const noteValueFor = (values, name) =>
  // eslint-disable-next-line security/detect-object-injection -- fixture: name is from the literal TASK_NAMES list and guarded by Object.hasOwn
  Object.hasOwn(values, name) ? values[name] : '';

const markupFor = (values) =>
  BOUND_IDS.map((id) => `<div id="${id}"></div>`).join('') +
  TASK_NAMES.map(
    (name) =>
      `<input class="eod-task-note-input" data-task="${name}" value="${noteValueFor(values, name)}" />`
  ).join('');

describe('EOD handoff notes (jsdom)', () => {
  let dom;
  let storage;

  const load = (values, stored) => {
    dom = createDom(markupFor(values));
    const context = dom.getInternalVMContext();
    storage = new Map(stored === undefined ? [] : [['wl_handoff', stored]]);
    // jsdom without a URL has no localStorage, so a Map-backed stand-in is defined.
    Object.defineProperty(context, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
      },
    });
    vm.runInContext(
      'var STORE_DEV_LOG = "x"; var wlLog = { warn() {} }; var openExpiryModal = () => {}; var saveExpiryDates = () => {};',
      context
    );
    vm.runInContext(changelogSrc, context);
  };
  const save = () => vm.runInContext('saveEodHandoffNotes', dom.getInternalVMContext())();
  const stored = () => JSON.parse(storage.get('wl_handoff'));

  afterEach(() => {
    assertNoUncaughtErrors(dom);
    dom.window.close();
  });

  it('stores __proto__ and constructor tasks as own keys without polluting Object.prototype (regression)', () => {
    load(
      Object.fromEntries([
        ['__proto__', 'a note'],
        ['constructor', 'b note'],
        ['ordinary task', 'c note'],
      ])
    );
    save();
    const notes = stored();
    assert.deepEqual(Object.keys(notes).sort(), ['__proto__', 'constructor', 'ordinary task']);
    assert.equal(Object.getOwnPropertyDescriptor(notes, '__proto__').value, 'a note');
    assert.equal(notes.constructor, 'b note');
    const protoIntact = vm.runInContext(
      'Object.keys(Object.prototype).length === 0 && ({}).constructor === Object',
      dom.getInternalVMContext()
    );
    assert.ok(protoIntact, 'the page realm Object.prototype is untouched');
  });

  it('removes a note when its input is emptied', () => {
    load({ 'ordinary task': '' }, JSON.stringify({ 'ordinary task': 'old', other: 'keep' }));
    save();
    assert.deepEqual(stored(), { other: 'keep' });
  });

  for (const [label, existing] of [
    ['an array', '[1,2]'],
    ['a string', '"text"'],
    ['null', 'null'],
    ['a number', '5'],
  ]) {
    it(`loads an existing wl_handoff value that is ${label} without throwing`, () => {
      load({ 'ordinary task': 'fresh' }, existing);
      save();
      assert.deepEqual(stored(), { 'ordinary task': 'fresh' });
    });
  }

  it('preserves existing notes for other tasks', () => {
    load({ 'ordinary task': 'fresh' }, JSON.stringify({ other: 'keep' }));
    save();
    assert.deepEqual(stored(), { other: 'keep', 'ordinary task': 'fresh' });
  });
});
