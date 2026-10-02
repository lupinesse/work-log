/**
 * @file 10b-signifiers.test.mjs
 * Tests for src/js/10b-signifiers.js (leaf ES module extracted as part of
 * issue #336, extraction #15): cycleSignifier(), sigHtml(), bindSignifierClicks(),
 * setSignifierRenderCallback().
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname, withStateAccessors, stripEsmSyntax } from './_helpers.mjs';
import { SIG_SYMBOL, SIG_TITLE, sigSymbol, sigTitle } from '../../src/js/signifiers.js';
import { escHtml } from '../../src/js/pure-fns.js';

/**
 * Creates a VM sandbox with 10b-signifiers.js loaded, stripping ESM syntax
 * and injecting the required globals.
 * @param {Object} [overrides] - Properties merged into the sandbox before eval.
 * @returns {Object} The populated sandbox.
 */
function loadSignifiersSandbox(overrides = {}) {
  const raw = readFileSync(join(__dirname, '../../src/js/10b-signifiers.js'), 'utf8');
  const src = stripEsmSyntax(raw);

  const saveCalls = [];
  const sandbox = {
    console,
    wlLog: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
    save: (...args) => saveCalls.push(args),
    saveCalls,
    escHtml,
    sigTitle,
    sigSymbol,
    // State backed by withStateAccessors
    entries: [],
    ...overrides,
  };

  vm.createContext(withStateAccessors(sandbox));
  vm.runInContext(src, sandbox);
  return sandbox;
}

const SIGNIFIERS = ['event', 'flagged', 'migrated', 'cancelled', 'overtime'];

describe('cycleSignifier', () => {
  it('advances the signifier from null to "event" (first step)', () => {
    const sandbox = loadSignifiersSandbox({
      entries: [{ id: 'e1', signifier: null }],
    });
    sandbox.cycleSignifier('e1');
    assert.equal(sandbox.entries[0].signifier, 'event');
  });

  it('advances through each step in SIG_CYCLE order', () => {
    const expected = ['event', 'flagged', 'migrated', 'cancelled', 'overtime'];
    const sandbox = loadSignifiersSandbox({
      entries: [{ id: 'e1', signifier: null }],
    });
    for (const step of expected) {
      sandbox.cycleSignifier('e1');
      assert.equal(sandbox.entries[0].signifier, step);
    }
  });

  it('wraps back to null after the last step', () => {
    const sandbox = loadSignifiersSandbox({
      entries: [{ id: 'e1', signifier: 'overtime' }],
    });
    sandbox.cycleSignifier('e1');
    assert.equal(sandbox.entries[0].signifier, null);
  });

  it('calls save() after each cycle', () => {
    const sandbox = loadSignifiersSandbox({
      entries: [{ id: 'e1', signifier: null }],
    });
    sandbox.cycleSignifier('e1');
    assert.equal(sandbox.saveCalls.length, 1);
  });

  it('logs a warning and returns early for an unknown entry id', () => {
    const warnCalls = [];
    const sandbox = loadSignifiersSandbox({
      entries: [{ id: 'e1', signifier: null }],
      wlLog: {
        warn: (...a) => warnCalls.push(a),
        error: () => {},
        info: () => {},
        debug: () => {},
      },
    });
    sandbox.cycleSignifier('no-such-id');
    assert.equal(warnCalls.length, 1);
    assert.match(warnCalls[0][0], /cycleSignifier/);
    assert.equal(sandbox.saveCalls.length, 0);
  });

  it('calls the registered render callback after cycling', () => {
    let renderCalled = false;
    const sandbox = loadSignifiersSandbox({
      entries: [{ id: 'e1', signifier: null }],
    });
    sandbox.setSignifierRenderCallback(() => {
      renderCalled = true;
    });
    sandbox.cycleSignifier('e1');
    assert.ok(renderCalled);
  });
});

describe('sigHtml', () => {
  it('returns a string containing the entry id in a data attribute', () => {
    const sandbox = loadSignifiersSandbox();
    const entry = { id: 'e42', signifier: null };
    const html = sandbox.sigHtml(entry);
    assert.ok(html.includes('data-entry-id="e42"'), 'should include data-entry-id');
  });

  it('includes the sig class for the current signifier', () => {
    const sandbox = loadSignifiersSandbox();
    for (const signifier of SIGNIFIERS) {
      const html = sandbox.sigHtml({ id: 'e1', signifier });
      assert.ok(html.includes(`sig-${signifier}`), `should include sig-${signifier} class`);
    }
  });

  it('uses sig-none class when signifier is null', () => {
    const sandbox = loadSignifiersSandbox();
    const html = sandbox.sigHtml({ id: 'e1', signifier: null });
    assert.ok(html.includes('sig-none'), 'should include sig-none class for null signifier');
  });

  it('escapes HTML in the entry id to prevent XSS', () => {
    const sandbox = loadSignifiersSandbox();
    const html = sandbox.sigHtml({ id: '<script>', signifier: null });
    assert.ok(!html.includes('<script>'), 'raw <script> tag should not appear in output');
    assert.ok(html.includes('&lt;script&gt;'), 'should HTML-escape the id');
  });
});

describe('setSignifierRenderCallback', () => {
  it('does not throw when called with a function', () => {
    const sandbox = loadSignifiersSandbox();
    assert.doesNotThrow(() => sandbox.setSignifierRenderCallback(() => {}));
  });

  it('cycles without error when no render callback is registered', () => {
    const sandbox = loadSignifiersSandbox({
      entries: [{ id: 'e1', signifier: null }],
    });
    assert.doesNotThrow(() => sandbox.cycleSignifier('e1'));
  });
});
