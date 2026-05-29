// ── 10b-signifiers.js — Entry signifiers ──

// null/undefined = billable (default, displayed as ●). Cycle: none → event → … → overtime → none
const SIG_CYCLE = ['event', 'flagged', 'migrated', 'cancelled', 'overtime'];
const SIG_SYMBOL = {
  event: '○',
  flagged: '★',
  migrated: '→',
  cancelled: '✗',
  overtime: '!',
};
const SIG_TITLE = {
  event: 'Meeting / event',
  flagged: 'Flagged for review',
  migrated: 'Migrated',
  cancelled: 'Cancelled — excluded from totals',
  overtime: 'Overtime',
};

/**
 * Returns the display symbol for an entry's signifier.
 * @param {Object} entry - Log entry object.
 * @returns {string} Unicode BuJo symbol (○ ★ → ✗ !) or '●' for the billable default.
 */
function sigSymbol(entry) {
  return SIG_SYMBOL[entry.signifier] || '●';
}

/**
 * Returns the accessible title string for an entry's signifier.
 * @param {Object} entry - Log entry object.
 * @returns {string}
 */
function sigTitle(entry) {
  return SIG_TITLE[entry.signifier] || 'Billable';
}

/**
 * Advances an entry's signifier one step through SIG_CYCLE and persists the change.
 * Wraps from the last value back to null (no signifier).
 * @param {string} entryId - ID of the entry to update.
 */
function cycleSignifier(entryId) {
  const entry = entries.find((e) => e.id === entryId);
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
  render();
}

/**
 * Returns the HTML string for the clickable signifier widget on one entry row.
 * @param {Object} entry - Log entry object.
 * @returns {string} HTML string for a `<span>` button.
 */
function sigHtml(entry) {
  return `<span class="esig sig-${entry.signifier || 'none'}"
               data-entry-id="${escHtml(entry.id)}"
               title="${sigTitle(entry)}"
               role="button" tabindex="0"
               aria-label="Signifier: ${sigTitle(entry)}">
    ${sigSymbol(entry)}
  </span>`;
}

/** Attaches click and keyboard listeners to all `.esig` elements after a render. */
function bindSignifierClicks() {
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
