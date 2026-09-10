/**
 * @file signifiers.test.mjs
 * Regression coverage for issue #336: sigSymbol()/sigTitle() were widely
 * relied on (10b-signifiers.js's own sigHtml(), 18-dailylog.js, and
 * SIG_SYMBOL/SIG_TITLE directly in 16-rapid.js) but had no dedicated test of
 * their own before this extraction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SIG_SYMBOL, SIG_TITLE, sigSymbol, sigTitle } from '../../src/js/signifiers.js';

const SIGNIFIERS = ['event', 'flagged', 'migrated', 'cancelled', 'overtime'];

describe('sigSymbol', () => {
  for (const signifier of SIGNIFIERS) {
    it(`returns the mapped symbol for '${signifier}'`, () => {
      assert.equal(sigSymbol({ signifier }), SIG_SYMBOL[signifier]);
    });
  }

  it("returns '●' (billable default) when signifier is null", () => {
    assert.equal(sigSymbol({ signifier: null }), '●');
  });

  it("returns '●' (billable default) when signifier is undefined", () => {
    assert.equal(sigSymbol({}), '●');
  });

  it("returns '●' (billable default) for an unrecognised signifier value", () => {
    assert.equal(sigSymbol({ signifier: 'not-a-real-signifier' }), '●');
  });
});

describe('sigTitle', () => {
  for (const signifier of SIGNIFIERS) {
    it(`returns the mapped title for '${signifier}'`, () => {
      assert.equal(sigTitle({ signifier }), SIG_TITLE[signifier]);
    });
  }

  it("returns 'Billable' when signifier is null", () => {
    assert.equal(sigTitle({ signifier: null }), 'Billable');
  });

  it("returns 'Billable' when signifier is undefined", () => {
    assert.equal(sigTitle({}), 'Billable');
  });

  it("returns 'Billable' for an unrecognised signifier value", () => {
    assert.equal(sigTitle({ signifier: 'not-a-real-signifier' }), 'Billable');
  });
});
