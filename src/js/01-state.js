const STORE_ENTRIES = 'wl_entries_v1';
const STORE_TIMER = 'wl_timer_v1';
const STORE_POMO_LOG = 'wl_pomoLog_v1';
const STORE_CATS = 'wl_cats_v1';
const STORE_QP_HIDDEN = 'wl_qp_hidden_v1';
const STORE_LOGNOTES = 'wl_lognotes_v1';
const STORE_TRACKERS = 'wl_trackers_v1';
const STORE_MIGRATION = 'wl_migration_v1';
const STORE_LOCATION = 'wl_location_v1';

// Lowercase task texts the user has dismissed from the recent-tasks list
const qpHidden = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_QP_HIDDEN) || '[]');
    return new Set(Array.isArray(raw) ? raw.map((s) => String(s).toLowerCase()) : []);
  } catch (e) {
    return new Set();
  }
})();
function saveQpHidden() {
  localStorage.setItem(STORE_QP_HIDDEN, JSON.stringify([...qpHidden]));
}

const DEFAULT_CATS = [
  { id: 'work', label: 'work', color: '#378ADD' },
  { id: 'meeting', label: 'meeting', color: '#7EC8E3' },
  { id: 'focus', label: 'deep focus', color: '#1D9E75' },
  { id: 'break', label: 'break', color: '#BA7517' },
  { id: 'other', label: 'other', color: '#888780' },
];
const DEFAULT_IDS = new Set(DEFAULT_CATS.map((c) => c.id));
const CUSTOM_PALETTE = [
  '#7B61FF',
  '#E67E22',
  '#0d9488',
  '#3F51B5',
  '#16A085',
  '#9B59B6',
  '#F39C12',
  '#00BCD4',
  '#27AE60',
  '#E91E63',
  '#FF5722',
  '#2ECC71',
  '#C0392B',
  '#1E88E5',
  '#43A047',
  '#FB8C00',
  '#8E24AA',
  '#039BE5',
  '#6D4C41',
  '#00897B',
  '#F4511E',
  '#D81B60',
  '#546E7A',
  '#FDD835',
  '#5E35B1',
];

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
// eslint-disable-next-line prefer-const -- reassigned by 04-render.js
let chartMode = 'task';
// eslint-disable-next-line prefer-const -- reassigned by 11-timeblock.js (loadBlocks)
let blocks = [];
const planDragId = null;

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
  } catch (e) {
    entries = [];
    wlLog.error('load: failed to parse entries from localStorage', e);
  }
  try {
    const parsedTimer = JSON.parse(localStorage.getItem(STORE_TIMER) || 'null');
    activeTimer = parsedTimer && validTimer(parsedTimer) ? parsedTimer : null;
    if (parsedTimer && !validTimer(parsedTimer))
      wlLog.warn('load: discarded invalid timer state', parsedTimer);
  } catch (e) {
    activeTimer = null;
    wlLog.error('load: failed to parse timer state', e);
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
  } catch (e) {
    wlLog.error('load: failed to parse categories', e);
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
    } catch (e) {
      wlLog.warn('load: failed to parse snapshot from localStorage', e);
    }
  }
  loadLogNotes();
  loadTrackers();
}

function loadLogNotes() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_LOGNOTES) || '[]');
    logNotes = Array.isArray(raw) ? raw : [];
  } catch (e) {
    logNotes = [];
    wlLog.warn('loadLogNotes: failed to parse log notes from localStorage', e);
  }
}

function saveLogNotes() {
  localStorage.setItem(STORE_LOGNOTES, JSON.stringify(logNotes));
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
 */
function save() {
  // Never overwrite real data with empty arrays
  const existing = localStorage.getItem(STORE_ENTRIES);
  if (!entries.length && existing && existing !== '[]') {
    wlLog.warn('save() blocked — refusing to overwrite existing entries with empty array');
    return;
  }
  localStorage.setItem(STORE_ENTRIES, JSON.stringify(entries));
  localStorage.setItem(STORE_TIMER, JSON.stringify(activeTimer));
  localStorage.setItem(STORE_CATS, JSON.stringify(categories));
}
