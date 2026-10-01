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

describe('Jira badge tokens (#494)', () => {
  it('defines warning and danger badge tokens for light and dark', () => {
    for (const token of ['--danger-bg', '--warning-bg', '--warning-ink']) {
      const definitions = compiledCss.match(new RegExp(`${token}:`, 'g')) ?? [];
      assert.equal(definitions.length, 2, `${token} needs a light and a dark value`);
    }
  });

  it('keeps the light-mode badge colours identical to the former hard-coded values', () => {
    assert.match(compiledCss, /--warning-bg:\s*#faeeda/);
    assert.match(compiledCss, /--warning-ink:\s*#854f0b/);
    assert.match(compiledCss, /--danger-bg:\s*rgba\(198, 40, 40, 0\.12\)/);
  });

  it('styles the badges through the tokens instead of raw colours', () => {
    for (const selector of [
      '.jira-badge-new',
      '.jira-badge-status-blocked',
      '.jira-badge-status-pending',
    ]) {
      const body = ruleBody(selector) ?? '';
      assert.match(body, /var\(--(warning|danger)-bg\)/, selector);
      assert.doesNotMatch(body, /#faeeda|#854f0b|#c62828|rgba\(198/i, selector);
    }
  });
});
