/**
 * @file state-access.test.mjs
 * Unit tests for the state-access layer (issue #423). Nothing in the app
 * consumes state-access.js yet — these tests exercise it in isolation, in
 * line with #423's "zero behavior change" first step.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCategories,
  setCategories,
  getSelectedTag,
  setSelectedTag,
  getEntries,
  setEntries,
  getPlanTasks,
  setPlanTasks,
  getViewDate,
  setViewDate,
  getActiveTimer,
  setActiveTimer,
  getTimerInterval,
  setTimerInterval,
  getBlocks,
  setBlocks,
} from '../../src/js/state-access.js';

describe('state-access.js', () => {
  describe('categories', () => {
    it('defaults to an empty array', () => {
      assert.deepEqual(getCategories(), []);
    });

    it('setCategories replaces the value returned by getCategories', () => {
      const next = [{ id: 'work', label: 'Work', color: '#000' }];
      setCategories(next);
      assert.equal(getCategories(), next);
    });
  });

  describe('selectedTag', () => {
    it('defaults to "work"', () => {
      assert.equal(getSelectedTag(), 'work');
    });

    it('setSelectedTag replaces the value returned by getSelectedTag', () => {
      setSelectedTag('personal');
      assert.equal(getSelectedTag(), 'personal');
    });
  });

  describe('entries', () => {
    it('defaults to an empty array', () => {
      assert.deepEqual(getEntries(), []);
    });

    it('setEntries replaces the value returned by getEntries', () => {
      const next = [{ id: 'e1' }];
      setEntries(next);
      assert.equal(getEntries(), next);
    });
  });

  describe('planTasks', () => {
    it('defaults to an empty array', () => {
      assert.deepEqual(getPlanTasks(), []);
    });

    it('setPlanTasks replaces the value returned by getPlanTasks', () => {
      const next = [{ id: 't1' }];
      setPlanTasks(next);
      assert.equal(getPlanTasks(), next);
    });
  });

  describe('viewDate', () => {
    it('defaults to a Date instance', () => {
      assert.ok(getViewDate() instanceof Date);
    });

    it('setViewDate replaces the value returned by getViewDate', () => {
      const next = new Date('2026-01-01');
      setViewDate(next);
      assert.equal(getViewDate(), next);
    });
  });

  describe('activeTimer', () => {
    it('defaults to null', () => {
      assert.equal(getActiveTimer(), null);
    });

    it('setActiveTimer replaces the value returned by getActiveTimer', () => {
      const next = { tag: 'work', start: 123 };
      setActiveTimer(next);
      assert.equal(getActiveTimer(), next);
      setActiveTimer(null);
      assert.equal(getActiveTimer(), null);
    });
  });

  describe('timerInterval', () => {
    it('defaults to null', () => {
      assert.equal(getTimerInterval(), null);
    });

    it('setTimerInterval replaces the value returned by getTimerInterval', () => {
      setTimerInterval(42);
      assert.equal(getTimerInterval(), 42);
      setTimerInterval(null);
      assert.equal(getTimerInterval(), null);
    });
  });

  describe('blocks', () => {
    it('defaults to an empty array', () => {
      assert.deepEqual(getBlocks(), []);
    });

    it('setBlocks replaces the value returned by getBlocks', () => {
      const next = [{ id: 'b1' }];
      setBlocks(next);
      assert.equal(getBlocks(), next);
    });
  });
});
