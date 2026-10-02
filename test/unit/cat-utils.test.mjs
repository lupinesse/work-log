/**
 * @file cat-utils.test.mjs
 * Tests for src/js/cat-utils.js (leaf ES module extracted as part of
 * issue #336, extraction #16): getCat(), getCatColor(), getCatLabel().
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getCat, getCatColor, getCatLabel } from '../../src/js/cat-utils.js';
import { setCategories } from '../../src/js/state.js';

const CATS = [
  { id: 'work', label: 'Work', color: '#4a90e2' },
  { id: 'break', label: 'Break', color: '#7b61ff' },
  { id: 'other', label: 'Other', color: '#888780' },
];

beforeEach(() => {
  setCategories([...CATS]);
});

describe('getCat', () => {
  it('returns the matching category for a known id', () => {
    const result = getCat('work');
    assert.equal(result.id, 'work');
    assert.equal(result.label, 'Work');
  });

  it('returns the colour sanitised through safeCssColor', () => {
    const result = getCat('work');
    assert.equal(result.color, '#4a90e2');
  });

  it("falls back to the 'other' category when the id is unknown", () => {
    const result = getCat('no-such-epic');
    assert.equal(result.id, 'other');
    assert.equal(result.label, 'Other');
  });

  it("returns a hardcoded stub when 'other' is also absent from the list", () => {
    setCategories([{ id: 'work', label: 'Work', color: '#4a90e2' }]);
    const result = getCat('no-such-epic');
    assert.equal(result.id, 'other');
    assert.equal(result.label, 'other');
    assert.equal(result.color, '#888780');
  });

  it('strips unsafe CSS colour values through safeCssColor', () => {
    setCategories([{ id: 'bad', label: 'Bad', color: 'red' }]);
    const result = getCat('bad');
    assert.notEqual(result.color, 'red', 'named colour should be sanitised');
    assert.equal(result.color, '#888780');
  });

  it('returns a shallow copy — mutating the result does not affect the store', () => {
    const result = getCat('work');
    result.label = 'mutated';
    assert.equal(getCat('work').label, 'Work');
  });
});

describe('getCatColor', () => {
  it('returns the colour for a known id', () => {
    assert.equal(getCatColor('work'), '#4a90e2');
  });

  it("falls back to '#888780' (the 'other' stub) for an unknown id when 'other' is absent", () => {
    setCategories([{ id: 'work', label: 'Work', color: '#4a90e2' }]);
    assert.equal(getCatColor('no-such-epic'), '#888780');
  });
});

describe('getCatLabel', () => {
  it('returns the label for a known id', () => {
    assert.equal(getCatLabel('break'), 'Break');
  });

  it("falls back to the 'other' category's label for an unknown id", () => {
    assert.equal(getCatLabel('no-such-epic'), 'Other');
  });

  it("returns 'other' (the stub label) when 'other' is also absent", () => {
    setCategories([{ id: 'work', label: 'Work', color: '#4a90e2' }]);
    assert.equal(getCatLabel('no-such-epic'), 'other');
  });
});
