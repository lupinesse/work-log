/**
 * @file focus-utils.js — Keyboard focus trap utility (LEAF MODULE).
 *
 * Provides `trapFocusInOverlay()` for WCAG 2.1.2 keyboard accessibility:
 * keeps Tab-key navigation inside an open overlay dialog. Extracted from
 * `02-utils.js` (issue #336, extraction #17); `12d-weeklyreport.js`
 * previously kept a private copy because it is a leaf ES module and
 * could not import from the concatenated `02-utils.js` — that duplication
 * is now resolved.
 */

/**
 * Keeps keyboard focus inside `overlayEl` while it is open (WCAG 2.1.2).
 * Wraps forward from the last focusable element back to the first (Tab) and
 * backward from the first to the last (Shift-Tab). Call from the overlay's
 * `keydown` handler whenever `e.key === 'Tab'`.
 * @param {HTMLElement} overlayEl - The open overlay container.
 * @param {KeyboardEvent} e - The Tab keydown event.
 * @returns {void}
 */
export function trapFocusInOverlay(overlayEl, e) {
  const focusable = Array.from(
    overlayEl.querySelectorAll(
      'a[href], area[href], input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null && el.tabIndex >= 0); // tabindex="-1" is not in Tab order (#556)
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
