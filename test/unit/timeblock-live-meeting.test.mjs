/**
 * @file timeblock-live-meeting.test.mjs
 * Unit tests for isLiveMeetingBlock() in 11a-timeblock-render.js. The check
 * used to read an undefined `b` (left behind when the loop variable was renamed
 * to `block`), which threw while a timer was running and stopped every planned
 * block from rendering (#598 follow-up). The function is cut out of the real
 * source so the tests follow it.
 *
 * Run: node --test test/unit/timeblock-live-meeting.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import { __dirname, extractFunctionSource } from './_helpers.mjs';

const source = readFileSync(join(__dirname, '../../src/js/11a-timeblock-render.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(extractFunctionSource(source, 'isLiveMeetingBlock'), sandbox);
const { isLiveMeetingBlock } = sandbox;

describe('isLiveMeetingBlock()', () => {
  const CASES = [
    [
      'a meeting whose text equals the entry text',
      { type: 'meeting', text: 'Standup' },
      { text: 'Standup' },
      true,
    ],
    [
      'a meeting logged with the calendar prefix',
      { type: 'meeting', text: 'Standup' },
      { text: '📅 Standup' },
      true,
    ],
    [
      'a match that differs only by case',
      { type: 'meeting', text: 'STANDUP' },
      { text: '📅  standup' },
      true,
    ],
    [
      'a meeting with different text',
      { type: 'meeting', text: 'Standup' },
      { text: 'Retro' },
      false,
    ],
    [
      'a task block with the same text',
      { type: 'task', text: 'Standup' },
      { text: 'Standup' },
      false,
    ],
    ['a block with no type', { text: 'Standup' }, { text: 'Standup' }, false],
    ['no running entry (null)', { type: 'meeting', text: 'Standup' }, null, false],
    ['no running entry (undefined)', { type: 'meeting', text: 'Standup' }, undefined, false],
  ];

  for (const [label, block, liveEntry, expected] of CASES) {
    it(`${expected ? 'is' : 'is not'} live for ${label}`, () => {
      assert.equal(isLiveMeetingBlock(block, liveEntry), expected);
    });
  }

  it('does not throw for any block when an entry is running (regression: b is not defined)', () => {
    assert.doesNotThrow(() =>
      isLiveMeetingBlock({ type: 'task', text: 'Write report' }, { text: 'Running now' })
    );
  });
});
