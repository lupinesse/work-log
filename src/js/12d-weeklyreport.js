/**
 * @file 12d-weeklyreport.js — Weekly report draft.
 *
 * Groups this calendar week's (Mon–Sun) finished, non-cancelled, non-utility
 * entries by Jira ticket key via buildWeeklyTicketSummary()/
 * formatWeeklyTicketSummaryText() (pure-fns.js), so writing a status report
 * no longer means reconstructing "what did I touch" by hand across
 * Jira/Confluence/memory. Opens a modal with the rendered text and a
 * copy-to-clipboard button — mirrors 12c-gapreport.js's modal wiring and
 * 25-rollingsummary.js's copy-to-clipboard pattern.
 */

// Element that had focus when the report was opened, restored on close —
// same convention as the gap-report modal in 12c-gapreport.js.
let _weeklyReportTrigger = null;

/**
 * Formats a week-start timestamp as a "Mon DD Mon – Sun DD Mon" range label.
 * @param {number} weekStart - Monday 00:00 local time, in ms.
 * @returns {string} The formatted range.
 */
function weekRangeLabel(weekStart) {
  const opts = { weekday: 'short', day: '2-digit', month: 'short' };
  const start = new Date(weekStart).toLocaleDateString('en', opts);
  const end = new Date(weekStart + 6 * 24 * 60 * 60 * 1000).toLocaleDateString('en', opts);
  return `${start} – ${end}`;
}

/**
 * Opens the weekly report draft: this calendar week's entries grouped by
 * ticket. Builds the text fresh from current `entries` state every time
 * it's opened, so it always reflects the latest data.
 * @returns {void}
 */
function openWeeklyReportOverlay() {
  const overlay = document.getElementById('weeklyReportOverlay');
  if (!overlay) return;

  _weeklyReportTrigger = document.activeElement;

  const weekStart = mondayOfWeek();
  const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
  const { ticketOrder, grouped } = buildWeeklyTicketSummary(entries, weekStart, weekEnd);
  const lines = formatWeeklyTicketSummaryText(ticketOrder, grouped, fmtDurLong);

  const subtitleEl = document.getElementById('weeklyReportSubtitle');
  const textEl = document.getElementById('weeklyReportText');
  if (subtitleEl) subtitleEl.textContent = weekRangeLabel(weekStart);
  if (textEl) {
    textEl.textContent = lines.length ? lines.join('\n') : 'Nothing tracked yet this week.';
  }

  overlay.classList.add('show');
  setTimeout(() => {
    const first = overlay.querySelector('button, [tabindex]:not([tabindex="-1"])');
    if (first) first.focus();
  }, 50);
}

/** Restores focus to whatever triggered the report, then clears it. */
function restoreWeeklyReportFocus() {
  if (_weeklyReportTrigger) {
    _weeklyReportTrigger.focus();
    _weeklyReportTrigger = null;
  }
}

/** Hides the weekly-report overlay and restores focus to its trigger. */
function closeWeeklyReportOverlay() {
  const overlay = document.getElementById('weeklyReportOverlay');
  if (overlay) overlay.classList.remove('show');
  restoreWeeklyReportFocus();
}

/**
 * Copies the rendered report text to the clipboard. Reads directly from the
 * visible `<pre>` block rather than rebuilding a parallel string, so the
 * copied text can never drift from what's on screen. Shows a brief
 * "Copied!" confirmation on success, or logs a warning on failure.
 * @returns {void}
 */
function copyWeeklyReportText() {
  const textEl = document.getElementById('weeklyReportText');
  if (!textEl) return;
  navigator.clipboard
    .writeText(textEl.textContent)
    .then(() => {
      const fb = document.getElementById('weeklyReportCopyFeedback');
      if (fb) {
        fb.textContent = 'Copied!';
        setTimeout(() => {
          fb.textContent = '';
        }, 2000);
      }
    })
    .catch((err) => {
      wlLog.warn('copyWeeklyReportText: clipboard write failed', err);
    });
}

const weeklyReportBtn = document.getElementById('weeklyReportBtn');
const weeklyReportOverlay = document.getElementById('weeklyReportOverlay');
const weeklyReportClose = document.getElementById('weeklyReportClose');
const weeklyReportCopyBtn = document.getElementById('weeklyReportCopyBtn');

if (weeklyReportBtn) weeklyReportBtn.addEventListener('click', openWeeklyReportOverlay);
if (weeklyReportClose) weeklyReportClose.addEventListener('click', closeWeeklyReportOverlay);
if (weeklyReportCopyBtn) weeklyReportCopyBtn.addEventListener('click', copyWeeklyReportText);
if (weeklyReportOverlay) {
  weeklyReportOverlay.addEventListener('click', (event) => {
    if (event.target === weeklyReportOverlay) closeWeeklyReportOverlay();
  });
  weeklyReportOverlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeWeeklyReportOverlay();
  });
}
