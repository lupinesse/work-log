/**
 * @file entry-billable.test.mjs
 * Tests for src/js/entry-billable.js (leaf ES module extracted as part of
 * issue #336, extraction #19): isEntryBillable(), roundToNearest30IfBillable().
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isEntryBillable, roundToNearest30IfBillable } from '../../src/js/entry-billable.js';
import { setCategories, setPlanTasks } from '../../src/js/state.js';

const CATS = [
  { id: 'work', label: 'Work', color: '#4a90e2', billable: true },
  { id: 'admin', label: 'Admin', color: '#aaa', billable: false },
  { id: 'other', label: 'Other', color: '#888780' }, // billable: undefined → billable by default
];

beforeEach(() => {
  setCategories([...CATS]);
  setPlanTasks([]);
});

describe('isEntryBillable', () => {
  describe('cancelled entries', () => {
    it('returns false for a cancelled entry regardless of other flags', () => {
      assert.equal(isEntryBillable({ text: 'x', signifier: 'cancelled' }), false);
    });

    it('returns false for cancelled even when billable is explicitly true', () => {
      assert.equal(isEntryBillable({ text: 'x', signifier: 'cancelled', billable: true }), false);
    });
  });

  describe('explicit entry-level billable flag', () => {
    it('returns true when entry.billable is true', () => {
      assert.equal(isEntryBillable({ text: 'x', billable: true }), true);
    });

    it('returns false when entry.billable is false', () => {
      assert.equal(isEntryBillable({ text: 'x', billable: false }), false);
    });

    it('does not fall through to plan-task lookup when billable is set', () => {
      setPlanTasks([{ id: 'pt1', text: 'x', date: '2026-01-01', status: 'todo', billable: true }]);
      assert.equal(isEntryBillable({ text: 'x', billable: false }), false);
    });
  });

  describe('plan-task fallback', () => {
    it('returns true when the matching plan task has billable: true', () => {
      setPlanTasks([
        { id: 'pt1', text: 'Write report', date: '2026-01-01', status: 'todo', billable: true },
      ]);
      assert.equal(isEntryBillable({ text: 'Write report', tag: 'admin' }), true);
    });

    it('returns false when the matching plan task has billable: false', () => {
      setPlanTasks([
        { id: 'pt1', text: 'Write report', date: '2026-01-01', status: 'todo', billable: false },
      ]);
      assert.equal(isEntryBillable({ text: 'Write report', tag: 'work' }), false);
    });

    it('treats plan task billable: undefined as billable (undefined → true)', () => {
      setPlanTasks([{ id: 'pt1', text: 'Write report', date: '2026-01-01', status: 'todo' }]);
      assert.equal(isEntryBillable({ text: 'Write report', tag: 'admin' }), true);
    });

    it('matches plan tasks case-insensitively with trimmed whitespace', () => {
      setPlanTasks([
        {
          id: 'pt1',
          text: '  Write Report  ',
          date: '2026-01-01',
          status: 'todo',
          billable: false,
        },
      ]);
      assert.equal(isEntryBillable({ text: 'write report' }), false);
    });
  });

  describe('category fallback', () => {
    it('returns true for a billable category when no plan task matches', () => {
      assert.equal(isEntryBillable({ text: 'unmatched', tag: 'work' }), true);
    });

    it('returns false for a non-billable category when no plan task matches', () => {
      assert.equal(isEntryBillable({ text: 'unmatched', tag: 'admin' }), false);
    });

    it('treats category billable: undefined as billable (undefined → true)', () => {
      // 'other' category has no billable field — should default to billable
      assert.equal(isEntryBillable({ text: 'unmatched', tag: 'other' }), true);
    });

    it("falls back to 'other' category when tag is absent", () => {
      // entry has no tag — getCat falls back to 'other', which has billable: undefined → true
      assert.equal(isEntryBillable({ text: 'unmatched' }), true);
    });

    it("falls back to 'other' category when tag is unknown", () => {
      assert.equal(isEntryBillable({ text: 'unmatched', tag: 'no-such-cat' }), true);
    });
  });
});

describe('roundToNearest30IfBillable', () => {
  // 47 minutes in ms = 2 820 000 ms; nearest 30-min mark = 60 min = 3 600 000 ms
  const TS_47_MIN = 47 * 60 * 1000;
  const TS_60_MIN = 60 * 60 * 1000;

  it('rounds when entry is null', () => {
    assert.equal(roundToNearest30IfBillable(TS_47_MIN, null), TS_60_MIN);
  });

  it('rounds when entry is undefined', () => {
    assert.equal(roundToNearest30IfBillable(TS_47_MIN, undefined), TS_60_MIN);
  });

  it('rounds a billable entry', () => {
    const entry = { text: 'x', billable: true };
    assert.equal(roundToNearest30IfBillable(TS_47_MIN, entry), TS_60_MIN);
  });

  it('returns exact ts for a non-billable entry', () => {
    const entry = { text: 'x', billable: false };
    assert.equal(roundToNearest30IfBillable(TS_47_MIN, entry), TS_47_MIN);
  });

  it('returns exact ts for a cancelled entry (non-billable)', () => {
    const entry = { text: 'x', signifier: 'cancelled' };
    assert.equal(roundToNearest30IfBillable(TS_47_MIN, entry), TS_47_MIN);
  });

  it('rounds when the entry resolves as billable via category', () => {
    const entry = { text: 'unmatched', tag: 'work' }; // work category has billable: true
    assert.equal(roundToNearest30IfBillable(TS_47_MIN, entry), TS_60_MIN);
  });

  it('returns exact ts when the entry resolves as non-billable via category', () => {
    const entry = { text: 'unmatched', tag: 'admin' }; // admin category has billable: false
    assert.equal(roundToNearest30IfBillable(TS_47_MIN, entry), TS_47_MIN);
  });

  it('already-rounded ts is unchanged', () => {
    const entry = { text: 'x', billable: true };
    assert.equal(roundToNearest30IfBillable(TS_60_MIN, entry), TS_60_MIN);
  });
});
