/**
 * @file emoji-picker.test.mjs
 * Unit tests for the emoji picker dialog semantics (#598 follow-up, WCAG 4.1.2
 * and WCAG 2.1.2): the picker must carry dialog ARIA attributes, trap Tab focus
 * inside itself, return focus to the trigger on Escape, and return focus after
 * setBlockEmoji() re-renders the grid. The relevant functions are cut out of
 * the real source so the tests follow it.
 *
 * Run: node --test test/unit/emoji-picker.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import {
  __dirname,
  createDom,
  extractFunctionSource,
  stubOffsetParent,
  withStateAccessors,
} from './_helpers.mjs';

const readSource = (file) => readFileSync(join(__dirname, '../../src/js', file), 'utf8');
const timeblockSource = readSource('11-timeblock.js');
const focusUtilsSource = readSource('focus-utils.js');

const functionsFrom = (source, names) =>
  names.map((name) => extractFunctionSource(source, name)).join('\n');

/** Strips the ESM `export` keyword so the source runs in a classic-script VM. */
const stripExport = (source) => source.replace(/\bexport\s+function\b/g, 'function');

/** Minimal EMOJI_COMMON used in place of the real constant. */
const EMOJI_STUB = ['😀', '🚀', '✅'];

const BLOCK = { id: 'b1', slot: 6, duration: 2, text: 'Write report' };

/**
 * Loads the picker functions into a jsdom window with a minimal grid block.
 * The window has a `#tbGrid` div holding one `.tb-block.plan` with the default
 * block's `data-bid` and a `.tb-block-emoji` button.
 * @param {object} [options] - Scenario settings.
 * @param {Array<object>} [options.blocks] - Blocks in state.
 * @param {string} [options.renderResult] - What `renderTimeblock()` does (no-op by default).
 * @returns {{ dom, ctx, triggerEl, calls }}
 */
function loadPicker({ blocks = [{ ...BLOCK }] } = {}) {
  const dom = createDom(
    '<div id="tbGrid">' +
      '<div class="tb-block plan" data-bid="b1" tabindex="0">' +
      '<button class="tb-block-emoji" aria-expanded="false" data-bid="b1">✦</button>' +
      '</div>' +
      '</div>'
  );
  stubOffsetParent(dom.window);

  const ctx = dom.getInternalVMContext();
  withStateAccessors(ctx);
  ctx.blocks = blocks;
  ctx._emojiPickerPid = null;
  ctx.EMOJI_COMMON = EMOJI_STUB;
  ctx.wlLog = { warn: () => {} };
  ctx.saveBlocks = () => {};
  ctx.renderTimeblock = () => {};

  // Inject trapFocusInOverlay from focus-utils.js
  vm.runInContext(stripExport(focusUtilsSource), ctx);

  // Load the functions under test
  vm.runInContext(
    functionsFrom(timeblockSource, [
      'createEmojiOptionButton',
      'focusBlockEmojiButton',
      'openBlockEmojiPicker',
      'setBlockEmoji',
    ]),
    ctx
  );

  const triggerEl = dom.window.document.querySelector('[data-bid="b1"].tb-block-emoji');
  return { dom, ctx, triggerEl };
}

/**
 * Opens the picker for block b1 via `openBlockEmojiPicker` and returns the
 * picker element that was appended to document.body.
 * @param {object} ctx - The VM context with `openBlockEmojiPicker`.
 * @param {HTMLElement} triggerEl - The emoji trigger button.
 * @param {Document} document - The jsdom document.
 * @returns {HTMLElement} The picker element.
 */
function openPicker(ctx, triggerEl, document) {
  ctx.openBlockEmojiPicker('b1', triggerEl);
  return document.getElementById('__emojiPicker');
}

describe('emoji picker dialog attributes (WCAG 4.1.2)', () => {
  it('has role="dialog"', () => {
    const { dom, ctx, triggerEl } = loadPicker();
    const picker = openPicker(ctx, triggerEl, dom.window.document);
    assert.ok(picker, 'picker was created');
    assert.equal(picker.getAttribute('role'), 'dialog');
  });

  it('has aria-modal="true"', () => {
    const { dom, ctx, triggerEl } = loadPicker();
    const picker = openPicker(ctx, triggerEl, dom.window.document);
    assert.equal(picker.getAttribute('aria-modal'), 'true');
  });

  it('has a non-empty aria-label', () => {
    const { dom, ctx, triggerEl } = loadPicker();
    const picker = openPicker(ctx, triggerEl, dom.window.document);
    const label = picker.getAttribute('aria-label');
    assert.ok(label && label.length > 0, 'aria-label is present and non-empty');
  });

  it('clear button has type="button" (does not submit a form)', () => {
    const { dom, ctx, triggerEl } = loadPicker();
    const picker = openPicker(ctx, triggerEl, dom.window.document);
    const clear = picker.querySelector('.emoji-picker-clear');
    assert.equal(clear.type, 'button');
  });
});

describe('aria-expanded on the trigger (WCAG 4.1.2)', () => {
  it('sets aria-expanded="true" on the trigger when the picker opens', () => {
    const { ctx, triggerEl } = loadPicker();
    ctx.openBlockEmojiPicker('b1', triggerEl);
    assert.equal(triggerEl.getAttribute('aria-expanded'), 'true');
  });

  it('resets aria-expanded="false" when the same trigger closes the picker (toggle)', () => {
    const { ctx, triggerEl } = loadPicker();
    ctx.openBlockEmojiPicker('b1', triggerEl); // open
    ctx.openBlockEmojiPicker('b1', triggerEl); // toggle closed
    assert.equal(triggerEl.getAttribute('aria-expanded'), 'false');
  });
});

describe('Escape key closes the picker and returns focus (WCAG 2.1.2)', () => {
  /**
   * Dispatches a keydown event on `target` for the given key.
   * @param {object} dom - The jsdom instance.
   * @param {Element} target - Element to dispatch on.
   * @param {string} key - KeyboardEvent.key value.
   * @param {object} [modifiers] - Modifier flags.
   * @returns {boolean} True if preventDefault was called.
   */
  function press(dom, target, key, modifiers = {}) {
    const event = new dom.window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('removes the picker element on Escape', () => {
    const { dom, ctx, triggerEl } = loadPicker();
    const picker = openPicker(ctx, triggerEl, dom.window.document);
    press(dom, picker, 'Escape');
    assert.equal(dom.window.document.getElementById('__emojiPicker'), null);
  });

  it('resets aria-expanded="false" on the trigger on Escape', () => {
    const { dom, ctx, triggerEl } = loadPicker();
    const picker = openPicker(ctx, triggerEl, dom.window.document);
    press(dom, picker, 'Escape');
    assert.equal(triggerEl.getAttribute('aria-expanded'), 'false');
  });

  it('returns focus to the trigger on Escape', () => {
    const { dom, ctx, triggerEl } = loadPicker();
    const picker = openPicker(ctx, triggerEl, dom.window.document);
    press(dom, picker, 'Escape');
    assert.equal(dom.window.document.activeElement, triggerEl);
  });

  it('traps Tab inside the picker (forward wrap from last to first)', () => {
    const { dom, ctx, triggerEl } = loadPicker();
    const picker = openPicker(ctx, triggerEl, dom.window.document);
    const focusable = Array.from(picker.querySelectorAll('input, button')).filter(
      (el) => el.offsetParent !== null
    );
    const last = focusable[focusable.length - 1];
    last.focus();
    const claimed = press(dom, picker, 'Tab');
    assert.equal(claimed, true, 'Tab from last element was claimed (prevented)');
    assert.equal(dom.window.document.activeElement, focusable[0]);
  });

  it('traps Shift+Tab inside the picker (backward wrap from first to last)', () => {
    const { dom, ctx, triggerEl } = loadPicker();
    const picker = openPicker(ctx, triggerEl, dom.window.document);
    const focusable = Array.from(picker.querySelectorAll('input, button')).filter(
      (el) => el.offsetParent !== null
    );
    focusable[0].focus();
    const claimed = press(dom, picker, 'Tab', { shiftKey: true });
    assert.equal(claimed, true, 'Shift+Tab from first element was claimed (prevented)');
    assert.equal(dom.window.document.activeElement, focusable[focusable.length - 1]);
  });
});

describe('focusBlockEmojiButton() returns focus to the re-rendered trigger', () => {
  it('focuses the emoji button for the given block ID', () => {
    const { dom, ctx } = loadPicker();
    ctx.focusBlockEmojiButton('b1');
    const focused = dom.window.document.activeElement;
    assert.equal(focused.classList.contains('tb-block-emoji'), true);
    assert.equal(focused.dataset.bid, 'b1');
  });

  it('does nothing for an unknown block ID', () => {
    const { dom, ctx } = loadPicker();
    assert.doesNotThrow(() => ctx.focusBlockEmojiButton('missing'));
    assert.equal(dom.window.document.activeElement, dom.window.document.body);
  });

  it('finds an ID containing quotes without building a selector from it', () => {
    const { dom, ctx } = loadPicker();
    const grid = dom.window.document.getElementById('tbGrid');
    const oddBlock = dom.window.document.createElement('div');
    oddBlock.className = 'tb-block plan';
    oddBlock.dataset.bid = 'a"]b';
    const oddBtn = dom.window.document.createElement('button');
    oddBtn.className = 'tb-block-emoji';
    oddBtn.dataset.bid = 'a"]b';
    oddBlock.appendChild(oddBtn);
    grid.appendChild(oddBlock);
    ctx.focusBlockEmojiButton('a"]b');
    assert.equal(dom.window.document.activeElement, oddBtn);
  });
});

describe('openBlockEmojiPicker() with an invalid bid', () => {
  it('does not crash and does not create the picker when bid is not in blocks', () => {
    const { dom, ctx, triggerEl } = loadPicker();
    assert.doesNotThrow(() => ctx.openBlockEmojiPicker('nonexistent', triggerEl));
    assert.equal(dom.window.document.getElementById('__emojiPicker'), null);
    assert.equal(ctx._emojiPickerPid, null);
  });
});

describe('setBlockEmoji() returns focus to the trigger after re-rendering', () => {
  it('focuses the emoji trigger button after saving an emoji', () => {
    const { dom, ctx, triggerEl } = loadPicker();
    openPicker(ctx, triggerEl, dom.window.document);
    ctx.setBlockEmoji('b1', '🚀');
    assert.equal(dom.window.document.activeElement, triggerEl);
  });

  it('focuses the emoji trigger button after removing an emoji (null)', () => {
    const { dom, ctx, triggerEl } = loadPicker({ blocks: [{ ...BLOCK, emoji: '🚀' }] });
    openPicker(ctx, triggerEl, dom.window.document);
    ctx.setBlockEmoji('b1', null);
    assert.equal(dom.window.document.activeElement, triggerEl);
  });
});
