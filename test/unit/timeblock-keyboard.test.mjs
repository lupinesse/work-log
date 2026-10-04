/**
 * @file timeblock-keyboard.test.mjs
 * Unit tests for moving a planned time block (#598 group B, WCAG 2.1.1):
 * the shared moveBlockToSlot() that drag-and-drop and the keyboard both use, and
 * the keyboard pieces in 11a-timeblock-render.js (handleBlockKeydown and its
 * helpers). The functions are cut out of the real source so the tests follow it.
 *
 * Run: node --test test/unit/timeblock-keyboard.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import { __dirname, createDom, extractFunctionSource, withStateAccessors } from './_helpers.mjs';

const readSource = (file) => readFileSync(join(__dirname, '../../src/js', file), 'utf8');
const timeblockSource = readSource('11-timeblock.js');
const renderSource = readSource('11a-timeblock-render.js');

const functionsFrom = (source, names) =>
  names.map((name) => extractFunctionSource(source, name)).join('\n');

const DATE_KEY = '2026-10-02';

describe('clampBlockSlot() keeps a block inside the 28-slot day', () => {
  const sandbox = { TB_SLOTS: 28 };
  vm.createContext(sandbox);
  vm.runInContext(functionsFrom(timeblockSource, ['clampBlockSlot']), sandbox);

  const CASES = [
    ['a slot before the start', -3, 2, 0],
    ['the first slot', 0, 2, 0],
    ['a slot in the middle', 5, 2, 5],
    ['the last slot that still fits', 26, 2, 26],
    ['one past the last slot that fits', 27, 2, 26],
    ['far past the end', 99, 2, 26],
    ['a block as long as the whole day', 5, 28, 0],
  ];
  for (const [label, slot, duration, expected] of CASES) {
    it(`${label}: slot ${slot}, duration ${duration} → ${expected}`, () => {
      assert.equal(sandbox.clampBlockSlot(slot, duration), expected);
    });
  }
});

describe('moveBlockToSlot() is the single path that changes a block time', () => {
  /**
   * Loads the move functions over an in-memory block list, recording side effects.
   * @param {object} options - Scenario settings.
   * @param {Array<object>} [options.blocks] - Blocks the state holds.
   * @param {string} [options.overlaps] - What tbOverlaps() reports ('' for none).
   * @param {boolean} [options.confirmAnswer] - What the overlap prompt returns.
   * @returns {{ sandbox: object, calls: Array<Array<unknown>> }} The sandbox and the ordered calls.
   */
  function loadMove({
    blocks = [{ id: 'b1', slot: 8, duration: 2, text: 'Write report' }],
    overlaps = '',
    confirmAnswer = true,
  } = {}) {
    const calls = [];
    const sandbox = {
      TB_START: 7,
      TB_SLOTS: 28,
      blocks,
      tbOverlaps: (...args) => {
        calls.push(['tbOverlaps', ...args]);
        return overlaps;
      },
      confirm: (message) => {
        calls.push(['confirm', message]);
        return confirmAnswer;
      },
      saveBlocks: () => calls.push(['saveBlocks']),
      renderTimeblock: () => calls.push(['renderTimeblock']),
    };
    vm.createContext(withStateAccessors(sandbox));
    vm.runInContext(functionsFrom(timeblockSource, ['clampBlockSlot', 'moveBlockToSlot']), sandbox);
    return { sandbox, calls };
  }

  it('moves the block, checks overlap for the new time range, saves, then redraws', () => {
    const { sandbox, calls } = loadMove();
    assert.equal(sandbox.moveBlockToSlot('b1', 9, DATE_KEY), 'moved');
    assert.equal(sandbox.blocks[0].slot, 9);
    // Slot 9 starts at 07:00 + 9 × 30 min = 690 minutes and runs for two slots.
    assert.deepEqual(calls, [
      ['tbOverlaps', 690, 750, DATE_KEY, 'b1'],
      ['saveBlocks'],
      ['renderTimeblock'],
    ]);
  });

  const CLAMP_CASES = [
    ['past the end', 99, 26],
    ['before the start', -4, 0],
  ];
  for (const [label, requested, expectedSlot] of CLAMP_CASES) {
    it(`clamps a request ${label} to slot ${expectedSlot}`, () => {
      const { sandbox } = loadMove({ blocks: [{ id: 'b1', slot: 8, duration: 2, text: 'x' }] });
      assert.equal(sandbox.moveBlockToSlot('b1', requested, DATE_KEY), 'moved');
      assert.equal(sandbox.blocks[0].slot, expectedSlot);
    });
  }

  const UNCHANGED_CASES = [
    ['the same slot is requested', 8, 8],
    ['the request clamps to the slot it is already on', 26, 99],
  ];
  for (const [label, currentSlot, requested] of UNCHANGED_CASES) {
    it(`does nothing when ${label}`, () => {
      const { sandbox, calls } = loadMove({
        blocks: [{ id: 'b1', slot: currentSlot, duration: 2, text: 'x' }],
      });
      assert.equal(sandbox.moveBlockToSlot('b1', requested, DATE_KEY), 'unchanged');
      assert.deepEqual(calls, [], 'no overlap prompt, save or redraw');
    });
  }

  it('reports "missing" and changes nothing for an unknown block ID', () => {
    const { sandbox, calls } = loadMove();
    assert.equal(sandbox.moveBlockToSlot('nope', 9, DATE_KEY), 'missing');
    assert.deepEqual(calls, []);
    assert.equal(sandbox.blocks[0].slot, 8);
  });

  it('asks before moving onto another block and leaves the block alone when refused', () => {
    const { sandbox, calls } = loadMove({ overlaps: 'Standup', confirmAnswer: false });
    assert.equal(sandbox.moveBlockToSlot('b1', 9, DATE_KEY), 'declined');
    assert.equal(sandbox.blocks[0].slot, 8);
    const names = calls.map((call) => call[0]);
    assert.deepEqual(names, ['tbOverlaps', 'confirm'], 'no save or redraw after a refusal');
    assert.match(calls[1][1], /Standup/);
  });

  it('moves anyway when the user accepts the overlap prompt', () => {
    const { sandbox, calls } = loadMove({ overlaps: 'Standup', confirmAnswer: true });
    assert.equal(sandbox.moveBlockToSlot('b1', 9, DATE_KEY), 'moved');
    assert.equal(sandbox.blocks[0].slot, 9);
    assert.deepEqual(
      calls.map((call) => call[0]),
      ['tbOverlaps', 'confirm', 'saveBlocks', 'renderTimeblock']
    );
  });
});

describe('keyboard helpers for planned blocks', () => {
  /**
   * Loads the keyboard functions into a jsdom window with a two-block grid.
   * @param {object} [options] - Scenario settings.
   * @param {string} [options.moveResult] - What the stubbed moveBlockToSlot() returns.
   * @param {Array<object>} [options.blocks] - Blocks the state holds.
   * @returns {{ dom: object, ctx: object, blockEl: HTMLElement, calls: Array<Array<unknown>> }}
   *   The window, its VM context, the first block's element and the moveBlockToSlot() calls.
   */
  function loadKeyboard({
    moveResult = 'moved',
    blocks = [
      { id: 'b1', slot: 6, duration: 2, text: 'Write report' },
      { id: 'b2', slot: 12, duration: 1, text: 'Other' },
    ],
  } = {}) {
    const dom = createDom(
      '<div id="tbGrid">' +
        '<div class="tb-block plan" data-bid="b1" tabindex="0"><button class="tb-block-emoji">✦</button></div>' +
        '<div class="tb-block plan" data-bid="b2" tabindex="0"></div>' +
        '</div>'
    );
    const ctx = dom.getInternalVMContext();
    const calls = [];
    ctx.TB_START = 7;
    ctx.blocks = blocks;
    ctx.moveBlockToSlot = (...args) => {
      calls.push(args);
      return moveResult;
    };
    withStateAccessors(ctx);
    vm.runInContext(functionsFrom(timeblockSource, ['slotToTime']), ctx);
    vm.runInContext(
      functionsFrom(renderSource, [
        'blockAriaLabel',
        'blockMoveDelta',
        'focusPlannedBlock',
        'handleBlockKeydown',
      ]),
      ctx
    );
    const blockEl = dom.window.document.querySelector('[data-bid="b1"]');
    blockEl.addEventListener('keydown', (event) =>
      ctx.handleBlockKeydown(event, { id: 'b1' }, DATE_KEY)
    );
    return { dom, ctx, blockEl, calls };
  }

  /**
   * Dispatches a keydown at an element and reports whether it was claimed.
   * @param {object} dom - The jsdom instance.
   * @param {Element} target - Element that receives the event.
   * @param {string} key - `KeyboardEvent.key` value.
   * @param {object} [modifiers] - Modifier flags such as `{ ctrlKey: true }`.
   * @returns {boolean} True when a handler called preventDefault().
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

  describe('blockAriaLabel()', () => {
    it('names the block, its time range, and how to move it', () => {
      const { ctx } = loadKeyboard();
      assert.equal(
        ctx.blockAriaLabel({ text: 'Write report', slot: 6, duration: 2 }),
        'Write report — planned 10:00–11:00, press arrow keys to move'
      );
    });
  });

  describe('blockMoveDelta()', () => {
    const CASES = [
      ['ArrowUp', -1],
      ['ArrowDown', 1],
      ['ArrowLeft', 0],
      ['Enter', 0],
      [' ', 0],
      ['a', 0],
    ];
    for (const [key, expected] of CASES) {
      it(`${JSON.stringify(key)} → ${expected}`, () => {
        assert.equal(loadKeyboard().ctx.blockMoveDelta(key), expected);
      });
    }
  });

  describe('handleBlockKeydown()', () => {
    const MOVE_CASES = [
      ['ArrowDown', 7],
      ['ArrowUp', 5],
    ];
    for (const [key, expectedSlot] of MOVE_CASES) {
      it(`${key} on the block asks for slot ${expectedSlot} and claims the key`, () => {
        const { dom, blockEl, calls } = loadKeyboard();
        assert.equal(press(dom, blockEl, key), true);
        assert.deepEqual(calls, [['b1', expectedSlot, DATE_KEY]]);
      });
    }

    const IGNORED_CASES = [
      ['a key pressed on a button inside the block (regression)', 'ArrowDown', {}, true],
      ['Ctrl+ArrowDown', 'ArrowDown', { ctrlKey: true }, false],
      ['Alt+ArrowDown', 'ArrowDown', { altKey: true }, false],
      ['Meta+ArrowDown', 'ArrowDown', { metaKey: true }, false],
      ['Shift+ArrowDown', 'ArrowDown', { shiftKey: true }, false],
      ['Enter', 'Enter', {}, false],
      ['Space', ' ', {}, false],
      ['ArrowLeft', 'ArrowLeft', {}, false],
    ];
    for (const [label, key, modifiers, fromButton] of IGNORED_CASES) {
      it(`leaves ${label} alone (no move, default action kept)`, () => {
        const { dom, blockEl, calls } = loadKeyboard();
        const target = fromButton ? blockEl.querySelector('button') : blockEl;
        assert.equal(press(dom, target, key, modifiers), false);
        assert.deepEqual(calls, []);
      });
    }

    it('does nothing for a block that no longer exists', () => {
      const { dom, blockEl, calls } = loadKeyboard({ blocks: [] });
      press(dom, blockEl, 'ArrowDown');
      assert.deepEqual(calls, []);
    });

    const FOCUS_CASES = [
      ['moved', true],
      ['declined', false],
      ['unchanged', false],
    ];
    for (const [result, refocuses] of FOCUS_CASES) {
      it(`${refocuses ? 'refocuses' : 'does not refocus'} the block after a "${result}" move`, () => {
        const { dom, blockEl } = loadKeyboard({ moveResult: result });
        press(dom, blockEl, 'ArrowDown');
        const focused = dom.window.document.activeElement;
        assert.equal(focused === blockEl, refocuses);
      });
    }
  });

  describe('focusPlannedBlock()', () => {
    it('focuses the planned block with that ID', () => {
      const { dom, ctx } = loadKeyboard();
      ctx.focusPlannedBlock('b2');
      assert.equal(dom.window.document.activeElement.dataset.bid, 'b2');
    });

    it('finds an ID containing quotes without building a selector from it', () => {
      const { dom, ctx } = loadKeyboard();
      const grid = dom.window.document.getElementById('tbGrid');
      const odd = dom.window.document.createElement('div');
      odd.className = 'tb-block plan';
      odd.tabIndex = 0;
      odd.dataset.bid = 'a"]b';
      grid.appendChild(odd);
      ctx.focusPlannedBlock('a"]b');
      assert.equal(dom.window.document.activeElement, odd);
    });

    it('does nothing for an unknown ID', () => {
      const { dom, ctx } = loadKeyboard();
      assert.doesNotThrow(() => ctx.focusPlannedBlock('missing'));
      assert.equal(dom.window.document.activeElement, dom.window.document.body);
    });
  });
});
