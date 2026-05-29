/* ── Entry add ── */

/**
 * Creates a new log entry from the capture input's current value.
 * Optionally starts the timer on the new entry (`withTimer = true`), in which
 * case any running timer is stopped first and the matching plan task is
 * auto-promoted to "in progress".
 * @param {boolean} withTimer - If true, start the timer on the new entry.
 */
function addEntry(withTimer) {
  const inp = document.getElementById('captureInput');
  const text = inp.value.trim();
  if (!text) {
    inp.focus();
    return;
  }
  if (withTimer && activeTimer) stopTimer();
  const entry = {
    id: Date.now() + '',
    text,
    tag: selectedTag,
    ts: safeRoundedStart(),
    date: dk(new Date()),
  };
  entries.push(entry);
  inp.value = '';
  viewDate = new Date();
  save();
  if (withTimer) {
    // Auto In progress on matching plan task
    const todayKey = dk(new Date());
    const task = planTasks.find(
      (planTask) => planTask.date === todayKey && planTask.text.toLowerCase() === text.toLowerCase()
    );
    if (task && task.status === 'todo') {
      task.status = 'inprogress';
      savePlan();
    }
    startTimer(entry.id);
  }
  render();
  inp.focus();
}

/* ── Billable rule ── */

/**
 * Determines whether a log entry is billable, using a three-tier lookup:
 * 1. The entry's own `billable` flag (if explicitly set).
 * 2. The matching plan task's `billable` flag.
 * 3. The category default.
 *
 * Assumption: entries and tasks where `billable` is `undefined` are treated as
 * billable by default. This preserves backward compatibility with data created
 * before the billable flag was introduced — older entries must not silently
 * disappear from billing reports after an upgrade.
 * If the default should change to non-billable, a migration of existing
 * localStorage data is required (see DATA.md § wl_entries).
 *
 * @param {Object} entry - Log entry object.
 * @returns {boolean} True if the entry should be counted as billable.
 */
function isEntryBillable(entry) {
  if (entry.signifier === 'cancelled') return false;
  if (entry.billable !== undefined) return entry.billable;
  const task = planTasks.find(
    (planTask) => planTask.text.toLowerCase().trim() === entry.text.toLowerCase().trim()
  );
  // `!== false` (not `=== true`) — undefined means billable (see Assumption above).
  if (task) return task.billable !== false;
  // Same `!== false` convention for categories — undefined → billable.
  return getCat(entry.tag || 'other').billable !== false;
}
