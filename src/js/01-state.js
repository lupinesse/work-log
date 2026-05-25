const STORE_ENTRIES = 'wl_entries_v1';
const STORE_TIMER = 'wl_timer_v1';
const STORE_POMO_LOG = 'wl_pomoLog_v1';
const STORE_CATS = 'wl_cats_v1';
const STORE_QP_HIDDEN = 'wl_qp_hidden_v1';

// Lowercase task texts the user has dismissed from the recent-tasks list
let qpHidden = (() => {
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
  '#E74C3C',
  '#16A085',
  '#3F51B5',
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

let viewDate = new Date();
let selectedTag = 'work';
let entries = [];
let activeTimer = null;
let timerInterval = null;
let categories = [...DEFAULT_CATS];
let chartMode = 'task';
let blocks = [];
let planDragId = null;

/* ── Load / Save ── */
// Schema validators — strip malformed records rather than rejecting the whole array

/**
 * Returns true if `e` is a well-formed work-log entry safe to load from localStorage.
 * @param {*} e - Candidate value parsed from JSON.
 * @returns {boolean}
 */
function validEntry(e) {
  return (
    e &&
    typeof e.id === 'string' &&
    typeof e.text === 'string' &&
    typeof e.ts === 'number' &&
    typeof e.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.date)
  );
}
/**
 * Returns true if `c` is a well-formed category object.
 * @param {*} c - Candidate value parsed from JSON.
 * @returns {boolean}
 */
function validCategory(c) {
  return (
    c && typeof c.id === 'string' && typeof c.label === 'string' && typeof c.color === 'string'
  );
}
/**
 * Returns true if `t` is a well-formed plan task with a recognised status value.
 * @param {*} t - Candidate value parsed from JSON.
 * @returns {boolean}
 */
function validPlanTask(t) {
  return (
    t &&
    typeof t.id === 'string' &&
    typeof t.text === 'string' &&
    typeof t.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
    ['todo', 'inprogress', 'done', 'pending', 'blocked', 'upcoming'].includes(t.status)
  );
}
/**
 * Returns true if `b` is a well-formed timeblock record.
 * @param {*} b - Candidate value parsed from JSON.
 * @returns {boolean}
 */
function validBlock(b) {
  return (
    b &&
    typeof b.id === 'string' &&
    typeof b.date === 'string' &&
    typeof b.slot === 'number' &&
    typeof b.duration === 'number' &&
    typeof b.text === 'string'
  );
}
/**
 * Returns true if `t` is a resumable timer state.
 * Handles both running (startTs is set) and paused (paused=true, accumulatedMs is set) forms.
 * @param {*} t - Candidate value parsed from JSON.
 * @returns {boolean}
 */
function validTimer(t) {
  if (!t || typeof t.entryId !== 'string') return false;
  // Running timer: startTs is a number (when the current run started)
  // Paused timer:  startTs is null, accumulatedMs holds the work time so far
  if (t.paused === true) return typeof t.accumulatedMs === 'number';
  return typeof t.startTs === 'number';
}
/**
 * Returns true if `e` is a valid Pomodoro session log entry.
 * @param {*} e - Candidate value.
 * @returns {boolean}
 */
function validPomoEntry(e) {
  return e && typeof e.ts === 'number' && typeof e.mins === 'number';
}

/**
 * Loads all persistent state from localStorage into module-level variables.
 * Invalid records are silently dropped per-item rather than rejecting entire arrays.
 * Falls back to the last snapshot if entries are missing from primary storage.
 */
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_ENTRIES) || '[]');
    entries = Array.isArray(raw) ? raw.filter(validEntry) : [];
  } catch (e) {
    entries = [];
  }
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_TIMER) || 'null');
    activeTimer = raw && validTimer(raw) ? raw : null;
  } catch (e) {
    activeTimer = null;
  }
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_CATS) || 'null');
    if (Array.isArray(raw) && raw.length) categories = raw.filter(validCategory);
  } catch (e) {}
  // Auto-restore from snapshot if entries are unexpectedly empty
  if (!entries.length) {
    try {
      const snap = JSON.parse(localStorage.getItem('wl_snapshot') || 'null');
      if (snap && Array.isArray(snap.entries) && snap.entries.length) {
        entries = snap.entries.filter(validEntry);
        if (Array.isArray(snap.categories) && snap.categories.length)
          categories = snap.categories.filter(validCategory);
        console.warn('Restored from snapshot — entries were missing from primary storage');
      }
    } catch (e) {}
  }
}
/**
 * Persists entries, active timer, and categories to localStorage.
 * Refuses to overwrite existing non-empty data with an empty array to guard against
 * accidental data loss if save() is called before load() completes.
 */
function save() {
  // Never overwrite real data with empty arrays
  const existing = localStorage.getItem(STORE_ENTRIES);
  if (!entries.length && existing && existing !== '[]') {
    console.warn('save() blocked — refusing to overwrite existing entries with empty array');
    return;
  }
  localStorage.setItem(STORE_ENTRIES, JSON.stringify(entries));
  localStorage.setItem(STORE_TIMER, JSON.stringify(activeTimer));
  localStorage.setItem(STORE_CATS, JSON.stringify(categories));
}
