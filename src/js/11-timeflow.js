// ── 11-timeflow.js — Today's Flow unified section (Flow / Log / Blocks views) ──

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

/** Task ID whose note is currently being edited inline in the Flow view. */
let _flowNoteEditId = null;

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

// ─────────────────────────── day-overview strip ───────────────────────────

/**
 * Converts a minutes-from-midnight value to a percentage across the strip range.
 * Clamped to [0, 100].
 * @param {number} mins
 * @returns {number}
 */
function stripPct(mins) {
  return Math.max(
    0,
    Math.min(100, ((mins - TF_STRIP_START) / (TF_STRIP_END - TF_STRIP_START)) * 100)
  );
}

/**
 * Converts a Unix timestamp (ms) to minutes-from-midnight in local time.
 * @param {number} ts
 * @returns {number}
 */
function tsToMins(ts) {
  const date = new Date(ts);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Formats a Unix timestamp (ms) as `HH:MM` in local time.
 * @param {number} ts
 * @returns {string}
 */
function fmtHm(ts) {
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Returns the effective tracked duration (ms) of an active-timer entry,
 * honouring pause state — matches the formula used by renderFlowHeader so
 * the strip bar and Flow-view duration freeze while paused.
 * @param {object} entry
 * @returns {number} 0 if no timer is active for this entry.
 */
function activeTimerDurationMs(entry) {
  if (!activeTimer || activeTimer.entryId !== entry.id) return 0;
  if (activeTimer.paused) return activeTimer.accumulatedMs || 0;
  return Math.max(0, Date.now() - (activeTimer.startTs || entry.ts));
}

/**
 * Renders the compact day-overview strip: hour-tick labels, entry footprints,
 * and (today only) a live "now" cursor.
 * @param {string} dateKey - YYYY-MM-DD.
 */
function renderDayStrip(dateKey) {
  const el = document.getElementById('tfDayStrip');
  if (!el) return;

  // Capture wall-clock time once so the live bar and now-cursor stay consistent
  const nowMins = tsToMins(Date.now());

  // Hour-tick labels at two-hour intervals
  const ticks = [7, 9, 11, 13, 15, 17, 19, 21]
    .map(
      (hour) =>
        `<span class="tf-tick" style="left:${stripPct(hour * 60)}%">${String(hour).padStart(2, '0')}</span>`
    )
    .join('');

  // Completed entry footprints — skip entries entirely outside the strip
  // (right === left after clamping) to avoid phantom slivers at the edges.
  const bars = entries
    .filter((entry) => entry.date === dateKey && entry.tsEnd && entry.signifier !== 'cancelled')
    .map((entry) => {
      const cat = getCat(entry.tag);
      const left = stripPct(Math.max(TF_STRIP_START, tsToMins(entry.ts)));
      const right = stripPct(Math.min(TF_STRIP_END, tsToMins(entry.tsEnd)));
      if (right <= left) return '';
      return `<div class="tf-bar" style="left:${left}%;width:${Math.max(0.5, right - left)}%;background:${safeCssColor(cat.color)}"></div>`;
    })
    .join('');

  // Live timer footprint — endpoint freezes at pause so the bar doesn't keep
  // growing while the user is paused (matches renderFlowHeader's totals math).
  let liveBar = '';
  if (activeTimer && isToday(viewDate)) {
    const liveEntry = entries.find((entry) => entry.id === activeTimer.entryId);
    if (liveEntry && liveEntry.date === dateKey) {
      const liveEndMins = tsToMins(liveEntry.ts + activeTimerDurationMs(liveEntry));
      const left = stripPct(Math.max(TF_STRIP_START, tsToMins(liveEntry.ts)));
      const right = stripPct(Math.min(TF_STRIP_END, liveEndMins));
      if (right > left) {
        const cat = getCat(liveEntry.tag);
        liveBar = `<div class="tf-bar tf-bar-live" style="left:${left}%;width:${right - left}%;background:${safeCssColor(cat.color)}"></div>`;
      }
    }
  }

  // Now cursor (today only)
  let nowCursor = '';
  if (isToday(viewDate) && nowMins >= TF_STRIP_START && nowMins <= TF_STRIP_END) {
    nowCursor = `<div class="tf-now-cursor" style="left:${stripPct(nowMins)}%"></div>`;
  }

  el.innerHTML = `<div class="tf-strip-ticks">${ticks}</div><div class="tf-strip-bar">${bars}${liveBar}${nowCursor}</div>`;
}

// ─────────────────────────── gap reminder ───────────────────────────

/**
 * Finds the largest untracked gap (≥ 15 min) today, including gaps between
 * consecutive completed entries AND the trailing gap from the most recent
 * entry's end to now (which is often the most actionable). Returns null for
 * past days — only actionable today.
 * @param {string} dateKey - YYYY-MM-DD.
 * @returns {{startTs: number, endTs: number, gapMin: number}|null}
 */
function findLargestGap(dateKey) {
  if (!isToday(viewDate)) return null;
  const timed = entries
    .filter((entry) => entry.date === dateKey && entry.tsEnd && entry.signifier !== 'cancelled')
    .sort((a, b) => a.ts - b.ts);

  let largest = null;

  // Internal gaps between consecutive completed entries
  for (let i = 0; i < timed.length - 1; i++) {
    const gapMin = Math.floor((timed[i + 1].ts - timed[i].tsEnd) / 60000);
    if (gapMin >= 15 && (!largest || gapMin > largest.gapMin)) {
      largest = { startTs: timed[i].tsEnd, endTs: timed[i + 1].ts, gapMin };
    }
  }

  // Trailing gap: last entry's end → now (or EOD if the day has been ended).
  // Suppressed while a live timer is running, since the user is actively
  // tracking and the gap will close itself.
  if (timed.length && !activeTimer) {
    const last = timed[timed.length - 1];
    const eodTs = getEodTs();
    const ceiling = eodTs || Date.now();
    const trailingMin = Math.floor((ceiling - last.tsEnd) / 60000);
    if (trailingMin >= 15 && (!largest || trailingMin > largest.gapMin)) {
      largest = { startTs: last.tsEnd, endTs: ceiling, gapMin: trailingMin };
    }
  }

  return largest;
}

/**
 * Renders or hides the gap-reminder banner.
 * @param {string} dateKey
 */
function renderGapReminder(dateKey) {
  const el = document.getElementById('tfGapReminder');
  if (!el) return;
  const gap = findLargestGap(dateKey);
  if (!gap) {
    el.style.display = 'none';
    return;
  }
  const hours = Math.floor(gap.gapMin / 60);
  const mins = gap.gapMin % 60;
  let dur;
  if (hours > 0) dur = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  else dur = `${mins}m`;
  el.style.display = '';
  el.innerHTML = `<span class="tf-gap-text">${fmtHm(gap.startTs)} – ${fmtHm(gap.endTs)} · ${dur} untracked between blocks</span><button type="button" class="tf-gap-btn" id="tfGapLogBtn">＋ log it</button>`;
}

// ─────────────────────────── section header ───────────────────────────

/**
 * Renders the section header: icon, title, tracked/billable totals, and
 * the Flow / Log / Blocks segmented control.
 * @param {string} dateKey
 * @param {'flow'|'log'|'blocks'} activeView
 */
function renderFlowHeader(dateKey, activeView) {
  const el = document.getElementById('tfHeader');
  if (!el) return;

  const dayEntries = entries.filter(
    (entry) => entry.date === dateKey && entry.tsEnd && entry.signifier !== 'cancelled'
  );
  let totalMs = dayEntries.reduce((sum, e) => sum + (e.tsEnd - e.ts), 0);
  let billMs = dayEntries
    .filter((entry) => isEntryBillable(entry))
    .reduce((sum, e) => sum + (e.tsEnd - e.ts), 0);

  // Include live timer duration so both totals update while tracking
  if (activeTimer && isToday(viewDate)) {
    const liveEntry = entries.find((entry) => entry.id === activeTimer.entryId);
    if (liveEntry && liveEntry.date === dateKey && !liveEntry.tsEnd) {
      const liveMs = activeTimerDurationMs(liveEntry);
      totalMs += liveMs;
      if (isEntryBillable(liveEntry)) billMs += liveMs;
    }
  }

  const totalsHtml =
    totalMs > 0
      ? `<span class="tf-totals">${fmtDur(totalMs)} tracked${billMs > 0 ? ` · <span class="tf-bill">${fmtDur(billMs)} billable</span>` : ''}</span>`
      : '';

  // Segmented control uses ARIA `tablist`/`tab` so screen readers announce the
  // mutually-exclusive selection correctly and link each tab to its pane.
  // Roving tabindex: only the active tab is in the tab order; arrows move within.
  const segHtml = TF_VIEWS.map((view) => {
    const isActive = view === activeView;
    return `<button type="button" role="tab" class="tf-seg-btn${isActive ? ' active' : ''}" data-view="${view}" id="tfTab-${view}" aria-selected="${isActive}" aria-controls="${TF_PANE_IDS[view]}" tabindex="${isActive ? '0' : '-1'}">${TF_VIEW_LABELS[view]}</button>`;
  }).join('');

  el.innerHTML = `<span class="section-icon tf-icon" aria-hidden="true">${ICON_ACTIVITY}</span><span class="tf-title">TODAY'S FLOW</span>${totalsHtml}<div class="tf-seg" id="tfSeg" role="tablist" aria-label="Select view">${segHtml}</div>`;
}

// ─────────────────────────── Flow view ───────────────────────────

/**
 * Partitions a flat item list from buildDailyLogItems into two structures:
 * non-session-note items (the main timeline rows) and a lookup of session-note
 * items keyed by their `parentEntryId`.  Session-notes render nested inside
 * their parent entry row rather than as standalone timeline entries.
 *
 * @param {Array<object>} allItems - Items returned by buildDailyLogItems.
 * @returns {{ items: Array<object>, sessionNotesByEntry: Record<string, Array<object>> }}
 */
function partitionSessionNotes(allItems) {
  const sessionNotesByEntry = {};
  const items = allItems.filter((item) => {
    if (item.type !== 'session-note') return true;
    const pid = item.parentEntryId;
    if (!pid) {
      wlLog.warn('partitionSessionNotes: orphaned session-note discarded, id=' + item.id);
      return false;
    }
    if (!sessionNotesByEntry[pid]) sessionNotesByEntry[pid] = [];
    sessionNotesByEntry[pid].push(item);
    return false;
  });
  return { items, sessionNotesByEntry };
}

/**
 * Builds the HTML fragment for a list of session-notes nested under a parent
 * entry row. Returns an empty string when there are no notes.
 * @param {Array<object>} notes - Session-note items for one parent entry.
 * @returns {string} HTML string, or `''` if notes is empty.
 */
function buildSessionNotesHtml(notes) {
  if (!notes.length) return '';
  return (
    `<ul class="tf-session-notes" aria-label="Session notes">` +
    notes
      .map(
        (note) =>
          `<li class="tf-session-note">` +
          `<span class="tf-sn-time">${fmtHm(note.ts)}</span>` +
          `<span class="tf-sn-text">${note.text}</span>` +
          `</li>`
      )
      .join('') +
    `</ul>`
  );
}

/**
 * Builds the note display / edit widget for a task-type flow row.
 * Shows read-only text when not editing; shows a textarea when editing.
 * @param {{ id: string, note: (string|undefined) }} task - The plan task object.
 * @param {boolean} isEditing - Whether this task's note is being edited.
 * @returns {string} HTML string.
 */
function buildFlowTaskNoteHtml(task, isEditing) {
  const hasNote = !!(task.note && task.note.trim());
  if (isEditing) {
    return `<div class="tf-task-note-edit" data-taskid="${task.id}">
        <textarea class="tf-task-note-input" data-taskid="${task.id}" rows="2" aria-label="note for task" placeholder="add a note…">${escHtml(task.note || '')}</textarea>
        <div class="tf-task-note-actions">
          <button class="tf-task-note-save" data-taskid="${task.id}">save</button>
          ${hasNote ? `<button class="tf-task-note-del" data-taskid="${task.id}">remove</button>` : ''}
          <button class="tf-task-note-cancel" data-taskid="${task.id}">cancel</button>
        </div>
      </div>`;
  }
  const label = hasNote ? 'edit note' : 'add note';
  return `<div class="tf-task-note">
      ${hasNote ? `<span class="tf-task-note-text">${escHtml(task.note)}</span>` : ''}
      <button class="tf-task-note-btn${hasNote ? ' tf-task-note-btn--has' : ''}" data-taskid="${task.id}" title="${label}" aria-label="${label}">${hasNote ? '📝' : '+ note'}</button>
    </div>`;
}

/**
 * Binds note edit/save/remove/cancel events on the Flow pane after each render.
 * Listeners are attached to freshly-rendered child elements; prior children are
 * discarded by the innerHTML replacement in renderFlowView, so there are no
 * orphan listeners. Both renderFlowView and renderPlan are called after mutations
 * so the Flow pane and the kanban board stay in sync.
 * @param {HTMLElement} pane - The #tfFlowPane element.
 */
function bindFlowNoteEvents(pane) {
  const dateKey = dk(viewDate);

  /** Focuses the note textarea for the given task ID after the next render. */
  function focusFlowNoteInput(tid) {
    setTimeout(() => {
      const ta = pane.querySelector(`.tf-task-note-input[data-taskid="${tid}"]`);
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }, 0);
  }

  pane.querySelectorAll('.tf-task-note-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const tid = btn.dataset.taskid;
      _flowNoteEditId = _flowNoteEditId === tid ? null : tid;
      renderFlowView(dateKey);
      if (_flowNoteEditId) focusFlowNoteInput(tid);
    });
  });

  pane.querySelectorAll('.tf-task-note-save').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.taskid;
      const ta = btn.closest('.tf-task-note-edit').querySelector('.tf-task-note-input');
      const val = ta.value.trim();
      const task = planTasks.find((taskItem) => taskItem.id === tid);
      if (task) {
        if (val) task.note = val;
        else delete task.note;
        savePlan();
      }
      _flowNoteEditId = null;
      renderFlowView(dateKey);
      renderPlan();
    });
  });

  pane.querySelectorAll('.tf-task-note-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.taskid;
      const task = planTasks.find((taskItem) => taskItem.id === tid);
      if (task) {
        delete task.note;
        savePlan();
      }
      _flowNoteEditId = null;
      renderFlowView(dateKey);
      renderPlan();
    });
  });

  pane.querySelectorAll('.tf-task-note-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      _flowNoteEditId = null;
      renderFlowView(dateKey);
    });
  });

  pane.querySelectorAll('.tf-task-note-input').forEach((ta) => {
    ta.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        ta.closest('.tf-task-note-edit').querySelector('.tf-task-note-save').click();
      }
      if (event.key === 'Escape') {
        ta.closest('.tf-task-note-edit').querySelector('.tf-task-note-cancel').click();
      }
    });
    ta.addEventListener('click', (event) => event.stopPropagation());
  });
}

/**
 * Renders the Flow view: a vertical list where each entry's accent strip height
 * is proportional to its duration (height = max(64, 0.6 × minutes) px), giving
 * longer tasks more visual weight.
 * @param {string} dateKey
 */
function renderFlowView(dateKey) {
  const el = document.getElementById('tfFlowPane');
  if (!el) return;

  const { items, sessionNotesByEntry } = partitionSessionNotes(buildDailyLogItems(dateKey));

  if (!items.length) {
    el.innerHTML = `<div class="tf-empty">No entries for ${isToday(viewDate) ? 'today' : 'this day'} yet.</div>`;
    return;
  }

  el.innerHTML = items
    .map((item) => {
      const startLabel = fmtHm(item.ts);

      // Look up the underlying entry object for entry-type items
      const entryObj =
        item.type === 'entry' && item.entryId
          ? entries.find((entry) => entry.id === item.entryId)
          : null;

      // Look up the task object for task-type items (status update rows)
      const taskObj =
        item.type === 'task' && item.taskId
          ? planTasks.find((task) => task.id === item.taskId)
          : null;

      let durationMin = 0;
      let durMs = 0;
      let isLive = false;
      if (entryObj) {
        isLive = !!(activeTimer && activeTimer.entryId === entryObj.id);
        // Use the paused-aware helper for live entries so the duration freezes
        // while the timer is paused, matching renderFlowHeader and renderDayStrip.
        const liveMs = isLive ? activeTimerDurationMs(entryObj) : 0;
        durMs = entryObj.tsEnd ? entryObj.tsEnd - entryObj.ts : liveMs;
        if (durMs > 0) durationMin = Math.max(1, Math.round(durMs / 60000));
      }

      // Strip height scales with duration; non-entry items (notes, tasks) get a fixed height
      const stripH = item.type === 'entry' ? Math.max(64, Math.round(0.6 * durationMin)) : 40;

      const notes = entryObj ? sessionNotesByEntry[entryObj.id] || [] : [];

      return `
        <div class="tf-flow-row${isLive ? ' live' : ''}">
          <div class="tf-flow-time">
            <span class="tf-flow-hm">${startLabel}</span>
            ${durMs > 0 ? `<span class="tf-flow-dur">${fmtDur(durMs)}</span>` : ''}
          </div>
          <div class="tf-flow-strip" style="height:${stripH}px;background:${safeCssColor(item.color)}">
            ${isLive ? '<span class="tf-flow-pulse" aria-hidden="true"></span>' : ''}
          </div>
          <div class="tf-flow-body" style="min-height:${stripH}px">
            <div class="tf-flow-text">${item.text}</div>
            <div class="tf-flow-sub">${item.sub}</div>
            ${buildSessionNotesHtml(notes)}
            ${taskObj ? buildFlowTaskNoteHtml(taskObj, _flowNoteEditId === taskObj.id) : ''}
          </div>
        </div>`;
    })
    .join('');

  bindFlowNoteEvents(el);
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
