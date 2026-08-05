// ── 23-sprints.js — Sprint mode ──

const STORE_SPRINTS = 'wl_sprints_v1';
let sprintLog = [];

let _sprintActive = false;
let _sprintIntention = '';
let _sprintDuration = 25; // minutes
let _sprintEntryId = null;
let _onSprintEnd = null;

const SPRINT_DURATIONS = [15, 25, 45, 60];

/**
 * Loads sprint history from localStorage into the module-level `sprintLog` array.
 * Falls back to an empty array and logs a warning on parse failure.
 * @returns {void}
 */
function loadSprintLog() {
  try {
    sprintLog = JSON.parse(localStorage.getItem(STORE_SPRINTS) || '[]');
  } catch (err) {
    sprintLog = [];
    wlLog.warn('loadSprintLog: failed to parse sprint log from localStorage', err);
  }
}

/**
 * Persists the current `sprintLog` array to localStorage.
 * @returns {void}
 */
function saveSprintLog() {
  localStorage.setItem(STORE_SPRINTS, JSON.stringify(sprintLog));
}

/**
 * Shows the sprint setup panel, clears the intention input, resets the
 * duration selection to 25 minutes, and focuses the intention field.
 * @returns {void}
 */
function openSprintSetup() {
  const el = document.getElementById('sprintSetup');
  if (!el) return;
  el.style.display = '';
  document.getElementById('sprintIntention').value = '';
  _sprintDuration = 25;
  renderSprintDurations();
  document.getElementById('sprintIntention').focus();
}

/**
 * Renders the duration chip row inside #sprintDurations, marking the
 * currently selected duration active. Attaches click listeners to each chip.
 * @returns {void}
 */
function renderSprintDurations() {
  const el = document.getElementById('sprintDurations');
  if (!el) return;
  el.innerHTML = SPRINT_DURATIONS.map(
    (duration) =>
      `<button class="add-btn sprint-dur-btn${duration === _sprintDuration ? ' sprint-dur-active' : ''}"
               data-dur="${duration}">${duration}m</button>`
  ).join('');
  el.querySelectorAll('.sprint-dur-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      _sprintDuration = parseInt(btn.dataset.dur, 10);
      renderSprintDurations();
    });
  });
}

/**
 * Commits a new sprint: reads the intention from the input, creates a time-log
 * entry, starts the main timer, starts the Pomodoro for `_sprintDuration`
 * minutes, and sets `_onSprintEnd` so the review panel is shown when the ring
 * reaches zero. No-ops with a focus call if the intention field is empty.
 * @returns {void}
 */
function startSprint() {
  _sprintIntention = document.getElementById('sprintIntention').value.trim();
  if (!_sprintIntention) {
    wlLog.info('startSprint: rejected — empty intention');
    document.getElementById('sprintIntention').focus();
    return;
  }
  wlLog.info('startSprint: starting', { duration: _sprintDuration });
  document.getElementById('sprintSetup').style.display = 'none';
  _sprintActive = true;

  const entry = {
    id: Date.now() + '',
    text: _sprintIntention,
    tag: selectedTag,
    ts: safeRoundedStart(),
    date: dk(new Date()),
    _sprintDuration,
  };
  entries.push(entry);
  _sprintEntryId = entry.id;
  save();

  if (activeTimer) stopTimer();
  startTimer(entry.id);

  const focusIntention = document.getElementById('sprintFocusIntention');
  if (focusIntention) {
    focusIntention.textContent = _sprintIntention;
    focusIntention.style.display = '';
  }

  // Start pomodoro for the sprint duration
  initPomo(_sprintDuration);
  startPomo();
  _onSprintEnd = showSprintReview;

  render();
}

/**
 * Called from `pomoDone()` when the Pomodoro ring reaches zero.
 * Fires the registered `_onSprintEnd` callback if one is set, then clears it
 * so it cannot fire twice.
 * @returns {void}
 */
function notifyPomodoroEnd() {
  if (_onSprintEnd) {
    wlLog.info('notifyPomodoroEnd: firing sprint-end callback');
    const fn = _onSprintEnd;
    _onSprintEnd = null;
    fn();
  } else {
    wlLog.info('notifyPomodoroEnd: no callback registered');
  }
}

/**
 * Stops the main timer and renders the sprint review panel inside #sprintReview.
 * Populates the intention label, wires outcome buttons (yes / partly / no),
 * and on save: appends the sprint to `sprintLog`, tags the entry with the
 * outcome, persists both, hides the panel, and triggers a full render.
 * @returns {void}
 */
function showSprintReview() {
  stopTimer();
  const el = document.getElementById('sprintReview');
  if (!el) return;
  el.style.display = '';
  document.getElementById('sprintReviewIntention').textContent = `"${_sprintIntention}"`;
  document.getElementById('sprintReviewNote').value = '';

  const outcomesEl = document.getElementById('sprintOutcomes');
  outcomesEl.innerHTML = [
    ['yes', '✓ Yes', '#1d9e75'],
    ['partly', '◑ Partly', '#ef9f27'],
    ['no', '✗ No', '#d32f2f'],
  ]
    .map(
      ([val, label, color]) =>
        `<button class="add-btn sprint-outcome-btn" data-outcome="${val}"
               style="flex:1;color:${color};border-color:${color}44">${label}</button>`
    )
    .join('');

  let _outcome = null;
  outcomesEl.querySelectorAll('.sprint-outcome-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      _outcome = btn.dataset.outcome;
      outcomesEl
        .querySelectorAll('.sprint-outcome-btn')
        .forEach((otherBtn) => (otherBtn.style.fontWeight = otherBtn === btn ? '600' : ''));
    });
  });

  document.getElementById('sprintReviewSave').onclick = () => {
    if (!_outcome) {
      wlLog.info('showSprintReview: rejected — no outcome chosen');
      alert('Please choose an outcome.');
      return;
    }
    const note = document.getElementById('sprintReviewNote').value.trim();
    loadSprintLog();
    sprintLog.push({
      id: _sprintEntryId,
      intention: _sprintIntention,
      duration: _sprintDuration,
      outcome: _outcome,
      note,
      ts: Date.now(),
    });
    saveSprintLog();
    wlLog.info('showSprintReview: sprint reviewed', {
      duration: _sprintDuration,
      outcome: _outcome,
      hasNote: !!note,
    });

    const entry = entries.find((en) => en.id === _sprintEntryId);
    if (entry) {
      entry._sprintOutcome = _outcome;
      save();
    }

    el.style.display = 'none';
    _sprintActive = false;
    const fi = document.getElementById('sprintFocusIntention');
    if (fi) fi.style.display = 'none';
    render();
  };
}

/**
 * Registers all sprint UI event listeners: the sprint mode button, start,
 * cancel, and Enter-key shortcut on the intention input.
 * Called once on DOMContentLoaded.
 * @returns {void}
 */
function initSprints() {
  document.getElementById('sprintModeBtn')?.addEventListener('click', openSprintSetup);
  document.getElementById('sprintStartBtn')?.addEventListener('click', startSprint);
  document.getElementById('sprintCancel')?.addEventListener('click', () => {
    const el = document.getElementById('sprintSetup');
    if (el) el.style.display = 'none';
  });
  document.getElementById('sprintIntention')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') startSprint();
  });
}
