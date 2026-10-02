/**
 * @file a11y-button-names.test.mjs
 * Regression tests for #598 groups A and D (WCAG 4.1.2 Name, Role, Value /
 * 2.4.6 Headings and Labels): glyph-only or repeated-text buttons on planned
 * time blocks, in the emoji picker and in the meeting strip must expose an
 * accessible name that says what they act on. The builders are cut out of the
 * real source so the tests follow it.
 *
 * Run: node --test test/unit/a11y-button-names.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import { escHtml } from '../../src/js/pure-fns-format.js';
import { __dirname, createDom, extractFunctionSource } from './_helpers.mjs';

const readSource = (file) => readFileSync(join(__dirname, '../../src/js', file), 'utf8');

/**
 * Evaluates one function from a source file inside a jsdom window.
 * @param {string} file - File name under src/js/.
 * @param {string} functionName - Function to cut out and load.
 * @returns {{ window: Window, run: Function }} The window and the loaded function.
 */
function loadFunction(file, functionName) {
  const dom = createDom();
  const context = dom.getInternalVMContext();
  dom.window.escHtml = escHtml;
  vm.runInContext(extractFunctionSource(readSource(file), functionName), context);
  return { window: dom.window, run: dom.window[functionName] };
}

/**
 * Parses an HTML fragment into a container element.
 * @param {Window} window - The jsdom window.
 * @param {string} html - Markup to parse.
 * @returns {HTMLElement} A div holding the parsed nodes.
 */
function parse(window, html) {
  const container = window.document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('buildBlockActionButtonsHtml() names every block button after its block', () => {
  const { window, run } = loadFunction('11a-timeblock-render.js', 'buildBlockActionButtonsHtml');
  const buttonsFor = (block) => parse(window, run(block));

  const labelCases = [
    [
      'start',
      '.tb-block-start',
      { id: 'b1', text: 'Write report' },
      'Start tracking: Write report',
    ],
    ['delete', '.tb-block-del', { id: 'b1', text: 'Write report' }, 'Delete block: Write report'],
    ['add emoji', '.tb-block-emoji', { id: 'b1', text: 'Write report' }, 'Add emoji: Write report'],
    [
      'change emoji',
      '.tb-block-emoji',
      { id: 'b1', text: 'Write report', emoji: '🚀' },
      'Change emoji: Write report',
    ],
  ];
  for (const [name, selector, block, expected] of labelCases) {
    it(`${name} button is labelled "${expected}"`, () => {
      const button = buttonsFor(block).querySelector(selector);
      assert.equal(button.getAttribute('aria-label'), expected);
    });
  }

  it('gives two different blocks different button names (regression: identical names)', () => {
    const first = buttonsFor({ id: 'a', text: 'Plan sprint' }).querySelector('.tb-block-del');
    const second = buttonsFor({ id: 'b', text: 'Review PRs' }).querySelector('.tb-block-del');
    assert.notEqual(first.getAttribute('aria-label'), second.getAttribute('aria-label'));
  });

  it('omits the start button on meeting blocks', () => {
    const buttons = buttonsFor({ id: 'm1', text: 'Standup', type: 'meeting' });
    assert.equal(buttons.querySelector('.tb-block-start'), null);
    assert.ok(buttons.querySelector('.tb-block-del'));
  });

  it('keeps the label intact when the block text contains quotes and markup', () => {
    const text = 'Fix "login" <b>bug</b>';
    const button = buttonsFor({ id: 'b1', text }).querySelector('.tb-block-del');
    assert.equal(button.getAttribute('aria-label'), `Delete block: ${text}`);
    assert.equal(button.getAttributeNames().includes('b'), false);
  });

  it('keeps data-bid and draggable="false" so the drag handlers still ignore the buttons', () => {
    const buttons = buttonsFor({ id: 'b9', text: 'Task' }).querySelectorAll('button');
    assert.equal(buttons.length, 3);
    for (const button of buttons) {
      assert.equal(button.dataset.bid, 'b9');
      assert.equal(button.getAttribute('draggable'), 'false');
    }
  });
});

describe('buildMeetingButtonsHtml() names both meeting buttons after the meeting', () => {
  const { window, run } = loadFunction('13-calendar.js', 'buildMeetingButtonsHtml');

  it('labels the start and hide buttons with the subject', () => {
    const { taskBtn, deleteBtn } = run({ subject: 'Design sync' }, 3);
    assert.equal(
      parse(window, taskBtn).querySelector('button').getAttribute('aria-label'),
      'Start tracking: Design sync'
    );
    assert.equal(
      parse(window, deleteBtn).querySelector('button').getAttribute('aria-label'),
      'Hide meeting: Design sync'
    );
  });

  it('keeps the hooks the click handlers read (data-subject, data-meeting-idx, title)', () => {
    const { taskBtn, deleteBtn } = run({ subject: 'Design sync' }, 3);
    assert.equal(parse(window, taskBtn).querySelector('button').dataset.subject, 'Design sync');
    const hide = parse(window, deleteBtn).querySelector('button');
    assert.equal(hide.dataset.meetingIdx, '3');
    assert.equal(hide.getAttribute('title'), 'Hide this meeting');
  });

  it('escapes a subject containing a quote so the attribute is not cut short', () => {
    const subject = 'Q3 "planning" & <review>';
    const { taskBtn } = run({ subject }, 0);
    const button = parse(window, taskBtn).querySelector('button');
    assert.equal(button.getAttribute('aria-label'), `Start tracking: ${subject}`);
    assert.equal(button.dataset.subject, subject);
  });
});

describe('createEmojiOptionButton() builds a labelled, non-submitting button', () => {
  const { window, run } = loadFunction('11-timeblock.js', 'createEmojiOptionButton');

  it('shows the emoji and names it "Select <emoji>"', () => {
    const button = run('😀', () => {});
    assert.equal(button.textContent, '😀');
    assert.equal(button.getAttribute('aria-label'), 'Select 😀');
  });

  it('is type="button" so it never submits a surrounding form', () => {
    assert.equal(run('😀', () => {}).type, 'button');
  });

  it('calls the handler once per click', () => {
    let calls = 0;
    const button = run('😀', () => {
      calls += 1;
    });
    button.dispatchEvent(new window.MouseEvent('click'));
    assert.equal(calls, 1);
  });
});
