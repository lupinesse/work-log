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
//
// Action handlers and initHero() (button binding) live in 06b-hero-events.js;
// the category quick-switch picker lives in 06c-hero-category.js. All three
// files share this module's `_hero*` state variables via the concatenated
// script scope.

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
    .filter((entry) => entry.date === todayKey && entry.tsEnd && entry.tsEnd > entry.ts)
    .reduce((sum, e) => sum + (e.tsEnd - e.ts), 0);

  const loggedEl = document.getElementById('heroLoggedToday');
  if (loggedEl) loggedEl.textContent = totalMs > 0 ? fmtDur(totalMs) : '0m';

  // Last session ended time
  const lastEl = document.getElementById('heroIdleLastSession');
  if (lastEl) {
    const last = [...entries]
      .filter((entry) => entry.date === todayKey && entry.tsEnd)
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
  [...entries].reverse().forEach((entry) => {
    const k = entry.text.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      recent.push(entry);
    }
  });

  const chips = recent.slice(0, 3);
  if (!chips.length) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = chips
    .map((entry) => {
      const cat = getCat(entry.tag);
      const isLast = chips[0] === entry;
      return (
        `<li>` +
        `<button class="hero-chip"` +
        ` data-text="${escHtml(entry.text)}" data-tag="${escHtml(entry.tag)}"` +
        ` aria-label="Start tracking: ${escHtml(entry.text)}">` +
        `<span class="hero-chip-dot" style="background:${safeCssColor(cat.color)}" aria-hidden="true"></span>` +
        `<span class="hero-chip-text">${escHtml(entry.text)}</span>` +
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
  const entry = entries.find((logEntry) => logEntry.id === activeTimer.entryId);
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
  const entry = entries.find((logEntry) => logEntry.id === activeTimer.entryId);
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
      .filter(
        (logEntry) => logEntry.date === entry.date && logEntry.tsEnd && logEntry.tsEnd > logEntry.ts
      )
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

// ── Formatting helpers ────────────────────────────────────────────────────────

/**
 * Returns "↳ last note X ago" text for the most recent session-note on an entry,
 * or an empty string when no session notes have been added yet.
 * @param {string} entryId - ID of the active log entry.
 * @returns {string}
 */
function _heroLastNoteText(entryId) {
  const latest = logNotes
    .filter((note) => note.type === 'session-note' && note.entryId === entryId)
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
  return entries.filter(
    (logEntry) => logEntry.date === todayKey && logEntry.text.toLowerCase() === key
  ).length;
}
