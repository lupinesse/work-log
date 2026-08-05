/* ── Today's tasks — board DnD, tabs & live strip ── */

/** Shared drag-state for board column DnD (set by dragstart, read by drop). */
let _boardDragTaskId = null;

/**
 * Moves a task to a new board column, updating its status and timer state.
 * Dropping into In Progress stops any running timer, creates a new time entry,
 * and starts tracking. Dropping into Done or To Do stops the active timer.
 * @param {string} taskId    - The plan task ID to move.
 * @param {string} newStatus - Target status: 'todo' | 'inprogress' | 'done'.
 * @returns {void}
 */
function moveTaskToColumn(taskId, newStatus) {
  const t = planTasks.find((task) => task.id === taskId);
  if (!t) {
    wlLog.warn('board: moveTaskToColumn — task not found', { id: taskId });
    return;
  }
  if (t.status === newStatus) return;

  wlLog.info('board: moveTaskToColumn', { id: taskId, from: t.status, to: newStatus });
  t.status = newStatus;

  // Stop the active timer only if it was tracking this exact task
  const stopTimerIfMatches = () => {
    if (activeTimer) {
      const timerEntry = entries.find((entry) => entry.id === activeTimer.entryId);
      if (timerEntry && timerEntry.text.toLowerCase() === t.text.toLowerCase()) stopTimer();
    }
  };

  if (newStatus === 'done') {
    if (!t.completedAt) t.completedAt = Date.now();
    stopTimerIfMatches();
  } else if (newStatus === 'todo') {
    delete t.completedAt;
    stopTimerIfMatches();
  } else if (newStatus === 'inprogress') {
    delete t.completedAt;
    // Stop any active timer unconditionally — only one task can be tracked at a time
    if (activeTimer) stopTimer();
    const entry = {
      id: Date.now() + '',
      text: t.text,
      tag: t.tag || 'other',
      ts: safeRoundedStart(),
      date: dk(new Date()),
    };
    entries.push(entry);
    save();
    startTimer(entry.id);
  }

  savePlan();
  renderPlan();
}

/**
 * Makes each rendered board card draggable and wires its dragstart/dragend.
 * Called once per `renderPlan()` cycle after columns are populated.
 * Static column drop-zone listeners are set up once in `initBoardColumnDnD()`.
 * @returns {void}
 */
function bindBoardColumnDnD() {
  document.querySelectorAll('.kb-cards > .plan-item').forEach((card) => {
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', (event) => {
      _boardDragTaskId = card.dataset.pid;
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('kb-dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('kb-dragging');
      document
        .querySelectorAll('.kb-col--drop-over')
        .forEach((el) => el.classList.remove('kb-col--drop-over'));
    });
  });
}

/**
 * Registers dragover, dragleave, and drop listeners on the three static board
 * column lists. Called exactly once on DOMContentLoaded from `07-lifecycle.js`.
 * Card draggable wiring (re-rendered each cycle) stays in `bindBoardColumnDnD()`.
 * @returns {void}
 */
function initBoardColumnDnD() {
  const COLUMN_MAP = {
    planList: 'todo',
    progressList: 'inprogress',
    doneList: 'done',
  };

  Object.keys(COLUMN_MAP).forEach((listId) => {
    const listEl = document.getElementById(listId);
    if (!listEl) return;

    listEl.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      listEl.closest('.kb-col').classList.add('kb-col--drop-over');
    });
    listEl.addEventListener('dragleave', (event) => {
      // Only remove highlight when truly leaving the column (not a child element)
      if (!listEl.closest('.kb-col').contains(event.relatedTarget)) {
        listEl.closest('.kb-col').classList.remove('kb-col--drop-over');
      }
    });
    listEl.addEventListener('drop', (event) => {
      event.preventDefault();
      listEl.closest('.kb-col').classList.remove('kb-col--drop-over');
      if (_boardDragTaskId) {
        moveTaskToColumn(_boardDragTaskId, COLUMN_MAP[listId]);
        _boardDragTaskId = null;
      }
    });
  });
}

/**
 * Initialises the tabbed board: wires tab-click handlers, restores the last
 * active tab from localStorage, and sets up drag-over-tab lane switching so
 * users can drag a card onto a tab label to reveal that column before dropping.
 * Called once on DOMContentLoaded from `07-lifecycle.js`.
 * @returns {void}
 */
function initBoardTabs() {
  const BOARD_TAB_KEY = 'wl_board_tab';

  /**
   * Activates one board tab: marks it `is-active`, shows its column, hides the rest.
   * @param {string} tabId - One of 'todo' | 'inprogress' | 'done'.
   */
  function activateBoardTab(tabId) {
    document.querySelectorAll('.board-tab').forEach((btn) => {
      const active = btn.dataset.tab === tabId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
      // Roving tabindex: only the active tab is in the tab order (WCAG 2.1.1)
      btn.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('.kb-col[data-col]').forEach((col) => {
      col.classList.toggle('kb-col--active', col.dataset.col === tabId);
    });
    try {
      localStorage.setItem(BOARD_TAB_KEY, tabId);
    } catch (err) {
      wlLog.warn('initBoardTabs: localStorage.setItem failed (quota?)', err);
    }
  }

  const storedTab = (() => {
    try {
      return localStorage.getItem(BOARD_TAB_KEY);
    } catch (err) {
      wlLog.warn('initBoardTabs: localStorage.getItem failed', err);
      return null;
    }
  })();
  activateBoardTab(storedTab || 'todo');

  document.querySelectorAll('.board-tab').forEach((btn) => {
    btn.addEventListener('click', () => activateBoardTab(btn.dataset.tab));

    // Drag over a tab → switch to that lane so the card can be dropped there
    btn.addEventListener('dragover', (event) => {
      event.preventDefault();
      btn.classList.add('board-tab--drop');
      activateBoardTab(btn.dataset.tab);
    });
    btn.addEventListener('dragleave', () => btn.classList.remove('board-tab--drop'));
    btn.addEventListener('drop', () => btn.classList.remove('board-tab--drop'));
  });

  // Arrow-key navigation between tabs (WCAG SC 4.1.2 tablist pattern)
  const tabsEl = document.getElementById('boardTabs');
  if (tabsEl) {
    tabsEl.addEventListener('keydown', (event) => {
      const tabs = [...document.querySelectorAll('.board-tab')];
      const idx = tabs.findIndex((tab) => tab === document.activeElement);
      if (idx === -1) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        tabs[(idx + 1) % tabs.length].focus();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        tabs[(idx - 1 + tabs.length) % tabs.length].focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        tabs[0].focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        tabs[tabs.length - 1].focus();
      }
    });
  }
}

/**
 * Updates the `#boardLive` running-task strip above the board tabs.
 * Shows the strip (with task title, category, and elapsed clock) when a
 * non-paused timer is active; hides it otherwise.
 * Called from `renderPlan()` after every render cycle.
 * @returns {void}
 */
function updateBoardLive() {
  const stripEl = document.getElementById('boardLive');
  if (!stripEl) return;

  if (!activeTimer || activeTimer.paused) {
    stripEl.hidden = true;
    return;
  }

  const liveEntry = entries.find((entry) => entry.id === activeTimer.entryId);
  if (!liveEntry) {
    stripEl.hidden = true;
    return;
  }

  if (!liveEntry.tag)
    wlLog.warn('updateBoardLive: entry has no tag, falling back to "other"', liveEntry.id);
  const cat = getCat(liveEntry.tag || 'other');
  const elapsed = fmtElapsed(getElapsedMs());

  stripEl.innerHTML = `<button class="board-live__card" id="boardLiveCard"
      aria-label="Currently tracking: ${escHtml(liveEntry.text)}">
    <span class="board-live__pulse" aria-hidden="true"></span>
    <span class="board-live__body">
      <span class="board-live__title">${escHtml(liveEntry.text)}</span>
      <span class="board-live__meta">
        <span class="board-live__dot" style="background:${escHtml(cat.color)}" aria-hidden="true"></span>
        ${escHtml(cat.label)}
      </span>
    </span>
    <span class="board-live__clock" id="boardLiveClock">${elapsed}</span>
  </button>`;
  stripEl.hidden = false;

  // Clicking the live strip navigates to the In Progress tab
  document.getElementById('boardLiveCard')?.addEventListener('click', () => {
    document.querySelector('.board-tab[data-tab="inprogress"]')?.click();
  });
}
