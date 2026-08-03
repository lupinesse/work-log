/* ── Today's tasks — event binding ── */

/**
 * Binds all plan list event handlers after each render.
 * @param {HTMLElement[]} lists - Column list elements (To Do, In Progress, Done).
 */
function bindPlanEvents(lists) {
  const qa = (sel) => lists.flatMap((listEl) => [...listEl.querySelectorAll(sel)]);

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
      lists.forEach((listEl) =>
        listEl
          .querySelectorAll('.plan-cat-picker.open')
          .forEach((picker) => picker.classList.remove('open'))
      );
      if (!isOpen) picker.classList.add('open');
    });
  });
  qa('.plan-cat-picker .cat-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const task = planTasks.find((task) => task.id === btn.dataset.pid);
      if (task) {
        task.tag = btn.dataset.cat;
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
      if (!input.value.trim()) {
        input.focus();
        return;
      }
      const category = createCategory(input.value);
      if (!category) {
        input.style.borderColor = '#C62828';
        input.focus();
        return;
      }
      const task = planTasks.find((task) => task.id === btn.dataset.pid);
      if (task) task.tag = category.id;
      save();
      savePlan();
      renderTagRow();
      renderPlan();
    });
  });
  qa('.pcat-add-input').forEach((inp) => {
    inp.addEventListener('keydown', (event) => {
      if (event.key === 'Enter')
        inp.closest('.pcat-add-form').querySelector('.pcat-add-ok').click();
      if (event.key === 'Escape')
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
      const task = planTasks.find((task) => task.id === sel.dataset.pid);
      if (!task) return;
      const prevStatus = task.status;
      const newStatus = sel.value;
      wlLog.info('planTask: status changed', { id: task.id, from: prevStatus, to: newStatus });

      // Capture in-flight typed text BEFORE re-render
      let liveTyped = null;
      if (_pendingCommentId === task.id) {
        const inp = document.getElementById('pc-inp-' + task.id);
        liveTyped = inp ? inp.value : _pendingCommentText;
      }

      task.status = newStatus;
      if (newStatus === 'done' && !task.completedAt) task.completedAt = Date.now();
      if (newStatus !== 'done') delete task.completedAt;

      // If child goes inprogress, promote parent too (unless already done)
      if (newStatus === 'inprogress' && task.parentId) {
        const parent = planTasks.find((planTask) => planTask.id === task.parentId);
        if (parent && parent.status === 'todo') {
          parent.status = 'inprogress';
        }
      }
      // When marking done, retire older versions of the same task
      if (newStatus === 'done') {
        planTasks
          .filter(
            (planTask) =>
              planTask.id !== task.id &&
              planTask.text.toLowerCase() === task.text.toLowerCase() &&
              planTask.status !== 'done'
          )
          .forEach((planTask) => {
            planTask.status = 'done';
            if (!planTask.completedAt) planTask.completedAt = task.completedAt;
          });
      }
      // Auto-complete parent when all its children are done
      if (newStatus === 'done' && task.parentId) {
        const parent = planTasks.find((planTask) => planTask.id === task.parentId);
        if (parent && parent.status !== 'done') {
          const siblings = planTasks.filter(
            (child) => child.parentId === parent.id && child.date === task.date
          );
          if (
            siblings.length > 0 &&
            siblings.every((sibling) => sibling.status === 'done' || sibling.id === task.id)
          ) {
            parent.status = 'done';
            if (!parent.completedAt) parent.completedAt = Date.now();
          }
        }
      }
      // Auto-stop timer when active task is marked done
      if (newStatus === 'done' && activeTimer) {
        const timerEntry = entries.find((entry) => entry.id === activeTimer.entryId);
        if (timerEntry && timerEntry.text.toLowerCase() === task.text.toLowerCase()) {
          stopTimer();
        }
      }

      // Pending/blocked transitions
      const wasPB = prevStatus === 'pending' || prevStatus === 'blocked';
      const isPB = newStatus === 'pending' || newStatus === 'blocked';

      if (isPB && newStatus !== prevStatus) {
        if (!task.statusComments) task.statusComments = [];
        const last = task.statusComments[task.statusComments.length - 1];
        const inFlight = _pendingCommentId === task.id;

        if (wasPB && inFlight && last && !last.comment) {
          // Same comment session — just relabel the unsaved entry,
          // preserving the typed-but-unsaved text via _pendingCommentText.
          last.status = newStatus;
          _pendingCommentText = liveTyped != null ? liveTyped : _pendingCommentText || '';
          // _pendingCommentId stays set
        } else {
          // Fresh session
          task.statusComments.push({ status: newStatus, comment: '', ts: Date.now() });
          _pendingCommentId = task.id;
          _pendingCommentText = '';
        }
      } else if (!isPB) {
        // Leaving pending/blocked — only drop a trailing unsaved entry
        // if this task had an in-flight comment session (otherwise it could
        // be a deliberately-saved empty entry).
        if (_pendingCommentId === task.id && task.statusComments && task.statusComments.length) {
          const last = task.statusComments[task.statusComments.length - 1];
          if (!last.comment && (last.status === 'pending' || last.status === 'blocked')) {
            task.statusComments.pop();
          }
        }
        if (_pendingCommentId === task.id) {
          _pendingCommentId = null;
          _pendingCommentText = '';
        }
      }

      savePlan();
      renderPlan();
      renderCompleted();
    });
  });

  bindPlanCommentEvents(qa);

  // Dismiss handoff note
  qa('.plan-handoff-dismiss').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      try {
        const notes = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
        delete notes[btn.dataset.task];
        localStorage.setItem('wl_handoff', JSON.stringify(notes));
      } catch (err) {
        wlLog.warn('plan-handoff-dismiss: failed to update wl_handoff in localStorage', err);
      }
      renderPlan();
    });
  });

  bindPlanNoteEvents(qa);

  bindPlanCheckpointEvents(qa);

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
      const task = planTasks.find((task) => task.id === editOk.dataset.pid);
      if (task) task.text = text;
      editingPlanId = null;
      savePlan();
      renderPlan();
    };
    editOk.addEventListener('click', saveEdit);
    const inp = document.getElementById('planEditInput');
    if (inp) {
      inp.focus();
      inp.select();
      inp.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') saveEdit();
        if (event.key === 'Escape') {
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
      const task = planTasks.find((task) => task.id === btn.dataset.pid);
      const text = btn.dataset.text;
      const tag = task ? task.tag || 'other' : selectedTag;
      if (activeTimer) stopTimer();
      const entry = createRestartedEntry(text, tag);
      entries.push(entry);
      promoteMatchingTaskToInProgress(text);
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
      planTasks = planTasks.filter((task) => task.id !== btn.dataset.pid);
      savePlan();
      renderPlan();
    });
  });

  // Split into subtasks
  qa('.plan-split-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
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
    inp.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const text = inp.value.trim();
        if (!text) return;
        const parentId = inp.closest('.plan-split-row').dataset.parent;
        const parent = planTasks.find((task) => task.id === parentId);
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
      } else if (event.key === 'Escape') {
        splitInputId = null;
        renderPlan();
      }
    });
  });
}
