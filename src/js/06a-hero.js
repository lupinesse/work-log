// ── 06a-hero.js — Hero Card state machine (Variant C) ──
//
// Manages the four visual states of the Hero Card:
//   idle     → no timer running
//   running  → timer active and not paused
//   paused   → timer active but on hold
//   stopped  → 6-second confirmation window after stopTimer()
//              (auto-transitions back to idle)
//
// Public surface:
//   renderHeroCard()     – full re-render; called after any state change
//   heroUpdateClock()    – updates the clock label every second (from tickTimer)
//   heroEnterStopped()   – called by stopTimer() to show the confirmation panel
//   initHero()           – binds button events; called once from DOMContentLoaded

/** @type {boolean} */
let _heroStopped = false;

/** @type {number|null} */
let _heroStoppedTimer = null;

/**
 * The log entry that was just stopped.  Kept so the Undo action can recover it
 * and the stopped panel can display the correct task name / session range.
 * @type {Object|null}
 */
let _heroStoppedEntry = null;

// ── State derivation ──────────────────────────────────────────────────────────

/**
 * Derives the current hero state from module-level timer variables.
 * @returns {'idle'|'running'|'paused'|'stopped'}
 */
function heroGetState() {
  if (_heroStopped) return 'stopped';
  if (!activeTimer) return 'idle';
  return activeTimer.paused ? 'paused' : 'running';
}

// ── Full render ───────────────────────────────────────────────────────────────

/**
 * Switches the root card's state-modifier class and makes the matching inner
 * panel visible.  Updates all dynamic content for the current state.
 */
function renderHeroCard() {
  const card = document.getElementById('heroCard');
  if (!card) return;

  const state = heroGetState();

  // Swap the state modifier class
  card.className = `hero-card hero-card--${state}`;

  // Show / hide inner panels
  _heroShowPanel('heroPanelIdle', state === 'idle');
  _heroShowPanel('heroPanelRunning', state === 'running');
  _heroShowPanel('heroPanelPaused', state === 'paused');
  _heroShowPanel('heroPanelStopped', state === 'stopped');

  // Fill dynamic content for the visible state
  if (state === 'idle') {
    _heroFillIdle();
  }
  if (state === 'running') {
    _heroFillRunning();
  }
  if (state === 'paused') {
    _heroFillPaused();
  }
  if (state === 'stopped') {
    _heroFillStopped();
  }

  // Keep the legacy timerBtn disabled state in sync so any stray references work
  const legacyBtn = document.getElementById('timerBtn');
  if (legacyBtn) {
    legacyBtn.disabled = state !== 'idle';
    legacyBtn.textContent = state !== 'idle' ? '▶ timing…' : '▶ start';
  }
}

/**
 * @param {string} id - Element ID.
 * @param {boolean} visible - Whether to show the element.
 */
function _heroShowPanel(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

// ── Idle fill ─────────────────────────────────────────────────────────────────

/** Updates the idle panel: logged-today total and last-session time. */
function _heroFillIdle() {
  const todayKey = dk(new Date());

  // Total logged today (ms → "Xh Ym" or "Xm")
  const totalMs = entries
    .filter((e) => e.date === todayKey && e.tsEnd && e.tsEnd > e.ts)
    .reduce((sum, e) => sum + (e.tsEnd - e.ts), 0);

  const loggedEl = document.getElementById('heroLoggedToday');
  if (loggedEl) loggedEl.textContent = totalMs > 0 ? fmtDur(totalMs) : '0m';

  // Last session ended time
  const lastEl = document.getElementById('heroIdleLastSession');
  if (lastEl) {
    const last = [...entries]
      .filter((e) => e.date === todayKey && e.tsEnd)
      .sort((a, b) => b.tsEnd - a.tsEnd)[0];
    lastEl.textContent = last ? `last session ended ${fmtTime(last.tsEnd)}` : '';
  }

  // Recent chips — last 3 distinct tasks from today + recent days
  _heroRenderRecentChips();
}

/**
 * Builds the recent-task chip strip in the idle panel.
 * Shows up to 3 distinct recent entries with their category dot.
 */
function _heroRenderRecentChips() {
  const el = document.getElementById('heroRecentChips');
  if (!el) return;

  const seen = new Set();
  /** @type {Array<{text: string, tag: string}>} */
  const recent = [];
  [...entries].reverse().forEach((e) => {
    const k = e.text.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      recent.push(e);
    }
  });

  const chips = recent.slice(0, 3);
  if (!chips.length) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = chips
    .map((e) => {
      const cat = getCat(e.tag);
      const isLast = chips[0] === e;
      return (
        `<li>` +
        `<button class="hero-chip"` +
        ` data-text="${escHtml(e.text)}" data-tag="${escHtml(e.tag)}"` +
        ` aria-label="Start tracking: ${escHtml(e.text)}">` +
        `<span class="hero-chip-dot" style="background:${safeCssColor(cat.color)}" aria-hidden="true"></span>` +
        `<span class="hero-chip-text">${escHtml(e.text)}</span>` +
        (isLast ? `<span class="hero-chip-last" aria-hidden="true">← last</span>` : '') +
        `</button>` +
        `</li>`
      );
    })
    .join('');

  el.querySelectorAll('.hero-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      _heroStartFromChip(btn.dataset.text, btn.dataset.tag);
    });
  });
}

// ── Running fill ──────────────────────────────────────────────────────────────

/** Updates the running panel: category dot + task title + started-at sub-line. */
function _heroFillRunning() {
  if (!activeTimer) return;
  const entry = entries.find((e) => e.id === activeTimer.entryId);
  if (!entry) return;

  _heroSetCategory('heroTaskCategory', entry.tag, true);

  const titleEl = document.getElementById('timerTask');
  if (titleEl) titleEl.innerHTML = jiraTicketHtml(entry.text);

  const metaEl = document.getElementById('heroRunningMeta');
  if (metaEl) {
    const sessionCount = _heroSessionCount(entry);
    metaEl.textContent = `started ${fmtTime(entry.ts)}${sessionCount > 1 ? ` · ${sessionCount} sessions today` : ''}`;
  }

  const noteRefEl = document.getElementById('heroTaskNoteRef');
  if (noteRefEl) noteRefEl.textContent = _heroLastNoteText(entry.id);
}

// ── Paused fill ───────────────────────────────────────────────────────────────

/** Updates the paused panel with the frozen clock and task details. */
function _heroFillPaused() {
  if (!activeTimer) return;
  const entry = entries.find((e) => e.id === activeTimer.entryId);
  if (!entry) return;

  _heroSetCategory('heroPausedCategory', entry.tag, true);

  const taskEl = document.getElementById('heroPausedTask');
  if (taskEl) taskEl.innerHTML = jiraTicketHtml(entry.text);

  const elapsed = getElapsedMs();
  const elapsedEl = document.getElementById('heroPausedElapsed');
  if (elapsedEl) elapsedEl.textContent = fmtElapsed(elapsed);

  const metaEl = document.getElementById('heroPausedMeta');
  if (metaEl) metaEl.textContent = `paused · since ${fmtTime(entry.ts)}`;

  const noteRefEl = document.getElementById('heroPausedNoteRef');
  if (noteRefEl) noteRefEl.textContent = _heroLastNoteText(entry.id);
}

// ── Stopped fill ──────────────────────────────────────────────────────────────

/** Updates the stopped panel with the session summary. */
function _heroFillStopped() {
  const entry = _heroStoppedEntry;
  if (!entry) return;

  _heroSetCategory('heroStoppedCategory', entry.tag);

  const taskEl = document.getElementById('heroStoppedTask');
  if (taskEl) taskEl.innerHTML = jiraTicketHtml(entry.text);

  const elapsed = entry.tsEnd && entry.tsEnd > entry.ts ? entry.tsEnd - entry.ts : 0;
  const elapsedEl = document.getElementById('heroStoppedElapsed');
  if (elapsedEl) elapsedEl.textContent = elapsed > 0 ? fmtElapsed(elapsed) : '0:00';

  const rangeEl = document.getElementById('heroStoppedRange');
  if (rangeEl && entry.tsEnd) {
    rangeEl.textContent = `${fmtTime(entry.ts)} → ${fmtTime(entry.tsEnd)} · added to today`;
  }

  const sessEl = document.getElementById('heroStoppedSessions');
  if (sessEl) {
    const count = _heroSessionCount(entry);
    const todayMs = entries
      .filter((e) => e.date === entry.date && e.tsEnd && e.tsEnd > e.ts)
      .reduce((s, e) => s + (e.tsEnd - e.ts), 0);
    sessEl.textContent =
      count > 1
        ? `${count} sessions today · ${fmtDur(todayMs)} total`
        : `${fmtDur(todayMs)} logged today`;
  }
}

// ── Clock tick (called every second from tickTimer) ───────────────────────────

/**
 * Updates the running-state elapsed clock without a full render.
 * Only touches the clock element so the DOM churn stays minimal.
 */
function heroUpdateClock() {
  if (!activeTimer || activeTimer.paused || _heroStopped) return;
  const el = document.getElementById('timerElapsed');
  if (el) el.textContent = fmtElapsed(getElapsedMs());
}

// ── Stopped state transition ──────────────────────────────────────────────────

/**
 * Called by stopTimer() just before activeTimer is cleared.
 * Shows the stopped confirmation panel and arms the 6s auto-dismiss.
 *
 * @param {Object} entry - The log entry that was just stopped.
 */
function heroEnterStopped(entry) {
  _heroStoppedEntry = entry;
  _heroStopped = true;

  renderHeroCard();

  // Auto-dismiss to idle after 6 seconds
  _heroStoppedTimer = setTimeout(() => {
    _heroStopped = false;
    _heroStoppedEntry = null;
    renderHeroCard();
  }, 6000);
}

/** Cancels the auto-dismiss timer (called by Undo / Done buttons). */
function _heroCancelStoppedTimer() {
  if (_heroStoppedTimer) {
    clearTimeout(_heroStoppedTimer);
    _heroStoppedTimer = null;
  }
  _heroStopped = false;
  _heroStoppedEntry = null;
}

// ── Action handlers ───────────────────────────────────────────────────────────

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
  const existing = [...entries].reverse().find((e) => e.text === text);
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
    entries = entries.filter((e) => e.id !== entry.id);
    save();
  }

  render();
}

/** Dismiss the stopped confirmation panel immediately (same as auto-dismiss). */
function _heroHandleDone() {
  _heroCancelStoppedTimer();
  renderHeroCard();
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Fills a category display cell with the dot + label (and optional caret/picker).
 * @param {string}  elId        - ID of the `.hero-task-category` element.
 * @param {string}  tag         - Category ID.
 * @param {boolean} [interactive=false] - When true, renders a caret button and picker panel.
 */
function _heroSetCategory(elId, tag, interactive = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  const cat = getCat(tag);

  if (!interactive) {
    el.innerHTML =
      `<span class="hero-task-cat-dot" style="background:${safeCssColor(cat.color)}" aria-hidden="true"></span>` +
      escHtml(cat.label);
    return;
  }

  const panelId = `${elId}-panel`;
  const itemsHtml = categories
    .map(
      (c) =>
        `<button class="hero-cat-item" role="menuitem" data-tag="${escHtml(c.id)}"` +
        ` aria-label="${escHtml(c.label)}">` +
        `<span class="hero-cat-item-dot" style="background:${safeCssColor(c.color)}" aria-hidden="true"></span>` +
        escHtml(c.label) +
        (c.id === tag
          ? `<span class="hero-cat-item-check" aria-hidden="true">&#10003;</span>`
          : '') +
        `</button>`
    )
    .join('');

  el.innerHTML =
    `<div class="hero-cat-wrap">` +
    `<button class="hero-task-cat-btn" aria-label="Change category" aria-haspopup="true" aria-expanded="false">` +
    `<span class="hero-task-cat-dot" style="background:${safeCssColor(cat.color)}" aria-hidden="true"></span>` +
    `<span class="hero-cat-label">${escHtml(cat.label)}</span>` +
    `<span class="hero-cat-caret" aria-hidden="true">&#9660;</span>` +
    `</button>` +
    `<div class="hero-cat-panel" id="${panelId}" role="menu" style="display:none">` +
    itemsHtml +
    `</div>` +
    `</div>`;

  _heroBindCatPicker(el.querySelector('.hero-cat-wrap'));
}

/**
 * Binds open/close/select keyboard and pointer events on a `.hero-cat-wrap` element.
 * @param {HTMLElement} wrap - The `.hero-cat-wrap` container.
 */
function _heroBindCatPicker(wrap) {
  if (!wrap) return;
  const btn = wrap.querySelector('.hero-task-cat-btn');
  const panel = wrap.querySelector('.hero-cat-panel');
  if (!btn || !panel) return;

  function openPanel() {
    panel.style.display = '';
    btn.setAttribute('aria-expanded', 'true');
    const first = panel.querySelector('.hero-cat-item');
    if (first) first.focus();
  }

  function closePanel() {
    panel.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', () => {
    panel.style.display !== 'none' ? closePanel() : openPanel();
  });

  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPanel();
    }
  });

  const items = Array.from(panel.querySelectorAll('.hero-cat-item'));
  items.forEach((item, idx) => {
    item.addEventListener('click', () => {
      _heroCatSelect(item.dataset.tag);
      closePanel();
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _heroCatSelect(item.dataset.tag);
        closePanel();
      } else if (e.key === 'Escape') {
        closePanel();
        btn.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items[idx + 1]) items[idx + 1].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items[idx - 1]) items[idx - 1].focus();
      }
    });
  });
}

/**
 * Updates the active entry's category, persists, and re-renders.
 * @param {string} newTag - Category ID to apply.
 */
function _heroCatSelect(newTag) {
  if (!activeTimer) return;
  const entry = entries.find((e) => e.id === activeTimer.entryId);
  if (!entry) return;
  entry.tag = newTag;
  save();
  renderHeroCard();
  render();
}

/**
 * Returns "↳ last note X ago" text for the most recent session-note on an entry,
 * or an empty string when no session notes have been added yet.
 * @param {string} entryId - ID of the active log entry.
 * @returns {string}
 */
function _heroLastNoteText(entryId) {
  const latest = logNotes
    .filter((n) => n.type === 'session-note' && n.entryId === entryId)
    .sort((a, b) => b.ts - a.ts)[0];
  if (!latest) return '';
  return `↳ last note ${fmtAgo(latest.ts)}`;
}

/**
 * Returns the number of distinct time entries today for the same task text.
 * @param {Object} entry
 * @returns {number}
 */
function _heroSessionCount(entry) {
  const key = entry.text.toLowerCase();
  const todayKey = entry.date || dk(new Date());
  return entries.filter((e) => e.date === todayKey && e.text.toLowerCase() === key).length;
}

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Binds all Hero Card button events.
 * Called once from DOMContentLoaded in 07-lifecycle.js.
 */
function initHero() {
  // Start tracking
  document.getElementById('heroStartBtn')?.addEventListener('click', _heroHandleStart);
  document.getElementById('heroComposerInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _heroHandleStart();
    // Prevent Space from opening the rapid-log overlay while typing here
    if (e.code === 'Space') e.stopPropagation();
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
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.hero-cat-wrap')) {
      document.querySelectorAll('.hero-cat-panel').forEach((p) => {
        p.style.display = 'none';
      });
      document.querySelectorAll('.hero-task-cat-btn[aria-expanded="true"]').forEach((b) => {
        b.setAttribute('aria-expanded', 'false');
      });
    }
  });

  // Initial render
  renderHeroCard();
}
