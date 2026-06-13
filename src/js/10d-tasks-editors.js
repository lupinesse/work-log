/* ── Today's tasks — per-card editors: comments, notes, checkpoints (split out of 10b-tasks-events.js) ── */

/**
 * Binds the per-card status-comment editor handlers (accept/skip/edit input,
 * plus the comment-history expander). Called from `bindPlanEvents()` after
 * each render.
 * @param {Function} qa - Selector helper closed over the rendered column lists.
 */
function bindPlanCommentEvents(qa) {
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
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
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
      const t = planTasks.find((t) => t.id === pid);
      if (t) {
        if (val) t.note = val;
        else delete t.note;
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
      const t = planTasks.find((t) => t.id === pid);
      if (t) {
        delete t.note;
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
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        ta.closest('.plan-note-area').querySelector('.plan-note-save').click();
      }
      if (e.key === 'Escape') {
        ta.closest('.plan-note-area').querySelector('.plan-note-cancel').click();
      }
    });
    ta.addEventListener('click', (e) => e.stopPropagation());
  });
}

/**
 * Binds the per-card checkpoint editor handlers (open/close badge, three-state
 * done toggles, inline edit, delete, add-on-Enter, and drag-to-reorder).
 * Called from `bindPlanEvents()` after each render.
 * @param {Function} qa - Selector helper closed over the rendered column lists.
 */
function bindPlanCheckpointEvents(qa) {
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
}
