/* ── Hero Card — action handlers + initialisation (split out of 06a-hero.js) ──
   Button click handlers for the Hero Card's idle/running/paused/stopped
   panels, plus initHero() which wires them all up. Depends on 06a-hero.js's
   state (heroGetState, renderHeroCard, _heroStopped*, _heroCancelStoppedTimer)
   and 06c-hero-category.js's renderHeroCard()-called _heroSetCategory. */

/**
 * Handles the "▶ Start tracking" button.
 * Uses the composer input if it has text; otherwise focuses the plan input.
 */
function _heroHandleStart() {
  const inp = document.getElementById('heroComposerInput');
  const text = inp ? inp.value.trim() : '';

  if (text) {
    const tag = selectedTag || (categories[0] ? categories[0].id : 'other');
    const entry = {
      id: Date.now() + '',
      text,
      tag,
      ts: safeRoundedStart(),
      date: dk(new Date()),
    };
    entries.push(entry);
    promoteMatchingTaskToInProgress(text);
    save();
    if (activeTimer) stopTimer();
    // Cancel any stopped-confirmation window so the new running state renders immediately.
    _heroCancelStoppedTimer();
    startTimer(entry.id);
    if (inp) inp.value = '';
    // render() refreshes the entry list below the hero card; renderHeroCard() is
    // already called by startTimer(), so this is the only additional work needed.
    render();
  } else {
    // Nothing typed — focus the plan/task input
    const planInp = document.getElementById('planInput');
    if (planInp) planInp.focus();
  }
}

/**
 * Starts tracking from a recent-chip click.
 * Re-uses the existing entry (no duplicate) and starts the timer.
 *
 * @param {string} text - Task description.
 * @param {string} tag  - Category ID.
 */
function _heroStartFromChip(text, tag) {
  // Find the most recent matching entry; re-use it rather than creating a duplicate
  const existing = [...entries].reverse().find((entry) => entry.text === text);
  if (existing && !existing.tsEnd) {
    // Entry already has no end — start timer on it
    promoteMatchingTaskToInProgress(text);
    if (activeTimer) stopTimer();
    _heroCancelStoppedTimer();
    startTimer(existing.id);
    render();
    return;
  }
  const entry = {
    id: Date.now() + '',
    text,
    tag,
    ts: safeRoundedStart(),
    date: dk(new Date()),
  };
  entries.push(entry);
  promoteMatchingTaskToInProgress(text);
  save();
  if (activeTimer) stopTimer();
  _heroCancelStoppedTimer();
  startTimer(entry.id);
  render();
}

/**
 * Undo the just-stopped entry: remove it from entries and optionally restart
 * the timer if the entry had been running (i.e. it had no prior tsEnd).
 */
function _heroHandleUndo() {
  const entry = _heroStoppedEntry;
  _heroCancelStoppedTimer();

  if (entry) {
    entries = entries.filter((en) => en.id !== entry.id);
    save();
  }

  render();
}

/** Dismiss the stopped confirmation panel immediately (same as auto-dismiss). */
function _heroHandleDone() {
  _heroCancelStoppedTimer();
  renderHeroCard();
}

/**
 * Binds all Hero Card button events.
 * Called once from DOMContentLoaded in 07-lifecycle.js.
 */
function initHero() {
  // Start tracking
  document.getElementById('heroStartBtn')?.addEventListener('click', _heroHandleStart);
  document.getElementById('heroComposerInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') _heroHandleStart();
    // Prevent Space from opening the rapid-log overlay while typing here
    if (event.code === 'Space') event.stopPropagation();
  });

  // Break from idle
  document
    .getElementById('heroIdleBreakBtn')
    ?.addEventListener('click', () => logUtilEntry('break'));

  // Resume from paused
  document.getElementById('heroResumeBtn')?.addEventListener('click', () => {
    resumeTimer();
    renderHeroCard();
  });

  // Stop from paused panel
  document.getElementById('heroPausedStopBtn')?.addEventListener('click', () => {
    stopTimer();
  });

  // Stopped panel actions
  document.getElementById('heroUndoBtn')?.addEventListener('click', _heroHandleUndo);
  document.getElementById('heroDoneBtn')?.addEventListener('click', _heroHandleDone);

  // "+ note" in stopped panel — focus the plan input for a note entry
  document.getElementById('heroNoteBtn')?.addEventListener('click', () => {
    _heroCancelStoppedTimer();
    renderHeroCard();
    const adHoc = document.getElementById('tlAdHocInput');
    if (adHoc) adHoc.focus();
  });

  // Focus mode button in running panel delegates to existing emergency button handler
  document.getElementById('heroPausedFocusBtn')?.addEventListener('click', () => {
    const emergBtn = document.getElementById('emergencyBtn');
    if (emergBtn) emergBtn.click();
  });

  // Close any open category picker when clicking outside a .hero-cat-wrap
  document.addEventListener('mousedown', (event) => {
    if (!event.target.closest('.hero-cat-wrap')) {
      document.querySelectorAll('.hero-cat-panel').forEach((panel) => {
        panel.style.display = 'none';
      });
      document.querySelectorAll('.hero-task-cat-btn[aria-expanded="true"]').forEach((catBtn) => {
        catBtn.setAttribute('aria-expanded', 'false');
      });
    }
  });

  // Initial render
  renderHeroCard();
}
