/**
 * @file a11y-keyboard-focus.test.mjs
 * Regression guards for keyboard access (WCAG 2.1.1 Keyboard, 2.4.7 Focus Visible):
 * every section header that is a div[role="button"] must toggle on Enter/Space, and
 * every control whose own styling removes the outline must show a replacement ring.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from 'sass';
import { __dirname, createDom, assertNoUncaughtErrors } from './_helpers.mjs';

const readSource = (relativePath) => readFileSync(join(__dirname, '../..', relativePath), 'utf8');
const miscSource = readSource('src/js/12-misc.js');
const markup = readSource('work-log.html');
const compiledCss = compile(join(__dirname, '../../src/css/styles.scss')).css;

/**
 * Reads the header id list that 12-misc.js wires to a11yHeaderKeydown().
 * @returns {string[]} The ids in KEYBOARD_ACTIVATED_HEADER_IDS.
 */
function wiredHeaderIds() {
  const listBody = miscSource.match(/const KEYBOARD_ACTIVATED_HEADER_IDS = \[([^\]]*)\]/)[1];
  return [...listBody.matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]);
}

/**
 * Lists the ids of every div[role="button"] in work-log.html.
 * @returns {string[]} Element ids.
 */
function buttonRoleDivIds() {
  return [...markup.matchAll(/<div[^>]*\bid="([A-Za-z]+)"[^>]*\brole="button"/g)].map(
    (match) => match[1]
  );
}

/**
 * Returns the declaration body of the first rule whose selector is exactly `selector`.
 * @param {string} selector - Full selector text, e.g. `.plan-status:focus-visible`.
 * @returns {string|null} Text between the braces, or null when there is no such rule.
 */
function ruleBody(selector) {
  const opening = `${selector} {`;
  const atFileStart = compiledCss.startsWith(opening);
  const afterNewline = compiledCss.indexOf(`\n${opening}`);
  if (!atFileStart && afterNewline === -1) return null;
  const bodyStart = (atFileStart ? 0 : afterNewline + 1) + opening.length;
  return compiledCss.slice(bodyStart, compiledCss.indexOf('}', bodyStart));
}

describe('section headers with role="button" respond to the keyboard', () => {
  it('finds the id of every div[role="button"] (guards the id-before-role regex)', () => {
    const roleButtonDivCount = (markup.match(/<div[^>]*\brole="button"/g) ?? []).length;
    assert.equal(buttonRoleDivIds().length, roleButtonDivCount);
  });

  it('wires every div[role="button"] header in work-log.html (regression)', () => {
    const missing = buttonRoleDivIds().filter((id) => !wiredHeaderIds().includes(id));
    assert.deepEqual(missing, [], `no Enter/Space handler for: ${missing.join(', ')}`);
  });

  it('wires only elements that exist in the markup', () => {
    const unknown = wiredHeaderIds().filter((id) => !markup.includes(`id="${id}"`));
    assert.deepEqual(unknown, []);
  });

  const KEY_CASES = [
    ['Enter', 'Enter', true],
    ['Space', ' ', true],
    ['Tab', 'Tab', false],
    ['a letter', 'a', false],
  ];

  for (const [label, key, shouldToggle] of KEY_CASES) {
    it(`${shouldToggle ? 'toggles' : 'ignores'} ${label} on a newly wired header`, () => {
      const dom = createDom('<div id="analyticsHeader" role="button" tabindex="0"></div>');
      const header = dom.window.document.getElementById('analyticsHeader');
      let clicks = 0;
      header.addEventListener('click', () => (clicks += 1));
      const helperSource = miscSource.match(/function a11yHeaderKeydown[\s\S]*?\r?\n}\r?\n/)[0];
      dom.window.eval(
        `${helperSource}; a11yHeaderKeydown(document.getElementById('analyticsHeader'));`
      );
      header.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
      assert.equal(clicks, shouldToggle ? 1 : 0);
      assertNoUncaughtErrors(dom);
      dom.window.close();
    });
  }
});

describe('controls that remove their outline show a focus ring (regression)', () => {
  const CONTROLS = ['cp-add-input', 'plan-status', 'emoji-picker-input'];

  for (const className of CONTROLS) {
    it(`.${className} has a visible :focus-visible ring`, () => {
      const focusBody = ruleBody(`.${className}:focus-visible`);
      assert.ok(focusBody, `no :focus-visible rule for .${className}`);
      assert.match(focusBody, /outline:\s*2px solid var\(--live\)/);
    });
  }
});
