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
  if (withTimer && getActiveTimer()) stopTimer();
  const entry = {
    id: Date.now() + '',
    text,
    tag: getSelectedTag(),
    ts: safeRoundedStart(),
    date: dk(new Date()),
  };
  getEntries().push(entry);
  inp.value = '';
  setViewDate(new Date());
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
  const entries = getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    // eslint-disable-next-line security/detect-object-injection -- key is an internal app-state value (app data), not from untrusted external input
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
 * 04a-render-entry-meta.js) are set so the new entry's proof-link/note editor opens with
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
// isEntryBillable() has been extracted to src/js/entry-billable.js
// (leaf ES module, issue #336, extraction #19).

/**
 * Returns copies of `entries` each carrying its resolved billable status as a
 * `_billable` flag. Pure helpers such as findGapReportEntries() have no access
 * to the category/task lookups isEntryBillable() needs, so callers resolve the
 * status up front and hand it over on the entry. The input entries are not
 * mutated.
 * @param {Array<Object>} entries - Log entries to annotate.
 * @returns {Array<Object>} New entry objects with `_billable` set.
 */
function annotateBillableStatus(entries) {
  return entries.map((entry) => ({ ...entry, _billable: isEntryBillable(entry) }));
}
