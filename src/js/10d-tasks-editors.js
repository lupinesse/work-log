/* ── Today's tasks — per-card editors: comments, notes, checkpoints ── */

/**
 * Binds the per-card status-comment editor handlers (accept/skip/edit input,
 * plus the comment-history expander). Called from `bindPlanEvents()` after
 * each render.
 * @param {Function} qa - Selector helper closed over the rendered column lists.
 * @returns {void}
 */
function bindPlanCommentEvents(qa) {
  // Accept / skip / edit for status comment
  function saveComment(pid) {
    const task = planTasks.find((task) => task.id === pid);
    if (!task) {
      _pendingCommentId = null;
      _pendingCommentText = '';
      renderPlan();
      return;
    }
    if (!task.statusComments) task.statusComments = [];
    const inp = document.getElementById('pc-inp-' + pid);
    const val = inp ? inp.value.trim() : (_pendingCommentText || '').trim();
    const entry = [...task.statusComments].reverse().find((comment) => comment.status === task.status);
    if (entry) {
      if (val) {
        entry.comment = val;
      } else {
        // Empty accept behaves as skip — remove the entry so the row
        // collapses to "+ add reason" rather than reopening the input.
        task.statusComments = task.statusComments.filter((comment) => comment !== entry);
      }
    } else if (val) {
      task.statusComments.push({ status: task.status, comment: val, ts: Date.now() });
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
      const task = planTasks.find((task) => task.id === btn.dataset.pid);
      if (task && task.statusComments && task.statusComments.length) {
        const last = task.statusComments[task.statusComments.length - 1];
        if (!last.comment) task.statusComments.pop();
      }
      _pendingCommentId = null;
      _pendingCommentText = '';
      savePlan();
      renderPlan();
    });
  });
  qa('.plan-comment-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const task = planTasks.find((task) => task.id === btn.dataset.pid);
      _pendingCommentId = btn.dataset.pid;
      if (task && task.statusComments) {
        const ac = [...task.statusComments].reverse().find((comment) => comment.status === task.status);
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
    inp.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') saveComment(inp.dataset.pid);
      if (event.key === 'Escape') {
        const task = planTasks.find((task) => task.id === inp.dataset.pid);
        if (task && task.statusComments && task.statusComments.length) {
          const last = task.statusComments[task.statusComments.length - 1];
          if (!last.comment) task.statusComments.pop();
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
      } catch (err) {
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
}

/**
 * Binds the per-card note editor handlers (toggle, display-to-edit, save,
 * delete, cancel, and textarea keyboard shortcuts). Called from
 * `bindPlanEvents()` after each render.
 * @param {Function} qa - Selector helper closed over the rendered column lists.
 * @returns {void}
 */
function bindPlanNoteEvents(qa) {
  /** Focuses the note textarea for the given task ID after the next render. */
  function focusNoteInput(pid) {
    setTimeout(() => {
      const ta = document.querySelector(`.plan-note-input[data-pid="${pid}"]`);
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    }, 0);
  }

  // Note button — toggle textarea open/closed
  qa('.plan-note-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const pid = btn.dataset.pid;
      if (_noteOpenIds.has(pid)) _noteOpenIds.delete(pid);
      else _noteOpenIds.add(pid);
      renderPlan();
      if (_noteOpenIds.has(pid)) focusNoteInput(pid);
    });
  });

  // Note display row — click to open edit
  qa('.plan-note-display').forEach((el) => {
    el.addEventListener('click', () => {
      const pid = el.dataset.pid;
      _noteOpenIds.add(pid);
      renderPlan();
      focusNoteInput(pid);
    });
  });

  // Note save
  qa('.plan-note-save').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.pid;
      const ta = btn.closest('.plan-note-area').querySelector('.plan-note-input');
      const val = ta.value.trim();
      const task = planTasks.find((task) => task.id === pid);
      if (task) {
        if (val) task.note = val;
        else delete task.note;
        savePlan();
      }
      _noteOpenIds.delete(pid);
      renderPlan();
    });
  });

  // Note remove
  qa('.plan-note-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.pid;
      const task = planTasks.find((task) => task.id === pid);
      if (task) {
        delete task.note;
        savePlan();
      }
      _noteOpenIds.delete(pid);
      renderPlan();
    });
  });

  // Note cancel
  qa('.plan-note-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      _noteOpenIds.delete(btn.dataset.pid);
      renderPlan();
    });
  });

  // Note textarea keyboard shortcuts
  qa('.plan-note-input').forEach((ta) => {
    ta.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        ta.closest('.plan-note-area').querySelector('.plan-note-save').click();
      }
      if (event.key === 'Escape') {
        ta.closest('.plan-note-area').querySelector('.plan-note-cancel').click();
      }
    });
    ta.addEventListener('click', (event) => event.stopPropagation());
  });
}

/**
 * Binds the per-card checkpoint editor handlers (open/close badge, three-state
 * done toggles, inline edit, delete, add-on-Enter, and drag-to-reorder).
 * Called from `bindPlanEvents()` after each render.
 * @param {Function} qa - Selector helper closed over the rendered column lists.
 * @returns {void}
 */
function bindPlanCheckpointEvents(qa) {
  // Checkpoint: toggle open/closed
  qa('.cp-badge').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
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
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      const task = planTasks.find((task) => task.id === el.dataset.pid);
      if (!task || !task.checkpoints) return;
      const idx = parseInt(el.dataset.cpidx);
      const cur = task.checkpoints[idx].done;
      task.checkpoints[idx].done = cur === false ? 'partial' : cur === 'partial' ? true : false;
      savePlan();
      renderPlan();
    });
  });

  // Checkpoint: toggle done via label click; double-click to edit
  qa('.cp-label').forEach((lbl) => {
    lbl.addEventListener('click', (event) => {
      event.stopPropagation();
      const task = planTasks.find((task) => task.id === lbl.dataset.pid);
      if (!task || !task.checkpoints) return;
      const idx = parseInt(lbl.dataset.cpidx);
      const cur = task.checkpoints[idx].done;
      task.checkpoints[idx].done = cur === false ? 'partial' : cur === 'partial' ? true : false;
      savePlan();
      renderPlan();
    });
    lbl.addEventListener('dblclick', (event) => {
      event.stopPropagation();
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
      const task = planTasks.find((task) => task.id === inp.dataset.pid);
      if (task && task.checkpoints && val) task.checkpoints[parseInt(inp.dataset.cpidx)].text = val;
      _cpEditId = null;
      _cpEditIdx = null;
      savePlan();
      renderPlan();
    };
    inp.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      }
      if (event.key === 'Escape') {
        _cpEditId = null;
        _cpEditIdx = null;
        renderPlan();
      }
    });
    inp.addEventListener('blur', save);
    inp.addEventListener('click', (event) => event.stopPropagation());
  });

  // Checkpoint: delete
  qa('.cp-del-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const task = planTasks.find((task) => task.id === btn.dataset.pid);
      if (!task || !task.checkpoints) return;
      task.checkpoints.splice(parseInt(btn.dataset.cpidx), 1);
      savePlan();
      renderPlan();
    });
  });

  // Checkpoint: add on Enter
  qa('.cp-add-input').forEach((inp) => {
    inp.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const val = inp.value.trim();
      if (!val) return;
      const task = planTasks.find((task) => task.id === inp.dataset.pid);
      if (!task) return;
      if (!Array.isArray(task.checkpoints)) task.checkpoints = [];
      task.checkpoints.push({
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
    inp.addEventListener('click', (event) => event.stopPropagation());
  });

  // Checkpoint: drag-to-reorder
  let _cpDragPid = null,
    _cpDragIdx = null;
  qa('.cp-row').forEach((row) => {
    row.addEventListener('dragstart', (event) => {
      _cpDragPid = row.dataset.pid;
      _cpDragIdx = parseInt(row.dataset.cpidx);
      event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      document
        .querySelectorAll('.cp-row.cp-drag-over')
        .forEach((row) => row.classList.remove('cp-drag-over'));
      row.classList.add('cp-drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('cp-drag-over'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('cp-drag-over');
      const targetIdx = parseInt(row.dataset.cpidx);
      if (_cpDragPid !== row.dataset.pid || _cpDragIdx === null || _cpDragIdx === targetIdx) return;
      const task = planTasks.find((task) => task.id === _cpDragPid);
      if (!task || !task.checkpoints) return;
      const moved = task.checkpoints.splice(_cpDragIdx, 1)[0];
      task.checkpoints.splice(targetIdx, 0, moved);
      savePlan();
      renderPlan();
      _cpDragIdx = null;
      _cpDragPid = null;
    });
  });
}
