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
    promoteMatchingTaskToInProgress(text);
    startTimer(entry.id);
  }
  render();
  inp.focus();
}

/* ── Restart with timer ── */

/**
 * Finds the most recently created log entry with the same text (case-
 * insensitive, trimmed) as `text`. Used to carry proof-link/note context
 * forward when a task or entry is restarted with a fresh timer.
 * @param {string} text - The entry/task text to match against.
 * @returns {(Object|undefined)} The most recent matching entry, or undefined if none exists.
 */
function findMostRecentEntryForText(text) {
  const key = text.toLowerCase().trim();
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].text.toLowerCase().trim() === key) return entries[i];
  }
  return undefined;
}

/**
 * Builds a fresh log entry that continues previously logged work on `text`,
 * used by every "restart with timer" entry point (the log's ▶ restart button,
 * the kanban board's ▸ track button, and the "+ track recent" chips) so they
 * behave consistently.
 *
 * If a prior entry with the same text exists, its proof link is carried over
 * automatically. Its note is deliberately not copied onto the new entry
 * directly — a note written for an earlier session may no longer describe
 * this one — instead `_entryMetaEditId` and `_pendingNoteConfirm` (both in
 * 04-render.js) are set so the new entry's proof-link/note editor opens with
 * a "same note as last time?" prompt for the user to confirm or clear.
 * @param {string} text - Entry text.
 * @param {string} tag - Category id.
 * @returns {Object} A new entry object, not yet pushed to `entries`.
 */
function createRestartedEntry(text, tag) {
  const entry = {
    id: Date.now() + '',
    text,
    tag,
    ts: safeRoundedStart(),
    date: dk(new Date()),
  };
  const prior = findMostRecentEntryForText(text);
  if (prior && prior.link && prior.link.trim()) entry.link = prior.link.trim();
  if (prior && prior.note && prior.note.trim()) {
    _entryMetaEditId = entry.id;
    _pendingNoteConfirm = { id: entry.id, note: prior.note.trim() };
  }
  return entry;
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
