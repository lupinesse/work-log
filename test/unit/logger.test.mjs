/**
 * @file logger.test.mjs
 * Extracted from the former monolithic test/unit.mjs (issue #334).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wlLog } from '../../src/js/logger.js';

describe('wlLog', () => {
  /** Temporarily replace a console method, run fn, restore, return recorded calls. */
  function spy(method, fn) {
    const recorded = [];
    const orig = console[method];
    console[method] = (...args) => recorded.push(args);
    try {
      fn();
    } finally {
      console[method] = orig;
    }
    return recorded;
  }

  describe('debug()', () => {
    it('calls console.debug with [WL:DEBUG] prefix', () => {
      const calls = spy('debug', () => wlLog.debug('hello'));
      assert.deepEqual(calls[0], ['[WL:DEBUG]', 'hello']);
    });

    it('includes optional data as a third argument', () => {
      const calls = spy('debug', () => wlLog.debug('msg', { x: 1 }));
      assert.deepEqual(calls[0], ['[WL:DEBUG]', 'msg', { x: 1 }]);
    });

    it('omits the data argument when not supplied', () => {
      const calls = spy('debug', () => wlLog.debug('msg'));
      assert.equal(calls[0].length, 2);
    });
  });

  describe('info()', () => {
    it('calls console.info with [WL:INFO] prefix', () => {
      const calls = spy('info', () => wlLog.info('hello'));
      assert.deepEqual(calls[0], ['[WL:INFO]', 'hello']);
    });

    it('includes optional data as a third argument', () => {
      const calls = spy('info', () => wlLog.info('msg', 42));
      assert.deepEqual(calls[0], ['[WL:INFO]', 'msg', 42]);
    });
  });

  describe('warn()', () => {
    it('calls console.warn with [WL:WARN] prefix', () => {
      const calls = spy('warn', () => wlLog.warn('oops'));
      assert.deepEqual(calls[0], ['[WL:WARN]', 'oops']);
    });

    it('includes optional data as a third argument', () => {
      const calls = spy('warn', () => wlLog.warn('oops', [1, 2]));
      assert.deepEqual(calls[0], ['[WL:WARN]', 'oops', [1, 2]]);
    });
  });

  describe('error()', () => {
    it('calls console.error with [WL:ERROR] prefix', () => {
      const calls = spy('error', () => wlLog.error('boom'));
      assert.deepEqual(calls[0], ['[WL:ERROR]', 'boom']);
    });

    it('includes optional data as a third argument', () => {
      const calls = spy('error', () => wlLog.error('boom', new Error('e')));
      assert.equal(calls[0][0], '[WL:ERROR]');
      assert.equal(calls[0][1], 'boom');
      assert.ok(calls[0][2] instanceof Error);
    });
  });

  describe('config()', () => {
    /**
     * Replaces several console methods for the duration of fn and always
     * restores them, even when fn throws.
     * @param {Record<string, Function>} stubs - Console method name to stub.
     * @param {Function} fn - Code to run while stubbed.
     */
    function withConsoleStubs(stubs, fn) {
      const originals = {};
      for (const method of Object.keys(stubs)) originals[method] = console[method];
      Object.assign(console, stubs);
      try {
        fn();
      } finally {
        Object.assign(console, originals);
      }
    }

    const noop = () => {};

    it('opens a collapsed group labelled [WL:CONFIG] Startup', () => {
      const groups = [];
      withConsoleStubs(
        { groupCollapsed: (...args) => groups.push(args), log: noop, groupEnd: noop },
        () => wlLog.config({ version: '1.0' })
      );
      assert.equal(groups.length, 1);
      assert.equal(groups[0][0], '[WL:CONFIG] Startup');
    });

    it('logs each key/value pair inside the group', () => {
      const logged = [];
      withConsoleStubs(
        { groupCollapsed: noop, groupEnd: noop, log: (...args) => logged.push(args) },
        () => wlLog.config({ a: 1, b: 'two' })
      );
      assert.equal(logged.length, 2);
      assert.ok(logged[0][0].includes('a:'));
      assert.ok(logged[1][0].includes('b:'));
    });

    it('calls console.groupEnd once', () => {
      const ends = [];
      withConsoleStubs(
        { groupCollapsed: noop, log: noop, groupEnd: (...args) => ends.push(args) },
        () => wlLog.config({})
      );
      assert.equal(ends.length, 1);
    });

    it('restores console methods even when the code under test throws', () => {
      const original = console.log;
      assert.throws(() =>
        withConsoleStubs({ log: noop }, () => {
          throw new Error('boom');
        })
      );
      assert.equal(console.log, original);
    });
  });
});
