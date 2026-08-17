/**
 * @file date-labels.test.mjs
 * Regression coverage for issue #336: isToday()/fmtLabel() were widely
 * relied on (8 src/js files) but had no dedicated test of their own before
 * this — other test files only ever re-implemented a stub version for their
 * own sandbox setup, never exercised the real function.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isToday, fmtLabel } from '../../src/js/date-labels.js';

describe('isToday', () => {
  it('returns true for the current date and time', () => {
    assert.equal(isToday(new Date()), true);
  });

  it('returns true for a different time on the same calendar day', () => {
    const now = new Date();
    const earlierToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 1);
    assert.equal(isToday(earlierToday), true);
  });

  it('returns false for yesterday', () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    assert.equal(isToday(yesterday), false);
  });

  it('returns false for tomorrow', () => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    assert.equal(isToday(tomorrow), false);
  });

  it('returns false for a date a year ago', () => {
    const now = new Date();
    const lastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    assert.equal(isToday(lastYear), false);
  });
});

describe('fmtLabel', () => {
  it('labels today as "today"', () => {
    assert.equal(fmtLabel(new Date()), 'today');
  });

  it('labels yesterday as "yesterday"', () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    assert.equal(fmtLabel(yesterday), 'yesterday');
  });

  it('labels two days ago with a short locale date, not "yesterday"', () => {
    const now = new Date();
    const twoDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
    const label = fmtLabel(twoDaysAgo);
    assert.notEqual(label, 'yesterday');
    assert.notEqual(label, 'today');
    assert.equal(
      label,
      twoDaysAgo.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })
    );
  });

  it('labels a date far in the past with a short locale date', () => {
    const label = fmtLabel(new Date(2020, 0, 15));
    assert.equal(
      label,
      new Date(2020, 0, 15).toLocaleDateString('en', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    );
  });

  it('labels a future date with a short locale date, not "today"/"yesterday"', () => {
    const now = new Date();
    const nextWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    const label = fmtLabel(nextWeek);
    assert.notEqual(label, 'today');
    assert.notEqual(label, 'yesterday');
  });
});
