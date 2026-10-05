/**
 * @file timeblock-a11y.test.mjs
 * Regression tests for #598 Group B (WCAG 2.1.1 — keyboard-operable timeblock
 * moves). Group A (accessible button names) is covered by a11y-button-names.test.mjs
 * which tests the refactored builder functions from origin/main.
 *
 * Run: node --test test/unit/timeblock-a11y.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  __dirname,
  withStateAccessors,
  createDom,
  assertNoUncaughtErrors,
  extractFunctionSource,
} from './_helpers.mjs';

const renderSrc = readFileSync(join(__dirname, '../../src/js/11a-timeblock-render.js'), 'utf8');
const timeblockSrc = readFileSync(join(__dirname, '../../src/js/11-timeblock.js'), 'utf8');

// The move logic lives in 11-timeblock.js; load the real functions so these tests
// cover the render handlers and the shared move path together.
const sharedMoveSrc = ['clampBlockSlot', 'moveBlockToSlot']
  .map((name) => extractFunctionSource(timeblockSrc, name))
  .join('\n');

// ── Group B — DOM rendering + keyboard interaction ────────────────────────────

/**
 * Populates a VM context (from a jsdom window) with the minimal globals needed
 * to call renderTimeblock() with one planned block.
 * @param {object} ctx - The jsdom internal VM context.
 * @param {Date}   viewDate - The date the grid renders for.
 * @param {Array}  blocks   - Initial planned blocks array.
 */
function seedContext(ctx, viewDate, blocks) {
  ctx.TB_START = 7;
  ctx.TB_END = 21;
  ctx.TB_SLOTS = 28;
  ctx.TB_SLOT_H = 36;
  ctx.blocks = blocks;
  ctx.entries = [];
  ctx.planTasks = [];
  ctx.activeTimer = null;
  ctx.viewDate = viewDate;
  ctx.isToday = () => true;
  ctx.dk = () =>
    `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(viewDate.getDate()).padStart(2, '0')}`;
  ctx.getCat = () => ({ color: '#888888', label: 'Other' });
  ctx.escHtml = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  ctx.slotToTime = (slot) => {
    const total = 7 * 60 + slot * 30;
    return (
      String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
    );
  };
  ctx.tbOverlaps = () => ''; // no overlaps by default
  ctx.confirm = () => true;
  ctx.saveBlocks = () => {};
  ctx.renderTimeblock = () => {}; // stub; replaced by vm.runInContext
  ctx.positionNowLine = () => {};
  ctx.getDayStart = () => null;
  withStateAccessors(ctx);
}

describe('planned timeblocks are keyboard-moveable (#598 Group B)', () => {
  let dom, window, doc;

  const MARKUP = '<div id="tbTimes"></div><div id="tbGrid"></div>';
  const VIEW_DATE = new Date(2026, 9, 2, 9, 0, 0); // 2 Oct 2026 09:00 local
  const makeBlock = (overrides = {}) => ({
    id: 'b1',
    date: '2026-10-02',
    slot: 5,
    duration: 2,
    text: 'Test block',
    tag: 'other',
    ...overrides,
  });

  beforeEach(() => {
    dom = createDom(MARKUP);
    window = dom.window;
    doc = window.document;

    const ctx = dom.getInternalVMContext();
    seedContext(ctx, VIEW_DATE, [makeBlock()]);

    // Load the source — this defines renderTimeblock() in the context,
    // overwriting the stub set by seedContext.
    vm.runInContext(renderSrc, ctx);
    vm.runInContext(sharedMoveSrc, ctx);

    // Initial render: paints the block into #tbGrid.
    ctx.renderTimeblock();
  });

  afterEach(() => {
    assertNoUncaughtErrors(dom);
    window.close();
  });

  it('renders planned blocks with tabIndex 0 (keyboard-focusable)', () => {
    const blockEl = doc.querySelector('[data-bid="b1"]');
    assert.ok(blockEl, 'plan block must be rendered in #tbGrid');
    assert.equal(blockEl.tabIndex, 0);
  });

  it('renders tb-block-del with an aria-label starting with "Delete block"', () => {
    const delBtn = doc.querySelector('.tb-block-del[data-bid="b1"]');
    assert.ok(delBtn, 'delete button must be rendered');
    assert.match(delBtn.getAttribute('aria-label') ?? '', /^Delete block/);
  });

  it('renders tb-block-emoji with aria-label "Add emoji" or "Change emoji"', () => {
    const emojiBtn = doc.querySelector('.tb-block-emoji[data-bid="b1"]');
    assert.ok(emojiBtn, 'emoji button must be rendered');
    assert.match(emojiBtn.getAttribute('aria-label') ?? '', /(?:Add|Change) emoji/);
  });

  it('moves the block down one slot on ArrowDown', () => {
    const ctx = dom.getInternalVMContext();
    const initialSlot = ctx.blocks[0].slot; // 5

    // Prevent the keydown handler from re-rendering (which would re-enter renderTimeblock).
    ctx.renderTimeblock = () => {};

    const blockEl = doc.querySelector('[data-bid="b1"]');
    blockEl.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );

    assert.equal(ctx.blocks[0].slot, initialSlot + 1, 'slot must increment by 1');
  });

  it('moves the block up one slot on ArrowUp', () => {
    const ctx = dom.getInternalVMContext();
    const initialSlot = ctx.blocks[0].slot; // 5

    ctx.renderTimeblock = () => {};

    const blockEl = doc.querySelector('[data-bid="b1"]');
    blockEl.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );

    assert.equal(ctx.blocks[0].slot, initialSlot - 1, 'slot must decrement by 1');
  });

  it('clamps at slot 0 — ArrowUp does nothing when already at top', () => {
    const ctx = dom.getInternalVMContext();
    ctx.blocks[0].slot = 0;
    ctx.renderTimeblock = () => {};

    const blockEl = doc.querySelector('[data-bid="b1"]');
    blockEl.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    );

    assert.equal(ctx.blocks[0].slot, 0, 'slot must not go below 0');
  });

  it('clamps at max slot — ArrowDown does nothing when block fills the last slot', () => {
    const ctx = dom.getInternalVMContext();
    const maxSlot = ctx.TB_SLOTS - ctx.blocks[0].duration; // 28 - 2 = 26
    ctx.blocks[0].slot = maxSlot;
    ctx.renderTimeblock = () => {};

    const blockEl = doc.querySelector('[data-bid="b1"]');
    blockEl.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );

    assert.equal(ctx.blocks[0].slot, maxSlot, 'slot must not exceed TB_SLOTS − duration');
  });

  it('ignores non-arrow keys (e.g. Enter)', () => {
    const ctx = dom.getInternalVMContext();
    const initialSlot = ctx.blocks[0].slot;
    ctx.renderTimeblock = () => {};

    const blockEl = doc.querySelector('[data-bid="b1"]');
    blockEl.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );

    assert.equal(ctx.blocks[0].slot, initialSlot, 'Enter must not change the slot');
  });

  it('exposes the block as a named group so assistive technology announces it (WCAG 4.1.2)', () => {
    const blockEl = doc.querySelector('.tb-block.plan[data-bid="b1"]');
    assert.equal(blockEl.getAttribute('role'), 'group');
    assert.equal(
      blockEl.getAttribute('aria-label'),
      'Test block — planned 09:30–10:30, press arrow keys to move'
    );
  });

  it('ignores arrow keys pressed on a button inside the block', () => {
    const ctx = dom.getInternalVMContext();
    const initialSlot = ctx.blocks[0].slot;
    ctx.renderTimeblock = () => {};

    const emojiBtn = doc.querySelector('.tb-block-emoji[data-bid="b1"]');
    const event = new window.KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    emojiBtn.dispatchEvent(event);

    assert.equal(ctx.blocks[0].slot, initialSlot, 'the block must not move');
    assert.equal(event.defaultPrevented, false, 'the button keeps its default key handling');
  });

  it('leaves the block where it is when the user declines the overlap prompt', () => {
    const ctx = dom.getInternalVMContext();
    const initialSlot = ctx.blocks[0].slot;
    let saved = false;
    ctx.tbOverlaps = () => 'Standup';
    ctx.confirm = () => false;
    ctx.saveBlocks = () => {
      saved = true;
    };
    ctx.renderTimeblock = () => {};

    doc
      .querySelector('[data-bid="b1"]')
      .dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      );

    assert.equal(ctx.blocks[0].slot, initialSlot);
    assert.equal(saved, false, 'a refused move must not be saved');
  });

  it('keeps keyboard focus on the moved block after the grid is redrawn', () => {
    const ctx = dom.getInternalVMContext();
    const blockEl = doc.querySelector('.tb-block.plan[data-bid="b1"]');
    blockEl.focus();

    // The real renderTimeblock() runs here, replacing the focused element.
    blockEl.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );

    const focused = doc.activeElement;
    assert.notEqual(focused, blockEl, 'the grid was redrawn, so the old element is gone');
    assert.equal(focused.dataset.bid, 'b1');
    assert.ok(focused.classList.contains('tb-block'));
    assert.equal(ctx.blocks[0].slot, 6);
  });

  it('calls saveBlocks() when the slot changes', () => {
    const ctx = dom.getInternalVMContext();
    let saveCalled = false;
    ctx.saveBlocks = () => {
      saveCalled = true;
    };
    ctx.renderTimeblock = () => {};

    const blockEl = doc.querySelector('[data-bid="b1"]');
    blockEl.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );

    assert.ok(saveCalled, 'saveBlocks() must be called after a slot change');
  });
});
