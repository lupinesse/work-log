// ── 11-timeflow.js — Today's Flow unified section (Flow / Log / Blocks views) ──
//
// Tab-switching orchestrator: owns which view is active and dispatches to the
// right render function. The section header/day-strip/gap-reminder chrome
// lives in 11c-timeflow-header.js; the Flow tab's own render + note editor
// lives in 11d-timeflow-flowview.js. All three share this file's constants
// and view-state via the concatenated script scope.

/** Activity-line SVG icon for the section header (Lucide-style, 24×24 viewBox, 1.5px stroke). */
const ICON_ACTIVITY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"' +
  ' fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';

const STORE_FLOW_VIEW = 'wl_flow_view';

/** 07:00 in minutes from midnight — left edge of the day-overview strip. */
const TF_STRIP_START = 7 * 60;
/** 21:00 in minutes from midnight — right edge of the day-overview strip. */
const TF_STRIP_END = 21 * 60;

/** Ordered list of view ids — drives the segmented control and keyboard nav. */
const TF_VIEWS = ['flow', 'log', 'blocks', 'month', 'summary'];

/** Display labels for the segmented control. Static so we avoid recomputing on every render. */
const TF_VIEW_LABELS = {
  flow: 'Flow',
  log: 'Log',
  blocks: 'Blocks',
  month: 'Month',
  summary: 'Summary',
};

/** Maps each view to the DOM id of the pane that hosts it. */
const TF_PANE_IDS = {
  flow: 'tfFlowPane',
  log: 'tfLogPane',
  blocks: 'tfBlocksPane',
  month: 'monthlyLogSection',
  summary: 'tfSummaryPane',
};

// ─────────────────────────── view preference ───────────────────────────

/**
 * Returns the persisted view preference, defaulting to 'flow'.
 * @returns {'flow'|'log'|'blocks'|'month'|'summary'}
 */
function getFlowView() {
  const stored = localStorage.getItem(STORE_FLOW_VIEW);
  return TF_VIEWS.includes(stored) ? stored : 'flow';
}

/**
 * Persists the active view selection.
 * @param {'flow'|'log'|'blocks'} view
 */
function setFlowView(view) {
  localStorage.setItem(STORE_FLOW_VIEW, view);
}

// ─────────────────────────── main render ───────────────────────────

/**
 * Renders the Today's Flow section: header, day-overview strip, gap reminder,
 * and the active view pane (Flow / Log / Blocks / Month).
 * Called from render() on every state change and when the view toggle fires.
 */
function renderTodayFlow() {
  const dateKey = dk(viewDate);
  const activeView = getFlowView();

  renderFlowHeader(dateKey, activeView);

  // Day strip and gap reminder are hidden in Month and Summary views
  const stripWrap = document.querySelector('.tf-day-strip-wrap');
  const gapEl = document.getElementById('tfGapReminder');
  const hideStripAndGap = activeView === 'month' || activeView === 'summary';
  if (stripWrap) stripWrap.style.display = hideStripAndGap ? 'none' : '';
  if (!hideStripAndGap) {
    renderDayStrip(dateKey);
    renderGapReminder(dateKey);
  } else if (gapEl) {
    gapEl.style.display = 'none';
  }

  Object.entries(TF_PANE_IDS).forEach(([view, id]) => {
    const pane = document.getElementById(id);
    if (pane) pane.style.display = view === activeView ? '' : 'none';
  });

  if (activeView === 'flow') renderFlowView(dateKey);
  else if (activeView === 'log') {
    const noteRow = document.getElementById('dailyLogNoteRow');
    if (noteRow) noteRow.style.display = isToday(viewDate) ? '' : 'none';
  } else if (activeView === 'blocks') renderTimeblock();
  else if (activeView === 'month') renderMonthlyLog();
  else if (activeView === 'summary') renderRollingSummary();
}

/**
 * Selects the view at index `nextIndex` in TF_VIEWS, focuses its tab button,
 * and re-renders. Shared by the keyboard handler in initTodayFlow().
 * @param {number} nextIndex
 */
function focusTabAt(nextIndex) {
  const view = TF_VIEWS[nextIndex];
  setFlowView(view);
  renderTodayFlow();
  document.getElementById(`tfTab-${view}`)?.focus();
}

/**
 * Binds the static listeners exactly once on DOMContentLoaded:
 *   - Log-note input/button (static HTML, never recreated)
 *   - Segmented-control click + keyboard nav, delegated off the stable
 *     #tfHeader container so we survive its innerHTML being rewritten
 *     by every renderFlowHeader() call.
 * Avoids the listener-accumulation bug that occurred when binding happened
 * inside render functions.
 */
function initTodayFlow() {
  document.getElementById('dailyLogNoteBtn')?.addEventListener('click', addLogNote);
  document.getElementById('dailyLogNoteInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addLogNote();
  });

  // Gap-reminder "+ log it" button: delegated from the stable #tfGapReminder
  // container so renderGapReminder() stays single-purpose (markup only).
  document.getElementById('tfGapReminder')?.addEventListener('click', (event) => {
    if (!event.target.closest('#tfGapLogBtn')) return;
    document.getElementById('captureInput')?.focus();
  });

  const header = document.getElementById('tfHeader');
  if (!header) return;

  header.addEventListener('click', (event) => {
    const btn = event.target.closest('.tf-seg-btn');
    if (!btn) return;
    setFlowView(btn.dataset.view);
    // Sync month calendar to viewDate when entering Month tab
    if (btn.dataset.view === 'month') {
      _mlYear = viewDate.getFullYear();
      _mlMonth = viewDate.getMonth();
    }
    renderTodayFlow();
  });

  // WCAG 2.1.1: Arrow keys + Home/End navigate between tabs in the tablist.
  header.addEventListener('keydown', (event) => {
    if (!event.target.classList || !event.target.classList.contains('tf-seg-btn')) return;
    const current = TF_VIEWS.indexOf(getFlowView());
    let next;
    if (event.key === 'ArrowLeft') next = (current - 1 + TF_VIEWS.length) % TF_VIEWS.length;
    else if (event.key === 'ArrowRight') next = (current + 1) % TF_VIEWS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TF_VIEWS.length - 1;
    else return;
    event.preventDefault();
    focusTabAt(next);
  });
}
