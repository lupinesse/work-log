/* ── Emergency Mode ── */

/** @type {boolean} True while the focus/emergency overlay is visible. */
let emergencyMode = false;

/**
 * Renders the checkpoint list inside the focus-mode overlay for the currently
 * active task. Hides the wrapper if the task has no checkpoints.
 * Each checkpoint cycles through three states on click: false → 'partial' → true.
 */
function renderEmergencyCps() {
  const wrap = document.getElementById('emergencyCpsWrap');
  const el = document.getElementById('emergencyCps');
  if (!wrap || !el) return;
  const entry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
  const todayKey = dk(new Date());
  const task = entry ? planTasks.find((t) => t.text === entry.text && t.date === todayKey) : null;
  const cps = task && Array.isArray(task.checkpoints) ? task.checkpoints : [];
  if (!cps.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  el.innerHTML = cps
    .map((cp, i) => {
      const isDone = cp.done === true;
      const isPartial = cp.done === 'partial';
      const stateClass = isDone ? ' cp-done' : isPartial ? ' cp-partial' : '';
      const symbol = isDone ? '✓' : isPartial ? '–' : '';
      return `<div class="emergency-cp-row">
        <div class="emergency-cp-check${stateClass}" data-tid="${task.id}" data-cidx="${i}">${symbol}</div>
        <span class="emergency-cp-text${stateClass}">${escHtml(cp.text)}</span>
      </div>`;
    })
    .join('');
  el.querySelectorAll('.emergency-cp-check').forEach((box) => {
    box.addEventListener('click', () => {
      const t = planTasks.find((t) => t.id === box.dataset.tid);
      if (!t || !t.checkpoints) return;
      const cur = t.checkpoints[parseInt(box.dataset.cidx)].done;
      t.checkpoints[parseInt(box.dataset.cidx)].done =
        cur === false ? 'partial' : cur === 'partial' ? true : false;
      savePlan();
      renderEmergencyCps();
      renderPlan();
    });
  });
}

/**
 * Activates focus/emergency mode: hides the main UI, shows the overlay,
 * moves the pomodoro section into the overlay, and focuses the next-action input.
 * The previously saved next-action note is restored if one exists for the active entry.
 */
function enterEmergency() {
  emergencyMode = true;
  document.body.classList.add('emergency');
  const entry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
  document.getElementById('emergencyTask').textContent = entry
    ? entry.text
    : 'No active task — start one first';
  // Restore any saved next action
  const saved = entry ? localStorage.getItem('wl_emergency_next_' + entry.id) || '' : '';
  document.getElementById('emergencyNext').value = saved;
  document.getElementById('emergencyNext').focus();
  renderEmergencyCps();
  // Move pomo below exit button
  document.getElementById('emergencyScreen').appendChild(document.querySelector('.pomo-section'));
}

/**
 * Deactivates focus/emergency mode: restores the main UI, saves the next-action
 * note, moves the pomodoro section back to its normal position, and auto-expands
 * the active task's checkpoint list so the user can pick up where they left off.
 */
function exitEmergency() {
  emergencyMode = false;
  document.body.classList.remove('emergency');
  // Save the next action note
  const entry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
  const note = document.getElementById('emergencyNext').value.trim();
  if (entry && note) localStorage.setItem('wl_emergency_next_' + entry.id, note);
  else if (entry) localStorage.removeItem('wl_emergency_next_' + entry.id);
  // Move pomo back to its original position after tbSection
  const tbSection = document.getElementById('tbSection');
  tbSection.parentNode.insertBefore(document.querySelector('.pomo-section'), tbSection.nextSibling);
  // Auto-expand checkpoints for the active task so user can pick up where they left off
  if (entry) {
    const activeTask = planTasks.find(
      (t) =>
        t.text.toLowerCase() === entry.text.toLowerCase() &&
        Array.isArray(t.checkpoints) &&
        t.checkpoints.length > 0
    );
    if (activeTask) _cpOpenIds.add(activeTask.id);
  }
  renderPlan();
}

document.getElementById('emergencyBtn').addEventListener('click', () => {
  emergencyMode ? exitEmergency() : enterEmergency();
});
document.getElementById('emergencyExit').addEventListener('click', exitEmergency);
// Escape key exits emergency mode
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && emergencyMode) exitEmergency();
});

/* ── Transition handoff note ── */

/**
 * Shows the handoff-note text field in the timer bar so the user can record
 * what a future self (or colleague) should know before picking this task up again.
 */
function showHandoffInput() {
  document.getElementById('timerHandoff').classList.add('show');
  document.getElementById('timerHandoffLbl').classList.add('show');
  document.getElementById('timerHandoff').focus();
}

/** Hides and clears the handoff-note text field. */
function hideHandoffInput() {
  document.getElementById('timerHandoff').classList.remove('show');
  document.getElementById('timerHandoffLbl').classList.remove('show');
  document.getElementById('timerHandoff').value = '';
}

/**
 * Retrieves the stored handoff note for a given entry text.
 * The lookup is case-insensitive and trims whitespace.
 * @param {string} entryText - The entry text to look up.
 * @returns {string|null} The stored note, or null if none exists.
 */
function getHandoffNote(entryText) {
  try {
    const notes = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
    return notes[entryText.toLowerCase().trim()] || null;
  } catch (e) {
    return null;
  }
}

/**
 * Persists a handoff note for a given entry text.
 * Pass an empty string or falsy value to delete the stored note.
 * The key is stored case-insensitively.
 * @param {string} entryText - The entry text to associate the note with.
 * @param {string} note - The note to save; falsy removes the stored note.
 */
function saveHandoffNote(entryText, note) {
  try {
    const notes = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
    if (note) notes[entryText.toLowerCase().trim()] = note;
    else delete notes[entryText.toLowerCase().trim()];
    localStorage.setItem('wl_handoff', JSON.stringify(notes));
  } catch (e) {}
}

// When stop is clicked: show handoff input, save note on confirm
document.getElementById('timerStop').removeEventListener('click', stopTimer);
document.getElementById('timerStop').addEventListener('click', () => {
  const handoffEl = document.getElementById('timerHandoff');
  if (!handoffEl.classList.contains('show')) {
    // First click — show handoff input
    showHandoffInput();
    document.getElementById('timerStop').textContent = 'done ✓';
  } else {
    // Second click — save note and stop
    const entry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
    const note = handoffEl.value.trim();
    if (entry) saveHandoffNote(entry.text, note);
    hideHandoffInput();
    document.getElementById('timerStop').textContent = 'stop';
    if (emergencyMode) exitEmergency();
    stopTimer();
  }
});
// Enter key on handoff input also confirms
document.getElementById('timerHandoff').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('timerStop').click();
  if (e.key === 'Escape') {
    hideHandoffInput();
    document.getElementById('timerStop').textContent = 'stop';
  }
});
