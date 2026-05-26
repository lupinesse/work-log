// ── 10b-signifiers.js — Entry signifiers ──

// null/undefined = no signifier (neutral). Cycle: none → event → … → overtime → none
const SIG_CYCLE = ['event', 'flagged', 'migrated', 'cancelled', 'overtime'];
const SIG_SYMBOL = {
  event: '📅',
  flagged: '🚩',
  migrated: '📤',
  cancelled: '❌',
  overtime: '⏰',
};
const SIG_TITLE = {
  event: 'Meeting / event',
  flagged: 'Flagged for review',
  migrated: 'Migrated',
  cancelled: 'Cancelled — excluded from totals',
  overtime: 'Overtime',
};

function sigSymbol(entry) {
  return SIG_SYMBOL[entry.signifier] || '·';
}

function sigTitle(entry) {
  return SIG_TITLE[entry.signifier] || 'No signifier';
}

function cycleSignifier(entryId) {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return;
  const idx = SIG_CYCLE.indexOf(entry.signifier);
  // -1 (none) → 0 (event); last item → null (back to none)
  entry.signifier = idx + 1 < SIG_CYCLE.length ? SIG_CYCLE[idx + 1] : null;
  save();
  render();
}

function sigHtml(entry) {
  return `<span class="esig sig-${entry.signifier || 'none'}"
               data-entry-id="${escHtml(entry.id)}"
               title="${sigTitle(entry)}"
               role="button" tabindex="0"
               aria-label="Signifier: ${sigTitle(entry)}">
    ${sigSymbol(entry)}
  </span>`;
}

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
