/**
 * @file signifiers.js
 * Stateless signifier lookup tables and accessors: what symbol and title an
 * entry's signifier (event/flagged/migrated/cancelled/overtime, or the
 * billable default) displays as. Only depends on JS builtins — no module
 * state, no other-file calls.
 * Extracted from 10b-signifiers.js (issue #336) — the rest of that file
 * (SIG_CYCLE, cycleSignifier, sigHtml, bindSignifierClicks) stays behind: it
 * reads the `entries` module state and calls `save()`/`render()`, and does
 * DOM binding, none of which a standalone ES module can reach.
 */

/** Signifier id → display symbol. Entries with no signifier show '●' (billable, the default). */
export const SIG_SYMBOL = {
  event: '○',
  flagged: '★',
  migrated: '→',
  cancelled: '✗',
  overtime: '!',
};

/** Signifier id → accessible title. Entries with no signifier show 'Billable'. */
export const SIG_TITLE = {
  event: 'Meeting / event',
  flagged: 'Flagged for review',
  migrated: 'Migrated',
  cancelled: 'Cancelled — excluded from totals',
  overtime: 'Overtime',
};

/**
 * Returns the display symbol for an entry's signifier.
 * @param {Object} entry - Log entry object.
 * @param {string|null} [entry.signifier] - One of 'event'|'flagged'|'migrated'|'cancelled'|'overtime',
 *   or null/undefined for the billable default.
 * @returns {string} Unicode BuJo symbol (○ ★ → ✗ !) or '●' for the billable default.
 */
export function sigSymbol(entry) {
  return SIG_SYMBOL[entry.signifier] || '●';
}

/**
 * Returns the accessible title string for an entry's signifier.
 * @param {Object} entry - Log entry object.
 * @param {string|null} [entry.signifier] - One of 'event'|'flagged'|'migrated'|'cancelled'|'overtime',
 *   or null/undefined for the billable default.
 * @returns {string} Accessible title (e.g. 'Meeting / event') or 'Billable' for the billable default.
 */
export function sigTitle(entry) {
  return SIG_TITLE[entry.signifier] || 'Billable';
}
