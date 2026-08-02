/**
 * @file 12c-gapreport.js — End-of-week gap report.
 *
 * Lists this calendar week's (Mon–Sun) finished, non-cancelled log entries
 * that have neither a proof link nor a note, via the pure
 * findGapReportEntries() (pure-fns.js), so the user can catch missing
 * documentation themselves before a weekly report is due. Clicking a flagged
 * entry jumps straight to it in the Log view with its proof-link/note editor
 * already open — see buildEntryMetaHtml()/bindEntryMetaEvents() in
 * 04-render.js for the editor itself (added alongside the entry.link/note
 * fields this report reads).
 */

// Element that had focus when the report was opened, restored on close —
// same convention as the EOD/expiry modal focus management in 12-misc.js.
let _gapReportTrigger = null;

/**
 * Builds one gap-report row: date label, task text (with any leading Jira
 * key linkified), and a "+ fix" button that jumps to the entry.
 * @param {Object} entry - A flagged log entry (from findGapReportEntries()).
 * @returns {string} HTML string.
 */
function buildGapReportRowHtml(entry) {
  return `<div class="gap-report-row">
      <span class="gap-report-date">${fmtDateLabel(entry.date)}</span>
      <span class="gap-report-text">${jiraTicketHtml(entry.text)}</span>
      <button type="button" class="gap-report-fix" data-id="${entry.id}" data-date="${entry.date}">+ fix</button>
    </div>`;
}

/**
 * Opens the gap report: this calendar week's entries missing both a proof
 * link and a note. Builds the list fresh from current `entries` state every
 * time it's opened, so it always reflects the latest data.
 */
function openGapReportOverlay() {
  const overlay = document.getElementById('gapReportOverlay');
  if (!overlay) return;

  _gapReportTrigger = document.activeElement;

  const weekStart = mondayOfWeek();
  const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
  const flagged = findGapReportEntries(entries, weekStart, weekEnd);

  const subtitleEl = document.getElementById('gapReportSubtitle');
  const listEl = document.getElementById('gapReportList');
  if (subtitleEl) {
    subtitleEl.textContent = flagged.length
      ? `${flagged.length} ${flagged.length === 1 ? 'entry needs' : 'entries need'} a proof link or a note this week`
      : 'All caught up 🎉 — every entry this week has a proof link or a note.';
  }
  if (listEl) {
    listEl.innerHTML = flagged.length
      ? flagged.map(buildGapReportRowHtml).join('')
      : '<div class="gap-report-empty">Nothing to fix.</div>';
  }

  overlay.classList.add('show');
  setTimeout(() => {
    const first = overlay.querySelector('button, [tabindex]:not([tabindex="-1"])');
    if (first) first.focus();
  }, 50);
}

/** Restores focus to whatever triggered the report, then clears it. */
function restoreGapReportFocus() {
  if (_gapReportTrigger) {
    _gapReportTrigger.focus();
    _gapReportTrigger = null;
  }
}

/** Hides the gap-report overlay and restores focus to its trigger. */
function closeGapReportOverlay() {
  const overlay = document.getElementById('gapReportOverlay');
  if (overlay) overlay.classList.remove('show');
  restoreGapReportFocus();
}

/**
 * Jumps from the gap report straight to a flagged entry: closes the report,
 * switches the viewed day and the Today's Flow tab to that entry's Log view,
 * opens its proof-link/note editor, and scrolls the row into view. This is
 * the "find it yourself, fix it yourself" action the report exists for.
 * @param {string} entryId - ID of the entry to jump to.
 * @param {string} entryDate - The entry's date (YYYY-MM-DD).
 */
function jumpToGapReportEntry(entryId, entryDate) {
  const overlay = document.getElementById('gapReportOverlay');
  if (overlay) overlay.classList.remove('show');
  _gapReportTrigger = null; // navigating away — nothing to restore focus to

  viewDate = new Date(entryDate + 'T12:00:00');
  setFlowView('log');
  _entryMetaEditId = entryId;
  render();

  setTimeout(() => {
    const row = document.querySelector(`.entry[data-id="${entryId}"]`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('emli-' + entryId)?.focus();
  }, 0);
}

const gapReportBtn = document.getElementById('gapReportBtn');
const gapReportOverlay = document.getElementById('gapReportOverlay');
const gapReportClose = document.getElementById('gapReportClose');
const gapReportList = document.getElementById('gapReportList');

if (gapReportBtn) gapReportBtn.addEventListener('click', openGapReportOverlay);
if (gapReportClose) gapReportClose.addEventListener('click', closeGapReportOverlay);
if (gapReportOverlay) {
  gapReportOverlay.addEventListener('click', (e) => {
    if (e.target === gapReportOverlay) closeGapReportOverlay();
  });
  gapReportOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeGapReportOverlay();
  });
}
if (gapReportList) {
  gapReportList.addEventListener('click', (e) => {
    const btn = e.target.closest('.gap-report-fix');
    if (btn) jumpToGapReportEntry(btn.dataset.id, btn.dataset.date);
  });
}
