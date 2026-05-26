// ── 10b-signifiers.js — Entry signifiers ──

const SIG_CYCLE = ['billable', 'event', 'flagged', 'migrated', 'cancelled', 'overtime'];
const SIG_SYMBOL = {
  billable: '●',
  event: '○',
  flagged: '★',
  migrated: '→',
  cancelled: '✗',
  overtime: '!',
};
const SIG_TITLE = {
  billable: 'Billable',
  event: 'Meeting / event',
  flagged: 'Flagged for review',
  migrated: 'Migrated',
  cancelled: 'Cancelled — excluded from totals',
  overtime: 'Overtime',
};

function sigSymbol(entry) {
  return SIG_SYMBOL[entry.signifier] || '●';
}

function sigTitle(entry) {
  return SIG_TITLE[entry.signifier] || 'Billable';
}

function cycleSignifier(entryId) {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return;
  const cur = entry.signifier || 'billable';
  const idx = SIG_CYCLE.indexOf(cur);
  entry.signifier = SIG_CYCLE[(idx + 1) % SIG_CYCLE.length];
  save();
  render();
}

function sigHtml(entry) {
  return `<span class="esig sig-${entry.signifier || 'billable'}"
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
