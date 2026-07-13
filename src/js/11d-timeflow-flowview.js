// ── 11d-timeflow-flowview.js — Today's Flow: Flow-tab render + note editor ──
//
// Split out of 11-timeflow.js: the entire "Flow" tab's own render plus its
// inline session/task note-editing widget (build-html helpers and event
// binding for that one pane) — a self-contained mini feature.

/** Task ID whose note is currently being edited inline in the Flow view. */
let _flowNoteEditId = null;

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
