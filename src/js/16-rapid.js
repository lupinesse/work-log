// ── 16-rapid.js — Quick Capture modal (QC_FinalV3 click-first design) ──
//
// Two-state modal: idle (no timer) and running (timer active).
// Task list is grouped: In progress / To-do / Recent.
// Filter chips narrow the list by category.
// Hovering a task row reveals a "▸ start" or "▸ switch" button.
// "Log without tracking" either commits typed text as a log entry or
// redirects to the ad-hoc row in the time log when input is empty.

/** @type {boolean} */
let _rapidOpen = false;

/**
 * Active category chip selection. Serves two purposes:
 * - filters the task list to show only that category, and
 * - tags any ad-hoc log entry created via "Log without tracking".
 * null means "All" (no filter; entry falls back to selectedTag).
 * @type {string|null}
 */
let _qcFilterCat = null;

/** @type {string} */
let _qcSearch = '';

/** @type {number|null} */
let _qcTickInterval = null;

// ── Open / close ─────────────────────────────────────────────────────────────

/** Opens the quick-capture overlay and focuses the search input. */
function openRapid() {
  const overlay = document.getElementById('rapidOverlay');
  if (!overlay) return;
  _rapidOpen = true;
  _qcFilterCat = null;
  _qcSearch = '';
  overlay.style.display = 'flex';
  _qcRenderAll();
  const inp = document.getElementById('rapidInput');
  if (inp) {
    inp.value = '';
    inp.focus();
  }
  _qcStartTick();
}

/** Hides the quick-capture overlay and stops the elapsed ticker. */
function closeRapid() {
  const overlay = document.getElementById('rapidOverlay');
  if (overlay) overlay.style.display = 'none';
  _rapidOpen = false;
  _qcStopTick();
}

// ── Log-only action ───────────────────────────────────────────────────────────

/**
 * Handles the "Log without tracking" footer button and Enter keypress.
 *
 * Parses inline shorthand tokens from the input before creating the entry:
 *   `#<cat>` overrides category, `!<sig>` sets the signifier,
 *   `><date>` sets the entry date (today / tomorrow / YYYY-MM-DD / weekday).
 *
 * - Non-empty text after token stripping → creates a log entry (no timer) and closes.
 * - Only tokens, no text → refocuses the input so the user adds a description.
 * - Completely empty input → closes and focuses the ad-hoc row in the time log.
 */
function _qcLogOnly() {
  const inp = document.getElementById('rapidInput');
  const raw = inp ? inp.value.trim() : '';
  if (!raw) {
    wlLog.info('_qcLogOnly: empty input, redirecting focus to ad-hoc row');
    closeRapid();
    const adHoc = document.getElementById('tlAdHocInput');
    if (adHoc) adHoc.focus();
    return;
  }

  const parsed = parseRapidTokens(raw, categories);
  if (!parsed.text) {
    // Tokens present but no description — ask the user to add one
    if (inp) inp.focus();
    return;
  }

  const tag =
    parsed.tag || _qcFilterCat || selectedTag || (categories[0] && categories[0].id) || 'other';
  const entryDate = parsed.date || dk(new Date());

  /** @type {Object} */
  const entry = {
    id: Date.now() + '',
    text: parsed.text,
    tag,
    ts: safeRoundedStart(),
    date: entryDate,
    _uncategorised: !parsed.tag && !_qcFilterCat,
  };
  if (parsed.signifier) entry.signifier = parsed.signifier;

  entries.push(entry);
  save();
  wlLog.info('_qcLogOnly: entry created', {
    tag,
    signifier: parsed.signifier,
    date: entryDate,
    uncategorised: entry._uncategorised,
  });
  closeRapid();
  render();
}

// ── Running-strip ticker ──────────────────────────────────────────────────────

/** Starts a 1-second interval to update the elapsed-time label in the running strip. */
function _qcStartTick() {
  _qcStopTick();
  if (activeTimer) {
    _qcTickInterval = setInterval(_qcUpdateElapsed, 1000);
  }
}

/** Clears the running-strip interval. */
function _qcStopTick() {
  if (_qcTickInterval) {
    clearInterval(_qcTickInterval);
    _qcTickInterval = null;
  }
}

/** Updates only the elapsed-time label; called every second by the ticker. */
function _qcUpdateElapsed() {
  const el = document.getElementById('qcRunElapsed');
  if (!el || !activeTimer) return;
  el.textContent = fmtElapsed(getElapsedMs());
}

// ── Render helpers ─────────────────────────────────────────────────────────────

/** Re-renders all dynamic regions of the quick-capture modal. */
function _qcRenderAll() {
  _qcRenderRunningStrip();
  _qcRenderCatChips();
  _qcRenderTaskList();
  _qcRenderTokenPreview({ tag: null, signifier: null, date: null });
}

/**
 * Shows or hides the running strip.
 * When a timer is active the strip displays the current task and elapsed time.
 * When idle the strip is hidden and the pulsing-dot class is removed.
 */
function _qcRenderRunningStrip() {
  const strip = document.getElementById('qcRunningStrip');
  const overlay = document.getElementById('rapidOverlay');
  if (!strip) return;

  if (!activeTimer) {
    strip.style.display = 'none';
    overlay && overlay.classList.remove('qc-is-running');
    return;
  }

  const entry = entries.find((e) => e.id === activeTimer.entryId);
  if (!entry) {
    strip.style.display = 'none';
    overlay && overlay.classList.remove('qc-is-running');
    return;
  }

  strip.style.display = 'flex';
  overlay && overlay.classList.add('qc-is-running');

  const taskEl = document.getElementById('qcRunTask');
  if (taskEl) taskEl.innerHTML = jiraTicketHtml(entry.text);
  _qcUpdateElapsed();
}

/**
 * Renders the "All" chip plus one chip per category.
 * The active chip is highlighted; clicking a chip filters the task list.
 */
function _qcRenderCatChips() {
  const el = document.getElementById('rapidCats');
  if (!el) return;

  const allBtn =
    `<button class="qc-cat-chip${!_qcFilterCat ? ' active' : ''}"` +
    ` data-cat="" aria-pressed="${!_qcFilterCat}">All</button>`;

  const catBtns = pickableCategories(categories, _qcFilterCat)
    .map(
      (c) =>
        `<button class="qc-cat-chip${_qcFilterCat === c.id ? ' active' : ''}"` +
        ` data-cat="${escHtml(c.id)}"` +
        ` aria-pressed="${_qcFilterCat === c.id}">` +
        `<span class="qc-chip-dot" style="background:${safeCssColor(c.color)}" aria-hidden="true"></span>` +
        `${escHtml(c.label)}` +
        `</button>`
    )
    .join('');

  el.innerHTML = allBtn + catBtns;

  el.querySelectorAll('.qc-cat-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      _qcFilterCat = btn.dataset.cat || null;
      _qcRenderCatChips();
      _qcRenderTaskList();
    });
  });
}

/**
 * Returns the HTML for one task row in the task list.
 * The action button is opacity-0 and revealed on row hover via CSS.
 *
 * @param {string} rowId - Unique row key: entry ID or 'plan:' + plan-task ID.
 * @param {string} text - Task/entry description text.
 * @param {{ id: string, label: string, color: string }} cat - Resolved category.
 * @param {boolean} isActive - True when this row matches the currently-running entry.
 * @returns {string} HTML string.
 */
function _qcTaskRowHtml(rowId, text, cat, isActive) {
  const actionLabel = isActive ? '■ now' : activeTimer ? '▸ switch' : '▸ start';
  const ariaLabel = isActive
    ? `Currently tracking: ${text}`
    : `${activeTimer ? 'Switch to' : 'Start'}: ${text}`;
  return (
    `<div class="qc-task-row${isActive ? ' qc-task-row--active' : ''}"` +
    ` role="option" aria-selected="${isActive}">` +
    `<span class="qc-task-dot" style="background:${safeCssColor(cat.color)}" aria-hidden="true"></span>` +
    `<span class="qc-task-text" title="${escHtml(text)}">${escHtml(text)}</span>` +
    `<button class="qc-task-action-btn"` +
    ` data-row-id="${escHtml(rowId)}"` +
    ` data-row-text="${escHtml(text)}"` +
    ` data-row-tag="${escHtml(cat.id)}"` +
    ` data-is-active="${isActive}"` +
    ` aria-label="${escHtml(ariaLabel)}">` +
    `${actionLabel}` +
    `</button>` +
    `</div>`
  );
}

/**
 * Collects and deduplicates the three task groups for the current filter state.
 * Pure data function — performs no DOM operations.
 *
 * @param {string} searchLower - Lower-cased search string; empty string means no filter.
 * @param {string} todayKey - Date key for today in YYYY-MM-DD format.
 * @returns {{ inProgress: Object[], todo: Object[], recent: Object[] }}
 */
function _qcBuildTaskGroups(searchLower, todayKey) {
  /** @param {string} text @returns {boolean} */
  const matchSearch = (text) => !searchLower || text.toLowerCase().includes(searchLower);
  /** @param {string} tag @returns {boolean} */
  const matchCat = (tag) => !_qcFilterCat || tag === _qcFilterCat;

  // ── In progress: the currently-running entry (if any) ─────────────────
  const activeEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;

  /** @type {Object[]} */
  const inProgress = [];
  if (activeEntry && matchSearch(activeEntry.text) && matchCat(activeEntry.tag)) {
    inProgress.push(activeEntry);
  }

  // ── To-do: today's open plan tasks ───────────────────────────────────
  const seen = new Set(inProgress.map((e) => e.text.toLowerCase()));
  const todo = planTasks.filter(
    (t) =>
      t.date === todayKey &&
      t.status !== 'done' &&
      !t._migrated &&
      matchSearch(t.text) &&
      matchCat(t.tag) &&
      !seen.has(t.text.toLowerCase())
  );
  todo.forEach((t) => seen.add(t.text.toLowerCase()));

  // ── Recent: unique entries from today, excluding the active one ───────
  /** @type {Object[]} */
  const recent = [];
  [...entries]
    .filter((e) => e.date === todayKey && e.id !== (activeTimer ? activeTimer.entryId : ''))
    .reverse()
    .forEach((e) => {
      const key = e.text.toLowerCase();
      if (!seen.has(key) && matchSearch(e.text) && matchCat(e.tag)) {
        seen.add(key);
        recent.push(e);
      }
    });

  return { inProgress, todo, recent };
}

/**
 * Renders the task list HTML string from pre-built group data.
 * Receives all inputs as parameters — performs no DOM or module-state reads.
 *
 * @param {{ inProgress: Object[], todo: Object[], recent: Object[] }} groups
 * @param {string} search - Original (un-lowercased) search string for the empty-state message.
 * @returns {string} HTML string ready for assignment to `el.innerHTML`.
 */
function _qcTaskListHtml(groups, search) {
  const { inProgress, todo, recent } = groups;

  if (!inProgress.length && !todo.length && !recent.length) {
    const msg = search
      ? `No tasks match — press ↵ to log &ldquo;<strong>${escHtml(search)}</strong>&rdquo;`
      : 'No tasks for today yet — type above to log something';
    return `<div class="qc-empty">${msg}</div>`;
  }

  let html = '';

  if (inProgress.length) {
    html += '<div class="qc-group-hdr" aria-hidden="true">In progress</div>';
    inProgress.forEach((e) => {
      html += _qcTaskRowHtml(e.id, e.text, getCat(e.tag), true);
    });
  }

  if (todo.length) {
    html += '<div class="qc-group-hdr" aria-hidden="true">To-do</div>';
    todo.slice(0, 6).forEach((t) => {
      html += _qcTaskRowHtml('plan:' + t.id, t.text, getCat(t.tag), false);
    });
  }

  if (recent.length) {
    html += '<div class="qc-group-hdr" aria-hidden="true">Recent</div>';
    recent.slice(0, 5).forEach((e) => {
      html += _qcTaskRowHtml(e.id, e.text, getCat(e.tag), false);
    });
  }

  return html;
}

/**
 * Attaches click listeners to task-row action buttons and their parent rows.
 * Separated from rendering so each has a single responsibility.
 *
 * @param {HTMLElement} el - The #qcTaskList container element.
 */
function _qcBindTaskListEvents(el) {
  el.querySelectorAll('.qc-task-action-btn').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      _qcActivateRow(
        btn.dataset.rowId,
        btn.dataset.rowText,
        btn.dataset.rowTag,
        btn.dataset.isActive === 'true'
      );
    });
  });

  // Row click delegates to its action button for a larger hit target.
  el.querySelectorAll('.qc-task-row').forEach((row) => {
    row.addEventListener('click', () => {
      row.querySelector('.qc-task-action-btn')?.click();
    });
  });
}

/**
 * Orchestrates data collection, rendering, and event binding for the task list.
 * Delegates each concern to a single-purpose helper.
 */
function _qcRenderTaskList() {
  const el = document.getElementById('qcTaskList');
  if (!el) return;
  const groups = _qcBuildTaskGroups(_qcSearch.toLowerCase(), dk(new Date()));
  el.innerHTML = _qcTaskListHtml(groups, _qcSearch);
  _qcBindTaskListEvents(el);
}

// ── Token preview ─────────────────────────────────────────────────────────────

/**
 * Renders colored pill badges below the search input for any recognised inline
 * tokens in the current input value. Hides the preview container when no tokens
 * are active (e.g. on modal open or after the field is cleared).
 *
 * @param {{ tag: string|null, signifier: string|null, date: string|null }} parsed
 *   Result of parseRapidTokens() for the current raw input value.
 */
function _qcRenderTokenPreview(parsed) {
  const el = document.getElementById('qcTokenPreview');
  if (!el) return;

  const chips = [];

  if (parsed.tag) {
    const cat = getCat(parsed.tag);
    chips.push(
      `<span class="qc-token qc-token--cat" style="border-color:${safeCssColor(cat.color)}33;color:${safeCssColor(cat.color)}">` +
        `<span class="qc-token-dot" style="background:${safeCssColor(cat.color)}" aria-hidden="true"></span>` +
        `${escHtml(cat.label)}` +
        `</span>`
    );
  }

  if (parsed.signifier) {
    // SIG_SYMBOL / SIG_TITLE are globals from 10b-signifiers.js, loaded before this file.
    const symbol =
      typeof SIG_SYMBOL !== 'undefined'
        ? SIG_SYMBOL[parsed.signifier] || parsed.signifier
        : parsed.signifier;
    const title =
      typeof SIG_TITLE !== 'undefined'
        ? SIG_TITLE[parsed.signifier] || parsed.signifier
        : parsed.signifier;
    chips.push(
      `<span class="qc-token qc-token--sig" title="${escHtml(title)}">` +
        `${escHtml(symbol)} ${escHtml(title)}` +
        `</span>`
    );
  }

  if (parsed.date) {
    chips.push(`<span class="qc-token qc-token--date">` + `📅 ${escHtml(parsed.date)}` + `</span>`);
  }

  if (!chips.length) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  el.innerHTML = chips.join('');
  el.style.display = 'flex';
}

// ── Task activation ───────────────────────────────────────────────────────────

/**
 * Starts or switches to a task from the quick-capture list.
 * If the row is already the active timer, just closes the modal.
 * For plan-task rows a fresh time entry is created.
 *
 * @param {string} rowId - Row ID from the data attribute.
 * @param {string} text - Task description.
 * @param {string} tag - Category ID.
 * @param {boolean} isActive - Whether this is the currently-running task.
 */
function _qcActivateRow(rowId, text, tag, isActive) {
  if (isActive) {
    wlLog.info('_qcActivateRow: clicked already-active row, just closing', { rowId });
    closeRapid();
    return;
  }

  const switching = !!activeTimer;
  if (switching) stopTimer();

  // Re-use the existing entry for log entries; always create new for plan tasks.
  let entry = rowId.startsWith('plan:') ? null : entries.find((e) => e.id === rowId);

  if (!entry) {
    entry = {
      id: Date.now() + '',
      text,
      tag,
      ts: safeRoundedStart(),
      date: dk(new Date()),
    };
    entries.push(entry);
    save();
    wlLog.info('_qcActivateRow: new entry created', { rowId, tag, switched: switching });
  } else {
    wlLog.info('_qcActivateRow: resuming existing entry', {
      entryId: entry.id,
      switched: switching,
    });
  }

  promoteMatchingTaskToInProgress(text);
  startTimer(entry.id);
  closeRapid();
  render();
}

// ── Initialisation ─────────────────────────────────────────────────────────────

/** Registers all event listeners for the quick-capture overlay. Called once on DOMContentLoaded. */
function initRapid() {
  // Escape closes the overlay
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _rapidOpen) closeRapid();
  });

  // Open via the ✏️ button in the Today's Tasks header
  document.getElementById('rapidOpenBtn')?.addEventListener('click', openRapid);

  // Close button
  document.getElementById('rapidClose')?.addEventListener('click', closeRapid);

  // Log without tracking
  document.getElementById('rapidLogOnly')?.addEventListener('click', _qcLogOnly);

  // Search / filter input — parse inline tokens on every keystroke
  const inp = document.getElementById('rapidInput');
  if (inp) {
    inp.addEventListener('input', () => {
      const parsed = parseRapidTokens(inp.value, categories);
      // Use the token-stripped text for task-list filtering
      _qcSearch = parsed.text;
      // Auto-activate the category chip when a #cat token is recognised;
      // clear it again when the token is removed.
      _qcFilterCat = parsed.tag || null;
      _qcRenderCatChips();
      _qcRenderTaskList();
      _qcRenderTokenPreview(parsed);
    });
    inp.addEventListener('keydown', (e) => {
      // Prevent the Space key from bubbling to the global rapid-open listener
      if (e.code === 'Space') e.stopPropagation();
      if (e.key === 'Enter') _qcLogOnly();
    });
  }

  // Stop current timer from the running strip
  document.getElementById('qcRunStop')?.addEventListener('click', () => {
    if (activeTimer) {
      stopTimer();
      render();
    }
    _qcRenderRunningStrip();
    _qcRenderTaskList();
    _qcStopTick();
  });

  // Dismiss overlay on backdrop click
  document.getElementById('rapidOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('rapidOverlay')) closeRapid();
  });
}
