/* ── Today's tasks — event binding ── */

/** Shared drag-state for board column DnD (set by dragstart, read by drop). */
let _boardDragTaskId = null;

/**
 * Binds all plan list event handlers after each render.
 * @param {HTMLElement[]} lists - Column list elements (To Do, In Progress, Done).
 */
function bindPlanEvents(lists) {
  const qa = (sel) => lists.flatMap((L) => [...L.querySelectorAll(sel)]);

  // WIP warn dismiss — { once: true } so re-renders don't stack listeners
  document.querySelectorAll('.wip-warn__dismiss').forEach((btn) => {
    btn.addEventListener(
      'click',
      () => {
        wipWarnDismissed = true;
        renderPlan();
      },
      { once: true }
    );
  });
  qa('.plan-text').forEach((span) => {
    span.addEventListener('click', () => {
      const pid = span.closest('.plan-item').dataset.pid;
      if (pid) {
        editingPlanId = pid;
        renderPlan();
      }
    });
  });

  // Category picker
  qa('.plan-cat-line').forEach((line) => {
    line.addEventListener('click', () => {
      const pid = line.dataset.pid;
      const picker = document.getElementById('pcp-' + pid);
      const isOpen = picker.classList.contains('open');
      lists.forEach((L) =>
        L.querySelectorAll('.plan-cat-picker.open').forEach((p) => p.classList.remove('open'))
      );
      if (!isOpen) picker.classList.add('open');
    });
  });
  qa('.plan-cat-picker .cat-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      if (t) {
        t.tag = btn.dataset.cat;
        savePlan();
        renderPlan();
      }
    });
  });
  qa('.plan-cat-picker .cat-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('pcp-' + btn.dataset.pid).classList.remove('open');
    });
  });

  // + new epic inside picker
  qa('.pcat-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.style.display = 'none';
      const form = document.getElementById('pcaf-' + btn.dataset.pid);
      form.classList.add('open');
      form.querySelector('.pcat-add-input').focus();
    });
  });
  qa('.pcat-add-ok').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = document.getElementById('pcaf-' + btn.dataset.pid);
      const input = form.querySelector('.pcat-add-input');
      const label = input.value.trim();
      if (!label) {
        input.focus();
        return;
      }
      if (categories.find((c) => c.label.toLowerCase() === label.toLowerCase())) {
        input.style.borderColor = '#C62828';
        input.focus();
        return;
      }
      const color = nextDistinctColor();
      const id = 'cat_' + Date.now();
      categories.push({ id, label, color });
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      if (t) t.tag = id;
      save();
      savePlan();
      renderTagRow();
      renderPlan();
    });
  });
  qa('.pcat-add-input').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') inp.closest('.pcat-add-form').querySelector('.pcat-add-ok').click();
      if (e.key === 'Escape')
        inp.closest('.pcat-add-form').querySelector('.pcat-add-cancel2').click();
    });
  });
  qa('.pcat-add-cancel2').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = document.getElementById('pcaf-' + btn.dataset.pid);
      form.classList.remove('open');
      const addBtn = form.closest('.pcat-add-row').querySelector('.pcat-add-btn');
      if (addBtn) addBtn.style.display = '';
    });
  });

  // Status change — handles pending/blocked entry creation and in-flight comment carry-over
  qa('.plan-status').forEach((sel) => {
    sel.addEventListener('change', () => {
      const t = planTasks.find((t) => t.id === sel.dataset.pid);
      if (!t) return;
      const prevStatus = t.status;
      const newStatus = sel.value;
      wlLog.info('planTask: status changed', { id: t.id, from: prevStatus, to: newStatus });

      // Capture in-flight typed text BEFORE re-render
      let liveTyped = null;
      if (_pendingCommentId === t.id) {
        const inp = document.getElementById('pc-inp-' + t.id);
        liveTyped = inp ? inp.value : _pendingCommentText;
      }

      t.status = newStatus;
      if (newStatus === 'done' && !t.completedAt) t.completedAt = Date.now();
      if (newStatus !== 'done') delete t.completedAt;

      // If child goes inprogress, promote parent too (unless already done)
      if (newStatus === 'inprogress' && t.parentId) {
        const parent = planTasks.find((p) => p.id === t.parentId);
        if (parent && parent.status === 'todo') {
          parent.status = 'inprogress';
        }
      }
      // When marking done, retire older versions of the same task
      if (newStatus === 'done') {
        planTasks
          .filter(
            (p) =>
              p.id !== t.id && p.text.toLowerCase() === t.text.toLowerCase() && p.status !== 'done'
          )
          .forEach((p) => {
            p.status = 'done';
            if (!p.completedAt) p.completedAt = t.completedAt;
          });
      }
      // Auto-complete parent when all its children are done
      if (newStatus === 'done' && t.parentId) {
        const parent = planTasks.find((p) => p.id === t.parentId);
        if (parent && parent.status !== 'done') {
          const siblings = planTasks.filter((c) => c.parentId === parent.id && c.date === t.date);
          if (siblings.length > 0 && siblings.every((c) => c.status === 'done' || c.id === t.id)) {
            parent.status = 'done';
            if (!parent.completedAt) parent.completedAt = Date.now();
          }
        }
      }
      // Auto-stop timer when active task is marked done
      if (newStatus === 'done' && activeTimer) {
        const timerEntry = entries.find((e) => e.id === activeTimer.entryId);
        if (timerEntry && timerEntry.text.toLowerCase() === t.text.toLowerCase()) {
          stopTimer();
        }
      }

      // Pending/blocked transitions
      const wasPB = prevStatus === 'pending' || prevStatus === 'blocked';
      const isPB = newStatus === 'pending' || newStatus === 'blocked';

      if (isPB && newStatus !== prevStatus) {
        if (!t.statusComments) t.statusComments = [];
        const last = t.statusComments[t.statusComments.length - 1];
        const inFlight = _pendingCommentId === t.id;

        if (wasPB && inFlight && last && !last.comment) {
          // Same comment session — just relabel the unsaved entry,
          // preserving the typed-but-unsaved text via _pendingCommentText.
          last.status = newStatus;
          _pendingCommentText = liveTyped != null ? liveTyped : _pendingCommentText || '';
          // _pendingCommentId stays set
        } else {
          // Fresh session
          t.statusComments.push({ status: newStatus, comment: '', ts: Date.now() });
          _pendingCommentId = t.id;
          _pendingCommentText = '';
        }
      } else if (!isPB) {
        // Leaving pending/blocked — only drop a trailing unsaved entry
        // if this task had an in-flight comment session (otherwise it could
        // be a deliberately-saved empty entry).
        if (_pendingCommentId === t.id && t.statusComments && t.statusComments.length) {
          const last = t.statusComments[t.statusComments.length - 1];
          if (!last.comment && (last.status === 'pending' || last.status === 'blocked')) {
            t.statusComments.pop();
          }
        }
        if (_pendingCommentId === t.id) {
          _pendingCommentId = null;
          _pendingCommentText = '';
        }
      }

      savePlan();
      renderPlan();
      renderCompleted();
    });
  });

  // Accept / skip / edit for status comment
  function saveComment(pid) {
    const t = planTasks.find((t) => t.id === pid);
    if (!t) {
      _pendingCommentId = null;
      _pendingCommentText = '';
      renderPlan();
      return;
    }
    if (!t.statusComments) t.statusComments = [];
    const inp = document.getElementById('pc-inp-' + pid);
    const val = inp ? inp.value.trim() : (_pendingCommentText || '').trim();
    const entry = [...t.statusComments].reverse().find((c) => c.status === t.status);
    if (entry) {
      if (val) {
        entry.comment = val;
      } else {
        // Empty accept behaves as skip — remove the entry so the row
        // collapses to "+ add reason" rather than reopening the input.
        t.statusComments = t.statusComments.filter((c) => c !== entry);
      }
    } else if (val) {
      t.statusComments.push({ status: t.status, comment: val, ts: Date.now() });
    }
    _pendingCommentId = null;
    _pendingCommentText = '';
    savePlan();
    renderPlan();
  }
  qa('.plan-comment-ok').forEach((btn) => {
    btn.addEventListener('click', () => saveComment(btn.dataset.pid));
  });
  qa('.plan-comment-skip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      if (t && t.statusComments && t.statusComments.length) {
        const last = t.statusComments[t.statusComments.length - 1];
        if (!last.comment) t.statusComments.pop();
      }
      _pendingCommentId = null;
      _pendingCommentText = '';
      savePlan();
      renderPlan();
    });
  });
  qa('.plan-comment-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      _pendingCommentId = btn.dataset.pid;
      if (t && t.statusComments) {
        const ac = [...t.statusComments].reverse().find((c) => c.status === t.status);
        _pendingCommentText = ac ? ac.comment || '' : '';
      } else {
        _pendingCommentText = '';
      }
      renderPlan();
    });
  });
  qa('.plan-comment-input').forEach((inp) => {
    // Mirror typed text into the in-flight buffer
    inp.addEventListener('input', () => {
      if (inp.dataset.pid === _pendingCommentId) _pendingCommentText = inp.value;
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveComment(inp.dataset.pid);
      if (e.key === 'Escape') {
        const t = planTasks.find((t) => t.id === inp.dataset.pid);
        if (t && t.statusComments && t.statusComments.length) {
          const last = t.statusComments[t.statusComments.length - 1];
          if (!last.comment) t.statusComments.pop();
        }
        _pendingCommentId = null;
        _pendingCommentText = '';
        savePlan();
        renderPlan();
      }
    });
    // Auto-focus the in-flight input, with cursor at end
    if (inp.dataset.pid === _pendingCommentId) {
      inp.focus();
      const len = inp.value.length;
      try {
        inp.setSelectionRange(len, len);
      } catch (e) {
        // Silently skip — setSelectionRange may fail on certain input types in some browsers
      }
    }
  });

  // History expand/collapse
  qa('.plan-comment-history-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      _expandedHistoryId = _expandedHistoryId === btn.dataset.pid ? null : btn.dataset.pid;
      renderPlan();
    });
  });

  // Dismiss handoff note
  qa('.plan-handoff-dismiss').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const notes = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
        delete notes[btn.dataset.task];
        localStorage.setItem('wl_handoff', JSON.stringify(notes));
      } catch (e) {
        wlLog.warn('plan-handoff-dismiss: failed to update wl_handoff in localStorage', e);
      }
      renderPlan();
    });
  });

  // Checkpoint: toggle open/closed
  qa('.cp-badge').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = btn.dataset.pid;
      if (_cpOpenIds.has(pid)) _cpOpenIds.delete(pid);
      else _cpOpenIds.add(pid);
      renderPlan();
      // Auto-focus add input when opening
      if (_cpOpenIds.has(pid)) {
        setTimeout(() => {
          const inp = document.querySelector(`.cp-add-input[data-pid="${pid}"]`);
          if (inp) inp.focus();
        }, 0);
      }
    });
  });

  // Checkpoint: toggle done (three-state: false → 'partial' → true → false)
  qa('.cp-check').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = planTasks.find((t) => t.id === el.dataset.pid);
      if (!t || !t.checkpoints) return;
      const idx = parseInt(el.dataset.cpidx);
      const cur = t.checkpoints[idx].done;
      t.checkpoints[idx].done = cur === false ? 'partial' : cur === 'partial' ? true : false;
      savePlan();
      renderPlan();
    });
  });

  // Checkpoint: toggle done via label click; double-click to edit
  qa('.cp-label').forEach((lbl) => {
    lbl.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = planTasks.find((t) => t.id === lbl.dataset.pid);
      if (!t || !t.checkpoints) return;
      const idx = parseInt(lbl.dataset.cpidx);
      const cur = t.checkpoints[idx].done;
      t.checkpoints[idx].done = cur === false ? 'partial' : cur === 'partial' ? true : false;
      savePlan();
      renderPlan();
    });
    lbl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      _cpEditId = lbl.dataset.pid;
      _cpEditIdx = parseInt(lbl.dataset.cpidx);
      renderPlan();
      setTimeout(() => {
        const inp = document.querySelector(
          '.cp-edit-input[data-pid="' + _cpEditId + '"][data-cpidx="' + _cpEditIdx + '"]'
        );
        if (inp) {
          inp.focus();
          inp.select();
        }
      }, 0);
    });
  });

  // Checkpoint: save/cancel inline edit
  qa('.cp-edit-input').forEach((inp) => {
    const save = () => {
      const val = inp.value.trim();
      const t = planTasks.find((t) => t.id === inp.dataset.pid);
      if (t && t.checkpoints && val) t.checkpoints[parseInt(inp.dataset.cpidx)].text = val;
      _cpEditId = null;
      _cpEditIdx = null;
      savePlan();
      renderPlan();
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
      if (e.key === 'Escape') {
        _cpEditId = null;
        _cpEditIdx = null;
        renderPlan();
      }
    });
    inp.addEventListener('blur', save);
    inp.addEventListener('click', (e) => e.stopPropagation());
  });

  // Checkpoint: delete
  qa('.cp-del-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      if (!t || !t.checkpoints) return;
      t.checkpoints.splice(parseInt(btn.dataset.cpidx), 1);
      savePlan();
      renderPlan();
    });
  });

  // Checkpoint: add on Enter
  qa('.cp-add-input').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const val = inp.value.trim();
      if (!val) return;
      const t = planTasks.find((t) => t.id === inp.dataset.pid);
      if (!t) return;
      if (!Array.isArray(t.checkpoints)) t.checkpoints = [];
      t.checkpoints.push({
        id: 'cp' + Date.now() + Math.random().toString(36).slice(2),
        text: val,
        done: false,
      });
      savePlan();
      renderPlan();
      // Re-focus add input after render
      setTimeout(() => {
        const next = document.querySelector(`.cp-add-input[data-pid="${inp.dataset.pid}"]`);
        if (next) next.focus();
      }, 0);
    });
    inp.addEventListener('click', (e) => e.stopPropagation());
  });

  // Checkpoint: drag-to-reorder
  let _cpDragPid = null,
    _cpDragIdx = null;
  qa('.cp-row').forEach((row) => {
    row.addEventListener('dragstart', (e) => {
      _cpDragPid = row.dataset.pid;
      _cpDragIdx = parseInt(row.dataset.cpidx);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document
        .querySelectorAll('.cp-row.cp-drag-over')
        .forEach((r) => r.classList.remove('cp-drag-over'));
      row.classList.add('cp-drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('cp-drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('cp-drag-over');
      const targetIdx = parseInt(row.dataset.cpidx);
      if (_cpDragPid !== row.dataset.pid || _cpDragIdx === null || _cpDragIdx === targetIdx) return;
      const t = planTasks.find((t) => t.id === _cpDragPid);
      if (!t || !t.checkpoints) return;
      const moved = t.checkpoints.splice(_cpDragIdx, 1)[0];
      t.checkpoints.splice(targetIdx, 0, moved);
      savePlan();
      renderPlan();
      _cpDragIdx = null;
      _cpDragPid = null;
    });
  });

  // Edit task text
  qa('.plan-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingPlanId = btn.dataset.pid;
      renderPlan();
    });
  });

  const editOk = document.getElementById('planEditOk');
  if (editOk) {
    const saveEdit = () => {
      const inp = document.getElementById('planEditInput');
      const text = inp ? inp.value.trim() : '';
      if (!text) {
        editingPlanId = null;
        renderPlan();
        return;
      }
      const t = planTasks.find((t) => t.id === editOk.dataset.pid);
      if (t) t.text = text;
      editingPlanId = null;
      savePlan();
      renderPlan();
    };
    editOk.addEventListener('click', saveEdit);
    const inp = document.getElementById('planEditInput');
    if (inp) {
      inp.focus();
      inp.select();
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') {
          editingPlanId = null;
          renderPlan();
        }
      });
    }
  }
  const editCancel = document.getElementById('planEditCancel');
  if (editCancel)
    editCancel.addEventListener('click', () => {
      editingPlanId = null;
      renderPlan();
    });

  // Start timer from task
  qa('.plan-log-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      const text = btn.dataset.text;
      const tag = t ? t.tag || 'other' : selectedTag;
      if (activeTimer) stopTimer();
      const entry = {
        id: Date.now() + '',
        text,
        tag,
        ts: safeRoundedStart(),
        date: dk(new Date()),
      };
      entries.push(entry);
      if (t && (t.status === 'todo' || t.status === 'upcoming')) {
        t.status = 'inprogress';
        if (t.parentId) {
          const parent = planTasks.find((p) => p.id === t.parentId);
          if (parent && parent.status === 'todo') parent.status = 'inprogress';
        }
        savePlan();
        renderPlan();
      }
      ensureDayStarted();
      viewDate = new Date();
      save();
      startTimer(entry.id);
      render();
    });
  });

  // Delete task (children become orphaned top-level tasks)
  qa('.plan-del-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      planTasks = planTasks.filter((t) => t.id !== btn.dataset.pid);
      savePlan();
      renderPlan();
    });
  });

  // Split into subtasks
  qa('.plan-split-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      splitInputId = splitInputId === btn.dataset.pid ? null : btn.dataset.pid;
      renderPlan();
      if (splitInputId) {
        const inp = document.getElementById('splitInp-' + splitInputId);
        if (inp) inp.focus();
      }
    });
  });
  qa('.plan-split-done').forEach((btn) => {
    btn.addEventListener('click', () => {
      splitInputId = null;
      renderPlan();
    });
  });
  qa('.plan-split-input').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = inp.value.trim();
        if (!text) return;
        const parentId = inp.closest('.plan-split-row').dataset.parent;
        const parent = planTasks.find((t) => t.id === parentId);
        planTasks.push({
          id: Date.now() + '',
          text,
          status: 'todo',
          date: dk(new Date()),
          tag: parent ? parent.tag : selectedTag,
          parentId,
        });
        savePlan();
        inp.value = '';
        renderPlan();
        // Re-focus the new input after re-render
        const newInp = document.getElementById('splitInp-' + parentId);
        if (newInp) newInp.focus();
      } else if (e.key === 'Escape') {
        splitInputId = null;
        renderPlan();
      }
    });
  });
}

/**
 * Moves a task to a new board column, updating its status and timer state.
 * Dropping into In Progress stops any running timer, creates a new time entry,
 * and starts tracking. Dropping into Done or To Do stops the active timer.
 * @param {string} taskId    - The plan task ID to move.
 * @param {string} newStatus - Target status: 'todo' | 'inprogress' | 'done'.
 */
function moveTaskToColumn(taskId, newStatus) {
  const t = planTasks.find((p) => p.id === taskId);
  if (!t || t.status === newStatus) return;

  wlLog.info('board: moveTaskToColumn', { id: taskId, from: t.status, to: newStatus });
  t.status = newStatus;

  if (newStatus === 'done') {
    if (!t.completedAt) t.completedAt = Date.now();
    if (activeTimer) {
      const timerEntry = entries.find((e) => e.id === activeTimer.entryId);
      if (timerEntry && timerEntry.text.toLowerCase() === t.text.toLowerCase()) stopTimer();
    }
  } else if (newStatus === 'todo') {
    delete t.completedAt;
    if (activeTimer) {
      const timerEntry = entries.find((e) => e.id === activeTimer.entryId);
      if (timerEntry && timerEntry.text.toLowerCase() === t.text.toLowerCase()) stopTimer();
    }
  } else if (newStatus === 'inprogress') {
    delete t.completedAt;
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
 */
function bindBoardColumnDnD() {
  document.querySelectorAll('.kb-cards > .plan-item').forEach((card) => {
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', (e) => {
      _boardDragTaskId = card.dataset.pid;
      e.dataTransfer.effectAllowed = 'move';
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

    listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      listEl.closest('.kb-col').classList.add('kb-col--drop-over');
    });
    listEl.addEventListener('dragleave', (e) => {
      // Only remove highlight when truly leaving the column (not a child element)
      if (!listEl.closest('.kb-col').contains(e.relatedTarget)) {
        listEl.closest('.kb-col').classList.remove('kb-col--drop-over');
      }
    });
    listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      listEl.closest('.kb-col').classList.remove('kb-col--drop-over');
      if (_boardDragTaskId) {
        moveTaskToColumn(_boardDragTaskId, COLUMN_MAP[listId]);
        _boardDragTaskId = null;
      }
    });
  });
}
