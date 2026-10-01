/**
 * @file timeblock-state.test.mjs
 * Unit tests for the places 11-timeblock.js writes the shared `blocks` array
 * through state.js's setBlocks() (#423): loadBlocks() (parse, corrupt-JSON
 * reset, one-time slot migration) and the "declined" branches of
 * checkBlockNotifications(), which drop a block the user chose not to start.
 * The functions are cut out of the real source so the tests track it.
 *
 * Run: node --test test/unit/timeblock-state.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import { __dirname, withStateAccessors } from './_helpers.mjs';

const source = readFileSync(join(__dirname, '../../src/js/11-timeblock.js'), 'utf8');

/**
 * Returns the full text of a top-level function declaration, found by
 * matching braces from its opening line.
 * @param {string} name - Function name to extract.
 * @returns {string} The function's source, from `function` to its closing brace.
 */
function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found in 11-timeblock.js`);
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

// The constants the functions read, copied from the file's own header lines.
const headerConstants = source.slice(0, source.indexOf('function loadBlocks'));
const loadSource = `${headerConstants}\n${extractFunction('loadBlocks')}\n${extractFunction('saveBlocks')}`;
const notifySource = `${headerConstants}\n${extractFunction('checkBlockNotifications')}`;

const plain = (value) => JSON.parse(JSON.stringify(value));

describe('loadBlocks() writes the shared blocks array', () => {
  /**
   * Loads loadBlocks() into a sandbox over an in-memory localStorage.
   * @param {Record<string, string>} store - Raw localStorage values by key.
   * @param {Array<object>} [seedBlocks] - What blocks holds before loading.
   * @returns {{ sandbox: object, store: object, warnings: string[], errors: string[] }}
   */
  function loadSandbox(store, seedBlocks = []) {
    const warnings = [];
    const errors = [];
    const sandbox = {
      blocks: seedBlocks,
      localStorage: {
        getItem: (key) => store[key] ?? null,
        setItem: (key, value) => {
          store[key] = String(value);
        },
      },
      validBlock: (block) => !!block && typeof block.id === 'string',
      wlLog: {
        warn: (message) => warnings.push(message),
        error: (message) => errors.push(message),
      },
    };
    vm.createContext(withStateAccessors(sandbox));
    vm.runInContext(loadSource, sandbox);
    return { sandbox, store, warnings, errors };
  }

  it('keeps valid stored blocks, drops invalid ones, and warns about the drop', () => {
    const { sandbox, warnings } = loadSandbox({
      wl_blocks_v1: JSON.stringify([{ id: 'a', slot: 1 }, { nope: true }]),
      wl_tb_migrated_7: '1',
    });
    sandbox.loadBlocks();
    assert.deepEqual(plain(sandbox.blocks), [{ id: 'a', slot: 1 }]);
    assert.match(warnings.join('\n'), /dropped 1 invalid block record/);
  });

  it('replaces any held blocks with an empty list and logs an error on corrupt JSON', () => {
    const { sandbox, errors } = loadSandbox({ wl_blocks_v1: '{not json', wl_tb_migrated_7: '1' }, [
      { id: 'stale', slot: 3 },
    ]);
    sandbox.loadBlocks();
    assert.deepEqual(plain(sandbox.blocks), []);
    assert.match(errors.join('\n'), /loadBlocks: failed to parse/);
  });

  it('shifts every slot by two once, persists the result and sets the migration flag', () => {
    const { sandbox, store } = loadSandbox({
      wl_blocks_v1: JSON.stringify([
        { id: 'a', slot: 1 },
        { id: 'b', slot: 4 },
      ]),
    });
    sandbox.loadBlocks();
    assert.deepEqual(
      plain(sandbox.blocks).map((block) => block.slot),
      [3, 6]
    );
    assert.deepEqual(
      JSON.parse(store.wl_blocks_v1).map((block) => block.slot),
      [3, 6]
    );
    assert.equal(store.wl_tb_migrated_7, '1');
  });

  it('leaves slots alone when the migration flag is already set', () => {
    const { sandbox } = loadSandbox({
      wl_blocks_v1: JSON.stringify([{ id: 'a', slot: 1 }]),
      wl_tb_migrated_7: '1',
    });
    sandbox.loadBlocks();
    assert.deepEqual(plain(sandbox.blocks), [{ id: 'a', slot: 1 }]);
  });
});

describe('checkBlockNotifications() drops a task block the user declines', () => {
  // 10:00:01 puts "now" three seconds into the block that starts at slot 6
  // (07:00 + 6 * 30 min), inside the 3-minute prompt window.
  const FIXED_NOW = new Date(2026, 9, 1, 10, 0, 1).getTime();

  /**
   * Loads checkBlockNotifications() with a fixed clock and recording stubs.
   * @param {object} options - Scenario settings.
   * @param {boolean} options.confirmAnswer - What the confirm() dialog returns.
   * @param {object|null} options.activeTimer - The running timer, if any.
   * @returns {{ sandbox: object, calls: string[] }}
   */
  function notifySandbox({ confirmAnswer, activeTimer }) {
    const calls = [];
    class FixedDate extends Date {
      constructor(...args) {
        if (args.length === 0) super(FIXED_NOW);
        else super(...args);
      }
    }
    const sandbox = {
      Date: FixedDate,
      blocks: [
        { id: 'task1', date: '2026-10-01', slot: 6, duration: 2, text: 'Task block' },
        { id: 'other', date: '2026-10-01', slot: 20, duration: 2, text: 'Later block' },
      ],
      entries: [],
      activeTimer,
      viewDate: new Date(FIXED_NOW),
      isToday: () => true,
      dk: () => '2026-10-01',
      confirm: () => confirmAnswer,
      tbStartBlock: () => calls.push('tbStartBlock'),
      saveBlocks: () => calls.push('saveBlocks'),
      renderTimeblock: () => calls.push('renderTimeblock'),
    };
    vm.createContext(withStateAccessors(sandbox));
    vm.runInContext(notifySource, sandbox);
    return { sandbox, calls };
  }

  const runningTimer = { entryId: 'e1', startTs: 1, accumulatedMs: 0, paused: false };
  const blockIds = (sandbox) => plain(sandbox.blocks).map((block) => block.id);

  it('removes the block when no timer is running and the user declines to start it', () => {
    const { sandbox, calls } = notifySandbox({ confirmAnswer: false, activeTimer: null });
    sandbox.checkBlockNotifications();
    assert.deepEqual(blockIds(sandbox), ['other']);
    assert.deepEqual(calls, ['saveBlocks', 'renderTimeblock']);
  });

  it('removes the block when a timer is running and the user declines to switch', () => {
    const { sandbox, calls } = notifySandbox({ confirmAnswer: false, activeTimer: runningTimer });
    sandbox.checkBlockNotifications();
    assert.deepEqual(blockIds(sandbox), ['other']);
    assert.deepEqual(calls, ['saveBlocks', 'renderTimeblock']);
  });

  it('keeps the block and starts it when the user accepts', () => {
    const { sandbox, calls } = notifySandbox({ confirmAnswer: true, activeTimer: null });
    sandbox.checkBlockNotifications();
    assert.deepEqual(blockIds(sandbox), ['task1', 'other']);
    assert.deepEqual(calls, ['tbStartBlock']);
  });
});
