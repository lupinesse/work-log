// STORE_* key constants are defined in app-constants.js (a leaf ES module
// imported at the top of the built bundle), not here.

// Lowercase task texts the user has dismissed from the recent-tasks list
const qpHidden = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_QP_HIDDEN) || '[]');
    return new Set(Array.isArray(raw) ? raw.map((s) => String(s).toLowerCase()) : []);
  } catch (err) {
    return new Set();
  }
})();
function saveQpHidden() {
  localStorage.setItem(STORE_QP_HIDDEN, JSON.stringify([...qpHidden]));
}

// DEFAULT_CATS and CUSTOM_PALETTE are defined in app-constants.js (a leaf
// ES module imported at the top of the built bundle), not here.

/**
 * Returns the next visually distinct colour from the palette for a new category.
 * Falls back to golden-angle HSL generation once all palette colours are in use.
 * @returns {string} A CSS colour string (hex or hsl).
 */
function nextDistinctColor() {
  const usedColors = new Set(getCategories().map((c) => c.color.toLowerCase()));
  const pick = CUSTOM_PALETTE.find((c) => !usedColors.has(c.toLowerCase()));
  if (pick) return pick;
  // All palette colours used — generate by golden-angle hue steps
  const hue = (usedColors.size * 137) % 360;
  return `hsl(${hue}, 65%, 52%)`;
}

/**
 * Creates and appends a new category from a raw label, unless a category
 * with the same label already exists (case-insensitive). Shared by the
 * task board's and the log entry's "+ new epic" pickers so both stay in
 * sync (10b-tasks-events.js, 04-render.js).
 * @param {string} rawLabel - User-entered label text, not yet trimmed.
 * @returns {{ id: string, label: string, color: string }|null} The new category, or null when the label is empty or already taken.
 */
function createCategory(rawLabel) {
  const label = String(rawLabel).trim();
  if (!label) return null;
  if (getCategories().find((cat) => cat.label.toLowerCase() === label.toLowerCase())) {
    wlLog.warn('createCategory: rejected duplicate label', { label });
    return null;
  }
  const category = { id: 'cat_' + Date.now(), label, color: nextDistinctColor() };
  getCategories().push(category);
  return category;
}

// The shared mutable variables (entries, activeTimer, timerInterval, categories,
// selectedTag, viewDate, blocks, logNotes) live in state.js (#423); read and
// write them through its getX()/setX() accessors, never as bare globals.

/* ── Load / Save ── */
// Schema validators (validEntry, validCategory, validPlanTask, validBlock, validTimer,
// validPomoEntry) are defined in 00-pure-fns.js (concatenated earlier in the build).

/**
 * Loads all persistent state from localStorage into module-level variables.
 * Invalid records are dropped per-item (rather than rejecting entire arrays)
 * and any drops are reported via wlLog.warn so data-quality issues are visible
 * in DevTools rather than silently disappearing.
 * Falls back to the last snapshot if entries are missing from primary storage.
 */
function load() {
  try {
    const parsedEntries = JSON.parse(localStorage.getItem(STORE_ENTRIES) || '[]');
    const allEntries = Array.isArray(parsedEntries) ? parsedEntries : [];
    setEntries(allEntries.filter(validEntry));
    if (getEntries().length < allEntries.length)
      wlLog.warn(
        `load: dropped ${allEntries.length - getEntries().length} invalid entry record(s)`,
        {
          total: allEntries.length,
          kept: getEntries().length,
        }
      );
  } catch (err) {
    setEntries([]);
    wlLog.error('load: failed to parse entries from localStorage', err);
  }
  try {
    const parsedTimer = JSON.parse(localStorage.getItem(STORE_TIMER) || 'null');
    setActiveTimer(parsedTimer && validTimer(parsedTimer) ? parsedTimer : null);
    if (parsedTimer && !validTimer(parsedTimer))
      wlLog.warn('load: discarded invalid timer state', parsedTimer);
  } catch (err) {
    setActiveTimer(null);
    wlLog.error('load: failed to parse timer state', err);
  }
  try {
    const parsedCategories = JSON.parse(localStorage.getItem(STORE_CATS) || 'null');
    if (Array.isArray(parsedCategories) && parsedCategories.length) {
      setCategories(parsedCategories.filter(validCategory));
      if (getCategories().length < parsedCategories.length)
        wlLog.warn(
          `load: dropped ${parsedCategories.length - getCategories().length} invalid category record(s)`,
          {
            total: parsedCategories.length,
            kept: getCategories().length,
          }
        );
    }
  } catch (err) {
    wlLog.error('load: failed to parse categories', err);
  }
  // Auto-restore from snapshot if entries are unexpectedly empty
  if (!getEntries().length) {
    try {
      const snap = JSON.parse(localStorage.getItem('wl_snapshot') || 'null');
      if (snap && Array.isArray(snap.entries) && snap.entries.length) {
        setEntries(snap.entries.filter(validEntry));
        if (Array.isArray(snap.categories) && snap.categories.length)
          setCategories(snap.categories.filter(validCategory));
        wlLog.warn('load: restored from snapshot — entries were missing from primary storage');
      }
    } catch (err) {
      wlLog.warn('load: failed to parse snapshot from localStorage', err);
    }
  }
  loadLogNotes();
  loadTrackers();
}

function loadLogNotes() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_LOGNOTES) || '[]');
    setLogNotes(Array.isArray(raw) ? raw : []);
  } catch (err) {
    setLogNotes([]);
    wlLog.warn('loadLogNotes: failed to parse log notes from localStorage', err);
  }
}

function saveLogNotes() {
  localStorage.setItem(STORE_LOGNOTES, JSON.stringify(getLogNotes()));
}

// save(), showSaveFailureBanner(), and hideSaveFailureBanner() have been
// extracted to src/js/01c-save.js (leaf ES module, issue #336, extraction #15).
