/**
 * @file calendar-strip.test.mjs
 * jsdom coverage for renderCalStrip() in 13-calendar.js: the collapse state is
 * restored once, the header click is bound once, and neither is tracked as an
 * expando property on a DOM node (#508).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { __dirname, createDom, assertNoUncaughtErrors } from './_helpers.mjs';

const calendarSrc = readFileSync(join(__dirname, '../../src/js/13-calendar.js'), 'utf8');

const MARKUP = `
  <section id="calSection">
    <div id="calHeader">Meetings</div>
    <span id="calCount"></span><span id="calNextInfo"></span>
    <div id="calMeetings"></div>
  </section>`;

const STUBS = `
  var wlLog = { warn() {}, info() {}, error() {}, debug() {} };
  var dk = () => '2026-10-01';
  var escHtml = (text) => String(text);
  var fmtDur = () => '30m';
  var CAL_ACCOUNT_LABELS = {};
  var readCollapseState = () => true;
  var writeCollapseState = () => {};
  var loadParked = () => {};
  var renderParked = () => {};
`;

describe('renderCalStrip collapse and header binding (jsdom)', () => {
  let dom;
  let section;
  const meeting = {
    subject: 'Standup',
    start: '2099-01-01T09:00:00',
    end: '2099-01-01T09:30:00',
    account: '',
  };

  const render = () => vm.runInContext('renderCalStrip', dom.getInternalVMContext())([meeting]);

  beforeEach(() => {
    dom = createDom(MARKUP);
    section = dom.window.document.getElementById('calSection');
    const context = dom.getInternalVMContext();
    vm.runInContext(STUBS, context);
    vm.runInContext(calendarSrc, context);
  });

  afterEach(() => {
    assertNoUncaughtErrors(dom);
    dom.window.close();
  });

  it('restores the stored collapse state on first render only', () => {
    render();
    assert.equal(section.classList.contains('collapsed'), true, 'stored state applied');
    section.classList.remove('collapsed'); // the user expands it
    render();
    assert.equal(section.classList.contains('collapsed'), false, 're-render must not re-collapse');
  });

  it('binds the header click once across re-renders', () => {
    render();
    render();
    dom.window.document.getElementById('calHeader').click();
    assert.equal(section.classList.contains('collapsed'), false, 'one click toggles exactly once');
  });

  it('keeps setup flags off the DOM nodes (regression, #508)', () => {
    render();
    assert.equal('_collapseRestored' in section, false);
    assert.equal('_calBound' in dom.window.document.getElementById('calHeader'), false);
  });
});

describe('calAccountLabel prototype-safety (jsdom)', () => {
  let dom;

  beforeEach(() => {
    dom = createDom(MARKUP);
    vm.runInContext(STUBS, dom.getInternalVMContext());
    vm.runInContext(calendarSrc, dom.getInternalVMContext());
    vm.runInContext('CAL_ACCOUNT_LABELS = { acme: "Acme Corp" };', dom.getInternalVMContext());
  });

  afterEach(() => {
    assertNoUncaughtErrors(dom);
    dom.window.close();
  });

  const labelFor = (account) =>
    vm.runInContext('calAccountLabel', dom.getInternalVMContext())(account);

  it('resolves a configured email domain to its label', () => {
    assert.equal(labelFor('me@acme.com'), 'Acme Corp');
  });

  it('does not resolve an email domain named after an Object.prototype member (regression)', () => {
    assert.equal(labelFor('me@constructor.com'), null);
    assert.equal(labelFor('me@toString.com'), null);
  });
});
