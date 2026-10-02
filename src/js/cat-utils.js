/**
 * @file cat-utils.js — Category lookup helpers (LEAF MODULE).
 *
 * Stateless category accessors extracted from `02-utils.js` (issue #336,
 * extraction #16). All three functions route through a single fallback chain:
 * id → 'other' → hardcoded stub. The returned colour is always sanitised
 * through `safeCssColor()`, which is the choke point every colour-rendering
 * template in the app relies on (audited in CHANGELOG against XSS alert #2).
 */
import { getCategories } from './state.js';
import { safeCssColor } from './pure-fns.js';

/**
 * Returns the category object for `id`, falling back to the built-in `'other'`
 * category or, when that is also absent, a hardcoded stub. The returned colour
 * always passes through `safeCssColor()` to strip any unsafe CSS value.
 * @param {string} id - Category ID.
 * @returns {{ id: string, label: string, color: string }}
 */
export function getCat(id) {
  const cat =
    getCategories().find((category) => category.id === id) ||
    getCategories().find((category) => category.id === 'other');
  if (!cat) return { id: 'other', label: 'other', color: '#888780' };
  return { ...cat, color: safeCssColor(cat.color) };
}

/**
 * Returns the CSS colour string for the category with the given ID.
 * @param {string} id - Category ID.
 * @returns {string} CSS colour value, always a safe CSS string.
 */
export function getCatColor(id) {
  return getCat(id).color;
}

/**
 * Returns the display label for the category with the given ID.
 * @param {string} id - Category ID.
 * @returns {string} Category label.
 */
export function getCatLabel(id) {
  return getCat(id).label;
}
