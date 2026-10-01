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

describe('danger tokens (#532)', () => {
  it('defines --danger-ink and --danger-border with distinct light and dark values', () => {
    const ink = compiledCss.match(/--danger-ink:\s*(#[0-9a-f]{6})/g) ?? [];
    const border = compiledCss.match(/--danger-border:\s*(#[0-9a-f]{6})/g) ?? [];
    assert.deepEqual(
      ink.map((d) => d.split(':')[1].trim()),
      ['#991b1b', '#fca5a5']
    );
    assert.deepEqual(
      border.map((d) => d.split(':')[1].trim()),
      ['#b91c1c', '#f87171']
    );
  });

  it('keeps --pom-red-deep in step by aliasing --danger-ink', () => {
    assert.match(compiledCss, /--pom-red-deep:\s*var\(--danger-ink\)/);
  });

  it('colours the save-failure banner through the tokens, not raw reds', () => {
    for (const selector of [
      '.save-fail-banner',
      '.save-fail-banner__action',
      '.save-fail-banner__dismiss',
    ]) {
      const body = ruleBody(selector) ?? '';
      assert.match(body, /var\(--danger-(ink|border)\)/, selector);
      assert.doesNotMatch(body, /#991b1b|#fca5a5|#f87171|#b91c1c/i, selector);
    }
  });
});
