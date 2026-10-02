/**
 * @file focus-indicators.test.mjs
 * Guard for #598 group C (WCAG 2.4.7 Focus Visible): any rule that removes the
 * browser's focus outline must be paired with a visible replacement on focus
 * (an outline, box-shadow, changed border colour or changed background), or
 * keep the ring for keyboard users. Fails with the selector's name when a new
 * `outline: none` is added without one.
 *
 * Run: node --test test/unit/focus-indicators.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { compile } from 'sass';

import { __dirname } from './_helpers.mjs';
import { extractInlineStyles, findOutlineRemovals, parseRules } from './_focus-audit.mjs';

const root = join(__dirname, '../..');
const compiledCss = compile(join(root, 'src/css/styles.scss')).css;
const inlineCss = extractInlineStyles(readFileSync(join(root, 'work-log.html'), 'utf8'));
const removals = findOutlineRemovals(parseRules(`${compiledCss}\n${inlineCss}`));

/** Runs the audit over a small piece of CSS. */
const audit = (css) => findOutlineRemovals(parseRules(css));

describe('findOutlineRemovals() classifies a rule correctly', () => {
  const CASES = [
    ['no replacement at all', '.a { outline: none; }', { exempt: false, replacement: '' }],
    [
      'a focus outline',
      '.a { outline: none; } .a:focus-visible { outline: 2px solid red; }',
      { exempt: false, replacement: 'outline' },
    ],
    [
      'a focus box-shadow',
      '.a { outline: none; } .a:focus { box-shadow: 0 0 0 2px blue; }',
      { exempt: false, replacement: 'box-shadow' },
    ],
    [
      'a changed border colour',
      '.a { outline: none; border: 1px solid grey; } .a:focus { border-color: blue; }',
      { exempt: false, replacement: 'border-color' },
    ],
    [
      'a border colour identical to the unfocused one (no visible change)',
      '.a { outline: none; border: 1px solid grey; } .a:focus { border-color: grey; }',
      { exempt: false, replacement: '' },
    ],
    [
      'a changed background',
      '.a { outline: none; background: white; } .a:focus { background: yellow; }',
      { exempt: false, replacement: 'background' },
    ],
    [
      'a focus rule that sets outline none again',
      '.a { outline: none; } .a:focus { outline: none; }',
      { exempt: false, replacement: '' },
    ],
    ['outline: 0', '.a { outline: 0; }', { exempt: false, replacement: '' }],
    [
      'pointer-only removal that keeps the keyboard ring',
      '.a:focus:not(:focus-visible) { outline: none; }',
      { exempt: true, replacement: 'keyboard ring kept' },
    ],
    [
      'a replacement for a different control',
      '.a { outline: none; } .b:focus { outline: 2px solid red; }',
      { exempt: false, replacement: '' },
    ],
  ];

  for (const [label, css, expected] of CASES) {
    it(label, () => {
      const [found] = audit(css);
      assert.equal(found.exempt, expected.exempt);
      assert.equal(found.replacement, expected.replacement);
    });
  }

  it('handles selector lists and ignores rules that keep the outline', () => {
    const found = audit(
      '.a, .b { outline: none; } .a:focus { box-shadow: 0 0 0 2px red; } .c { color: red; }'
    );
    assert.deepEqual(
      found.map((entry) => [entry.selector, entry.replacement]),
      [
        ['.a', 'box-shadow'],
        ['.b', ''],
      ]
    );
  });

  it('reads rules inside @media and skips @keyframes bodies', () => {
    const css = `@media (min-width: 1px) { .a { outline: none; } } @keyframes k { from { outline: none; } }`;
    assert.deepEqual(
      audit(css).map((entry) => entry.selector),
      ['.a']
    );
  });
});

describe('every rule that removes a focus outline shows a replacement or keeps the keyboard ring (#598 group C)', () => {
  it('scans a realistic number of rules (guards against a parser that finds nothing)', () => {
    assert.ok(removals.length >= 20, `only ${removals.length} outline removals found`);
  });

  it('includes the inline <style> in work-log.html (.notion-select)', () => {
    assert.ok(removals.some((entry) => entry.selector === '.notion-select'));
  });

  for (const { selector, exempt, replacement } of removals) {
    it(`${selector} ${exempt ? 'keeps the keyboard ring' : 'shows a visible focus indicator'}`, () => {
      assert.ok(
        exempt || replacement,
        `${selector} removes the outline but nothing visible changes on focus ` +
          '(add a :focus-visible ring, e.g. @include mixins.focus-ring)'
      );
    });
  }
});
