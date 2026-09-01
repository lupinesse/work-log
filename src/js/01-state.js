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
  const usedColors = new Set(categories.map((c) => c.color.toLowerCase()));
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
  if (categories.find((cat) => cat.label.toLowerCase() === label.toLowerCase())) {
    wlLog.warn('createCategory: rejected duplicate label', { label });
    return null;
  }
  const category = { id: 'cat_' + Date.now(), label, color: nextDistinctColor() };
  categories.push(category);
  return category;
}

// eslint-disable-next-line prefer-const -- reassigned by 04-render.js, 05-entries.js, 07-lifecycle.js
let viewDate = new Date();
// eslint-disable-next-line prefer-const -- reassigned by 02-utils.js, 04-render.js
let selectedTag = 'work';
let logNotes = [];
// eslint-disable-next-line prefer-const -- reassigned by 22-trackers.js (loadTrackers)
let trackers = [];
let entries = [];
let activeTimer = null;
// eslint-disable-next-line prefer-const -- reassigned by 03-timer.js, 04-render.js
let timerInterval = null;
let categories = [...DEFAULT_CATS];
// eslint-disable-next-line prefer-const -- reassigned by 11-timeblock.js (loadBlocks)
let blocks = [];

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
    entries = allEntries.filter(validEntry);
    if (entries.length < allEntries.length)
      wlLog.warn(`load: dropped ${allEntries.length - entries.length} invalid entry record(s)`, {
        total: allEntries.length,
        kept: entries.length,
      });
  } catch (err) {
    entries = [];
    wlLog.error('load: failed to parse entries from localStorage', err);
  }
  try {
    const parsedTimer = JSON.parse(localStorage.getItem(STORE_TIMER) || 'null');
    activeTimer = parsedTimer && validTimer(parsedTimer) ? parsedTimer : null;
    if (parsedTimer && !validTimer(parsedTimer))
      wlLog.warn('load: discarded invalid timer state', parsedTimer);
  } catch (err) {
    activeTimer = null;
    wlLog.error('load: failed to parse timer state', err);
  }
  try {
    const parsedCategories = JSON.parse(localStorage.getItem(STORE_CATS) || 'null');
    if (Array.isArray(parsedCategories) && parsedCategories.length) {
      categories = parsedCategories.filter(validCategory);
      if (categories.length < parsedCategories.length)
        wlLog.warn(
          `load: dropped ${parsedCategories.length - categories.length} invalid category record(s)`,
          {
            total: parsedCategories.length,
            kept: categories.length,
          }
        );
    }
  } catch (err) {
    wlLog.error('load: failed to parse categories', err);
  }
  // Auto-restore from snapshot if entries are unexpectedly empty
  if (!entries.length) {
    try {
      const snap = JSON.parse(localStorage.getItem('wl_snapshot') || 'null');
      if (snap && Array.isArray(snap.entries) && snap.entries.length) {
        entries = snap.entries.filter(validEntry);
        if (Array.isArray(snap.categories) && snap.categories.length)
          categories = snap.categories.filter(validCategory);
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
    logNotes = Array.isArray(raw) ? raw : [];
  } catch (err) {
    logNotes = [];
    wlLog.warn('loadLogNotes: failed to parse log notes from localStorage', err);
  }
}

function saveLogNotes() {
  localStorage.setItem(STORE_LOGNOTES, JSON.stringify(logNotes));
}

// Reference to the currently-shown save-failure banner, or null when hidden.
let saveFailBanner = null;

/**
 * Shows a persistent, dismissible banner warning that saving to localStorage
 * is failing (e.g. quota exceeded), with a button to export a backup on the
 * spot. Idempotent — a second failed save while the banner is already up
 * does nothing, so repeat failures don't spam duplicate banners.
 */
function showSaveFailureBanner() {
  if (saveFailBanner) return;

  const banner = document.createElement('div');
  banner.className = 'save-fail-banner';
  banner.id = 'saveFailBanner';
  banner.setAttribute('role', 'alert');

  const msg = document.createElement('span');
  msg.className = 'save-fail-banner__msg';
  msg.textContent = '⚠ Saving failed — your data may not persist. Export a backup now.';

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'save-fail-banner__action';
  exportBtn.textContent = 'Export backup';
  exportBtn.addEventListener('click', () => exportBackup());

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'save-fail-banner__dismiss';
  dismissBtn.setAttribute('aria-label', 'Dismiss saving-failed warning');
  dismissBtn.textContent = '×';
  dismissBtn.addEventListener('click', () => hideSaveFailureBanner());

  banner.appendChild(msg);
  banner.appendChild(exportBtn);
  banner.appendChild(dismissBtn);
  document.body.prepend(banner);
  saveFailBanner = banner;
}

/** Removes the save-failure banner, if one is currently shown. */
function hideSaveFailureBanner() {
  saveFailBanner?.remove();
  saveFailBanner = null;
}

/**
 * Persists entries, active timer, and categories to localStorage.
 * Refuses to overwrite existing non-empty data with an empty array to guard against
 * accidental data loss if save() is called before load() completes.
 *
 * Assumption: an empty `entries` array in memory while localStorage still holds
 * data means save() was called before load() finished (e.g. a race during init),
 * not that the user intentionally deleted everything. Intentional clearing goes
 * through a dedicated wipe path that bypasses this guard.
 *
 * If localStorage.setItem throws (e.g. QuotaExceededError), the failure is
 * caught so it never propagates to save()'s many callers — silently losing
 * data with no signal to the user is worse than a caught, logged, and
 * surfaced failure. A persistent banner tells the user to export a backup;
 * it clears itself automatically the next time a save() call succeeds.
 */
function save() {
  // Never overwrite real data with empty arrays
  const existing = localStorage.getItem(STORE_ENTRIES);
  if (!entries.length && existing && existing !== '[]') {
    wlLog.warn('save() blocked — refusing to overwrite existing entries with empty array');
    return;
  }
  try {
    localStorage.setItem(STORE_ENTRIES, JSON.stringify(entries));
    localStorage.setItem(STORE_TIMER, JSON.stringify(activeTimer));
    localStorage.setItem(STORE_CATS, JSON.stringify(categories));
    hideSaveFailureBanner();
  } catch (err) {
    wlLog.error('save: localStorage.setItem failed — data is not persisting', err);
    showSaveFailureBanner();
  }
}
