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
    fn();
    console[method] = orig;
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
    it('opens a collapsed group labelled [WL:CONFIG] Startup', () => {
      const groups = spy('groupCollapsed', () => {
        const origLog = console.log;
        const origEnd = console.groupEnd;
        console.log = () => {};
        console.groupEnd = () => {};
        wlLog.config({ version: '1.0' });
        console.log = origLog;
        console.groupEnd = origEnd;
      });
      assert.equal(groups.length, 1);
      assert.equal(groups[0][0], '[WL:CONFIG] Startup');
    });

    it('logs each key/value pair inside the group', () => {
      const logged = [];
      const origGroup = console.groupCollapsed;
      const origEnd = console.groupEnd;
      console.groupCollapsed = () => {};
      console.groupEnd = () => {};
      const origLog = console.log;
      console.log = (...args) => logged.push(args);
      wlLog.config({ a: 1, b: 'two' });
      console.groupCollapsed = origGroup;
      console.groupEnd = origEnd;
      console.log = origLog;
      assert.equal(logged.length, 2);
      assert.ok(logged[0][0].includes('a:'));
      assert.ok(logged[1][0].includes('b:'));
    });

    it('calls console.groupEnd once', () => {
      const ends = spy('groupEnd', () => {
        const orig = console.groupCollapsed;
        const origLog = console.log;
        console.groupCollapsed = () => {};
        console.log = () => {};
        wlLog.config({});
        console.groupCollapsed = orig;
        console.log = origLog;
      });
      assert.equal(ends.length, 1);
    });
  });
});
