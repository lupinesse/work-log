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

describe('--color-success token (#511)', () => {
  it('is defined for the light theme and overridden for dark', () => {
    const definitions = compiledCss.match(/--color-success:\s*(#[0-9a-f]{6})/g) ?? [];
    assert.equal(definitions.length, 2, 'one light and one dark definition');
    assert.notEqual(definitions[0], definitions[1], 'dark value differs from light');
  });

  it('colours the pomodoro completion tick instead of a hard-coded hex', () => {
    const body = ruleBody('.pomo-checkmark') ?? '';
    assert.match(body, /color:\s*var\(--color-success\)/);
    assert.doesNotMatch(body, /#16a34a/i);
  });
});
