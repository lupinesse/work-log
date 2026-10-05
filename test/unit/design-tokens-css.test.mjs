/**
 * @file design-tokens-css.test.mjs
 * Compiles the real stylesheet and checks that semantic colour tokens exist for
 * both themes and are used instead of raw hex values (#526, #527, #532, #494, #493, #537, #511, #586).
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
  const text = `\n${compiledCss}`;
  const marker = `\n${selector} {`;
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return null;
  const bodyStart = markerIndex + marker.length;
  return text.slice(bodyStart, text.indexOf('}', bodyStart));
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
      const definitionCount = compiledCss.split(`${token}:`).length - 1;
      assert.equal(definitionCount, 2, `${token} needs a light and a dark value`);
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

describe('retired colour aliases (#493)', () => {
  for (const alias of ['--card-soft', '--line-strong', '--ink2', '--ink-muted']) {
    it(`${alias} is neither defined nor referenced`, () => {
      assert.equal(compiledCss.includes(alias), false);
    });
  }
});

describe('modal and toast semantic tokens (#537)', () => {
  it('gives the amber reminder palette a light and a dark value', () => {
    for (const token of [
      '--amber-bg',
      '--amber-border',
      '--amber-ink',
      '--amber-accent',
      '--amber-hover-bg',
    ]) {
      const definitionCount = compiledCss.split(`${token}:`).length - 1;
      assert.equal(definitionCount, 2, `${token} needs a light and a dark value`);
    }
  });

  it('keeps the light amber values identical to the former hard-coded hexes', () => {
    assert.match(compiledCss, /--amber-bg:\s*#fef3c7/);
    assert.match(compiledCss, /--amber-ink:\s*#92400e/);
    assert.match(compiledCss, /--amber-accent:\s*#b45309/);
  });

  it('styles both reminder families through the tokens, with no dark-mode copies', () => {
    for (const selector of ['.eod-reminder', '.plan-review-reminder']) {
      const body = ruleBody(selector) ?? '';
      assert.match(body, /var\(--amber-bg\)/, selector);
      assert.doesNotMatch(body, /#fef3c7|#fde68a|#92400e/i, selector);
    }
    const reminderRulesWithRawAmber =
      compiledCss.match(/\.(?:eod|plan-review)-reminder[^{]*\{[^}]*#fbbf24[^}]*\}/g) ?? [];
    assert.deepEqual(reminderRulesWithRawAmber, [], 'dark values live in the tokens only');
  });

  it('uses the success and soft-danger tokens for toasts and the hours-entry error', () => {
    assert.match(ruleBody('.wl-toast-ok') ?? '', /var\(--success-bg\)/);
    assert.match(ruleBody('.wl-toast-err') ?? '', /var\(--danger-soft-bg\)/);
    assert.match(ruleBody('.eod-entry__status--error') ?? '', /var\(--danger-soft-ink\)/);
  });
});

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

describe('colour tokenisation outside _modals.scss (#586)', () => {
  /**
   * Strips all :root { ... } blocks from CSS so we only scan rule bodies.
   * @param {string} css - Full compiled stylesheet.
   * @returns {string} CSS with :root blocks removed.
   */
  function nonRootCss(css) {
    return css.replace(/:root\s*\{[^}]*\}/g, '');
  }

  const outsideRoot = nonRootCss(compiledCss);

  it('defines --sig-event-subtle with light and dark values', () => {
    const defs = compiledCss.split('--sig-event-subtle:').length - 1;
    assert.equal(defs, 2, '--sig-event-subtle needs a light and a dark value');
  });

  it('has no raw #1d9e75 outside :root token definitions', () => {
    assert.doesNotMatch(outsideRoot, /#1d9e75/i);
  });

  it('has no raw #ef9f27 outside :root token definitions', () => {
    assert.doesNotMatch(outsideRoot, /#ef9f27/i);
  });

  it('has no raw #9b7dff outside :root token definitions', () => {
    assert.doesNotMatch(outsideRoot, /#9b7dff/i);
  });

  it('has no raw #0a3d1f outside :root token definitions', () => {
    assert.doesNotMatch(outsideRoot, /#0a3d1f/i);
  });

  it('has no raw #fde68a outside :root token definitions', () => {
    assert.doesNotMatch(outsideRoot, /#fde68a/i);
  });

  it('styles done-state checkboxes through --success-ink', () => {
    const body = ruleBody('.cp-check.cp-checked') ?? '';
    assert.match(body, /var\(--success-ink\)/);
    assert.doesNotMatch(body, /#1d9e75/i);
  });

  it('styles pending badge text through --note-pending-ink', () => {
    const body = ruleBody('.plan-status.pending') ?? '';
    assert.match(body, /var\(--note-pending-ink\)/);
    assert.doesNotMatch(body, /#9b7dff/i);
  });

  it('styles done-st badge through --success-bg and --success-ink', () => {
    const body = ruleBody('.plan-status.done-st') ?? '';
    assert.match(body, /var\(--success-bg\)/);
    assert.match(body, /var\(--success-ink\)/);
    assert.doesNotMatch(body, /#0a3d1f|#1d9e75/i);
  });

  it('styles wip-warn banner through amber tokens with no dark-mode copies', () => {
    const body = ruleBody('.wip-warn') ?? '';
    assert.match(body, /var\(--amber-bg\)/);
    assert.match(body, /var\(--amber-border\)/);
    assert.match(body, /var\(--amber-ink\)/);
    assert.doesNotMatch(body, /#fde68a|#fef3c7|#92400e/i);
  });

  it('styles hero-longrun-warn banner through amber tokens with no dark-mode copies', () => {
    const body = ruleBody('.hero-longrun-warn') ?? '';
    assert.match(body, /var\(--amber-bg\)/);
    assert.match(body, /var\(--amber-border\)/);
    assert.doesNotMatch(body, /#fde68a|#fef3c7|#92400e/i);
  });

  it('uses --sig-event-subtle for the split-input default border', () => {
    const body = ruleBody('.plan-split-input') ?? '';
    assert.match(body, /var\(--sig-event-subtle\)/);
    assert.doesNotMatch(body, /#1d9e75/i);
  });
});
