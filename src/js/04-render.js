/* ── Render — orchestrator ── */
// render() itself stays here as a thin orchestrator; everything it used to
// do inline now lives in sibling files, split out because this module was
// the largest, least-split one in the codebase (flagged five consecutive
// weekly QA reviews at 892 non-blank lines):
//   04a-render-entry-meta.js  — per-entry proof-link/note editor + category picker
//   04b-render-stats.js       — header stat tiles + sub-stat tiles
//   04c-render-timeline.js    — timeline entry list (build + bind) + its small helpers
//   04d-render-quickpick.js   — recent-tasks quick-pick bar
// Each extraction is a verbatim move, not a rewrite: no logic changed, only
// where it lives and — for the two blocks that were the middle of render()
// rather than a whole function already — the function boundary drawn around
// it.

/**
 * Full application re-render: updates the date label, timer bar, stat counters,
 * sub-stats, time-log list, chart, quick-pick, plan, completed section, and
 * time-block view. Call whenever persistent state changes.
 *
 * Design trade-off: full DOM re-render on every change rather than targeted
 * updates. Keeps state reasoning simple for a single-user personal tool where
 * the entry list is small (typically < 50 items per day). If performance becomes
 * a concern, the innermost `timelineEl.querySelectorAll` event-binding loop
 * (bindTimelineEntryEvents in 04c-render-timeline.js) is the first candidate
 * for optimisation.
 */
function render() {
  renderHeroCard();
  renderHeaderAndTimerSection();
  renderHeaderStatTiles();
  renderSubStatTiles();
  renderTimelineSection(viewEntries());
}

/**
 * Updates the date label and prev/next-day navigation, the location chip,
 * the start/end-of-day controls and reminder, and the timer bar/button —
 * everything render() needs to refresh purely because the viewed date or
 * timer state may have changed, before it gets to stats or the timeline.
 */
function renderHeaderAndTimerSection() {
  document.getElementById('dateLabel').textContent = fmtLabel(viewDate);
  document.getElementById('prevDay').disabled = false;
  document.getElementById('nextDay').disabled = isToday(viewDate);
  renderLocation();
  // Session chip + end-the-day button track the day in view, so refresh them
  // whenever the date changes.
  renderSodBtn();
  renderEodBtn();
  renderEodReminder();

  if (!activeTimer) {
    updateTimerBar();
    updateTimerBtn(false);
  } else {
    updateTimerBar();
    updateTimerBtn(true);
  }
}
