/**
 * @file focus-ring-css.test.mjs
 * Regression for #513: inline text inputs that set `outline: none` must still
 * show a visible keyboard-focus indicator (WCAG 2.4.7 / 1.4.11). Compiles the
 * real stylesheet so the shared `focus-ring` mixin is exercised end to end.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { compile } from 'sass';
import { __dirname } from './_helpers.mjs';

const compiledCss = compile(join(__dirname, '../../src/css/styles.scss')).css;

/**
 * Returns the declaration body of the first rule whose selector is exactly `selector`.
 * @param {string} selector - Full selector text, e.g. `.cp-edit-input:focus-visible`.
 * @returns {string|null} Text between the braces, or null when there is no such rule.
 */
function ruleBody(selector) {
  // Plain string search, not a RegExp built from the selector: no escaping to get wrong.
  const text = `\n${compiledCss}`;
  const marker = `\n${selector} {`;
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return null;
  const bodyStart = markerIndex + marker.length;
  return text.slice(bodyStart, text.indexOf('}', bodyStart));
}

describe('inline text inputs keep a visible focus indicator (regression, #513)', () => {
  const INLINE_INPUT_CLASSES = [
    'cp-edit-input',
    'plan-inline-input',
    'cat-inline-input',
    'pcat-add-input',
  ];

  for (const className of INLINE_INPUT_CLASSES) {
    it(`.${className} suppresses the default outline but restores a focus-visible ring`, () => {
      assert.match(ruleBody(`.${className}`) ?? '', /outline:\s*none/);
      const focusBody = ruleBody(`.${className}:focus-visible`);
      assert.ok(focusBody, `no :focus-visible rule for .${className}`);
      assert.match(focusBody, /outline:\s*2px solid var\(--live\)/);
    });
  }
});
