/**
 * @file _focus-audit.mjs
 * Test helper for the focus-indicator guard (#598 group C, WCAG 2.4.7 Focus
 * Visible). It reads CSS, finds every rule that removes the browser's focus
 * outline, and decides whether the same control shows a visible replacement
 * when focused. Dependency-free on purpose: the input is compiled Sass or the
 * hand-written <style> blocks in work-log.html, both of which are flat,
 * well-formed CSS, so a brace-counting parser is enough and avoids adding a
 * direct dev dependency just for one test.
 */

const FOCUS_PSEUDO = /:(focus-visible|focus|focus-within)\b/g;
const KEYBOARD_FOCUS_PSEUDO = /:(focus-visible|focus)\b/;
const OUTLINE_REMOVED = /^(none|0)$/;
const BORDER_WIDTH_OR_STYLE =
  /^(none|hidden|solid|dashed|dotted|double|\d[\d.]*(px|em|rem)|var\(--border-hairline\))$/;

/**
 * Splits a selector list on top-level commas (commas inside `:not(...)` or
 * `:is(...)` do not separate selectors).
 * @param {string} selectorText - Text before a rule's opening brace.
 * @returns {string[]} The individual, trimmed selectors.
 */
function splitSelectors(selectorText) {
  const selectors = [];
  let depth = 0;
  let current = '';
  for (const character of selectorText) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      selectors.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

/**
 * Parses declarations from the body of one rule.
 * @param {string} body - Text between a rule's braces.
 * @returns {Record<string, string>} Property to value; later declarations win.
 */
function parseDeclarations(body) {
  const declarations = {};
  for (const declaration of body.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator === -1) continue;
    const property = declaration.slice(0, separator).trim();
    const value = declaration
      .slice(separator + 1)
      .replace(/!important/, '')
      .trim();
    if (property) declarations[property] = value;
  }
  return declarations;
}

/**
 * Parses flat CSS into style rules. At-rules that wrap rules (`@media`) are
 * entered and their rules reported with the at-rule's text in `media`;
 * `@keyframes` bodies are skipped because their selectors are not elements.
 * @param {string} css - CSS source.
 * @returns {Array<{ selectors: string[], declarations: Record<string, string>, media: string }>}
 *   The rules in source order.
 */
export function parseRules(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const walk = (text, media) => {
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf('{', index);
      if (open === -1) return;
      let depth = 1;
      let close = open + 1;
      while (close < text.length && depth > 0) {
        if (text[close] === '{') depth += 1;
        if (text[close] === '}') depth -= 1;
        close += 1;
      }
      const prelude = text.slice(index, open).trim();
      const body = text.slice(open + 1, close - 1);
      if (prelude.startsWith('@keyframes') || prelude.startsWith('@font-face')) {
        // Not element rules.
      } else if (prelude.startsWith('@')) {
        walk(body, prelude);
      } else {
        rules.push({
          selectors: splitSelectors(prelude),
          declarations: parseDeclarations(body),
          media,
        });
      }
      index = close;
    }
  };
  walk(source, '');
  return rules;
}

/**
 * Pulls the CSS out of every `<style>` block in an HTML document.
 * @param {string} html - HTML source.
 * @returns {string} The blocks' contents joined with newlines.
 */
export function extractInlineStyles(html) {
  return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
}

/**
 * Removes focus pseudo-classes so a focused selector maps back to its base.
 * @param {string} selector - A selector such as `.plan-input:focus-visible`.
 * @returns {string} The same selector without focus pseudo-classes.
 */
function baseSelector(selector) {
  return selector.replace(FOCUS_PSEUDO, '');
}

/**
 * Whether a rule's own declarations switch the outline off.
 * @param {Record<string, string>} declarations - A rule's declarations.
 * @returns {boolean} True for `outline: none` or `outline: 0`.
 */
function removesOutline(declarations) {
  return Boolean(declarations.outline) && OUTLINE_REMOVED.test(declarations.outline.trim());
}

/**
 * Best-effort colour of a base rule's border: the explicit `border-color`, or
 * the shorthand `border` with its width and style tokens stripped.
 * @param {Record<string, string>} declarations - Declarations of the unfocused rule.
 * @returns {string} The colour text, or '' when none is declared.
 */
function borderColourOf(declarations) {
  if (declarations['border-color']) return declarations['border-color'];
  if (!declarations.border) return '';
  return declarations.border
    .split(/\s+(?![^(]*\))/)
    .filter((token) => !BORDER_WIDTH_OR_STYLE.test(token))
    .join(' ');
}

/**
 * Decides whether a focus rule changes the control's appearance in a way a
 * keyboard user can see, compared with its unfocused rules.
 * @param {Record<string, string>} focusDeclarations - Declarations of the focus rule.
 * @param {Record<string, string>} baseDeclarations - Merged declarations of the unfocused rules.
 * @returns {string} What changes (`outline`, `box-shadow`, `border-color`, `background`), or '' for nothing visible.
 */
function visibleChange(focusDeclarations, baseDeclarations) {
  const outline = focusDeclarations.outline;
  if (outline && !OUTLINE_REMOVED.test(outline.trim())) return 'outline';
  if (focusDeclarations['box-shadow'] && focusDeclarations['box-shadow'] !== 'none') {
    return 'box-shadow';
  }
  const focusBorder = focusDeclarations['border-color'];
  if (focusBorder && !borderColourOf(baseDeclarations).includes(focusBorder)) {
    return 'border-color';
  }
  for (const property of ['background', 'background-color']) {
    const value = focusDeclarations[property];
    if (value && value !== baseDeclarations[property]) return 'background';
  }
  return '';
}

/**
 * Finds every selector whose rule removes the focus outline and reports
 * whether a visible replacement exists for it.
 *
 * `:focus:not(:focus-visible)` selectors are reported as exempt: they remove
 * the outline only for pointer focus, so keyboard users keep the default ring.
 * @param {ReturnType<typeof parseRules>} rules - Rules from {@link parseRules}.
 * @returns {Array<{ selector: string, exempt: boolean, replacement: string }>}
 *   One entry per selector; `replacement` is '' when the control shows nothing on focus.
 */
export function findOutlineRemovals(rules) {
  const results = [];
  for (const rule of rules) {
    if (!removesOutline(rule.declarations)) continue;
    for (const selector of rule.selectors) {
      if (/:focus:not\(:focus-visible\)/.test(selector)) {
        results.push({ selector, exempt: true, replacement: 'keyboard ring kept' });
        continue;
      }
      const base = baseSelector(selector);
      const baseDeclarations = Object.assign(
        {},
        ...rules
          .filter((other) => !other.media && other.selectors.includes(base))
          .map((other) => other.declarations)
      );
      const focusRules = rules.filter((other) =>
        other.selectors.some(
          (candidate) => KEYBOARD_FOCUS_PSEUDO.test(candidate) && baseSelector(candidate) === base
        )
      );
      const replacement =
        focusRules
          .map((focusRule) => visibleChange(focusRule.declarations, baseDeclarations))
          .find(Boolean) ?? '';
      results.push({ selector, exempt: false, replacement });
    }
  }
  return results;
}
