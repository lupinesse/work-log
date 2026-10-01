/**
 * @file design-tokens-css.test.mjs
 * Compiles the real stylesheet and checks that semantic colour tokens exist for
 * both themes and are used instead of raw hex values (#511).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { compile } from 'sass';
import { __dirname } from './_helpers.mjs';

const compiledCss = compile(join(__dirname, '../../src/css/styles.scss')).css;

/**
 * Returns the declaration body of the first rule with exactly this selector.
 * @param {string} selector - Selector text, e.g. `.pomo-checkmark`.
 * @returns {string|null} Text between the braces, or null when there is no such rule.
 */
function ruleBody(selector) {
  const escaped = selector.replace(/[.:]/g, '\\$&');
  const match = compiledCss.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  return match ? match[1] : null;
}

describe('shape tokens replace raw values (#526, #527)', () => {
  it('defines --radius-pill and uses it instead of border-radius: 99px', () => {
    assert.match(compiledCss, /--radius-pill:\s*99px/);
    assert.doesNotMatch(compiledCss, /border-radius:\s*99px/);
    assert.match(compiledCss, /border-radius:\s*var\(--radius-pill\)/);
  });

  it('defines --border-hairline and uses it instead of a raw 0.5px border', () => {
    assert.match(compiledCss, /--border-hairline:\s*0\.5px/);
    assert.doesNotMatch(compiledCss, /0\.5px (solid|dashed)/);
    assert.match(compiledCss, /border:\s*var\(--border-hairline\) solid/);
  });
});
