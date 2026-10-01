// ── 10b-signifiers.js — Entry signifiers (LEAF MODULE) ──
//
// Leaf ES module: SIG_CYCLE, cycleSignifier(), sigHtml(), bindSignifierClicks().
// Extracted from the concatenated bundle as part of issue #336, extraction #15.
//
// render() is a non-leaf function; callers must register it via
// setSignifierRenderCallback() during app startup before any signifier click
// can trigger a re-render.

import { save } from './01c-save.js';
import { getEntries } from './state.js';
import { wlLog } from './logger.js';
import { escHtml } from './pure-fns.js';
import { sigTitle, sigSymbol } from './signifiers.js';

// Cycle: none → event → flagged → migrated → cancelled → overtime → none
// null/undefined = billable default (●). Advancing past the last item wraps to null.
const SIG_CYCLE = ['event', 'flagged', 'migrated', 'cancelled', 'overtime'];

/** Registered render function, injected at startup to avoid a non-leaf dep. */
let _renderFn = null;

/**
 * Registers the render function so cycleSignifier can re-render the UI after
 * mutating an entry. Must be called once during app startup.
 * @param {Function} fn - The render() function from 04-render.js.
 */
export function setSignifierRenderCallback(fn) {
  _renderFn = fn;
}

/**
 * Advances an entry's signifier one step through SIG_CYCLE and persists the change.
 * Wraps from the last value back to null (no signifier).
 * @param {string} entryId - ID of the entry to update.
 */
export function cycleSignifier(entryId) {
  const entry = getEntries().find((e) => e.id === entryId);
  if (!entry) {
    // No matching entry usually means a stale click during a re-render —
    // a misuse-shaped event, not a routine info-level branch.
    wlLog.warn('cycleSignifier: no matching entry', { entryId });
    return;
  }
  const idx = SIG_CYCLE.indexOf(entry.signifier);
  // -1 (none) → 0 (event); last item → null (back to none)
  const next = idx + 1 < SIG_CYCLE.length ? SIG_CYCLE[idx + 1] : null;
  wlLog.info('cycleSignifier: changed', { entryId, from: entry.signifier || null, to: next });
  entry.signifier = next;
  save();
  _renderFn?.();
}

/**
 * Returns the HTML string for the clickable signifier widget on one entry row.
 * @param {Object} entry - Log entry object.
 * @returns {string} HTML string for a `<span>` button.
 */
export function sigHtml(entry) {
  return `<span class="esig sig-${entry.signifier || 'none'}"
               data-entry-id="${escHtml(entry.id)}"
               title="${sigTitle(entry)}"
               role="button" tabindex="0"
               aria-label="Signifier: ${sigTitle(entry)}">
    ${sigSymbol(entry)}
  </span>`;
}

/** Attaches click and keyboard listeners to all `.esig` elements after a render. */
export function bindSignifierClicks() {
  document.querySelectorAll('.esig').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleSignifier(el.dataset.entryId);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        cycleSignifier(el.dataset.entryId);
      }
    });
  });
}
