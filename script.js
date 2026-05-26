(function () {
  // ── 00-config.js ──
  /* ── App configuration ──
   *
   * Static defaults — used when the app is opened directly as a file,
   * or when the local server is not running.
   *
   * When the local server IS running, location values are overridden at
   * startup by /api/config, which reads from your gitignored config.local.ps1.
   * Edit config.local.ps1 (copy from config.local.example.ps1) to set your
   * actual location without touching source code.
   *
   * JIRA_BASE and CAL_ACCOUNT_LABELS are still compile-time — edit them here
   * and rebuild (`node build.js`) to change them.
   */

  // ---------------------------------------------------------------------------
  // Location — overridden at runtime by /api/config when the server is running
  // ---------------------------------------------------------------------------

  /**
   * Latitude of the work location (decimal degrees).
   * Default used when the server is not running; normally set via config.local.ps1.
   * @type {number}
   */
  let WEATHER_LAT = 60.1887;

  /**
   * Longitude of the work location (decimal degrees).
   * Default used when the server is not running; normally set via config.local.ps1.
   * @type {number}
   */
  let WEATHER_LON = 24.927;

  /**
   * Display name for the work location shown next to the weather widget.
   * Default used when the server is not running; normally set via config.local.ps1.
   * @type {string}
   */
  let WEATHER_NAME = 'Helsinki';

  // ---------------------------------------------------------------------------
  // Jira — base URL used to turn ticket keys (e.g. PROJ-123) into links
  // ---------------------------------------------------------------------------

  /**
   * Base URL for Jira ticket links. Ticket keys found in task names are
   * converted to `<a href="${JIRA_BASE}/${key}">` anchors.
   * Set to `''` to disable link generation.
   * @type {string}
   */
  const JIRA_BASE = 'https://your-instance.atlassian.net/browse';

  // ---------------------------------------------------------------------------
  // Outlook calendar account labels
  // ---------------------------------------------------------------------------

  /**
   * Maps raw Outlook account keys (lowercase) to human-readable labels shown
   * in the calendar strip. The PowerShell server sends the DisplayName field;
   * this map handles display-name variants, email domains, and substring matches.
   *
   * Add an entry for each calendar account you want labelled; unknown accounts
   * are shown without a label badge.
   *
   * @type {Object.<string, string>}
   */
  const CAL_ACCOUNT_LABELS = {
    // Replace with your own account keys and labels, e.g.:
    // acme: 'Acme Corp',
    // contractor: 'My Contractor',
  };

  // ── 00-logger.js ──
  // Structured logger — prefix [WL:LEVEL] makes log lines easy to filter in DevTools.
  // Loaded first (00-) so all other modules can call wlLog.* without guards.

  /**
   * Namespace for all application logging.
   * Each method prepends a `[WL:LEVEL]` tag so log lines can be filtered in
   * the browser DevTools console with the text filter `[WL:`.
   * @namespace wlLog
   */
  const wlLog = (() => {
    const fmt = (level, msg, data) =>
      data !== undefined ? [`[WL:${level}]`, msg, data] : [`[WL:${level}]`, msg];

    return {
      /**
       * Emits a debug-level message, visible only when DevTools verbose level is on.
       * @param {string} msg - Human-readable message.
       * @param {*} [data] - Optional value to attach to the log line.
       */
      debug: (msg, data) => console.debug(...fmt('DEBUG', msg, data)),

      /**
       * Emits an informational message.
       * @param {string} msg - Human-readable message.
       * @param {*} [data] - Optional value to attach to the log line.
       */
      info: (msg, data) => console.info(...fmt('INFO', msg, data)),

      /**
       * Emits a warning — something unexpected but non-fatal.
       * @param {string} msg - Human-readable message.
       * @param {*} [data] - Optional value to attach to the log line.
       */
      warn: (msg, data) => console.warn(...fmt('WARN', msg, data)),

      /**
       * Emits an error — something that broke or produced an incorrect result.
       * @param {string} msg - Human-readable message.
       * @param {*} [data] - Optional value to attach to the log line.
       */
      error: (msg, data) => console.error(...fmt('ERROR', msg, data)),

      /**
       * Logs a snapshot of runtime configuration at startup in a collapsed group.
       * Called once by 07-lifecycle.js after state is loaded.
       * @param {Object} cfg - Key/value pairs to display (e.g. version, entry count).
       */
      config: (cfg) => {
        console.groupCollapsed('[WL:CONFIG] Startup');
        Object.entries(cfg).forEach(([k, v]) => console.log(`  ${k}:`, v));
        console.groupEnd();
      },
    };
  })();

  // ── 00-pure-fns.js ──
  /**
   * @file 00-pure-fns.js
   * Pure functions with no side-effects and no dependencies on global state.
   * Extracted here so they can be imported by Node unit tests without a browser.
   *
   * In the browser build these declarations become globals inside the IIFE.
   * In Node (require / test runner) the module.exports block at the bottom exports them.
   */

  /* ── CSS / HTML safety ── */

  /**
   * Returns `c` if it is a safe CSS colour (hex or hsl()), otherwise returns a neutral fallback.
   * Prevents malformed user-supplied colour values from breaking layout or injecting CSS.
   * @param {string} c
   * @returns {string} A safe CSS colour string.
   * @example
   * safeCssColor('#7B61FF')      // → '#7B61FF'
   * safeCssColor('hsl(200,60%,50%)') // → 'hsl(200,60%,50%)'
   * safeCssColor('red')          // → '#888780'  (name blocked)
   * safeCssColor('')             // → '#888780'
   */
  function safeCssColor(c) {
    // Allow hex (#rgb, #rrggbb, #rrggbbaa) and hsl() only — block anything else
    return /^(#[0-9a-fA-F]{3,8}|hsl\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*\))$/.test(String(c))
      ? c
      : '#888780';
  }

  /**
   * Escapes a string for safe insertion as HTML text content.
   * @param {string} s
   * @returns {string}
   * @example
   * escHtml('<b>bold</b>')   // → '&lt;b&gt;bold&lt;/b&gt;'
   * escHtml('a & b')         // → 'a &amp; b'
   * escHtml('"quoted"')      // → '&quot;quoted&quot;'
   * escHtml(42)              // → '42'
   */
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Date / time formatting ── */

  /**
   * Formats a Date as YYYY-MM-DD using UTC (toISOString).
   * Note: uses UTC midnight, not local midnight — callers near midnight in UTC+ zones
   * should be aware that this may return the previous calendar day.
   * @param {Date} d
   * @returns {string} e.g. '2026-05-25'
   */
  function dk(d) {
    return d.toISOString().slice(0, 10);
  }

  /**
   * Formats a Unix timestamp as HH:MM in 24-hour local time.
   * @param {number} ts - Unix timestamp in milliseconds.
   * @returns {string} e.g. '09:30'
   * @example
   * fmtTime(new Date('2026-05-25T09:05:00').getTime()) // → '09:05'
   * fmtTime(new Date('2026-05-25T14:30:00').getTime()) // → '14:30'
   */
  function fmtTime(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /**
   * Formats a duration in milliseconds as a compact time string.
   * @param {number} ms - Duration in milliseconds.
   * @returns {string} 'MM:SS' for durations under an hour; 'HH:MM:SS' otherwise.
   * @example
   * fmtElapsed(0)              // → '00:00'
   * fmtElapsed(90 * 1000)      // → '01:30'
   * fmtElapsed(3600 * 1000)    // → '01:00:00'
   * fmtElapsed(5461 * 1000)    // → '01:31:01'
   */
  function fmtElapsed(ms) {
    const s = Math.floor(ms / 1000);
    const hh = Math.floor(s / 3600),
      mm = Math.floor((s % 3600) / 60),
      ss = s % 60;
    if (hh > 0)
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  /* ── Billing time rounding ── */

  /**
   * Rounds a duration up to the nearest 30-minute slot, with a minimum of 30 min.
   * Used for billing time estimates — even a 1-second task costs one half-hour slot.
   *
   * Assumption: billing granularity is 30 minutes and the minimum billable unit is
   * 30 minutes. Changing this assumption requires updating both this function and
   * any UI that displays billable totals (04-render.js renderBillableBar).
   *
   * @param {number} ms - Duration in milliseconds.
   * @returns {number} Duration rounded up to nearest 30-min slot, in milliseconds.
   * @example
   * roundUp30(0)                    // → 1_800_000  (30 min — minimum)
   * roundUp30(1)                    // → 1_800_000  (1 ms still costs one slot)
   * roundUp30(30 * 60 * 1000)       // → 1_800_000  (exactly 30 min stays at 30 min)
   * roundUp30(30 * 60 * 1000 + 1)   // → 3_600_000  (30 min + 1 ms rounds up to 60 min)
   */
  function roundUp30(ms) {
    const SLOT = 30 * 60 * 1000;
    return Math.max(SLOT, Math.ceil(ms / SLOT) * SLOT);
  }

  /**
   * Rounds a timestamp to the nearest 30-minute clock mark.
   *
   * Tie-breaking rule (at exactly 15 min into a 30-min slot): rounds DOWN.
   * Rationale: conservative for billing — a task must exceed the midpoint of the slot
   * before the next slot is claimed.
   *
   * Assumption: rounding ties (exactly 15 min past a slot start) are resolved in
   * favour of the earlier slot to avoid inflating billable time. This matches the
   * intent documented in DATA.md under wl_entries.ts.
   *
   * @param {number} ts - Unix timestamp in milliseconds.
   * @returns {number} Rounded Unix timestamp in milliseconds.
   */
  function roundToNearest30(ts) {
    const d = new Date(ts);
    const m = d.getMinutes();
    const blockStart = Math.floor(m / 30) * 30; // 0 or 30
    const withinBlock = m - blockStart; // 0–29
    // withinBlock <= 15 → keep blockStart (rounds down / tie goes down)
    // withinBlock >  15 → advance to blockStart + 30
    const roundedMins = withinBlock <= 15 ? blockStart : blockStart + 30;
    const result = new Date(d);
    result.setSeconds(0, 0);
    result.setMinutes(roundedMins % 60);
    if (roundedMins >= 60) result.setHours(d.getHours() + 1);
    return result.getTime();
  }

  /* ── Schema validators ── */
  // These are used by 01-state.js load() to strip malformed records from localStorage.
  // They are pure: each validates only its argument with no side-effects.

  /**
   * Returns true if `e` is a well-formed work-log entry safe to load from localStorage.
   * @param {*} e - Candidate value parsed from JSON.
   * @returns {boolean}
   * @example
   * validEntry({ id: '1', text: 'Write report', ts: 1234567890, date: '2026-05-25' }) // → true
   * validEntry(null)                           // → false
   * validEntry({ id: 1, text: 'x', ts: 0, date: '2026-05-25' }) // → false (numeric id)
   * validEntry({ id: '1', text: 'x', ts: 0, date: '25-05-2026' }) // → false (wrong date format)
   */
  function validEntry(e) {
    return !!(
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
    return !!(
      c &&
      typeof c.id === 'string' &&
      typeof c.label === 'string' &&
      typeof c.color === 'string'
    );
  }

  /**
   * Returns true if `t` is a well-formed plan task with a recognised status value.
   * @param {*} t - Candidate value parsed from JSON.
   * @returns {boolean}
   * @example
   * validPlanTask({ id: 'pk1', text: 'Build form', date: '2026-05-25', status: 'todo' }) // → true
   * validPlanTask({ id: 'pk1', text: 'x', date: '2026-05-25', status: 'finished' }) // → false (unknown status)
   * validPlanTask(null) // → false
   */
  function validPlanTask(t) {
    return !!(
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
    return !!(
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
   * @example
   * validTimer({ entryId: 'e1', startTs: 1234567890 })              // → true  (running)
   * validTimer({ entryId: 'e1', paused: true, accumulatedMs: 900000 }) // → true  (paused)
   * validTimer({ entryId: 'e1' })                                   // → false (neither running nor paused)
   * validTimer(null)                                                 // → false
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
    return !!(e && typeof e.ts === 'number' && typeof e.mins === 'number');
  }

  // ── CommonJS export (Node / unit tests only) ─────────────────────────────────
  // In the browser IIFE, `module` is not defined so typeof returns 'undefined' and
  // this block is skipped — functions remain as globals in the closure.
  if (typeof module !== 'undefined') {
    module.exports = {
      safeCssColor,
      escHtml,
      dk,
      fmtTime,
      fmtElapsed,
      roundUp30,
      roundToNearest30,
      validEntry,
      validCategory,
      validPlanTask,
      validBlock,
      validTimer,
      validPomoEntry,
    };
  }

  // ── 01-state.js ──
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
      const raw = JSON.parse(localStorage.getItem(STORE_ENTRIES) || '[]');
      const all = Array.isArray(raw) ? raw : [];
      entries = all.filter(validEntry);
      if (entries.length < all.length)
        wlLog.warn(`load: dropped ${all.length - entries.length} invalid entry record(s)`, {
          total: all.length,
          kept: entries.length,
        });
    } catch (e) {
      entries = [];
      wlLog.error('load: failed to parse entries from localStorage', e);
    }
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_TIMER) || 'null');
      activeTimer = raw && validTimer(raw) ? raw : null;
      if (raw && !validTimer(raw)) wlLog.warn('load: discarded invalid timer state', raw);
    } catch (e) {
      activeTimer = null;
      wlLog.error('load: failed to parse timer state', e);
    }
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_CATS) || 'null');
      if (Array.isArray(raw) && raw.length) {
        categories = raw.filter(validCategory);
        if (categories.length < raw.length)
          wlLog.warn(`load: dropped ${raw.length - categories.length} invalid category record(s)`, {
            total: raw.length,
            kept: categories.length,
          });
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
      } catch (e) {}
    }
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

  // ── 01b-migrate.js ──
  /**
   * @file 01b-migrate.js
   * Automatic localStorage schema migration.
   *
   * Runs once per page load, before load() reads from the versioned keys.
   * Each migration entry maps an old key name to the new one. If the old
   * key has data and the new key is empty, the data is copied across and
   * the old key is removed. Already-migrated users are unaffected (the
   * old key simply won't exist).
   *
   * Adding a new migration: append an entry to MIGRATIONS. Never remove
   * old entries — a user might be upgrading across multiple versions.
   *
   * @see DATA.md for the full localStorage schema reference.
   */

  /**
   * Describes one key-rename migration.
   * @typedef {{ from: string, to: string, description: string }} Migration
   */

  /** @type {Migration[]} */
  const MIGRATIONS = [
    // v0 → v1: keys gained _v1 suffix and some were renamed for clarity.
    // (Original single-file release used these bare names.)
    { from: 'wl_entries', to: 'wl_entries_v1', description: 'entries array' },
    { from: 'wl_cats', to: 'wl_cats_v1', description: 'categories array' },
    { from: 'wl_categories', to: 'wl_cats_v1', description: 'categories array (alt name)' },
    { from: 'wl_timer', to: 'wl_timer_v1', description: 'active timer state' },
    { from: 'wl_active_timer', to: 'wl_timer_v1', description: 'active timer state (alt name)' },
    { from: 'wl_plan', to: 'wl_plan_v1', description: 'plan tasks array' },
    { from: 'wl_pomoLog', to: 'wl_pomoLog_v1', description: 'pomodoro session log' },
    { from: 'wl_qp_hidden', to: 'wl_qp_hidden_v1', description: 'quick-pick hidden tasks' },
  ];

  /**
   * Runs all pending schema migrations.
   * Safe to call multiple times — migrations are skipped if the source key
   * is absent or the destination key already has data.
   */
  function migrateStorage() {
    let migratedCount = 0;
    for (const { from, to, description } of MIGRATIONS) {
      const oldData = localStorage.getItem(from);
      if (!oldData) continue; // already migrated or never existed
      if (localStorage.getItem(to)) {
        // Destination already has data — don't overwrite; just clean up old key
        localStorage.removeItem(from);
        wlLog.warn(
          `migrate: removed stale old key "${from}" (${description}); "${to}" already exists`
        );
        continue;
      }
      localStorage.setItem(to, oldData);
      localStorage.removeItem(from);
      migratedCount++;
      wlLog.info(`migrate: "${from}" → "${to}" (${description})`);
    }
    if (migratedCount > 0) {
      wlLog.info(`migrate: completed ${migratedCount} migration(s)`);
    }
  }

  // Run immediately so data is in the right keys before load() is called.
  migrateStorage();

  // ── 02-utils.js ──
  /* ── Epic helpers ── */
  // safeCssColor() and escHtml() are defined in 00-pure-fns.js.

  /**
   * Returns the category object for `id`, falling back to 'other' if not found.
   * The returned colour is always sanitised through safeCssColor.
   * @param {string} id - Category ID.
   * @returns {{ id: string, label: string, color: string }}
   */
  function getCat(id) {
    const cat = categories.find((c) => c.id === id) || categories.find((c) => c.id === 'other');
    if (!cat) return { id: 'other', label: 'other', color: '#888780' };
    return { ...cat, color: safeCssColor(cat.color) };
  }
  function getCatColor(id) {
    return getCat(id).color;
  }
  function getCatLabel(id) {
    return getCat(id).label;
  }

  function addCategory() {
    const name = prompt('New epic name:');
    if (!name || !name.trim()) return;
    const label = name.trim();
    if (categories.find((c) => c.label.toLowerCase() === label.toLowerCase())) {
      alert('An epic with that name already exists.');
      return;
    }
    const color = nextDistinctColor();
    const id = 'cat_' + Date.now();
    categories.push({ id, label, color });
    selectedTag = id;
    save();
    renderTagRow();
  }

  let editingCatId = null;
  let addingNewCat = false;

  function renderTagRow() {
    const row = document.getElementById('tagRow');
    const selCat = getCat(selectedTag);

    // Build manage row content based on state
    let manageHtml;
    if (editingCatId) {
      const c = getCat(editingCatId);
      manageHtml = `<div class="cat-inline-edit">
        <input class="cat-inline-input" id="catEditInput" value="${escHtml(c.label)}" data-id="${editingCatId}" />
        <button class="cat-inline-ok" id="catEditOk" data-id="${editingCatId}">&#10003;</button>
        <button class="cat-inline-cancel" id="catEditCancel">&#10005;</button>
      </div>`;
    } else if (addingNewCat) {
      manageHtml = `<div class="cat-inline-edit">
        <input class="cat-inline-input" id="catNewInput" placeholder="new epic name" style="flex:1" />
        <button class="cat-inline-ok" id="catNewOk">&#10003;</button>
        <button class="cat-inline-cancel" id="catNewCancel">&#10005;</button>
      </div>`;
    } else {
      manageHtml = `
        <button class="cat-manage-btn" id="catRenBtn">&#9998; rename</button>
        <button class="cat-manage-btn danger" id="catDelBtn">&#215; delete</button>
        <button class="cat-manage-btn add" id="catAddBtn">+ add epic</button>
        <button class="cat-manage-btn" id="catBillBtn">${selCat.billable === false ? '💸 non-billable' : '💰 billable'}</button>`;
    }

    row.innerHTML = `
      <div class="cat-dropdown-row">
        <label class="cat-color-swatch cat-dot-preview" id="catDotPreview" title="click to change colour" style="background:${selCat.color}">
          <input type="color" id="catQuickColorPick" value="${selCat.color}" style="opacity:0;position:absolute;width:0;height:0;pointer-events:none" />
        </label>
        <select class="cat-select" id="catSelect">
        ${[...categories]
          .sort((a, b) => a.label.localeCompare(b.label))
          .map(
            (c) =>
              `<option value="${c.id}"${c.id === selectedTag ? ' selected' : ''}>${escHtml(c.label)}</option>`
          )
          .join('')}
        </select>
      </div>
      <div class="cat-manage-row" id="catManageRow">${manageHtml}</div>`;

    // Select change
    document.getElementById('catSelect').addEventListener('change', (e) => {
      selectedTag = e.target.value;
      editingCatId = null;
      addingNewCat = false;
      renderTagRow();
    });

    // Quick colour picker — click the dot to change colour immediately
    const quickColorPick = document.getElementById('catQuickColorPick');
    if (quickColorPick) {
      quickColorPick.addEventListener('input', () => {
        const dot = document.getElementById('catDotPreview');
        if (dot) dot.style.background = quickColorPick.value;
      });
      quickColorPick.addEventListener('change', () => {
        const cat = categories.find((c) => c.id === selectedTag);
        if (cat) {
          cat.color = quickColorPick.value;
          save();
          renderTagRow();
          render();
          renderTimeblock();
          renderCompleted();
        }
      });
    }

    // Rename: open
    const renBtn = document.getElementById('catRenBtn');
    if (renBtn)
      renBtn.addEventListener('click', () => {
        editingCatId = selectedTag;
        addingNewCat = false;
        renderTagRow();
      });

    // Rename: save
    const editOk = document.getElementById('catEditOk');
    if (editOk) {
      const saveEdit = () => {
        const input = document.getElementById('catEditInput');
        const label = input ? input.value.trim() : '';
        const id = editOk.dataset.id;
        if (!label) {
          editingCatId = null;
          renderTagRow();
          return;
        }
        if (categories.find((c) => c.id !== id && c.label.toLowerCase() === label.toLowerCase())) {
          input.style.borderColor = '#C62828';
          input.focus();
          return;
        }
        const cat = categories.find((c) => c.id === id);
        if (cat) cat.label = label;
        editingCatId = null;
        save();
        renderTagRow();
        render();
        renderTimeblock();
        renderCompleted();
      };
      editOk.addEventListener('click', saveEdit);
      const inp = document.getElementById('catEditInput');
      if (inp) {
        inp.focus();
        inp.select();
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') saveEdit();
          if (e.key === 'Escape') {
            editingCatId = null;
            renderTagRow();
          }
        });
      }
    }

    // Rename: cancel
    const editCancel = document.getElementById('catEditCancel');
    if (editCancel)
      editCancel.addEventListener('click', () => {
        editingCatId = null;
        renderTagRow();
      });

    // Delete
    const delBtn = document.getElementById('catDelBtn');
    if (delBtn)
      delBtn.addEventListener('click', () => {
        categories = categories.filter((c) => c.id !== selectedTag);
        selectedTag = 'work';
        save();
        renderTagRow();
        render();
      });

    // Add: open
    const addBtn = document.getElementById('catAddBtn');
    if (addBtn)
      addBtn.addEventListener('click', () => {
        addingNewCat = true;
        editingCatId = null;
        renderTagRow();
      });
    const billBtn = document.getElementById('catBillBtn');
    if (billBtn)
      billBtn.addEventListener('click', () => {
        const cat = getCat(selectedTag);
        cat.billable = cat.billable === false;
        // Retroactively update all tasks with this category
        planTasks.forEach((t) => {
          if (t.tag === selectedTag) t.billable = cat.billable;
        });
        save();
        savePlan();
        renderTagRow();
        renderPlan();
        renderCompleted();
      });

    // Add: save
    const newOk = document.getElementById('catNewOk');
    if (newOk) {
      const saveNew = () => {
        const input = document.getElementById('catNewInput');
        const label = input ? input.value.trim() : '';
        if (!label) {
          addingNewCat = false;
          renderTagRow();
          return;
        }
        if (categories.find((c) => c.label.toLowerCase() === label.toLowerCase())) {
          input.style.borderColor = '#C62828';
          input.focus();
          return;
        }
        const color = nextDistinctColor();
        const id = 'cat_' + Date.now();
        categories.push({ id, label, color });
        selectedTag = id;
        addingNewCat = false;
        document.getElementById('captureInput').value = '';
        save();
        renderTagRow();
        render();
      };
      newOk.addEventListener('click', saveNew);
      const ni = document.getElementById('catNewInput');
      if (ni) {
        ni.focus();
        ni.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') saveNew();
          if (e.key === 'Escape') {
            addingNewCat = false;
            renderTagRow();
          }
        });
      }
    }

    // Add: cancel
    const newCancel = document.getElementById('catNewCancel');
    if (newCancel)
      newCancel.addEventListener('click', () => {
        addingNewCat = false;
        renderTagRow();
      });
  }

  /* ── Utility ── */
  // dk(), fmtTime(), fmtElapsed(), roundUp30(), roundToNearest30(), safeCssColor(), escHtml()
  // are defined in 00-pure-fns.js (concatenated earlier) so they are in scope here.

  /**
   * Returns true if `d` falls on today's calendar date (UTC).
   * @param {Date} d
   * @returns {boolean}
   */
  function isToday(d) {
    return dk(d) === dk(new Date());
  }
  /**
   * Returns a human-readable day label: 'today', 'yesterday', or a short locale date string.
   * @param {Date} d
   * @returns {string}
   */
  function fmtLabel(d) {
    if (isToday(d)) return 'today';
    const diffMs = new Date(dk(new Date())) - new Date(dk(d));
    const diffDays = Math.round(diffMs / 86400000);
    if (diffDays === 1) return 'yesterday';
    return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  /**
   * Rounds `ts` to the nearest 30-minute mark only when `entry` is billable.
   * Non-billable entries keep their exact timestamps for accurate reporting.
   * @param {number} ts - Unix timestamp in milliseconds.
   * @param {object|null} entry - Work-log entry; if null, always rounds.
   * @returns {number} Timestamp, conditionally rounded.
   */
  function roundToNearest30IfBillable(ts, entry) {
    // Assumption: non-billable entries keep exact timestamps for accurate time reporting.
    // Billable entries are rounded because clients are invoiced in 30-minute increments.
    // Changing this requires updating the export format in 05-entries.js and DATA.md.
    if (entry && !isEntryBillable(entry)) return ts;
    return roundToNearest30(ts);
  }

  /**
   * Returns a rounded start timestamp that does not overlap any existing entry for today.
   * Prevents new entries from appearing to start before a prior entry's end time.
   * @returns {number} Unix timestamp in milliseconds.
   */
  function safeRoundedStart() {
    const ts = roundToNearest30(Date.now());
    const todayKey = dk(new Date());
    const lastEnd = entries
      .filter((e) => e.date === todayKey && e.tsEnd)
      .reduce((max, e) => Math.max(max, e.tsEnd), 0);
    return Math.max(ts, lastEnd);
  }

  /**
   * Returns entries for the currently viewed date, sorted newest-first.
   * @returns {Array<object>}
   */
  function viewEntries() {
    return entries
      .filter((e) => e.date === dk(viewDate))
      .slice()
      .reverse();
  }
  /**
   * Counts entries logged since the start of the current ISO week (Monday 00:00 local).
   * @returns {number}
   */
  function weekCount() {
    const now = new Date(),
      mon = new Date(now);
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    mon.setHours(0, 0, 0, 0);
    return entries.filter((e) => new Date(e.ts) >= mon).length;
  }
  /**
   * Counts consecutive days with at least one logged entry, looking backwards from yesterday.
   * Today is excluded so the streak only increments once the day has been completed.
   * @returns {number}
   */
  function calcStreak() {
    const days = new Set(entries.map((e) => e.date));
    let streak = 0,
      d = new Date();
    d.setDate(d.getDate() - 1); // Start from yesterday, not today
    while (days.has(dk(d))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }
  // escHtml() is defined in 00-pure-fns.js.

  // ── 03-timer.js ──
  /* ── Timer ── */

  /**
   * Returns the total elapsed milliseconds for the active timer.
   * Accounts for accumulated time from previous pause/resume cycles.
   * Returns 0 if no timer is active.
   * @returns {number} Elapsed time in milliseconds.
   */
  function getElapsedMs() {
    if (!activeTimer) return 0;
    const acc = activeTimer.accumulatedMs || 0;
    return activeTimer.paused ? acc : acc + (Date.now() - activeTimer.startTs);
  }
  /**
   * Starts (or restarts) the timer for the given entry.
   * Clears any existing interval, resets the chime state, and begins a 1-second
   * tick. Persists state and updates the UI immediately.
   * @param {string} entryId - ID of the log entry to time.
   */
  function startTimer(entryId) {
    if (timerInterval) clearInterval(timerInterval);
    _lastChimeMinute = null;
    activeTimer = { entryId, startTs: Date.now(), accumulatedMs: 0, paused: false };
    save();
    timerInterval = setInterval(tickTimer, 1000); // set up BEFORE first tick so it always runs
    tickTimer();
    updateTimerBar();
    updateTimerBtn(true);
  }
  /**
   * Pauses the running timer, accumulating elapsed time so it can be resumed.
   * No-ops if no timer is active or it is already paused.
   */
  function pauseTimer() {
    if (!activeTimer || activeTimer.paused) return;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    activeTimer.accumulatedMs = getElapsedMs();
    activeTimer.paused = true;
    activeTimer.startTs = null;
    save();
    updateTimerBar();
    updateTabAndFavicon();
  }
  /**
   * Resumes a paused timer from where it left off.
   * No-ops if no timer is active or it is not paused.
   */
  function resumeTimer() {
    if (!activeTimer || !activeTimer.paused) return;
    activeTimer.paused = false;
    activeTimer.startTs = Date.now();
    save();
    timerInterval = setInterval(tickTimer, 1000);
    tickTimer();
    updateTimerBar();
  }
  /**
   * Stops the active timer, stamps the log entry with an end time (rounded to
   * the nearest 30 min for billable entries), clears `activeTimer`, and
   * triggers a full render. Resets the timer bar colour and closes the park
   * capture input if open. No-ops if no timer is active.
   */
  function stopTimer() {
    if (!activeTimer) return;
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    const entry = entries.find((e) => e.id === activeTimer.entryId);
    if (entry) entry.tsEnd = roundToNearest30IfBillable(entry.ts + getElapsedMs(), entry);
    activeTimer = null;
    _lastChimeMinute = null;
    save();
    render();
    const bar = document.getElementById('timerBar');
    if (bar) {
      bar.style.background = '';
      bar.style.borderColor = '';
    }
    const pulse = document.querySelector('.timer-pulse');
    if (pulse) pulse.style.background = '';
    // Close park capture if open
    const pc = document.getElementById('parkCapture');
    const pb = document.getElementById('timerParkBtn');
    if (pc) {
      pc.classList.remove('show');
      pc.value = '';
    }
    if (pb) pb.classList.remove('active');
    updateTabAndFavicon();
  }
  /**
   * Updates the live time-block element in the time-block view to reflect the
   * current elapsed time of the active timer. No-ops if the live block element
   * or the active timer's entry cannot be found.
   */
  function updateLiveBlock() {
    const el = document.getElementById('tb-live-block');
    if (!el || !activeTimer) return;
    const entry = entries.find((e) => e.id === activeTimer.entryId);
    if (!entry) return;
    const tbStartMins = TB_START * 60,
      tbEndMins = TB_END * 60;
    const startMins = new Date(entry.ts).getHours() * 60 + new Date(entry.ts).getMinutes();
    const cStart = Math.max(startMins, tbStartMins);
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    const endMins = Math.min(Math.max(nowMins, cStart + 1), tbEndMins);
    const hPx = Math.max(TB_SLOT_H * 0.5, ((endMins - cStart) / 30) * TB_SLOT_H);
    el.style.height = hPx + 'px';
    const sub = document.getElementById('tb-live-sub');
    if (sub) {
      const cat = getCat(entry.tag || 'other');
      const elapsedMins = Math.round(getElapsedMs() / 60000);
      const h = Math.floor(elapsedMins / 60),
        m = elapsedMins % 60;
      sub.textContent = cat.label + ' · ' + (h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`);
    }
  }

  // Favicon — drawn on a 32×32 canvas as a colored dot
  const HYPERFOCUS_MINS = 90;
  let _faviconState = null; // track last state to avoid redundant redraws

  /**
   * Updates the browser favicon to a coloured dot reflecting the timer state.
   * Skips redundant redraws by tracking the last rendered state.
   * @param {'active'|'paused'|'hyperfocus'|'idle'} state - Current timer state.
   */
  function setFavicon(state) {
    if (state === _faviconState) return;
    _faviconState = state;
    const colors = { active: '#1D9E75', paused: '#EF9F27', hyperfocus: '#E74C3C', idle: null };
    const color = colors[state];
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (!color) {
      link.href = '';
      return;
    }
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d');
      if (!ctx) return; // canvas blocked (e.g. privacy settings)
      ctx.beginPath();
      ctx.arc(16, 16, 13, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      link.href = c.toDataURL();
    } catch (e) {} // silently skip favicon if canvas unavailable
  }

  /**
   * Synchronises the browser tab title and favicon with the current timer state.
   * Adds a ▶/⏸/🔴 prefix and shows the elapsed time and task name in the title.
   * Switches to hyperfocus state (red) after {@link HYPERFOCUS_MINS} minutes for
   * non-meeting tasks.
   */
  function updateTabAndFavicon() {
    if (!activeTimer) {
      document.title = 'Work Log';
      setFavicon('idle');
      return;
    }
    const entry = entries.find((e) => e.id === activeTimer.entryId);
    const taskText = entry ? entry.text : '…';
    const elapsedMs = getElapsedMs();
    const elapsed = fmtElapsed(elapsedMs);
    const isMeeting = entry && entry.text.startsWith('📅');
    const isHyperfocus = !isMeeting && elapsedMs > HYPERFOCUS_MINS * 60 * 1000;

    if (activeTimer.paused) {
      document.title = `⏸ ${elapsed} — ${taskText}`;
      setFavicon('paused');
    } else if (isHyperfocus) {
      document.title = `🔴 ${elapsed} — ${taskText}`;
      setFavicon('hyperfocus');
    } else {
      document.title = `▶ ${elapsed} — ${taskText}`;
      setFavicon('active');
    }
  }

  /**
   * Computes the timer-bar accent colour, interpolating from green to red as
   * elapsed time approaches {@link HYPERFOCUS_MINS}.
   * Returns `null` when the timer is paused so CSS handles the paused state.
   * Colour shift: green (#1D9E75 = hsl 158,69,51) → red (#E74C3C = hsl 5,72,57).
   * @param {number}  elapsedMs - Elapsed time in milliseconds.
   * @param {boolean} paused    - Whether the timer is currently paused.
   * @returns {string|null} An HSL colour string, or null when paused.
   */
  function timerBarColor(elapsedMs, paused) {
    if (paused) return null; // let CSS paused class handle it
    const t = Math.min(elapsedMs / (HYPERFOCUS_MINS * 60 * 1000), 1); // 0→1
    const hue = Math.round(158 - 153 * t); // 158 (green) → 5 (red)
    const sat = Math.round(69 + 3 * t); // 69% → 72%
    const lit = Math.round(51 + 6 * t); // 51% → 57%
    return `hsl(${hue}, ${sat}%, ${lit}%)`;
  }

  // Chime system
  let CHIME_INTERVALS_MINS = [30]; // default, overridden by selector
  let _lastChimeMinute = null;

  function loadChimeSetting() {
    const saved = parseInt(localStorage.getItem('wl_chime_mins') || '30');
    CHIME_INTERVALS_MINS = saved > 0 ? [saved] : [];
    const sel = document.getElementById('chimeIntervalSel');
    if (sel) sel.value = String(saved);
  }

  document.getElementById('chimeIntervalSel').addEventListener('change', function () {
    const val = parseInt(this.value);
    CHIME_INTERVALS_MINS = val > 0 ? [val] : [];
    localStorage.setItem('wl_chime_mins', String(val));
    _lastChimeMinute = null; // reset so next interval fires fresh
  });

  /**
   * Fires an audible chime if the elapsed time has crossed a configured interval
   * boundary since the last chime. No-ops when the timer is paused.
   * @param {number} elapsedMs - Elapsed time in milliseconds.
   */
  function checkChime(elapsedMs) {
    if (!activeTimer || activeTimer.paused) return;
    const elapsedMins = Math.floor(elapsedMs / 60000);
    if (elapsedMins === _lastChimeMinute) return;
    if (CHIME_INTERVALS_MINS.some((n) => elapsedMins > 0 && elapsedMins % n === 0)) {
      _lastChimeMinute = elapsedMins;
      playChime();
    }
  }

  /**
   * Plays two soft sine-wave tones (528 Hz then 660 Hz) using the Web Audio API
   * to signal an elapsed-time milestone. Silently skips if Web Audio is
   * unavailable (e.g. browser privacy settings).
   */
  function playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const freq = [528, 660]; // two soft tones
      freq.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = f;
        const start = ctx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.18, start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
        osc.start(start);
        osc.stop(start + 0.5);
      });
    } catch (e) {}
  }

  /**
   * Applies or clears the dynamic colour on the timer bar and pulse indicator.
   * When paused, removes inline styles so the CSS `.paused` class takes over.
   * When running, sets background and border to the hue computed by
   * {@link timerBarColor}.
   */
  function updateTimerBarColor() {
    const bar = document.getElementById('timerBar');
    if (!bar || !activeTimer) return;
    if (activeTimer.paused) {
      // Let CSS handle paused state — remove inline styles
      bar.style.background = '';
      bar.style.borderColor = '';
      const pulse = bar.querySelector('.timer-pulse');
      if (pulse) pulse.style.background = '';
      return;
    }
    const color = timerBarColor(getElapsedMs(), false);
    // Derive a darker background from the same hue
    const t = Math.min(getElapsedMs() / (HYPERFOCUS_MINS * 60 * 1000), 1);
    const hue = Math.round(158 - 153 * t);
    bar.style.background = `hsl(${hue}, 60%, 8%)`;
    bar.style.borderColor = color;
    const pulse = bar.querySelector('.timer-pulse');
    if (pulse) pulse.style.background = color;
  }

  /**
   * Called every second by the timer interval. Updates the timer bar text,
   * the live time-block element, the tab title/favicon, the bar colour, and
   * checks whether a chime should fire. Also refreshes the focus-mode overlay
   * when it is open. Errors are caught and logged so a single bad tick cannot
   * stop the interval.
   */
  function tickTimer() {
    try {
      if (!activeTimer) return;
      const entry = entries.find((e) => e.id === activeTimer.entryId);
      const elapsed = getElapsedMs();
      document.getElementById('timerBar').style.display = 'flex';
      document.getElementById('timerTask').textContent = entry ? entry.text : '…';
      document.getElementById('timerElapsed').textContent = fmtElapsed(elapsed);
      updateLiveBlock();
      updateTabAndFavicon();
      updateTimerBarColor();
      checkChime(elapsed);
      if (emergencyMode) {
        const emergEl = document.getElementById('emergencyTask');
        if (emergEl) emergEl.textContent = entry ? entry.text : '—';
        renderEmergencyCps();
      }
    } catch (e) {
      console.error('[wl] tickTimer error:', e);
    }
  }
  /**
   * Shows or hides the timer bar and updates the pause/resume button label.
   * Also enables or disables the "make it interesting" hook button.
   */
  function updateTimerBar() {
    const bar = document.getElementById('timerBar');
    const pauseBtn = document.getElementById('timerPause');
    const hookBtn = document.getElementById('timerHookBtn');
    if (!activeTimer) {
      bar.style.display = 'none';
      if (hookBtn) hookBtn.disabled = true;
      return;
    }
    bar.style.display = 'flex';
    bar.classList.toggle('paused', activeTimer.paused);
    pauseBtn.textContent = activeTimer.paused ? 'resume' : 'pause';
    if (hookBtn) hookBtn.disabled = false;
  }
  /**
   * Updates the main start-timer button's label and disabled state.
   * @param {boolean} running - True if a timer is currently active.
   */
  function updateTimerBtn(running) {
    const btn = document.getElementById('timerBtn');
    btn.disabled = running;
    btn.textContent = running ? '▶ timing…' : '▶ start';
  }
  /**
   * Called at startup to reconnect the tick interval when the app is reloaded
   * with an active timer persisted in localStorage. If the entry the timer was
   * tracking no longer exists the timer is cleared. No-ops if no timer is active.
   */
  function resumeTimerIfActive() {
    if (!activeTimer) return;
    if (!entries.find((e) => e.id === activeTimer.entryId)) {
      if (
        entries.length > 0 ||
        !localStorage.getItem(STORE_ENTRIES) ||
        localStorage.getItem(STORE_ENTRIES) === '[]'
      ) {
        activeTimer = null;
        save();
      }
      return;
    }
    if (!activeTimer.paused) timerInterval = setInterval(tickTimer, 1000);
    tickTimer();
    updateTimerBar();
    updateTimerBtn(true);
  }

  // Refresh the "time by task" chart every 15 minutes while a timer runs so the
  // active task's accumulated time appears in (near) real time. renderChart()
  // decorates the active timer's entry with a synthetic tsEnd (= now or
  // ts+accumulated for paused) so the bar grows without modifying stored data.
  const CHART_REFRESH_MS = 15 * 60 * 1000;
  setInterval(() => {
    if (!activeTimer) return;
    try {
      renderChart(viewEntries());
    } catch (e) {
      /* renderChart may not be ready on very first tick */
    }
  }, CHART_REFRESH_MS);

  // ── 04-render.js ──
  /* ── Render ── */

  /**
   * Full application re-render: updates the date label, timer bar, stat counters,
   * sub-stats, time-log list, chart, quick-pick, plan, completed section, and
   * time-block view. Call whenever persistent state changes.
   */
  function render() {
    document.getElementById('dateLabel').textContent = fmtLabel(viewDate);
    document.getElementById('prevDay').disabled = false;
    document.getElementById('nextDay').disabled = isToday(viewDate);

    if (!activeTimer) {
      updateTimerBar();
      updateTimerBtn(false);
    } else {
      updateTimerBar();
      updateTimerBtn(true);
    }

    const todayKey = dk(new Date());
    document.getElementById('statToday').textContent = new Set(
      entries.filter((e) => e.date === todayKey).map((e) => e.text.toLowerCase())
    ).size;
    document.getElementById('statWeek').textContent = (() => {
      const mon2 = new Date();
      mon2.setDate(mon2.getDate() - ((mon2.getDay() + 6) % 7));
      mon2.setHours(0, 0, 0, 0);
      return new Set(entries.filter((e) => new Date(e.ts) >= mon2).map((e) => e.tag || 'other'))
        .size;
    })();
    document.getElementById('statStreak').textContent = calcStreak();

    // Sub-stats
    function fmtMs(ms) {
      const mins = Math.round(ms / 60000),
        h = Math.floor(mins / 60),
        m = mins % 60;
      return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
    }
    function taskSubHtml(label, ms) {
      const m = label.match(/^([A-Z]+-\d+)([\s:_-]+(.*))?$/s);
      const ticket = m ? m[1] : null;
      const name = m ? (m[3] || '').trim() : label;
      const keyHtml = ticket
        ? `<a class="jira-key-link" href="${JIRA_BASE}/${ticket}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escHtml(ticket)}</a>`
        : null;
      return keyHtml
        ? `${keyHtml}${name ? `<br>${escHtml(name)}` : ''}<br><strong>${fmtMs(ms)}</strong>`
        : `${escHtml(label)}<br><strong>${fmtMs(ms)}</strong>`;
    }

    // Today: task with most tracked time
    const todayTimed = entries.filter((e) => e.date === todayKey && e.tsEnd && e.tsEnd > e.ts);
    const todayByTask = {};
    todayTimed.forEach((e) => {
      const k = e.text.toLowerCase();
      if (!todayByTask[k]) todayByTask[k] = { label: e.text, ms: 0 };
      todayByTask[k].ms += e.tsEnd - e.ts;
    });
    const topTask = Object.values(todayByTask).sort((a, b) => b.ms - a.ms)[0];
    const todaySub = document.getElementById('statTodaySub');
    if (topTask) {
      todaySub.innerHTML = taskSubHtml(topTask.label, topTask.ms);
      todaySub.style.display = '';
    } else {
      todaySub.style.display = 'none';
    }

    // This week: task with most tracked time
    const mon = new Date();
    mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    mon.setHours(0, 0, 0, 0);
    const weekTimed = entries.filter((e) => new Date(e.ts) >= mon && e.tsEnd && e.tsEnd > e.ts);
    const weekByTask = {};
    weekTimed.forEach((e) => {
      const k = e.text.toLowerCase();
      if (!weekByTask[k]) weekByTask[k] = { label: e.text, ms: 0 };
      weekByTask[k].ms += e.tsEnd - e.ts;
    });
    const topWeekTask = Object.values(weekByTask).sort((a, b) => b.ms - a.ms)[0];
    const weekSub = document.getElementById('statWeekSub');
    if (topWeekTask) {
      weekSub.innerHTML = taskSubHtml(topWeekTask.label, topWeekTask.ms);
      weekSub.style.display = '';
    } else {
      weekSub.style.display = 'none';
    }

    // Streak: day with longest tracked time
    const streakDays = [];
    {
      const d2 = new Date();
      d2.setDate(d2.getDate() - 1);
      const seen = new Set(entries.map((e) => e.date));
      while (seen.has(dk(d2))) {
        streakDays.push(dk(d2));
        d2.setDate(d2.getDate() - 1);
      }
    }
    const streakSub = document.getElementById('statStreakSub');
    if (streakDays.length > 0) {
      let bestDay = null,
        bestMs = 0;
      streakDays.forEach((dateKey2) => {
        const ms = entries
          .filter((e) => e.date === dateKey2 && e.tsEnd && e.tsEnd > e.ts)
          .reduce((s, e) => s + (e.tsEnd - e.ts), 0);
        if (ms > bestMs) {
          bestMs = ms;
          bestDay = dateKey2;
        }
      });
      if (bestDay && bestMs > 0) {
        const d3 = new Date(bestDay + 'T12:00:00');
        const dayName = isToday(d3)
          ? 'today'
          : d3.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });
        streakSub.innerHTML = `<strong>Longest date tracked</strong><br>${escHtml(dayName)}<br><strong>${fmtMs(bestMs)}</strong>`;
        streakSub.style.display = '';
      } else {
        streakSub.style.display = 'none';
      }
    } else {
      streakSub.style.display = 'none';
    }

    const list = viewEntries();
    const tl = document.getElementById('timeline');

    if (!list.length) {
      tl.innerHTML =
        '<div class="empty-state">' +
        (isToday(viewDate)
          ? 'nothing logged yet.<br>start by typing what you just did above.'
          : 'nothing was logged on this day.') +
        '</div>';
      document.getElementById('chart').innerHTML = '';
      renderQuickPick();
      renderPlan();
      renderCompleted();
      renderTimeblock();
      return;
    }

    const logHeader = `<div class="timelog-header"><span class="chart-title">time log</span></div>`;
    tl.innerHTML =
      logHeader +
      list
        .map((e) => {
          const isTiming = activeTimer && activeTimer.entryId === e.id;
          const isPaused = isTiming && activeTimer.paused;
          const color = getCatColor(e.tag);

          const endLine = isTiming
            ? isPaused
              ? `<span class="etime-end" style="color:#EF9F27;font-size:10px;">paused</span>`
              : `<span class="etime-end" style="color:#5DCAA5;font-size:10px;">timing…</span>`
            : e.tsEnd
              ? `<span class="etime-end">&#8627; ${fmtTime(e.tsEnd)}</span>${durLabel(e.ts, e.tsEnd)}`
              : `<span class="etime-end" style="color:var(--text3);font-style:italic;font-size:10px;">+ end time</span>`;

          const catOpts =
            categories
              .map(
                (c) =>
                  `<button class="cat-opt${e.tag === c.id ? ' sel' : ''}" data-id="${e.id}" data-cat="${c.id}" style="${e.tag === c.id ? `background:${c.color};` : ''}color:${e.tag === c.id ? '#fff' : c.color}">${escHtml(c.label)}</button>`
              )
              .join('') + `<button class="cat-cancel" data-id="${e.id}">cancel</button>`;

          const startVal = toTimeInput(e.ts);
          const endVal = e.tsEnd ? toTimeInput(e.tsEnd) : '';

          const billableEmoji = isEntryBillable(e) ? '💰' : '💸';
          return `
        <div class="entry${isTiming ? ' is-timing' : ''}${e.signifier === 'cancelled' ? ' sig-cancelled-row' : ''}" data-id="${e.id}">
          <div class="etime-col">
            <span class="etime-display" data-id="${e.id}">
              <span class="etime-start">${fmtTime(e.ts)}</span>
              ${endLine}
            </span>
            <div class="etime-editor" id="ed-${e.id}">
              <div class="etime-editor-row"><span class="etime-lbl">start</span><input class="etime-input" type="time" id="ts-${e.id}" value="${startVal}" /></div>
              <div class="etime-editor-row"><span class="etime-lbl">end</span><input class="etime-input" type="time" id="te-${e.id}" value="${endVal}" placeholder="--:--" /></div>
              <div class="etime-actions">
                <button class="etime-save" data-id="${e.id}">save</button>
                <button class="etime-cancel" data-id="${e.id}">cancel</button>
              </div>
            </div>
          </div>
          ${sigHtml(e)}
          <span class="edot" style="background:${color};margin-top:6px;"></span>
          <div class="ebody">
            <div class="etext" data-id="${e.id}">${jiraTicketHtml(e.text)}</div>
            <button class="etag-btn" data-id="${e.id}">
              <span class="etag-cdot" style="background:${color}"></span>
              ${escHtml(getCatLabel(e.tag))} &#9660;
            </button>
            <div class="cat-picker" id="cp-${e.id}">${catOpts}</div>
          </div>
          <button class="ebill-btn" data-id="${e.id}" title="toggle billable/non-billable" style="cursor:pointer;background:none;border:none;padding:4px 8px;font-size:16px;color:inherit">${billableEmoji}</button>
          <button class="erestart" data-id="${e.id}" title="restart with timer">&#9654;</button>
          <button class="edel" data-id="${e.id}" title="delete">&times;</button>
        </div>`;
        })
        .join('');

    bindSignifierClicks();

    /* time editor */
    tl.querySelectorAll('.etime-display').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        closeAllEditors();
        el.style.display = 'none';
        document.getElementById('ed-' + id).classList.add('open');
      });
    });
    tl.querySelectorAll('.etime-save').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id,
          entry = entries.find((e) => e.id === id);
        if (!entry) return;
        const sv = document.getElementById('ts-' + id).value;
        const ev = document.getElementById('te-' + id).value;
        if (sv) entry.ts = roundToNearest30(applyTime(entry.ts, sv));
        if (ev) entry.tsEnd = roundToNearest30(applyTime(entry.ts, ev));
        else delete entry.tsEnd;
        // If this entry's timer is running, reset startTs to the new entry.ts
        if (activeTimer && activeTimer.entryId === id && sv) {
          activeTimer.startTs = entry.ts;
          activeTimer.accumulatedMs = 0;
          activeTimer.paused = false;
        }
        save();
        render();
      });
    });
    tl.querySelectorAll('.etime-cancel').forEach((btn) =>
      btn.addEventListener('click', () => render())
    );

    /* category picker */
    tl.querySelectorAll('.etag-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const picker = document.getElementById('cp-' + id);
        const isOpen = picker.classList.contains('open');
        document.querySelectorAll('.cat-picker.open').forEach((el) => el.classList.remove('open'));
        if (!isOpen) picker.classList.add('open');
      });
    });
    tl.querySelectorAll('.cat-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const entry = entries.find((e) => e.id === btn.dataset.id);
        if (entry) {
          const key = entry.text.toLowerCase();
          entries.forEach((e) => {
            if (e.text.toLowerCase() === key) e.tag = btn.dataset.cat;
          });
          save();
          render();
        }
      });
    });
    tl.querySelectorAll('.cat-cancel').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('cp-' + btn.dataset.id).classList.remove('open');
      });
    });

    /* billable toggle */
    tl.querySelectorAll('.ebill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const entry = entries.find((e) => e.id === btn.dataset.id);
        if (entry) {
          entry.billable = entry.billable === false ? undefined : false;
          save();
          render();
        }
      });
    });

    /* delete */
    tl.querySelectorAll('.edel').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (activeTimer && activeTimer.entryId === id) {
          clearInterval(timerInterval);
          timerInterval = null;
          activeTimer = null;
          save();
          updateTimerBtn(false);
          document.getElementById('timerBar').style.display = 'none';
        }
        entries = entries.filter((e) => e.id !== id);
        save();
        render();
      });
    });

    /* restart */
    tl.querySelectorAll('.erestart').forEach((btn) => {
      btn.addEventListener('click', () => {
        const src = entries.find((e) => e.id === btn.dataset.id);
        if (!src) return;
        if (activeTimer) stopTimer();
        const newEntry = {
          id: Date.now() + '',
          text: src.text,
          tag: src.tag,
          ts: safeRoundedStart(),
          date: dk(new Date()),
        };
        entries.push(newEntry);
        viewDate = new Date();
        save();
        startTimer(newEntry.id);
        render();
      });
    });

    /* rename entry text (propagates to all entries + plan tasks with same text) */
    tl.querySelectorAll('.etext').forEach((el) => {
      el.addEventListener('click', () => {
        if (el.querySelector('.etext-input')) return;
        const id = el.dataset.id;
        const entry = entries.find((e) => e.id === id);
        if (!entry) return;
        const origText = entry.text;
        const input = document.createElement('input');
        input.className = 'etext-input';
        input.value = origText;
        el.innerHTML = '';
        el.appendChild(input);
        input.focus();
        input.select();
        let saved = false;
        const doSave = () => {
          if (saved) return;
          saved = true;
          const newText = input.value.trim();
          if (newText && newText !== origText) {
            const origLower = origText.toLowerCase();
            entries.forEach((e) => {
              if (e.text.toLowerCase() === origLower) e.text = newText;
            });
            planTasks.forEach((t) => {
              if (t.text.toLowerCase() === origLower) t.text = newText;
            });
            save();
            savePlan();
          }
          render();
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            doSave();
          }
          if (ev.key === 'Escape') {
            saved = true;
            render();
          }
        });
        input.addEventListener('blur', doSave);
      });
    });

    renderQuickPick();
    renderChart(list);
    renderPlan();
    renderCompleted();
    renderTimeblock();
  }

  /**
   * Renders the "recent tasks" quick-pick bar below the capture input.
   * Deduplicates entries by text, hides manually-dismissed tasks and tasks past
   * their iteration expiry, and caps the list at 16 items.
   */
  function renderQuickPick() {
    const qp = document.getElementById('quickPick');
    const seen = new Set();
    // Build deduplicated recent list, then filter out hidden ones
    const allRecent = [...entries].reverse().filter((e) => {
      const k = e.text.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // Hide tasks whose last-logged date is at or past the current iteration boundary
    const todayKeyQp = dk(new Date());
    const expiredQp = new Set(
      allRecent
        .filter((e) => {
          const expiry = getIterationExpiry(e.date || '');
          return expiry && todayKeyQp >= expiry;
        })
        .map((e) => e.text.toLowerCase())
    );
    const recent = allRecent
      .filter((e) => !qpHidden.has(e.text.toLowerCase()) && !expiredQp.has(e.text.toLowerCase()))
      .slice(0, 16);
    // Hidden count is the intersection of qpHidden with task texts actually present in entries
    const hiddenInUse = allRecent.filter((e) => qpHidden.has(e.text.toLowerCase())).length;

    if (!recent.length && !hiddenInUse) {
      qp.innerHTML = '';
      return;
    }

    const itemsHtml = recent
      .map((e) => {
        return (
          `<button class="qp-item" data-text="${escHtml(e.text)}" data-tag="${e.tag}">` +
          `<span class="qp-item-text">${escHtml(e.text)}</span>` +
          `<span class="qp-remove" data-text="${escHtml(e.text)}" title="remove from recent tasks">&times;</span>` +
          `</button>`
        );
      })
      .join('');
    const restoreHtml = hiddenInUse
      ? `<button class="qp-restore" id="qpRestore" title="show all hidden tasks again">restore ${hiddenInUse} hidden</button>`
      : '';

    qp.innerHTML = `<div class="qp-wrap"><div class="qp-label">recent tasks</div><div class="qp-list">${itemsHtml}${restoreHtml}</div></div>`;

    // Click pill body — fill capture input (only if click wasn't on the ✕)
    qp.querySelectorAll('.qp-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (e.target.closest('.qp-remove')) return;
        document.getElementById('captureInput').value = btn.dataset.text;
        selectedTag = btn.dataset.tag;
        renderTagRow();
        document.getElementById('captureInput').focus();
      });
    });
    // Click ✕ — hide from recent list
    qp.querySelectorAll('.qp-remove').forEach((x) => {
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        qpHidden.add(x.dataset.text.toLowerCase());
        saveQpHidden();
        renderQuickPick();
      });
    });
    // Restore all hidden
    const restoreBtn = document.getElementById('qpRestore');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', () => {
        qpHidden.clear();
        saveQpHidden();
        renderQuickPick();
      });
    }
  }

  /**
   * Renders the time-tracking bar chart for the currently viewed day.
   * Decorates the active timer's entry with a synthetic `tsEnd` so live time
   * appears in real-time. Respects `chartMode` ('task' | 'category').
   * @param {Array<Object>} list - The array of log entries to chart.
   */
  function renderChart(list) {
    const el = document.getElementById('chart');
    // Decorate the active timer's entry with a synthetic tsEnd so its accumulated
    // time appears in the chart in (near) real time — not just after the timer stops.
    // Re-runs naturally on every render; a 15-min interval also forces a refresh.
    const decorated = (list || []).map((e) => {
      if (activeTimer && e.id === activeTimer.entryId && !e.tsEnd) {
        const liveEnd = activeTimer.paused
          ? e.ts + (activeTimer.accumulatedMs || 0)
          : Math.max(Date.now(), activeTimer.startTs || e.ts);
        return Object.assign({}, e, { tsEnd: liveEnd, _live: true });
      }
      return e;
    });
    const timed = decorated.filter((e) => e.tsEnd && e.tsEnd > e.ts);

    const toggleHtml = `<div class="chart-toggle">
      <button class="chart-tog${chartMode === 'task' ? ' active' : ''}" data-mode="task">by task</button>
      <button class="chart-tog${chartMode === 'category' ? ' active' : ''}" data-mode="category">by epic</button>
    </div>`;

    if (!timed.length) {
      el.innerHTML = `<div class="chart-section"><div class="chart-header"><span class="chart-title">time tracked</span>${toggleHtml}</div><div class="chart-empty">add end times to entries to see the chart</div></div>`;
      el.querySelectorAll('.chart-tog').forEach((b) =>
        b.addEventListener('click', () => {
          chartMode = b.dataset.mode;
          renderChart(list);
        })
      );
      return;
    }

    const totals = {},
      meta = {},
      liveKeys = new Set(),
      billCounts = {};
    function tallyBill(key, e) {
      if (!billCounts[key]) billCounts[key] = { bill: 0, nonBill: 0 };
      if (isEntryBillable(e)) billCounts[key].bill++;
      else billCounts[key].nonBill++;
    }
    if (chartMode === 'task') {
      timed.forEach((e) => {
        const key = e.text.toLowerCase();
        totals[key] = (totals[key] || 0) + Math.max(0, e.tsEnd - e.ts);
        if (!meta[key]) meta[key] = { label: e.text, color: getCatColor(e.tag) };
        if (e._live) liveKeys.add(key);
        tallyBill(key, e);
      });
    } else {
      timed.forEach((e) => {
        const key = e.tag || 'other';
        totals[key] = (totals[key] || 0) + Math.max(0, e.tsEnd - e.ts);
        if (!meta[key]) meta[key] = { label: getCatLabel(key), color: getCatColor(key) };
        if (e._live) liveKeys.add(key);
        tallyBill(key, e);
      });
    }
    // Per-row billable icon: 💰 if all billable, 💸 if all non-billable, ⚖️ if mixed
    function billIcon(key) {
      const c = billCounts[key];
      if (!c) return '';
      if (c.bill && c.nonBill)
        return '<span class="chart-bill" title="mixed billable/non-billable">⚖️</span>';
      if (c.bill) return '<span class="chart-bill" title="billable">💰</span>';
      if (c.nonBill) return '<span class="chart-bill" title="non-billable">💸</span>';
      return '';
    }

    const sorted = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    const maxMs = totals[sorted[0]];
    const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

    const rows = sorted
      .map((key) => {
        const ms = totals[key],
          pct = Math.round((ms / maxMs) * 100);
        const mins = Math.round(ms / 60000),
          h = Math.floor(mins / 60),
          m = mins % 60;
        const dur = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
        const { label, color } = meta[key];
        const live = liveKeys.has(key) ? ' chart-row-live' : '';
        const liveDot = liveKeys.has(key)
          ? '<span class="chart-live-dot" title="currently being tracked">●</span>'
          : '';
        return `<div class="chart-row${live}">
        <span class="chart-label" title="${escHtml(label)}">${liveDot}${escHtml(label)}</span>
        <div class="chart-track"><div class="chart-bar" style="width:${pct}%;background:${color}"></div></div>
        ${billIcon(key)}
        <span class="chart-dur">${dur}</span>
      </div>`;
      })
      .join('');

    const tm2 = Math.round(grandTotal / 60000),
      th2 = Math.floor(tm2 / 60),
      tm3 = tm2 % 60;
    const totalDur = th2 > 0 ? (tm3 > 0 ? `${th2}h ${tm3}m` : `${th2}h`) : `${tm3}m`;
    const billMs = timed
      .filter((e) => isEntryBillable(e))
      .reduce((s, e) => s + (e.tsEnd - e.ts), 0);
    const nonBillMs = timed.reduce((s, e) => s + (e.tsEnd - e.ts), 0) - billMs;
    const fmtMs = (ms) => {
      const m = Math.round(ms / 60000),
        h = Math.floor(m / 60),
        r = m % 60;
      return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
    };
    const title = chartMode === 'task' ? 'time by task' : 'time by epic';
    el.innerHTML = `<div class="chart-section"><div class="chart-header"><span class="chart-title">${title}</span>${toggleHtml}</div>${rows}<div class="chart-total">total tracked: <span>${totalDur}</span></div>${billMs > 0 || nonBillMs > 0 ? `<div class="chart-total">💰 billable: <span>${fmtMs(billMs)}</span></div><div class="chart-total">💸 non-billable: <span>${fmtMs(nonBillMs)}</span></div>` : ''}</div>`;
    el.querySelectorAll('.chart-tog').forEach((b) =>
      b.addEventListener('click', () => {
        chartMode = b.dataset.mode;
        renderChart(list);
      })
    );
  }

  /* ── Helpers ── */

  /** Closes every open inline time-editor panel and restores the display spans. */
  function closeAllEditors() {
    document.querySelectorAll('.etime-editor.open').forEach((el) => el.classList.remove('open'));
    document.querySelectorAll('.etime-display').forEach((el) => (el.style.display = ''));
  }
  /**
   * Converts a Unix timestamp (ms) to an HH:MM string suitable for an
   * `<input type="time">` value.
   * @param {number} ts - Unix timestamp in milliseconds.
   * @returns {string} Local time formatted as "HH:MM".
   */
  function toTimeInput(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  /**
   * Replaces the hours/minutes of a base timestamp with values parsed from a
   * "HH:MM" string, returning the resulting timestamp in milliseconds.
   * @param {number} baseTsMs - Base Unix timestamp (ms) that supplies the date.
   * @param {string} timeStr  - Time string in "HH:MM" format.
   * @returns {number} New Unix timestamp (ms) with the updated time.
   */
  function applyTime(baseTsMs, timeStr) {
    const d = new Date(baseTsMs),
      [hh, mm] = timeStr.split(':').map(Number);
    d.setHours(hh, mm, 0, 0);
    return d.getTime();
  }
  /**
   * Builds an HTML `<span class="etime-dur">` containing the human-readable
   * duration between two timestamps.  Returns an empty string if the duration
   * is zero or negative.
   * @param {number} tsStart - Start Unix timestamp (ms).
   * @param {number} tsEnd   - End Unix timestamp (ms).
   * @returns {string} HTML string, or '' if duration ≤ 0.
   */
  function durLabel(tsStart, tsEnd) {
    const mins = Math.round((tsEnd - tsStart) / 60000);
    if (mins <= 0) return '';
    const h = Math.floor(mins / 60),
      m = mins % 60;
    return `<span class="etime-dur">${h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`}</span>`;
  }

  // ── 05-entries.js ──
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
        (t) => t.date === todayKey && t.text.toLowerCase() === text.toLowerCase()
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

  /* ── Export ── */

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
   * @param {Object} e - Log entry object.
   * @returns {boolean} True if the entry should be counted as billable.
   */
  function isEntryBillable(e) {
    if (e.signifier === 'cancelled') return false;
    if (e.billable !== undefined) return e.billable;
    const t = planTasks.find((t) => t.text.toLowerCase().trim() === e.text.toLowerCase().trim());
    // `!== false` (not `=== true`) — undefined means billable (see Assumption above).
    if (t) return t.billable !== false;
    // Same `!== false` convention for categories — undefined → billable.
    return getCat(e.tag || 'other').billable !== false;
  }

  /**
   * Exports the currently viewed day's log as a plaintext file.
   * Groups entries by category and task, includes a header with day start/end
   * times and tracked time totals, and appends a pasteable billable summary.
   * Writes to the user's chosen save folder via the File System Access API,
   * or falls back to a browser download.
   */
  function exportTxt() {
    const dayEntries = viewEntries().slice().reverse();
    if (!dayEntries.length) return;

    const dateStr = dk(viewDate);
    const isViewingToday = dateStr === dk(new Date());

    // Day start/end
    let dayStartTs = isViewingToday ? getDayStart() : null;
    if (!dayStartTs && dayEntries.length) dayStartTs = Math.min(...dayEntries.map((e) => e.ts));
    const timedEntries = dayEntries.filter(
      (e) => e.tsEnd && e.tsEnd > e.ts && e.signifier !== 'cancelled'
    );
    let dayEndTs = timedEntries.length ? Math.max(...timedEntries.map((e) => e.tsEnd)) : null;
    // Factor in the active timer's effective end so "Ended:" reflects live work
    if (activeTimer && isViewingToday) {
      const timerEntry = dayEntries.find((e) => e.id === activeTimer.entryId);
      if (timerEntry) {
        const liveEnd = activeTimer.paused
          ? timerEntry.ts + (activeTimer.accumulatedMs || 0) // paused → start + accumulated
          : Math.max(Date.now(), activeTimer.startTs || timerEntry.ts); // running → now (or startTs if test setup is ahead of wall clock)
        dayEndTs = dayEndTs ? Math.max(dayEndTs, liveEnd) : liveEnd;
      }
    }

    const fmtTsHM = (ts) => {
      const d = new Date(ts);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };
    const fmtDurMs = (ms) => {
      const mins = Math.round(ms / 60000),
        h = Math.floor(mins / 60),
        m = mins % 60;
      return h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
    };

    // Group by category, then by task (preserving first-seen order)
    const catOrder = [];
    const catGrouped = {};
    dayEntries.forEach((e) => {
      const catKey = e.tag || 'other';
      const taskKey = e.text.toLowerCase();
      if (!catGrouped[catKey]) {
        catOrder.push(catKey);
        catGrouped[catKey] = { totalMs: 0, tasks: {}, taskOrder: [] };
      }
      if (!catGrouped[catKey].tasks[taskKey]) {
        catGrouped[catKey].taskOrder.push(taskKey);
        catGrouped[catKey].tasks[taskKey] = { label: e.text, totalMs: 0, hasTime: false };
      }
      if (e.tsEnd && e.tsEnd > e.ts) {
        const ms = e.tsEnd - e.ts;
        catGrouped[catKey].totalMs += ms;
        catGrouped[catKey].tasks[taskKey].totalMs += ms;
        catGrouped[catKey].tasks[taskKey].hasTime = true;
      }
    });

    const lines = [];
    catOrder.forEach((catKey) => {
      const { totalMs, tasks, taskOrder } = catGrouped[catKey];
      const catTimeStr = totalMs > 0 ? fmtDurMs(totalMs) : '--';
      lines.push(`${catTimeStr} - ${getCatLabel(catKey)}`);
      taskOrder.forEach((taskKey) => {
        const { label, totalMs: tMs, hasTime } = tasks[taskKey];
        const taskTimeStr = hasTime ? fmtDurMs(tMs) : '--';
        lines.push(`    ${taskTimeStr} - ${label}`);
      });
    });

    // Billable / non-billable breakdown
    const totalTrackedMs = timedEntries.reduce((s, e) => s + (e.tsEnd - e.ts), 0);
    const billableMs = timedEntries
      .filter((e) => isEntryBillable(e))
      .reduce((s, e) => s + (e.tsEnd - e.ts), 0);
    const nonBillableMs = totalTrackedMs - billableMs;

    const header = [`Work Log — ${dateStr}`];
    if (dayStartTs) {
      const startStr = fmtTsHM(dayStartTs);
      const endStr = dayEndTs ? fmtTsHM(dayEndTs) : '--:--';
      header.push(`Started: ${startStr}  |  Ended: ${endStr}`);
      if (dayEndTs) header.push(`Workday: ${fmtDurMs(dayEndTs - dayStartTs)}`);
    }
    if (totalTrackedMs > 0) {
      header.push(
        `Total tracked: ${fmtDurMs(totalTrackedMs)}  |  💰 Billable: ${fmtDurMs(billableMs)}  |  💸 Non-billable: ${fmtDurMs(nonBillableMs)}`
      );
    }
    header.push('---');

    // Pasteable billable summary — last line of the file
    // Format: "Category (task1, task2), uncategorised-task"
    const stripJira = (t) => t.replace(/^[A-Z][A-Z0-9]*-\d+[:\s]\s*/, '').trim();
    const billableTimed = timedEntries.filter((e) => isEntryBillable(e));
    // Merge same-task entries that are separated by ≤30 minutes into a single block.
    // Rationale: 30 min is the billing rounding unit — splitting a task at a gap
    // shorter than one slot would produce two entries that each round to the same
    // half-hour anyway, while making the billable summary harder to read.
    const mergeForExport = (arr) => {
      const sorted = [...arr].sort((a, b) => a.ts - b.ts);
      const out = [];
      for (const e of sorted) {
        const prev = out[out.length - 1];
        if (
          prev &&
          prev.text.toLowerCase() === e.text.toLowerCase() &&
          e.ts - (prev._end || prev.ts) <= 30 * 60000
        )
          prev._end = Math.max(prev._end || prev.ts, e.tsEnd || e.ts);
        else out.push({ ...e, _end: e.tsEnd || e.ts });
      }
      return out;
    };
    const billableMerged = mergeForExport(billableTimed);
    // Group by category, preserve order of first appearance
    const summaryOrder = [];
    const summaryGroups = {};
    const summaryUngrouped = [];
    billableMerged.forEach((e) => {
      const taskName = stripJira(e.text);
      if (!e.tag || e.tag === 'other') {
        if (!summaryUngrouped.includes(taskName)) summaryUngrouped.push(taskName);
      } else {
        const catLabel = getCatLabel(e.tag);
        if (!summaryGroups[e.tag]) {
          summaryOrder.push(e.tag);
          summaryGroups[e.tag] = { label: catLabel, tasks: [] };
        }
        if (!summaryGroups[e.tag].tasks.includes(taskName))
          summaryGroups[e.tag].tasks.push(taskName);
      }
    });
    const summaryParts = [
      ...summaryOrder.map(
        (k) => `${summaryGroups[k].label} (${summaryGroups[k].tasks.join(', ')})`
      ),
      ...summaryUngrouped,
    ];
    const summaryLine = summaryParts.length ? summaryParts.join(', ') : '';

    const blob = new Blob(
      [[...header, ...lines, ...(summaryLine ? ['---', summaryLine] : [])].join('\n')],
      { type: 'text/plain' }
    );
    const filename = `work-log-${dateStr}.txt`;
    writeExportFile('timesheets', filename, blob);
  }

  /**
   * Exports a full JSON backup of all application state: entries, categories,
   * plan tasks, time blocks, pomodoro log, dev log, distractions, and hidden
   * quick-pick items. Triggers a file download or writes to the save folder.
   */
  function exportBackup() {
    const backup = {
      version: '1',
      exported: new Date().toISOString(),
      entries,
      categories,
      planTasks,
      blocks,
      pomoLog: (() => {
        try {
          return JSON.parse(localStorage.getItem(STORE_POMO_LOG) || '[]');
        } catch (e) {
          return [];
        }
      })(),
      devLog: (() => {
        try {
          return JSON.parse(localStorage.getItem(STORE_DEV_LOG) || '[]');
        } catch (e) {
          return [];
        }
      })(),
      distractions: (() => {
        try {
          return JSON.parse(localStorage.getItem(STORE_DISTRACTIONS) || '[]');
        } catch (e) {
          return [];
        }
      })(),
      qpHidden: [...qpHidden],
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const filename = `work-log-backup-${dk(new Date())}.json`;
    writeExportFile('JSON backups', filename, blob);
  }

  /* ── File System Access API ── */
  let _cachedDirHandle = null;

  /**
   * Opens (or creates) the IndexedDB database used to persist the FSA directory handle.
   * @returns {Promise<IDBDatabase>} Resolves with the opened database instance.
   */
  function openIDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('wl_fs_v1', 1);
      req.onupgradeneeded = (e) => e.target.result.createObjectStore('handles');
      req.onsuccess = (e) => res(e.target.result);
      req.onerror = () => rej(req.error);
    });
  }

  /**
   * Retrieves the previously granted File System Access directory handle from
   * IndexedDB (with an in-memory cache).
   * @returns {Promise<FileSystemDirectoryHandle|null>} The handle, or null if none saved.
   */
  async function getSavedDir() {
    if (_cachedDirHandle) return _cachedDirHandle;
    try {
      const db = await openIDB();
      return new Promise((res) => {
        const tx = db.transaction('handles', 'readonly');
        const get = tx.objectStore('handles').get('saveDir');
        get.onsuccess = () => {
          _cachedDirHandle = get.result || null;
          res(_cachedDirHandle);
        };
        get.onerror = () => res(null);
      });
    } catch (e) {
      return null;
    }
  }

  /**
   * Persists a File System Access directory handle to IndexedDB for reuse
   * across sessions, and updates the in-memory cache.
   * @param {FileSystemDirectoryHandle} handle - The directory handle to store.
   * @returns {Promise<void>}
   */
  async function storeDirHandle(handle) {
    _cachedDirHandle = handle;
    try {
      const db = await openIDB();
      return new Promise((res) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, 'saveDir');
        tx.oncomplete = () => res();
        tx.onerror = () => res();
      });
    } catch (e) {}
  }

  /**
   * Clears the persisted FSA directory handle from both IndexedDB and the
   * in-memory cache so future exports fall back to browser downloads.
   * @returns {Promise<void>}
   */
  async function clearDirHandle() {
    _cachedDirHandle = null;
    try {
      const db = await openIDB();
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').delete('saveDir');
    } catch (e) {}
  }

  /**
   * Writes a Blob to `subfolder/filename` inside the user's chosen FSA directory.
   * Creates the subfolder if it does not exist. Falls back to a browser `<a>`
   * download if the FSA handle is missing or permission is not granted.
   * @param {string} subfolder - Name of the subfolder to write into.
   * @param {string} filename  - Name of the file to create or overwrite.
   * @param {Blob}   blob      - File content.
   * @returns {Promise<void>}
   */
  async function writeExportFile(subfolder, filename, blob) {
    const dir = await getSavedDir();
    if (dir) {
      try {
        const perm = await dir.queryPermission({ mode: 'readwrite' });
        const granted =
          perm === 'granted'
            ? true
            : (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
        if (granted) {
          const subDir = await dir.getDirectoryHandle(subfolder, { create: true });
          const fh = await subDir.getFileHandle(filename, { create: true });
          const writable = await fh.createWritable();
          await writable.write(blob);
          await writable.close();
          renderFolderStatus();
          return;
        }
      } catch (e) {
        console.warn('[wl] FSA write failed, falling back to download:', e);
      }
    }
    // Fallback: browser download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Prompts the user to select a save folder via the File System Access API
   * and persists the resulting directory handle. Shows a fallback alert in
   * browsers that do not support the API.
   * @returns {Promise<void>}
   */
  async function pickSaveFolder() {
    if (!window.showDirectoryPicker) {
      alert(
        "Your browser doesn't support the File System Access API.\nUse Chrome or Edge for automatic subfolder saving.\nFiles will download normally for now."
      );
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await storeDirHandle(handle);
      renderFolderStatus();
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
    }
  }

  /**
   * Updates the `#folderStatus` element to show the currently selected save
   * folder name (green) or a "pick save folder" prompt (default colour).
   */
  function renderFolderStatus() {
    const el = document.getElementById('folderStatus');
    if (!el) return;
    getSavedDir().then((dir) => {
      if (dir) {
        el.textContent = `📁 ${dir.name}`;
        el.title =
          'Timesheets → ' +
          dir.name +
          '/timesheets/\nJSON backups → ' +
          dir.name +
          '/JSON backups/\nClick to change';
        el.style.color = '#1D9E75';
      } else {
        el.textContent = 'pick save folder';
        el.title =
          'Choose where exports are saved (creates timesheets/ and JSON backups/ subfolders)';
        el.style.color = '';
      }
    });
  }

  // ── 06-focus.js ──
  /* ── Emergency Mode ── */

  /**
   * True while the focus/emergency overlay is visible.
   * @type {boolean}
   */
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
    tbSection.parentNode.insertBefore(
      document.querySelector('.pomo-section'),
      tbSection.nextSibling
    );
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

  // ── 07-lifecycle.js ──
  /* ── Start of day ── */

  /**
   * Returns the localStorage key used to store today's start-of-day timestamp.
   * @returns {string} Key in the format `wl_sod_YYYY-MM-DD`.
   */
  function sodKey() {
    return 'wl_sod_' + dk(new Date());
  }
  /**
   * Retrieves today's recorded start-of-day timestamp from localStorage.
   * @returns {number|null} Unix timestamp (ms), or null if not yet set.
   */
  function getDayStart() {
    return parseInt(localStorage.getItem(sodKey()) || '0') || null;
  }

  /**
   * Updates the "start the day" button to show the recorded start time (if any)
   * or its default label. Colours the button green once a time is set.
   */
  function renderSodBtn() {
    const btn = document.getElementById('sodBtn');
    if (!btn) return;
    const sod = getDayStart();
    if (sod) {
      const d = new Date(sod);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      btn.textContent = `🌅 started ${hh}:${mm}`;
      btn.style.color = '#1D9E75';
      btn.style.borderColor = '#1D9E75';
    } else {
      btn.textContent = '🌅 start the day';
      btn.style.color = '';
      btn.style.borderColor = '';
    }
  }

  document.getElementById('sodBtn').addEventListener('click', () => {
    const existing = getDayStart();
    if (existing) {
      // Allow re-setting — ask for time
      const d = new Date(existing);
      const cur =
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      const val = prompt(`Started at (HH:MM):`, cur);
      if (!val) return;
      const [h, m] = val.split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return;
      const ts = new Date();
      ts.setHours(h, m, 0, 0);
      localStorage.setItem(sodKey(), String(ts.getTime()));
    } else {
      localStorage.setItem(sodKey(), String(Date.now()));
    }
    renderSodBtn();
    renderTimeblock();
  });

  /* ── End of day button state ── */

  /**
   * Returns the localStorage key used to store today's end-of-day timestamp.
   * @returns {string} Key in the format `wl_eod_YYYY-MM-DD`.
   */
  function eodKey() {
    return 'wl_eod_' + dk(new Date());
  }

  /**
   * Retrieves today's recorded end-of-day timestamp from localStorage.
   * @returns {number|null} Unix timestamp (ms), or null if not yet set.
   */
  function getEodTs() {
    return parseInt(localStorage.getItem(eodKey()) || '0') || null;
  }

  /**
   * Updates the "end the day" button to show the recorded end time (if any)
   * or its default label, and dims the button once a time is set.
   */
  function renderEodBtn() {
    const btn = document.getElementById('eodBtn');
    if (!btn) return;
    const eod = getEodTs();
    if (eod) {
      const d = new Date(eod);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      btn.textContent = `🌙 ended ${hh}:${mm}`;
      btn.style.opacity = '0.7';
    } else {
      btn.textContent = '🌙 end the day';
      btn.style.opacity = '';
    }
  }

  /* ── Pomodoro weekly clear ── */

  /**
   * Clears the pomodoro log when a new ISO week begins.
   * Compares the stored week key against the current ISO week; if they differ,
   * the log is removed and the new week key is saved.
   */
  function checkPomoWeeklyClear() {
    const now = new Date();
    const currentWeekKey = `${now.getFullYear()}-W${String(getISOWeek(now)).padStart(2, '0')}`;
    const storedWeek = localStorage.getItem('wl_pomo_week');
    if (storedWeek && storedWeek !== currentWeekKey) {
      localStorage.removeItem(STORE_POMO_LOG);
    }
    localStorage.setItem('wl_pomo_week', currentWeekKey);
  }

  /* ── Event listeners ── */
  document.getElementById('addBtn').addEventListener('click', () => addEntry(false));
  document.getElementById('timerBtn').addEventListener('click', () => addEntry(true));
  document.getElementById('captureInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addEntry(false);
  });
  document.getElementById('timerPause').addEventListener('click', () => {
    if (activeTimer && activeTimer.paused) resumeTimer();
    else pauseTimer();
  });
  document.getElementById('prevDay').addEventListener('click', () => {
    viewDate = new Date(viewDate);
    viewDate.setDate(viewDate.getDate() - 1);
    render();
  });
  document.getElementById('nextDay').addEventListener('click', () => {
    if (isToday(viewDate)) return;
    viewDate = new Date(viewDate);
    viewDate.setDate(viewDate.getDate() + 1);
    render();
  });

  /* ── Auto-backup ── */

  /**
   * Returns true if today has at least one log entry that has not yet been
   * exported (i.e. the last export date differs from today's date key).
   * @returns {boolean}
   */
  function todayHasUnexportedEntries() {
    const todayKey = dk(new Date());
    const lastExport = localStorage.getItem('wl_last_export');
    return entries.some((e) => e.date === todayKey) && lastExport !== todayKey;
  }

  /**
   * Writes a recoverable snapshot of today's log entries to localStorage every
   * 30 minutes.  The snapshot contains both a human-readable plaintext summary
   * and the raw entry/category arrays so data can be recovered after accidental
   * clearing.  No-ops when there are no entries for today.
   *
   * Assumption: 30 minutes is an acceptable data-loss window for a personal work
   * log used in a single browser tab. Browser crashes, accidental page reloads,
   * and mis-clicks on "clear data" are the main risks; all are adequately covered
   * by a 30-minute recovery point. If higher durability is needed, reduce the
   * interval in the setInterval call in 07-lifecycle.js.
   */
  function saveSnapshot() {
    const todayKey = dk(new Date());
    const dayEntries = entries
      .filter((e) => e.date === todayKey)
      .slice()
      .sort((a, b) => a.ts - b.ts);
    if (!dayEntries.length) return;
    const order = [],
      grouped = {};
    dayEntries.forEach((e) => {
      const key = e.text.toLowerCase();
      if (!grouped[key]) {
        order.push(key);
        grouped[key] = { label: e.text, tag: e.tag, totalMs: 0, hasTime: false };
      }
      if (e.tsEnd && e.tsEnd > e.ts) {
        grouped[key].totalMs += e.tsEnd - e.ts;
        grouped[key].hasTime = true;
      }
    });
    const lines = order.map((key) => {
      const { label, tag, totalMs, hasTime } = grouped[key];
      let timeStr;
      if (hasTime) {
        const mins = Math.round(totalMs / 60000),
          h = Math.floor(mins / 60),
          m = mins % 60;
        timeStr = h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
      } else {
        timeStr = '--';
      }
      return `${timeStr} - ${label} - ${getCatLabel(tag)}`;
    });
    localStorage.setItem(
      'wl_snapshot',
      JSON.stringify({
        date: todayKey,
        text: lines.join('\n'),
        entries: entries,
        categories: categories,
      })
    );
  }

  /**
   * Formerly offered to download yesterday's snapshot on page load.
   * The banner was removed — end-of-day modal handles exports now.
   * Kept as a no-op stub to avoid removing the call sites.
   */
  function checkSnapshot() {
    // Banner removed — end-of-day modal handles exports now
  }

  saveSnapshot();
  setInterval(saveSnapshot, 30 * 60 * 1000);

  // Deferred so planTasks/blocks are initialized before logging their counts.
  // planTasks is declared in 10-tasks.js which comes after this file in build order.
  setTimeout(
    () =>
      wlLog.config({
        version: '1.8.0',
        date: dk(new Date()),
        // Persistent state counts (after load + migration have run)
        entries: entries.length,
        categories: categories.length,
        planTasks: planTasks.length,
        blocks: blocks.length,
        // Runtime state
        timer: activeTimer ? 'active' : 'idle',
        snapshot: !!localStorage.getItem('wl_snapshot'),
        // Environment: true when the PS API server responded (weather / calendar live)
        apiServer: !!localStorage.getItem('wl_api_ok'),
      }),
    0
  );

  // ── 08-pomodoro.js ──
  /* ── Pomodoro ── */
  const POMO_CX = 100,
    POMO_CY = 100,
    POMO_R = 84;

  let pomoDurMins = 5;
  let pomoTotal = 300;
  let pomoLeft = 300;
  let pomoRunning = false;
  let pomoInterval = null;

  /**
   * Returns the angular gap (in radians) between pomodoro timer segments.
   * Smaller gaps are used for higher segment counts to keep them visually distinct.
   * @param {number} n - Number of segments (minutes).
   * @returns {number} Gap in radians.
   */
  function pomoGap(n) {
    return n <= 6 ? 0.04 : n <= 12 ? 0.028 : 0.018;
  }

  /**
   * Builds an SVG path string for a pie-chart sector (filled segment).
   * @param {number} cx - Centre x coordinate.
   * @param {number} cy - Centre y coordinate.
   * @param {number} r  - Radius.
   * @param {number} a1 - Start angle in radians (0 = 12 o'clock).
   * @param {number} a2 - End angle in radians.
   * @returns {string} SVG path `d` attribute value.
   */
  function sectorPath(cx, cy, r, a1, a2) {
    const x1 = cx + r * Math.sin(a1),
      y1 = cy - r * Math.cos(a1);
    const x2 = cx + r * Math.sin(a2),
      y2 = cy - r * Math.cos(a2);
    const large = a2 - a1 > Math.PI ? 1 : 0;
    return `M${cx} ${cy}L${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z`;
  }

  /**
   * Redraws all pomodoro SVG segments to reflect the current remaining time.
   * Each minute is a sector; filled sectors fade as time elapses.
   */
  function drawPomoSegments() {
    const N = pomoDurMins;
    const pct = pomoTotal > 0 ? pomoLeft / pomoTotal : 0;
    const gap = pomoGap(N);
    const svg = document.getElementById('pomoSvg');
    const hole = document.getElementById('pomoHole');
    svg.querySelectorAll('.pomo-seg').forEach((e) => e.remove());

    for (let i = 0; i < N; i++) {
      const a1 = (i / N) * 2 * Math.PI + gap;
      const a2 = ((i + 1) / N) * 2 * Math.PI - gap;

      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      bg.setAttribute('class', 'pomo-seg pomo-seg-bg');
      bg.setAttribute('d', sectorPath(POMO_CX, POMO_CY, POMO_R, a1, a2));
      svg.insertBefore(bg, hole);

      const lo = i / N,
        hi = (i + 1) / N;
      const elapsed = 1 - pct;
      const fill = elapsed >= hi ? 0 : elapsed > lo ? 1 - (elapsed - lo) / (hi - lo) : 1;
      if (fill > 0.001) {
        const fillStart = a1 + (a2 - a1) * (1 - fill);
        const fp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        fp.setAttribute('class', 'pomo-seg pomo-seg-fill');
        fp.setAttribute('d', sectorPath(POMO_CX, POMO_CY, POMO_R, fillStart, a2));
        svg.insertBefore(fp, hole);
      }
    }
  }

  /**
   * Initialises (or re-initialises) the pomodoro timer for the given duration.
   * Clears any running interval, resets state, and highlights the matching
   * duration button.
   * @param {number} mins - Session duration in minutes.
   */
  function initPomo(mins) {
    clearInterval(pomoInterval);
    pomoInterval = null;
    pomoDurMins = mins;
    pomoTotal = mins * 60;
    pomoLeft = pomoTotal;
    pomoRunning = false;
    document
      .querySelectorAll('.pomo-dur')
      .forEach((b) => b.classList.toggle('active', +b.dataset.min === mins));
    updatePomoDisplay();
  }

  /**
   * Starts the pomodoro countdown. Resets to full duration if already at zero.
   * Fires {@link pomoDone} and clears the interval when time runs out.
   */
  function startPomo() {
    if (pomoLeft === 0) initPomo(pomoDurMins);
    pomoRunning = true;
    updatePomoDisplay();
    pomoInterval = setInterval(() => {
      pomoLeft--;
      if (pomoLeft <= 0) {
        pomoLeft = 0;
        pomoRunning = false;
        clearInterval(pomoInterval);
        pomoInterval = null;
        pomoDone();
      }
      updatePomoDisplay();
    }, 1000);
  }

  /** Pauses the pomodoro timer without resetting the remaining time. */
  function pausePomo() {
    pomoRunning = false;
    clearInterval(pomoInterval);
    pomoInterval = null;
    updatePomoDisplay();
  }

  /** Resets the pomodoro timer to the full configured duration without starting it. */
  function resetPomo() {
    clearInterval(pomoInterval);
    pomoInterval = null;
    pomoLeft = pomoTotal;
    pomoRunning = false;
    updatePomoDisplay();
  }

  /**
   * Called when the pomodoro timer reaches zero. Plays the completion beep,
   * briefly animates the time display, and appends a session record to the
   * pomodoro log in localStorage.
   */
  function pomoDone() {
    playPomoBeep();
    const t = document.getElementById('pomoTime');
    t.classList.add('done');
    setTimeout(() => t.classList.remove('done'), 2400);
    // Log the session
    const liveEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
    const log = pomoGetLog();
    log.unshift({ ts: Date.now(), mins: pomoDurMins, task: liveEntry ? liveEntry.text : null });
    localStorage.setItem(STORE_POMO_LOG, JSON.stringify(log.slice(0, 100)));
    renderPomoLog();
  }

  /**
   * Reads and validates the pomodoro session log from localStorage.
   * Invalid records are dropped and reported via wlLog.warn.
   * @returns {Array<{ts: number, mins: number, task: string|null}>} Session log entries.
   */
  function pomoGetLog() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_POMO_LOG) || '[]');
      const all = Array.isArray(raw) ? raw : [];
      const valid = all.filter(validPomoEntry);
      if (valid.length < all.length)
        wlLog.warn(`pomoGetLog: dropped ${all.length - valid.length} invalid pomodoro record(s)`, {
          total: all.length,
          kept: valid.length,
        });
      return valid;
    } catch (e) {
      wlLog.error('pomoGetLog: failed to parse pomodoro log', e);
      return [];
    }
  }

  /**
   * Renders the pomodoro session history list inside `#pomoLog`.
   * Shows date/time, duration, and the task that was active during each session.
   */
  function renderPomoLog() {
    const log = pomoGetLog();
    const el = document.getElementById('pomoLog');
    if (!log.length) {
      el.innerHTML = '<div class="pomo-log-empty">no sessions yet</div>';
      return;
    }
    el.innerHTML = log
      .map((entry) => {
        const d = new Date(entry.ts);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const dateStr = isToday(d)
          ? `${hh}:${mm}`
          : `${d.toLocaleDateString('en', { month: 'short', day: 'numeric' })} ${hh}:${mm}`;
        const task = entry.task
          ? escHtml(entry.task)
          : '<span style="opacity:0.5">no active task</span>';
        return `<div class="pomo-log-entry">
        <span class="pomo-log-time">${dateStr}</span>
        <span class="pomo-log-dur">${entry.mins} min</span>
        <span class="pomo-log-task">${task}</span>
      </div>`;
      })
      .join('');
  }

  /**
   * Plays three short 660 Hz beeps spaced 350 ms apart using the Web Audio API
   * to signal pomodoro completion. Silently skips if Web Audio is unavailable.
   */
  function playPomoBeep() {
    [0, 350, 700].forEach((delay) =>
      setTimeout(() => {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator(),
            gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 660;
          gain.gain.setValueAtTime(0.25, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
          osc.start();
          osc.stop(ctx.currentTime + 0.25);
        } catch (e) {}
      }, delay)
    );
  }

  /**
   * Refreshes the pomodoro timer display: updates the countdown text, redraws
   * segments, and sets the start/pause button label and status text to reflect
   * the current state (running / paused / done / ready).
   */
  function updatePomoDisplay() {
    const mins = Math.floor(pomoLeft / 60),
      secs = pomoLeft % 60;
    document.getElementById('pomoTime').textContent =
      String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    drawPomoSegments();
    const startBtn = document.getElementById('pomoStart');
    const statusEl = document.getElementById('pomoStatus');
    if (pomoLeft === 0) {
      startBtn.textContent = 'start';
      startBtn.classList.remove('running');
      statusEl.textContent = 'done!';
    } else if (pomoRunning) {
      startBtn.textContent = 'pause';
      startBtn.classList.add('running');
      statusEl.textContent = 'focus';
    } else {
      startBtn.textContent = 'start';
      startBtn.classList.remove('running');
      statusEl.textContent = pomoLeft === pomoTotal ? 'ready' : 'paused';
    }
  }

  document.getElementById('pomoStart').addEventListener('click', () => {
    if (pomoRunning) pausePomo();
    else startPomo();
  });
  document.getElementById('pomoReset').addEventListener('click', resetPomo);
  document.querySelectorAll('.pomo-dur').forEach((btn) => {
    btn.addEventListener('click', () => initPomo(+btn.dataset.min));
  });
  updatePomoDisplay();

  /* ── New day detection ── */
  /**
   * Generates a plaintext export of all log entries for the given date and
   * triggers a file download into the user's `timesheets/` folder.
   * Groups entries by task, totals tracked time, and prepends a header with
   * day start/end times and total workday duration.
   * @param {string} dateKey - Date string in YYYY-MM-DD format.
   */
  function exportForDate(dateKey) {
    const dayEntries = entries
      .filter((e) => e.date === dateKey)
      .slice()
      .sort((a, b) => a.ts - b.ts);
    if (!dayEntries.length) return;
    const seen = new Set(),
      order = [],
      grouped = {};
    dayEntries.forEach((e) => {
      const key = e.text.toLowerCase();
      if (!grouped[key]) {
        order.push(key);
        grouped[key] = { label: e.text, tag: e.tag, totalMs: 0, hasTime: false };
      }
      if (e.tsEnd && e.tsEnd > e.ts) {
        grouped[key].totalMs += e.tsEnd - e.ts;
        grouped[key].hasTime = true;
      }
    });

    const fmtTsHM = (ts) => {
      const d = new Date(ts);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };
    const fmtDurMsL = (ms) => {
      const mins = Math.round(ms / 60000),
        h = Math.floor(mins / 60),
        m = mins % 60;
      return h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
    };

    const lines = order.map((key) => {
      const { label, tag, totalMs, hasTime } = grouped[key];
      const timeStr = hasTime ? fmtDurMsL(totalMs) : '--';
      return `${timeStr} - ${label} - ${getCatLabel(tag)}`;
    });

    const dayStartTs = Math.min(...dayEntries.map((e) => e.ts));
    const timedE = dayEntries.filter((e) => e.tsEnd && e.tsEnd > e.ts);
    const dayEndTs = timedE.length ? Math.max(...timedE.map((e) => e.tsEnd)) : null;
    const header = [`Work Log — ${dateKey}`];
    if (dayStartTs) {
      const endStr = dayEndTs ? fmtTsHM(dayEndTs) : '--:--';
      header.push(`Started: ${fmtTsHM(dayStartTs)}  |  Ended: ${endStr}`);
      if (dayEndTs) header.push(`Workday: ${fmtDurMsL(dayEndTs - dayStartTs)}`);
    }
    header.push('---');

    // Add Pomodoro sessions if any exist for this day
    let pomoLog = [];
    try {
      pomoLog = JSON.parse(localStorage.getItem(STORE_POMO_LOG) || '[]');
    } catch (e) {}
    const dayPomos = pomoLog.filter((p) => p.date === dateKey);
    if (dayPomos.length > 0) {
      lines.push('');
      lines.push('Pomodoro Sessions:');
      dayPomos.forEach((p) => {
        lines.push(
          `  ${p.time || '--:--'} - ${p.mins}min session - ${p.notes ? escHtml(p.notes) : 'no notes'}`
        );
      });
    }

    const blob = new Blob([[...header, ...lines].join('\n')], { type: 'text/plain' });
    writeExportFile('timesheets', `work-log-${dateKey}.txt`, blob);
  }

  /**
   * Formerly showed a "new day" banner prompting the user to export yesterday's log.
   * The banner was removed — end-of-day modal handles exports now.
   * Kept as a no-op stub to avoid removing the call sites.
   */
  function checkNewDay() {
    // Banner removed — end-of-day modal handles exports now
  }

  // ── 09-clock-weather.js ──
  /* ── Live clock + weather ── */

  /**
   * Returns the ISO 8601 week number for a given date.
   * @param {Date} d - The date to evaluate.
   * @returns {number} ISO week number (1–53).
   */
  function getISOWeek(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  }
  /**
   * Returns the total number of ISO weeks in a given year (52 or 53).
   * Uses the fact that Dec 28 is always in the last ISO week.
   * @param {number} year - The full 4-digit year.
   * @returns {number} 52 or 53.
   */
  function totalISOWeeks(year) {
    return getISOWeek(new Date(year, 11, 28)); // Dec 28 is always in last ISO week
  }

  let _lastTickDate = dk(new Date());
  let _lastReminderMinute = -1;

  // Auto-break state — set at :50, cleared at :00
  let _preBreakEntryId = null; // entry id that was running before the automated break
  let _breakEntryId = null; // entry id of the auto-created Break entry

  /* ── Water-themed reminders ── */

  /**
   * Plays a water-themed audio reminder using the Web Audio API.
   * 'breaktime' plays a short rain sound (8 rustling oscillators).
   * 'worktime' plays a rolling ocean-wave sound (3 deeper tones).
   * Silently skips if Web Audio is unavailable.
   * @param {'breaktime'|'worktime'} type - Which sound to play.
   */
  function playWaterReminderSound(type) {
    // type: 'breaktime' (get up, at XX:50) or 'worktime' (return to work, at XX:00)
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();

      if (type === 'breaktime') {
        // Rain sound: multiple short rustling sounds in quick succession
        // Simulates rain/drizzle
        for (let i = 0; i < 8; i++) {
          setTimeout(() => {
            try {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);

              // Randomized low frequency for rain effect
              osc.frequency.value = 100 + Math.random() * 80;

              gain.gain.setValueAtTime(0.15, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

              osc.start();
              osc.stop(ctx.currentTime + 0.3);
            } catch (e) {}
          }, i * 80);
        }
      } else if (type === 'worktime') {
        // Ocean wave sound: deeper, rolling wave tones
        // Three waves in sequence
        for (let w = 0; w < 3; w++) {
          setTimeout(() => {
            try {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);

              // Deeper frequency for ocean/waves
              osc.frequency.value = 60 + w * 20;

              gain.gain.setValueAtTime(0.2, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

              osc.start();
              osc.stop(ctx.currentTime + 0.6);
            } catch (e) {}
          }, w * 700);
        }
      }
    } catch (e) {}
  }

  /**
   * Checks the current minute and fires hourly break/return-to-work logic.
   * At minute :50 — stops the active timer, creates a Break entry, starts a
   * 10-minute pomodoro, and enters focus mode.
   * At minute :00 — stops the Break timer (if still running), restarts the
   * pre-break task, and exits focus mode.
   * Runs at most once per clock minute.
   */
  function checkReminders() {
    const now = new Date();
    const mins = now.getMinutes();

    // Only check once per minute
    if (mins === _lastReminderMinute) return;
    _lastReminderMinute = mins;

    if (mins === 50) {
      // Break time — stop current timer, create Break entry, play rain sound, enter focus mode
      playWaterReminderSound('breaktime');

      // Remember which entry was running so we can restore it after the break
      _preBreakEntryId = activeTimer ? activeTimer.entryId : null;
      _breakEntryId = null;

      // Stop any active timer
      if (activeTimer) stopTimer();

      // Create a Break entry
      const breakEntry = {
        id: Date.now() + '',
        text: 'Break',
        tag: 'break',
        ts: Date.now(),
        date: dk(new Date()),
      };
      entries.push(breakEntry);
      save();
      _breakEntryId = breakEntry.id;

      // Start timer on Break entry
      startTimer(breakEntry.id);

      // Initialize and start 10-minute pomodoro
      initPomo(10);
      startPomo();

      // Enter focus/emergency mode
      enterEmergency();

      render();
    } else if (mins === 0) {
      // Return to work — play ocean wave sound, then restore pre-break state
      playWaterReminderSound('worktime');

      if (_breakEntryId) {
        // Only stop the break timer if the user hasn't already switched away from it
        if (activeTimer && activeTimer.entryId === _breakEntryId) {
          stopTimer(); // finalizes the Break entry with tsEnd
          // Resume the pre-break task if it still exists in entries
          if (_preBreakEntryId && entries.find((e) => e.id === _preBreakEntryId)) {
            startTimer(_preBreakEntryId);
          }
        }
        // Exit focus mode regardless — it was auto-entered, so auto-exit it
        if (emergencyMode) exitEmergency();
        _preBreakEntryId = null;
        _breakEntryId = null;
        render();
      }
    }
  }

  tickClock();
  setInterval(tickClock, 10000);

  /**
   * Updates the live clock display (date, time, ISO week), the time-block
   * "now" line, block notifications, and hourly reminders. Also detects
   * midnight rollover: carries unfinished plan tasks to the new day and
   * re-renders the UI.
   */
  function tickClock() {
    const now = new Date();
    const weekday = now.toLocaleDateString('en', { weekday: 'long' });
    const month = now.toLocaleDateString('en', { month: 'long' });
    const day = now.getDate();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('liveDate').textContent = `${weekday}, ${month} ${day}`;
    document.getElementById('liveTime').textContent = `${hh}:${mm}`;
    const w = getISOWeek(now);
    const total = totalISOWeeks(now.getFullYear());
    document.getElementById('liveWeek').textContent = `Week ${w}/${total}`;
    positionNowLine();
    checkBlockNotifications();
    checkReminders(); // Check for hourly break reminders
    // Detect midnight rollover — carry tasks and re-render
    const todayKey = dk(now);
    if (todayKey !== _lastTickDate) {
      _lastTickDate = todayKey;
      autoCarryTasks();
      patchCarriedTasks();
      viewDate = new Date();
      renderSodBtn();
      renderEodBtn();
      checkPomoWeeklyClear();
      render();
    }
  }

  // WEATHER_LAT, WEATHER_LON, WEATHER_NAME, JIRA_BASE are defined in 00-config.js

  /**
   * Returns HTML for a task text string, converting any leading Jira ticket key
   * (e.g. `AITO-1234`) into a clickable link. The remainder of the text is
   * HTML-escaped and appended.
   * @param {string} text - Raw task text, possibly starting with a Jira key.
   * @returns {string} HTML string.
   */
  function jiraTicketHtml(text) {
    const m = text.match(/^([A-Z]+-\d+)([\s:_-]+(.*))?$/s);
    if (!m) return escHtml(text);
    const key = m[1];
    const rest = (m[3] || '').trim();
    const link = `<a class="jira-key-link" href="${JIRA_BASE}/${key}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escHtml(key)}</a>`;
    return rest ? `${link}<span class="jira-key-sep">:</span> ${escHtml(rest)}` : link;
  }

  /**
   * Maps a WMO weather interpretation code to a representative emoji.
   * @param {number} code - WMO weather code (0 = clear sky, 95+ = thunderstorm).
   * @returns {string} A single weather emoji character.
   */
  function weatherEmoji(code) {
    if (code === 0) return '☀️';
    if (code <= 1) return '🌤️';
    if (code <= 2) return '⛅';
    if (code <= 3) return '☁️';
    if (code <= 48) return '🌫️';
    if (code <= 55) return '🌦️';
    if (code <= 65) return '🌧️';
    if (code <= 75) return '❄️';
    if (code <= 82) return '🌧️';
    if (code <= 86) return '🌨️';
    return '⛈️';
  }

  // Finnish nameday (nimipäivä) — hardcoded official list (University of Helsinki 2020)

  /**
   * Calculates moon phase, illumination percentage, and zodiac sign for a date
   * using a simplified version of the Meeus algorithm.
   * @param {Date} date - The date to evaluate.
   * @returns {{emoji: string, phase: string, illum: number, sign: Array.<string>}}
   *   `emoji` = phase emoji, `phase` = phase name, `illum` = illumination (%),
   *   `sign` = [symbol, name] of the current zodiac sign.
   */
  function getMoonData(date) {
    const JD = date.getTime() / 86400000 + 2440587.5;
    const D = JD - 2451545.0; // days from J2000
    const toR = (x) => (x * Math.PI) / 180;

    // Moon's ecliptic longitude (simplified Meeus)
    const L = (((218.316 + 13.176396 * D) % 360) + 360) % 360;
    const M = toR((((134.963 + 13.064993 * D) % 360) + 360) % 360);
    const E = toR((((297.85 + 12.190749 * D) % 360) + 360) % 360);
    const lon =
      (((L +
        6.289 * Math.sin(M) -
        1.274 * Math.sin(2 * E - M) +
        0.658 * Math.sin(2 * E) -
        0.214 * Math.sin(2 * M) -
        0.11 * Math.sin(E)) %
        360) +
        360) %
      360;

    // Zodiac sign
    const SIGNS = [
      ['♈', 'Aries'],
      ['♉', 'Taurus'],
      ['♊', 'Gemini'],
      ['♋', 'Cancer'],
      ['♌', 'Leo'],
      ['♍', 'Virgo'],
      ['♎', 'Libra'],
      ['♏', 'Scorpio'],
      ['♐', 'Sagittarius'],
      ['♑', 'Capricorn'],
      ['♒', 'Aquarius'],
      ['♓', 'Pisces'],
    ];
    const sign = SIGNS[Math.floor(lon / 30)];

    // Synodic age → phase emoji + illumination
    const synodicPeriod = 29.530588853;
    const age = (((JD - 2451550.26) % synodicPeriod) + synodicPeriod) % synodicPeriod;
    const illum = Math.round(((1 - Math.cos((2 * Math.PI * age) / synodicPeriod)) / 2) * 100);
    const p = age / synodicPeriod;
    const PHASES = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
    const PHASE_NAMES = [
      'New Moon',
      'Waxing Crescent',
      'First Quarter',
      'Waxing Gibbous',
      'Full Moon',
      'Waning Gibbous',
      'Last Quarter',
      'Waning Crescent',
    ];
    const pIdx =
      p < 0.025 || p >= 0.975
        ? 0
        : p < 0.25
          ? 1
          : p < 0.275
            ? 2
            : p < 0.5
              ? 3
              : p < 0.525
                ? 4
                : p < 0.75
                  ? 5
                  : p < 0.775
                    ? 6
                    : 7;

    return { emoji: PHASES[pIdx], phase: PHASE_NAMES[pIdx], illum, sign };
  }

  /**
   * Renders today's moon phase, illumination, and zodiac sign into `#liveMoon`.
   * No-ops if the element is absent.
   */
  function renderMoon() {
    const el = document.getElementById('liveMoon');
    if (!el) return;
    const { emoji, phase, illum, sign } = getMoonData(new Date());
    el.textContent = `${emoji} ${illum}% ${phase} — ${sign[1]} ${sign[0]}`;
  }

  // Finnish flag days
  const FLAG_DAYS_FIXED = {
    '01-01': "New Year's Day",
    '02-05': 'J.L. Runeberg Day',
    '02-28': 'Kalevala Day',
    '03-19': 'Minna Canth Day',
    '04-09': 'Mikael Agricola Day',
    '04-27': "National Veterans' Day",
    '05-01': 'May Day',
    '05-09': 'Europe Day',
    '05-12': 'J.V. Snellman Day',
    '06-04': 'Flag Day of the Finnish Defence Forces',
    '07-06': 'Eino Leino Day',
    '10-01': 'Miina Sillanpää Day',
    '10-10': 'Aleksis Kivi Day',
    '10-24': 'United Nations Day',
    '11-06': 'Swedish Heritage Day',
    '11-20': "Children's Rights Day",
    '12-06': 'Finnish Independence Day',
    '12-08': 'Jean Sibelius Day',
  };

  /**
   * Returns an object mapping "MM-DD" strings to Finnish flag-day names for
   * the given year. Combines fixed dates with computed moveable feasts.
   * @param {number} year - The full 4-digit year.
   * @returns {Object<string, string>} Map of "MM-DD" → event name.
   */
  function getFlagDays(year) {
    const days = { ...FLAG_DAYS_FIXED };
    // Mother's Day — 2nd Sunday of May
    days[fmtMD(nthWeekday(year, 5, 0, 2))] = "Mother's Day";
    // Kaatuneitten muistopäivä — 3rd Sunday of May
    days[fmtMD(nthWeekday(year, 5, 0, 3))] = 'Kaatuneitten muistopäivä';
    // Midsummer / Finnish Flag Day — Saturday between Jun 20–26
    days[fmtMD(nearestWeekday(new Date(year, 5, 20), 6))] = 'Midsummer / Finnish Flag Day';
    // Father's Day — 2nd Sunday of November
    days[fmtMD(nthWeekday(year, 11, 0, 2))] = "Father's Day";
    // Finnish Nature Day — last Saturday of August
    days[fmtMD(lastWeekday(year, 8, 6))] = 'Finnish Nature Day';
    return days;
  }

  /**
   * Returns the date of the nth occurrence of a weekday in the given month.
   * @param {number} year    - Full 4-digit year.
   * @param {number} month   - Month (1 = January … 12 = December).
   * @param {number} weekday - Day of week (0 = Sunday … 6 = Saturday).
   * @param {number} n       - 1-based occurrence index (1 = first, 2 = second, …).
   * @returns {Date}
   */
  function nthWeekday(year, month, weekday, n) {
    // weekday: 0=Sun..6=Sat, month: 1-12, n: 1-based
    const d = new Date(year, month - 1, 1);
    let count = 0;
    while (true) {
      if (d.getDay() === weekday) {
        count++;
        if (count === n) return new Date(d);
      }
      d.setDate(d.getDate() + 1);
    }
  }

  /**
   * Returns the date of the last occurrence of a weekday in the given month.
   * @param {number} year    - Full 4-digit year.
   * @param {number} month   - Month (1 = January … 12 = December).
   * @param {number} weekday - Day of week (0 = Sunday … 6 = Saturday).
   * @returns {Date}
   */
  function lastWeekday(year, month, weekday) {
    // Last occurrence of weekday (0=Sun..6=Sat) in month (1-12)
    const d = new Date(year, month, 0); // last day of month
    while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
    return d;
  }

  /**
   * Returns the first date on or after `from` that falls on the given weekday.
   * @param {Date}   from    - Start date (inclusive).
   * @param {number} weekday - Day of week (0 = Sunday … 6 = Saturday).
   * @returns {Date}
   */
  function nearestWeekday(from, weekday) {
    const d = new Date(from);
    while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
    return d;
  }

  /**
   * Formats a Date as a zero-padded "MM-DD" string used as flag-day map keys.
   * @param {Date} d - The date to format.
   * @returns {string} e.g. "06-04" for the 4th of June.
   */
  function fmtMD(d) {
    return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /**
   * No longer actively used — `fetchCalendarEvents` handles flag-day display.
   * Kept as a no-op stub so call sites don't need to be removed.
   */
  function renderFlagDay() {
    // No longer needed — fetchCalendarEvents handles everything
    // Kept as stub for compatibility
  }

  // Token is injected server-side by start-server.ps1 — never put it in client JS.
  const NAMEDAY_API_BASE = '/api'; // proxied through local server to avoid CORS

  /**
   * Fetches today's Finnish and Swedish name days from the Nimipäivärajapinta API
   * and renders them in `#liveNameday`. Falls back to an "API unavailable" note
   * on error.
   */
  function fetchNameday() {
    const el = document.getElementById('liveNameday');
    if (!el) return;

    // Fetch both Finnish and Swedish names, show with explicit language labels
    fetch(`${NAMEDAY_API_BASE}/namedays/today`)
      .then((r) => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data.success && data.name_days_by_type) {
          const finnishNames = (data.name_days_by_type.suomi || []).map((n) => n.name);
          const swedishNames = (data.name_days_by_type.ruotsi || []).map((n) => n.name);

          let display = "🎂 Today's name day: ";

          const SE_FLAG =
            '<svg width="16" height="11" viewBox="0 0 16 11" style="vertical-align:middle;margin:0 2px;border-radius:1px;display:inline-block"><rect width="16" height="11" fill="#006AA7"/><rect x="4" width="2.5" height="11" fill="#FECC02"/><rect y="4" width="16" height="2.5" fill="#FECC02"/></svg>';

          if (finnishNames.length > 0 && swedishNames.length > 0) {
            display += `${finnishNames.slice(0, 2).map(escHtml).join(', ')}`;
            display += ` <span style="font-size:85%;color:var(--text3)">/ ${SE_FLAG}${swedishNames.slice(0, 2).map(escHtml).join(', ')}</span>`;
          } else if (finnishNames.length > 0) {
            display += `${finnishNames.slice(0, 2).map(escHtml).join(', ')}`;
          } else if (swedishNames.length > 0) {
            display += `<span style="font-size:85%;color:var(--text3)">${SE_FLAG}${swedishNames.slice(0, 2).map(escHtml).join(', ')}</span>`;
          } else {
            throw new Error('No name day data');
          }

          el.innerHTML = display;
        } else {
          throw new Error('Invalid API response');
        }
      })
      .catch((err) => {
        console.warn('[wl] Nameday API failed:', err.message);
        el.innerHTML = `<span style="color:#999999;font-size:85%">🎂 (API unavailable)</span>`;
      });
  }

  /**
   * Fetches today's Finnish flag days, public holidays, and notable days from the
   * Nimipäivärajapinta Typesense API, displaying the first match in `#liveFlagDay`.
   * If today has no event, shows the next upcoming one. Falls back to the hardcoded
   * {@link FLAG_DAYS_FIXED} list if the API is unreachable.
   */
  function fetchCalendarEvents() {
    const el = document.getElementById('liveFlagDay');
    if (!el) return;

    const now = new Date();
    const day = now.getDate();
    const mon = now.getMonth() + 1;
    const year = now.getFullYear();
    const FLAG_SVG =
      '<svg width="20" height="13" viewBox="0 0 18 11" style="vertical-align:middle;margin-right:5px;border-radius:1px;display:inline-block"><rect width="18" height="11" fill="#fff"/><rect y="4" width="18" height="3" fill="#003580"/><rect x="5" width="3" height="11" fill="#003580"/></svg>';

    // Hardcoded fallback — always shows something even if API is unreachable
    function showFallback() {
      const todayMD = fmtMD(now);
      const thisYear = getFlagDays(year);
      const nextYear = getFlagDays(year + 1);
      if (thisYear[todayMD]) {
        el.innerHTML = `${FLAG_SVG}<span style="font-weight:500">${escHtml(thisYear[todayMD])}</span>`;
        return;
      }
      const todayFull = `${year}-${todayMD}`;
      const all = [
        ...Object.entries(thisYear).map(([k, v]) => ({
          key: `${year}-${k}`,
          type: 'flag',
          name: v,
        })),
        ...Object.entries(nextYear).map(([k, v]) => ({
          key: `${year + 1}-${k}`,
          type: 'flag',
          name: v,
        })),
      ].sort((a, b) => a.key.localeCompare(b.key));
      const next = all.find((d) => d.key > todayFull);
      if (next) {
        const dateStr = new Date(next.key + 'T12:00:00').toLocaleDateString('en', {
          month: 'long',
          day: 'numeric',
        });
        el.innerHTML = `${FLAG_SVG}Upcoming: ${dateStr} — <span style="font-weight:500">${escHtml(next.name)}</span>`;
      }
    }

    const apiPost = (collection, body) =>
      fetch(`${NAMEDAY_API_BASE}/typesense/collections/${collection}/documents/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .catch(() => ({ hits: [] }));

    const todayStr = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Check today first, then upcoming if nothing found
    Promise.all([
      apiPost('flag_days', { q: '*', filter_by: `day:=${day} && month:=${mon}`, per_page: 1 }),
      apiPost('holidays', {
        q: '*',
        filter_by: `day:=${day} && month:=${mon} && in_short_list:=true`,
        per_page: 1,
      }),
      apiPost('notable_days', { q: '*', filter_by: `day:=${day} && month:=${mon}`, per_page: 1 }),
    ])
      .then(([flagToday, holidayToday, notableToday]) => {
        // Show today's event if found
        if (flagToday.hits && flagToday.hits.length > 0) {
          el.innerHTML = `${FLAG_SVG}<span style="font-weight:500">${escHtml(flagToday.hits[0].document.name_fi)}</span>`;
          return;
        }
        if (holidayToday.hits && holidayToday.hits.length > 0) {
          el.innerHTML = `📅 <span style="font-weight:500">${escHtml(holidayToday.hits[0].document.name_fi)}</span>`;
          return;
        }
        if (notableToday.hits && notableToday.hits.length > 0) {
          el.innerHTML = `📅 <span style="font-weight:500">${escHtml(notableToday.hits[0].document.name_fi)}</span>`;
          return;
        }

        // Nothing today — find next upcoming event
        return Promise.all([
          apiPost('flag_days', {
            q: '*',
            filter_by: `date:>${todayStr}`,
            sort_by: 'date:asc',
            per_page: 1,
          }),
          apiPost('holidays', {
            q: '*',
            filter_by: `date:>${todayStr} && in_short_list:=true`,
            sort_by: 'date:asc',
            per_page: 1,
          }),
          apiPost('notable_days', {
            q: '*',
            filter_by: `date:>${todayStr}`,
            sort_by: 'date:asc',
            per_page: 1,
          }),
        ]).then(([flagNext, holidayNext, notableNext]) => {
          const events = [];
          if (flagNext.hits && flagNext.hits.length > 0)
            events.push({
              date: flagNext.hits[0].document.date,
              type: 'flag',
              name: flagNext.hits[0].document.name_fi,
            });
          if (holidayNext.hits && holidayNext.hits.length > 0)
            events.push({
              date: holidayNext.hits[0].document.date,
              type: 'calendar',
              name: holidayNext.hits[0].document.name_fi,
            });
          if (notableNext.hits && notableNext.hits.length > 0)
            events.push({
              date: notableNext.hits[0].document.date,
              type: 'calendar',
              name: notableNext.hits[0].document.name_fi,
            });

          if (events.length > 0) {
            const next = events.sort((a, b) => a.date.localeCompare(b.date))[0];
            const dateStr = new Date(next.date + 'T12:00:00').toLocaleDateString('en', {
              month: 'long',
              day: 'numeric',
            });
            const icon = next.type === 'flag' ? FLAG_SVG : '📅 ';
            el.innerHTML = `${icon}Upcoming: ${dateStr} — <span style="font-weight:500">${escHtml(next.name)}</span>`;
          } else {
            showFallback(); // API returned nothing — use hardcoded list
          }
        });
      })
      .catch(() => showFallback());
  }

  /**
   * Fetches current weather, hourly precipitation probability, and sunrise/sunset
   * data from the Open-Meteo API for the configured location ({@link WEATHER_LAT},
   * {@link WEATHER_LON}) and populates `#liveWeather`, `#liveRain`, and
   * `#liveSunrise`. No-ops gracefully on `file:` protocol or network error.
   */
  function fetchWeather() {
    if (location.protocol === 'file:') {
      document.getElementById('liveWeather').textContent =
        `${WEATHER_NAME} — open via localhost for weather`;
      return;
    }
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}&current=temperature_2m,weather_code&hourly=precipitation_probability&daily=sunrise,sunset,daylight_duration&timezone=Europe%2FHelsinki&past_days=1&forecast_days=2`
    )
      .then((r) => r.json())
      .then((d) => {
        const temp = Math.round(d.current.temperature_2m);
        const emoji = weatherEmoji(d.current.weather_code);
        document.getElementById('liveWeather').textContent = `${WEATHER_NAME}, ${temp}°C ${emoji}`;

        // Peak rain probability in next 8 hours
        const times = d.hourly.time;
        const probs = d.hourly.precipitation_probability;
        // Find current hour in local time (API times are local)
        const _now = new Date();
        const _pad = (n) => String(n).padStart(2, '0');
        const nowLocalStr = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}T${_pad(_now.getHours())}`;
        const nowIdx = times.findIndex((t) => t.slice(0, 13) === nowLocalStr);
        if (nowIdx === -1) return;

        const windowStart = nowIdx + 1; // start from next hour — current hour may already be past
        const window = probs.slice(windowStart, windowStart + 9);
        const peak = Math.max(...window);
        const peakOff = window.indexOf(peak);
        const peakTime = new Date(times[windowStart + peakOff]);
        const hh = String(peakTime.getHours()).padStart(2, '0');
        const mm = String(peakTime.getMinutes()).padStart(2, '0');

        document.getElementById('liveRain').textContent =
          peak > 0 ? `${peak}% chance of rain at ${hh}:${mm}` : 'No rain expected';

        // Sunrise / sunset / day length
        if (d.daily && d.daily.time && d.daily.sunrise) {
          const todayStr = dk(new Date()); // "YYYY-MM-DD"
          const todayIdx = d.daily.time.indexOf(todayStr);
          const yesterdayIdx = todayIdx > 0 ? todayIdx - 1 : -1;
          if (todayIdx !== -1) {
            const parse = (str) => {
              const t = new Date(str);
              return (
                String(t.getHours()).padStart(2, '0') +
                ':' +
                String(t.getMinutes()).padStart(2, '0')
              );
            };
            const rise = parse(d.daily.sunrise[todayIdx]);
            const set_ = parse(d.daily.sunset[todayIdx]);
            const durSec = d.daily.daylight_duration[todayIdx];
            const h = Math.floor(durSec / 3600);
            const m = Math.floor((durSec % 3600) / 60);
            let diffHtml = '';
            if (yesterdayIdx !== -1) {
              const diffMin = Math.round((durSec - d.daily.daylight_duration[yesterdayIdx]) / 60);
              if (diffMin > 0) diffHtml = ` <strong style="color:#1D9E75">+${diffMin} min</strong>`;
              else if (diffMin < 0)
                diffHtml = ` <strong style="color:#E74C3C">${diffMin} min</strong>`;
            }
            document.getElementById('liveSunrise').innerHTML =
              `🌅 ${rise} | 🌇 ${set_} | ☀️ ${h}h ${m}min${diffHtml}`;
          }
        }
      })
      .catch(() => {
        document.getElementById('liveWeather').textContent = WEATHER_NAME;
      });
  }
  // Load location from server config before the first weather fetch.
  // Falls back to the defaults in 00-config.js when the server is not running.
  fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      if (!cfg) return;
      if (typeof cfg.weatherLat === 'number') WEATHER_LAT = cfg.weatherLat;
      if (typeof cfg.weatherLon === 'number') WEATHER_LON = cfg.weatherLon;
      if (cfg.weatherName) WEATHER_NAME = cfg.weatherName;
      // Mark that the API server responded — read by wlLog.config() in 07-lifecycle.js
      // to record which environment the app is running in.
      localStorage.setItem('wl_api_ok', '1');
    })
    .catch(() => {
      localStorage.removeItem('wl_api_ok');
    })
    .finally(() => fetchWeather());

  fetchNameday();
  fetchCalendarEvents();
  renderMoon();
  renderFlagDay();
  renderDistractionCount();
  renderSodBtn();
  renderEodBtn();
  renderFolderStatus();
  loadChimeSetting();
  setInterval(fetchWeather, 10 * 60 * 1000); // refresh every 10 min

  // ── 10-tasks.js ──
  /* ── Today's tasks ── */
  const STORE_PLAN = 'wl_plan_v1';
  /**
   * Plan task list — each item:
   * `{ id, text, status, tag, date, [billable], [notionUrl], [emoji], [checkpoints], [parentId], [priority] }`
   * @type {Array<Object>}
   */
  let planTasks = [];
  let planCollapsed = false;
  let pendingCollapsed = false;
  let editingPlanId = null;
  let _pendingCommentId = null;
  let splitInputId = null;
  let _pendingCommentText = '';
  let _expandedHistoryId = null;
  let _cpOpenIds = new Set();
  let _cpEditId = null; // pid of task whose checkpoint is being edited
  let _cpEditIdx = null; // index of checkpoint being edited

  /**
   * Loads plan tasks from localStorage into `planTasks`, filtering out invalid
   * entries via `validPlanTask`. Drops are reported via wlLog.warn so data-quality
   * issues are visible in DevTools. Resets to empty array on parse error.
   */
  function loadPlan() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_PLAN) || '[]');
      const all = Array.isArray(raw) ? raw : [];
      planTasks = all.filter(validPlanTask);
      if (planTasks.length < all.length)
        wlLog.warn(`loadPlan: dropped ${all.length - planTasks.length} invalid task record(s)`, {
          total: all.length,
          kept: planTasks.length,
        });
    } catch (e) {
      planTasks = [];
      wlLog.error('loadPlan: failed to parse plan tasks from localStorage', e);
    }
  }
  /** Persists the current `planTasks` array to localStorage. */
  function savePlan() {
    localStorage.setItem(STORE_PLAN, JSON.stringify(planTasks));
  }

  /**
   * Re-renders the entire plan UI for the currently viewed date: main task list,
   * pending/blocked section, upcoming section, all associated controls (status
   * dropdowns, checkpoints, billable buttons, Notion/emoji buttons), and section
   * headers with counts. Also renders the completed-tasks section.
   */
  function renderPlan() {
    const viewKey = dk(viewDate);
    const todayKey = dk(new Date());
    const allViewTasks = planTasks.filter((t) => t.date === viewKey);
    const mainTasks = allViewTasks.filter(
      (t) =>
        t.status !== 'done' &&
        t.status !== 'pending' &&
        t.status !== 'blocked' &&
        t.status !== 'upcoming'
    );
    const pendingTasks = allViewTasks.filter(
      (t) => t.status === 'pending' || t.status === 'blocked'
    );
    const upcomingTasks = allViewTasks.filter((t) => t.status === 'upcoming');
    const todoCount = allViewTasks.filter((t) => (t.status || 'todo') === 'todo').length;
    const progressCount = allViewTasks.filter((t) => t.status === 'inprogress').length;
    const pendingCount = allViewTasks.filter((t) => t.status === 'pending').length;
    const blockedCount = allViewTasks.filter((t) => t.status === 'blocked').length;
    const upcomingCount = allViewTasks.filter((t) => t.status === 'upcoming').length;
    const doneCount = isToday(viewDate)
      ? planTasks.filter((t) => t.date === viewKey && t.status === 'done').length
      : allViewTasks.filter((t) => t.status === 'done').length;

    // Main section header — only counts active/done tasks
    const mainParts = [];
    if (todoCount > 0) mainParts.push(`${todoCount} to do`);
    if (progressCount > 0) mainParts.push(`${progressCount} in progress`);
    mainParts.push(`${doneCount} done`);
    document.getElementById('planCount').textContent =
      todoCount + progressCount + doneCount ? mainParts.join(' · ') : '';
    document.getElementById('planSection').classList.toggle('collapsed', planCollapsed);

    // Upcoming section
    const upcomingSectionEl = document.getElementById('upcomingSection');
    if (upcomingTasks.length > 0) {
      upcomingSectionEl.style.display = '';
      document.getElementById('upcomingCount').textContent = `${upcomingCount} upcoming`;
    } else {
      upcomingSectionEl.style.display = 'none';
    }

    // Pending section header
    const pendingParts = [];
    if (pendingCount > 0) pendingParts.push(`${pendingCount} pending`);
    if (blockedCount > 0) pendingParts.push(`${blockedCount} blocked`);
    const pendingSectionEl = document.getElementById('pendingSection');
    if (pendingTasks.length > 0) {
      pendingSectionEl.style.display = '';
      pendingSectionEl.classList.toggle('collapsed', pendingCollapsed);
      document.getElementById('pendingCount').textContent = pendingParts.join(' · ');
    } else {
      pendingSectionEl.style.display = 'none';
    }

    // Hide add form when not viewing today
    const addRow = document.getElementById('planAddRow');
    if (addRow) addRow.style.display = isToday(viewDate) ? '' : 'none';

    const mainListEl = document.getElementById('planList');
    const pendingListEl = document.getElementById('pendingList');
    const upcomingListEl = document.getElementById('upcomingList');

    // Empty-state for main list (the pending list is shown/hidden entirely)
    if (!mainTasks.length) {
      mainListEl.innerHTML = `<div class="plan-empty">${
        isToday(viewDate)
          ? pendingTasks.length
            ? 'all active tasks are pending or blocked — see below'
            : 'no tasks yet — add some above'
          : 'no tasks were planned for this day'
      }</div>`;
    }

    const STATUS_ORDER = { inprogress: 0, todo: 1, pending: 2, blocked: 3, done: 4 };

    const liveEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
    const liveText = liveEntry ? liveEntry.text.toLowerCase() : null;

    const flatSort = (tasks) => {
      const parents = tasks.filter((t) => !t.parentId);
      const children = tasks.filter((t) => !!t.parentId);
      const sorted = [...parents].sort((a, b) => {
        const aLive = liveText && a.text.toLowerCase() === liveText;
        const bLive = liveText && b.text.toLowerCase() === liveText;
        if (aLive && !bLive) return -1;
        if (!aLive && bLive) return 1;
        const aOrd = STATUS_ORDER[a.status || 'todo'] ?? 1;
        const bOrd = STATUS_ORDER[b.status || 'todo'] ?? 1;
        if (aOrd !== bOrd) return aOrd - bOrd;
        // Within the same status: higher priority first (high=1, normal=0, low=-1)
        const aPri = a.priority || 0;
        const bPri = b.priority || 0;
        if (aPri !== bPri) return bPri - aPri;
        return a.text.localeCompare(b.text);
      });
      // Insert children right after their parent
      const result = [];
      sorted.forEach((p) => {
        result.push(p);
        const kids = children
          .filter((c) => c.parentId === p.id)
          .sort((a, b) => a.text.localeCompare(b.text));
        kids.forEach((k) => result.push(k));
      });
      // Orphaned children (parent deleted/moved) go at end
      children
        .filter((c) => !parents.find((p) => p.id === c.parentId))
        .forEach((c) => result.push(c));
      return result;
    };

    const statusOpts = (cur) =>
      ['todo', 'inprogress', 'upcoming', 'pending', 'blocked', 'done']
        .map((s) => {
          const labels = {
            todo: 'To do',
            inprogress: 'In progress',
            upcoming: 'Upcoming',
            pending: 'Pending',
            blocked: 'Blocked',
            done: 'Done',
          };
          return `<option value="${s}"${cur === s ? ' selected' : ''}>${labels[s]}</option>`;
        })
        .join('');

    const mainSorted = flatSort(mainTasks);
    const pendingSorted = flatSort(pendingTasks);
    const upcomingSorted = flatSort(upcomingTasks);

    const fmtMins = (mins) => {
      const h = Math.floor(mins / 60),
        m = mins % 60;
      return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
    };

    // Priority button: click cycles 0 (normal) → 1 (high) → -1 (low) → 0
    function prioBtnHtml(t) {
      const p = t.priority || 0;
      const icon = p === 1 ? '⭐' : p === -1 ? '⬇' : '☆';
      const cls = p === 1 ? ' prio-high' : p === -1 ? ' prio-low' : '';
      const next = p === 0 ? 'high' : p === 1 ? 'low' : 'normal';
      return `<button class="prio-btn${cls}" data-pid="${t.id}" title="priority: ${p === 1 ? 'high' : p === -1 ? 'low' : 'normal'} — click for ${next}">${icon}</button>`;
    }

    // Notion button: 📋 send to Notion. If already sent, becomes a link icon.
    function notionBtnHtml(t) {
      if (t.notionUrl) {
        return `<button class="notion-task-btn notion-sent" data-pid="${t.id}" title="open in Notion: ${escHtml(t.notionUrl)}">🔗</button>`;
      }
      return `<button class="notion-task-btn" data-pid="${t.id}" title="send to Notion second brain">📋</button>`;
    }

    // Billable button: 💰/💸 — sits between status dropdown and task name.
    // Hidden (not rendered) for pending/blocked/upcoming; the t.billable value
    // is preserved on the task object and reappears when status returns to today.
    function billBtnHtml(t, status) {
      if (status === 'pending' || status === 'blocked' || status === 'upcoming') return '';
      const icon = t.billable === false ? '💸' : '💰';
      const title = t.billable === false ? 'mark billable' : 'mark non-billable';
      return `<button class="bill-btn bill-btn-left" data-pid="${t.id}" title="${title}">${icon}</button>`;
    }

    function renderRow(t) {
      const status = t.status || 'todo';
      const tag = t.tag || 'other';
      const cat = getCat(tag);
      const loggedMins = entries
        .filter(
          (e) => e.date === viewKey && e.text.toLowerCase() === t.text.toLowerCase() && e.tsEnd
        )
        .reduce((sum, e) => sum + Math.round((e.tsEnd - e.ts) / 60000), 0);
      const timeSpent = loggedMins > 0 ? fmtMins(loggedMins) : '';

      if (editingPlanId === t.id) {
        return `<div class="plan-item" data-pid="${t.id}">
          <select class="plan-status ${status === 'done' ? 'done-st' : status}" data-pid="${t.id}">${statusOpts(status)}</select>
          <div class="plan-inline-edit">
            <input class="plan-inline-input" id="planEditInput" value="${escHtml(t.text)}" data-pid="${t.id}" />
            <button class="plan-inline-ok" id="planEditOk" data-pid="${t.id}">&#10003;</button>
            <button class="plan-inline-cancel" id="planEditCancel">&#10005;</button>
          </div>
        </div>`;
      }

      const isLive = liveText && t.text.toLowerCase() === liveText;
      const catOpts =
        [...categories]
          .sort((a, b) => a.label.localeCompare(b.label))
          .map(
            (c) =>
              `<button class="cat-opt${t.tag === c.id ? ' sel' : ''}" data-pid="${t.id}" data-cat="${c.id}" style="${t.tag === c.id ? `background:${c.color};color:#fff;border-color:transparent` : `color:${c.color}`}">${escHtml(c.label)}</button>`
          )
          .join('') +
        `<button class="cat-cancel" data-pid="${t.id}">cancel</button>` +
        `<div class="pcat-add-row">` +
        `<button class="pcat-add-btn" data-pid="${t.id}">+ new epic</button>` +
        `<div class="pcat-add-form" id="pcaf-${t.id}">` +
        `<input class="pcat-add-input" placeholder="name…" />` +
        `<button class="pcat-add-ok" data-pid="${t.id}">&#10003;</button>` +
        `<button class="pcat-add-cancel2" data-pid="${t.id}">&#10005;</button>` +
        `</div></div>`;

      // Comment row + bubble for pending/blocked
      let commentRowHtml = '';
      let pbTsText = '';
      let pbCommentBubble = '';
      if (status === 'pending' || status === 'blocked') {
        const inFlight = _pendingCommentId === t.id;
        const activeComment = t.statusComments
          ? [...t.statusComments].reverse().find((c) => c.status === status)
          : null;
        const showInput = inFlight || (activeComment && !activeComment.comment);

        // Timestamp — use activeComment.ts or any matching statusComment.ts
        const tsSource =
          activeComment ||
          (t.statusComments
            ? [...t.statusComments].reverse().find((c) => c.status === status)
            : null);
        if (tsSource && tsSource.ts) {
          const td = new Date(tsSource.ts);
          const hh = String(td.getHours()).padStart(2, '0');
          const mm = String(td.getMinutes()).padStart(2, '0');
          const isToday2 = dk(td) === dk(new Date());
          const dateLabel = isToday2
            ? 'today'
            : td.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
          pbTsText = `${status} ${dateLabel}, at ${hh}:${mm}`;
        }

        if (showInput) {
          const val = inFlight
            ? escHtml(_pendingCommentText || '')
            : activeComment
              ? escHtml(activeComment.comment || '')
              : '';
          commentRowHtml = `<div class="plan-comment-row">
            <input class="plan-comment-input" id="pc-inp-${t.id}" data-pid="${t.id}" value="${val}" placeholder="why is this ${status}? (optional)" />
            <button class="plan-comment-ok" data-pid="${t.id}">&#10003;</button>
            <button class="plan-comment-skip" data-pid="${t.id}">skip</button>
          </div>`;
        } else if (activeComment && activeComment.comment) {
          // Comment shown as tooltip on bubble — no separate row
          pbCommentBubble = `<span class="plan-comment-bubble" title="${escHtml(activeComment.comment)}">💬</span>`;
        } else {
          // No comment yet — dim bubble that opens the input
          pbCommentBubble = `<button class="plan-comment-bubble plan-comment-bubble-empty plan-comment-edit" data-pid="${t.id}" title="add reason">💬</button>`;
        }
      }

      const taskNameHtml = isLive
        ? `▶ <strong>${tag === 'meeting' ? '📅 ' : ''}${t.emoji ? escHtml(t.emoji) + ' ' : ''}${jiraTicketHtml(t.text)}</strong>`
        : `${tag === 'meeting' ? '📅 ' : ''}${t.emoji ? escHtml(t.emoji) + ' ' : ''}${jiraTicketHtml(t.text)}`;

      const catLineHtml = `<div class="plan-cat-line" data-pid="${t.id}">
            <span class="plan-cat-dot" style="background:${cat.color}"></span>
            <span class="plan-cat-name" style="color:${cat.color}">${escHtml(cat.label)}</span>
            <span class="plan-cat-chevron">▾</span>
          </div>
          <div class="plan-cat-picker" id="pcp-${t.id}">${catOpts}</div>`;

      // Handoff note from wl_handoff
      let handoffNoteHtml = '';
      if (status !== 'done') {
        try {
          const _hn = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
          const _note = _hn[t.text.toLowerCase().trim()];
          if (_note)
            handoffNoteHtml = `<div class="plan-handoff-note"><span class="plan-handoff-text">↳ ${escHtml(_note)}</span><button class="plan-handoff-dismiss" data-task="${escHtml(t.text.toLowerCase().trim())}" title="dismiss note">×</button></div>`;
        } catch (e) {}
      }

      // Checkpoint badge + expandable area
      const cps = Array.isArray(t.checkpoints) ? t.checkpoints : [];
      const cpDone = cps.filter((c) => c.done).length;
      const cpTotal = cps.length;
      const cpOpen = _cpOpenIds.has(t.id);
      let cpBadgeClass = 'cp-badge';
      if (cpDone > 0 && cpDone < cpTotal) cpBadgeClass += ' cp-has-progress';
      else if (cpTotal > 0 && cpDone === cpTotal) cpBadgeClass += ' cp-done-all';
      else if (cpTotal > 0) cpBadgeClass += ` cp-st-${status}`; // has steps but none ticked yet — mirror task status color
      const cpBadgeLabel =
        cpTotal === 0 ? '+ steps' : cpDone === cpTotal ? `✓ ${cpTotal}` : `${cpDone}/${cpTotal}`;

      let cpAreaHtml = '';
      if (cpOpen || (cpTotal === 0 && cpOpen)) {
        const pct = cpTotal ? Math.round((cpDone / cpTotal) * 100) : 0;
        const rowsHtml = cps
          .map(
            (cp, i) =>
              `<div class="cp-row${_cpEditId === t.id && _cpEditIdx === i ? ' cp-editing' : ''}" draggable="${_cpEditId === t.id && _cpEditIdx === i ? 'false' : 'true'}" data-pid="${t.id}" data-cpidx="${i}">
            <span class="cp-handle" title="drag to reorder">⠿</span>
            <div class="cp-check${cp.done === true ? ' cp-checked' : cp.done === 'partial' ? ' cp-partial' : ''}" data-pid="${t.id}" data-cpidx="${i}">${cp.done === 'partial' ? '–' : '✓'}</div>
            ${
              _cpEditId === t.id && _cpEditIdx === i
                ? `<input class="cp-edit-input" data-pid="${t.id}" data-cpidx="${i}" value="${escHtml(cp.text)}" />`
                : `<span class="cp-label${cp.done === true ? ' cp-checked' : cp.done === 'partial' ? ' cp-partial' : ''}" data-pid="${t.id}" data-cpidx="${i}">${escHtml(cp.text)}</span>`
            }
            <button class="cp-del-btn" data-pid="${t.id}" data-cpidx="${i}" title="remove">×</button>
          </div>`
          )
          .join('');
        cpAreaHtml = `<div class="cp-area">
          ${
            cpTotal > 0
              ? `<div class="cp-progress-row">
            <div class="cp-bar"><div class="cp-fill" style="width:${pct}%"></div></div>
            <span class="cp-frac">${cpDone}/${cpTotal}</span>
          </div>`
              : ''
          }
          ${rowsHtml}
          <div class="cp-add-row">
            <span class="cp-add-icon">+</span>
            <input class="cp-add-input" data-pid="${t.id}" placeholder="add a step… (Enter to save)" />
          </div>
        </div>`;
      }

      // Pending/blocked: simplified layout — no action buttons, bubble tooltip, timestamp at far right
      if (status === 'pending' || status === 'blocked') {
        return `<div class="plan-item plan-pb-item${isLive ? ' active-timer' : ''}" data-pid="${t.id}" data-dtxt="${escHtml(t.text)}" data-dtag="${tag}">
          <select class="plan-status ${status}" data-pid="${t.id}">${statusOpts(status)}</select>
          ${billBtnHtml(t, status)}
          <div class="plan-left">
            <div class="plan-top">
              <span class="plan-text">${taskNameHtml}${pbCommentBubble ? '&thinsp;' + pbCommentBubble : ''}<button class="${cpBadgeClass}" data-pid="${t.id}" title="${cpOpen ? 'collapse steps' : 'expand steps'}">${cpBadgeLabel}</button>${prioBtnHtml(t)}${notionBtnHtml(t)}</span>
            </div>
            ${handoffNoteHtml}
            ${cpAreaHtml}
            ${commentRowHtml}
            ${catLineHtml}
          </div>
          ${pbTsText ? `<span class="plan-pb-ts">${escHtml(pbTsText)}</span>` : ''}
        </div>`;
      }

      const childCount = planTasks.filter(
        (c) => c.parentId === t.id && c.date === viewKey && c.status !== 'done'
      ).length;
      const childBadge =
        childCount > 0 ? `<span class="plan-child-badge">${childCount}</span>` : '';
      const isChild = !!t.parentId;
      const indent = isChild ? ' plan-child-item' : '';
      const childPrefix = isChild ? '<span class="plan-child-arrow">↳</span>' : '';

      return `<div class="plan-item${status === 'done' ? ' done' : ''}${isLive ? ' active-timer' : ''}${indent}" data-pid="${t.id}" data-dtxt="${escHtml(t.text)}" data-dtag="${tag}">
        ${childPrefix}<select class="plan-status ${status === 'done' ? 'done-st' : status}" data-pid="${t.id}">${statusOpts(status)}</select>
        ${billBtnHtml(t, status)}
        <div class="plan-left">
          <div class="plan-top">
            <span class="plan-text">${taskNameHtml}${!isChild ? `<button class="${cpBadgeClass}" data-pid="${t.id}" title="${cpOpen ? 'collapse steps' : 'expand steps'}">${cpBadgeLabel}</button>` : ''}${prioBtnHtml(t)}${notionBtnHtml(t)}</span>
          </div>
          ${handoffNoteHtml}
          ${!isChild ? cpAreaHtml : ''}
          ${commentRowHtml}
          ${isChild ? '' : catLineHtml}
        </div>
        <div class="plan-actions">
          ${childBadge}
          ${status !== 'done' && !isChild ? `<button class="plan-split-btn" data-pid="${t.id}" title="split into subtasks">⊕</button>` : ''}
          <button class="plan-log-btn" data-pid="${t.id}" data-text="${escHtml(t.text)}">▶ start</button>
          <button class="plan-edit-btn" data-pid="${t.id}" title="edit">&#9998;</button>
          <button class="plan-del-btn" data-pid="${t.id}">&times;</button>
        </div>
      </div>
      ${
        splitInputId === t.id
          ? `<div class="plan-split-row" data-parent="${t.id}">
        <span class="plan-child-arrow">↳</span>
        <input class="plan-split-input" id="splitInp-${t.id}" placeholder="subtask name… ↵ to add" />
        <button class="plan-split-done" data-pid="${t.id}">done</button>
      </div>`
          : ''
      }`;
    }

    // Render all three lists
    if (mainTasks.length) mainListEl.innerHTML = mainSorted.map(renderRow).join('');
    pendingListEl.innerHTML = pendingSorted.map(renderRow).join('');
    upcomingListEl.innerHTML = upcomingSorted.map(renderRow).join('');

    // Event handlers bound across all three lists (main, pending, upcoming)
    const lists = [mainListEl, pendingListEl, upcomingListEl];
    const qa = (sel) => lists.flatMap((L) => [...L.querySelectorAll(sel)]);
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
        lists.forEach((L) =>
          L.querySelectorAll('.plan-cat-picker.open').forEach((p) => p.classList.remove('open'))
        );
        if (!isOpen) picker.classList.add('open');
      });
    });
    qa('.plan-cat-picker .cat-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = planTasks.find((t) => t.id === btn.dataset.pid);
        if (t) {
          t.tag = btn.dataset.cat;
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
        const label = input.value.trim();
        if (!label) {
          input.focus();
          return;
        }
        if (categories.find((c) => c.label.toLowerCase() === label.toLowerCase())) {
          input.style.borderColor = '#C62828';
          input.focus();
          return;
        }
        const color = nextDistinctColor();
        const id = 'cat_' + Date.now();
        categories.push({ id, label, color });
        const t = planTasks.find((t) => t.id === btn.dataset.pid);
        if (t) t.tag = id;
        save();
        savePlan();
        renderTagRow();
        renderPlan();
      });
    });
    qa('.pcat-add-input').forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') inp.closest('.pcat-add-form').querySelector('.pcat-add-ok').click();
        if (e.key === 'Escape')
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
        const t = planTasks.find((t) => t.id === sel.dataset.pid);
        if (!t) return;
        const prevStatus = t.status;
        const newStatus = sel.value;

        // Capture in-flight typed text BEFORE re-render
        let liveTyped = null;
        if (_pendingCommentId === t.id) {
          const inp = document.getElementById('pc-inp-' + t.id);
          liveTyped = inp ? inp.value : _pendingCommentText;
        }

        t.status = newStatus;
        if (newStatus === 'done' && !t.completedAt) t.completedAt = roundToNearest30(Date.now());
        if (newStatus !== 'done') delete t.completedAt;

        // If child goes inprogress, promote parent too (unless already done)
        if (newStatus === 'inprogress' && t.parentId) {
          const parent = planTasks.find((p) => p.id === t.parentId);
          if (parent && parent.status === 'todo') {
            parent.status = 'inprogress';
          }
        }
        // When marking done, retire older versions of the same task
        if (newStatus === 'done') {
          planTasks
            .filter(
              (p) =>
                p.id !== t.id &&
                p.text.toLowerCase() === t.text.toLowerCase() &&
                p.status !== 'done'
            )
            .forEach((p) => {
              p.status = 'done';
              if (!p.completedAt) p.completedAt = t.completedAt;
            });
        }
        // Auto-complete parent when all its children are done
        if (newStatus === 'done' && t.parentId) {
          const parent = planTasks.find((p) => p.id === t.parentId);
          if (parent && parent.status !== 'done') {
            const siblings = planTasks.filter((c) => c.parentId === parent.id && c.date === t.date);
            if (
              siblings.length > 0 &&
              siblings.every((c) => c.status === 'done' || c.id === t.id)
            ) {
              parent.status = 'done';
              if (!parent.completedAt) parent.completedAt = roundToNearest30(Date.now());
            }
          }
        }
        // Auto-stop timer when active task is marked done
        if (newStatus === 'done' && activeTimer) {
          const timerEntry = entries.find((e) => e.id === activeTimer.entryId);
          if (timerEntry && timerEntry.text.toLowerCase() === t.text.toLowerCase()) {
            stopTimer();
          }
        }

        // Pending/blocked transitions
        const wasPB = prevStatus === 'pending' || prevStatus === 'blocked';
        const isPB = newStatus === 'pending' || newStatus === 'blocked';

        if (isPB && newStatus !== prevStatus) {
          if (!t.statusComments) t.statusComments = [];
          const last = t.statusComments[t.statusComments.length - 1];
          const inFlight = _pendingCommentId === t.id;

          if (wasPB && inFlight && last && !last.comment) {
            // Same comment session — just relabel the unsaved entry,
            // preserving the typed-but-unsaved text via _pendingCommentText.
            last.status = newStatus;
            _pendingCommentText = liveTyped != null ? liveTyped : _pendingCommentText || '';
            // _pendingCommentId stays set
          } else {
            // Fresh session
            t.statusComments.push({ status: newStatus, comment: '', ts: Date.now() });
            _pendingCommentId = t.id;
            _pendingCommentText = '';
          }
        } else if (!isPB) {
          // Leaving pending/blocked — only drop a trailing unsaved entry
          // if this task had an in-flight comment session (otherwise it could
          // be a deliberately-saved empty entry).
          if (_pendingCommentId === t.id && t.statusComments && t.statusComments.length) {
            const last = t.statusComments[t.statusComments.length - 1];
            if (!last.comment && (last.status === 'pending' || last.status === 'blocked')) {
              t.statusComments.pop();
            }
          }
          if (_pendingCommentId === t.id) {
            _pendingCommentId = null;
            _pendingCommentText = '';
          }
        }

        savePlan();
        renderPlan();
        renderCompleted();
      });
    });

    // Accept / skip / edit for status comment
    function saveComment(pid) {
      const t = planTasks.find((t) => t.id === pid);
      if (!t) {
        _pendingCommentId = null;
        _pendingCommentText = '';
        renderPlan();
        return;
      }
      if (!t.statusComments) t.statusComments = [];
      const inp = document.getElementById('pc-inp-' + pid);
      const val = inp ? inp.value.trim() : (_pendingCommentText || '').trim();
      const entry = [...t.statusComments].reverse().find((c) => c.status === t.status);
      if (entry) {
        if (val) {
          entry.comment = val;
        } else {
          // Empty accept behaves as skip — remove the entry so the row
          // collapses to "+ add reason" rather than reopening the input.
          t.statusComments = t.statusComments.filter((c) => c !== entry);
        }
      } else if (val) {
        t.statusComments.push({ status: t.status, comment: val, ts: Date.now() });
      }
      _pendingCommentId = null;
      _pendingCommentText = '';
      savePlan();
      renderPlan();
    }
    qa('.plan-comment-ok').forEach((btn) => {
      btn.addEventListener('click', () => saveComment(btn.dataset.pid));
    });
    qa('.plan-comment-skip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = planTasks.find((t) => t.id === btn.dataset.pid);
        if (t && t.statusComments && t.statusComments.length) {
          const last = t.statusComments[t.statusComments.length - 1];
          if (!last.comment) t.statusComments.pop();
        }
        _pendingCommentId = null;
        _pendingCommentText = '';
        savePlan();
        renderPlan();
      });
    });
    qa('.plan-comment-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = planTasks.find((t) => t.id === btn.dataset.pid);
        _pendingCommentId = btn.dataset.pid;
        if (t && t.statusComments) {
          const ac = [...t.statusComments].reverse().find((c) => c.status === t.status);
          _pendingCommentText = ac ? ac.comment || '' : '';
        } else {
          _pendingCommentText = '';
        }
        renderPlan();
      });
    });
    qa('.plan-comment-input').forEach((inp) => {
      // Mirror typed text into the in-flight buffer
      inp.addEventListener('input', () => {
        if (inp.dataset.pid === _pendingCommentId) _pendingCommentText = inp.value;
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveComment(inp.dataset.pid);
        if (e.key === 'Escape') {
          const t = planTasks.find((t) => t.id === inp.dataset.pid);
          if (t && t.statusComments && t.statusComments.length) {
            const last = t.statusComments[t.statusComments.length - 1];
            if (!last.comment) t.statusComments.pop();
          }
          _pendingCommentId = null;
          _pendingCommentText = '';
          savePlan();
          renderPlan();
        }
      });
      // Auto-focus the in-flight input, with cursor at end
      if (inp.dataset.pid === _pendingCommentId) {
        inp.focus();
        const len = inp.value.length;
        try {
          inp.setSelectionRange(len, len);
        } catch (e) {}
      }
    });

    // History expand/collapse
    qa('.plan-comment-history-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        _expandedHistoryId = _expandedHistoryId === btn.dataset.pid ? null : btn.dataset.pid;
        renderPlan();
      });
    });

    // Dismiss handoff note
    qa('.plan-handoff-dismiss').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          const notes = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
          delete notes[btn.dataset.task];
          localStorage.setItem('wl_handoff', JSON.stringify(notes));
        } catch (e) {}
        renderPlan();
      });
    });

    // Checkpoint: toggle open/closed
    qa('.cp-badge').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pid = btn.dataset.pid;
        if (_cpOpenIds.has(pid)) _cpOpenIds.delete(pid);
        else _cpOpenIds.add(pid);
        renderPlan();
        // Auto-focus add input when opening
        if (_cpOpenIds.has(pid)) {
          setTimeout(() => {
            const inp = document.querySelector(`.cp-add-input[data-pid="${pid}"]`);
            if (inp) inp.focus();
          }, 0);
        }
      });
    });

    // Checkpoint: toggle done (three-state: false → 'partial' → true → false)
    qa('.cp-check').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = planTasks.find((t) => t.id === el.dataset.pid);
        if (!t || !t.checkpoints) return;
        const idx = parseInt(el.dataset.cpidx);
        const cur = t.checkpoints[idx].done;
        t.checkpoints[idx].done = cur === false ? 'partial' : cur === 'partial' ? true : false;
        savePlan();
        renderPlan();
      });
    });

    // Checkpoint: toggle done via label click; double-click to edit
    qa('.cp-label').forEach((lbl) => {
      lbl.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = planTasks.find((t) => t.id === lbl.dataset.pid);
        if (!t || !t.checkpoints) return;
        const idx = parseInt(lbl.dataset.cpidx);
        const cur = t.checkpoints[idx].done;
        t.checkpoints[idx].done = cur === false ? 'partial' : cur === 'partial' ? true : false;
        savePlan();
        renderPlan();
      });
      lbl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        _cpEditId = lbl.dataset.pid;
        _cpEditIdx = parseInt(lbl.dataset.cpidx);
        renderPlan();
        setTimeout(() => {
          const inp = document.querySelector(
            '.cp-edit-input[data-pid="' + _cpEditId + '"][data-cpidx="' + _cpEditIdx + '"]'
          );
          if (inp) {
            inp.focus();
            inp.select();
          }
        }, 0);
      });
    });

    // Checkpoint: save/cancel inline edit
    qa('.cp-edit-input').forEach((inp) => {
      const save = () => {
        const val = inp.value.trim();
        const t = planTasks.find((t) => t.id === inp.dataset.pid);
        if (t && t.checkpoints && val) t.checkpoints[parseInt(inp.dataset.cpidx)].text = val;
        _cpEditId = null;
        _cpEditIdx = null;
        savePlan();
        renderPlan();
      };
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          save();
        }
        if (e.key === 'Escape') {
          _cpEditId = null;
          _cpEditIdx = null;
          renderPlan();
        }
      });
      inp.addEventListener('blur', save);
      inp.addEventListener('click', (e) => e.stopPropagation());
    });

    // Checkpoint: delete
    qa('.cp-del-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = planTasks.find((t) => t.id === btn.dataset.pid);
        if (!t || !t.checkpoints) return;
        t.checkpoints.splice(parseInt(btn.dataset.cpidx), 1);
        savePlan();
        renderPlan();
      });
    });

    // Checkpoint: add on Enter
    qa('.cp-add-input').forEach((inp) => {
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const val = inp.value.trim();
        if (!val) return;
        const t = planTasks.find((t) => t.id === inp.dataset.pid);
        if (!t) return;
        if (!Array.isArray(t.checkpoints)) t.checkpoints = [];
        t.checkpoints.push({
          id: 'cp' + Date.now() + Math.random().toString(36).slice(2),
          text: val,
          done: false,
        });
        savePlan();
        renderPlan();
        // Re-focus add input after render
        setTimeout(() => {
          const next = document.querySelector(`.cp-add-input[data-pid="${inp.dataset.pid}"]`);
          if (next) next.focus();
        }, 0);
      });
      inp.addEventListener('click', (e) => e.stopPropagation());
    });

    // Checkpoint: drag-to-reorder
    let _cpDragPid = null,
      _cpDragIdx = null;
    qa('.cp-row').forEach((row) => {
      row.addEventListener('dragstart', (e) => {
        _cpDragPid = row.dataset.pid;
        _cpDragIdx = parseInt(row.dataset.cpidx);
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document
          .querySelectorAll('.cp-row.cp-drag-over')
          .forEach((r) => r.classList.remove('cp-drag-over'));
        row.classList.add('cp-drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('cp-drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('cp-drag-over');
        const targetIdx = parseInt(row.dataset.cpidx);
        if (_cpDragPid !== row.dataset.pid || _cpDragIdx === null || _cpDragIdx === targetIdx)
          return;
        const t = planTasks.find((t) => t.id === _cpDragPid);
        if (!t || !t.checkpoints) return;
        const moved = t.checkpoints.splice(_cpDragIdx, 1)[0];
        t.checkpoints.splice(targetIdx, 0, moved);
        savePlan();
        renderPlan();
        _cpDragIdx = null;
        _cpDragPid = null;
      });
    });

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
        const t = planTasks.find((t) => t.id === editOk.dataset.pid);
        if (t) t.text = text;
        editingPlanId = null;
        savePlan();
        renderPlan();
      };
      editOk.addEventListener('click', saveEdit);
      const inp = document.getElementById('planEditInput');
      if (inp) {
        inp.focus();
        inp.select();
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') saveEdit();
          if (e.key === 'Escape') {
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
        const t = planTasks.find((t) => t.id === btn.dataset.pid);
        const text = btn.dataset.text;
        const tag = t ? t.tag || 'other' : selectedTag;
        if (activeTimer) stopTimer();
        const entry = {
          id: Date.now() + '',
          text,
          tag,
          ts: safeRoundedStart(),
          date: dk(new Date()),
        };
        entries.push(entry);
        if (t && t.status === 'todo') {
          t.status = 'inprogress';
          if (t.parentId) {
            const parent = planTasks.find((p) => p.id === t.parentId);
            if (parent && parent.status === 'todo') parent.status = 'inprogress';
          }
          savePlan();
          renderPlan();
        }
        viewDate = new Date();
        save();
        startTimer(entry.id);
        render();
      });
    });

    // Delete task (children become orphaned top-level tasks)
    qa('.plan-del-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        planTasks = planTasks.filter((t) => t.id !== btn.dataset.pid);
        savePlan();
        renderPlan();
      });
    });

    // Split into subtasks
    qa('.plan-split-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
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
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const text = inp.value.trim();
          if (!text) return;
          const parentId = inp.closest('.plan-split-row').dataset.parent;
          const parent = planTasks.find((t) => t.id === parentId);
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
        } else if (e.key === 'Escape') {
          splitInputId = null;
          renderPlan();
        }
      });
    });
  }

  const EMOJI_COMMON = [
    '⭐',
    '🔥',
    '✅',
    '❌',
    '⚠️',
    '💡',
    '🚀',
    '🐛',
    '🔧',
    '🔍',
    '📝',
    '📋',
    '💬',
    '📞',
    '🎯',
    '🏃',
    '⏳',
    '🔒',
    '🔑',
    '💻',
    '📊',
    '📈',
    '🌐',
    '🗂️',
    '📌',
    '🧪',
    '🎨',
    '💰',
    '🤔',
    '😅',
    '🙏',
    '👀',
    '✍️',
    '🤝',
    '🚧',
    '⚡',
    '🧩',
    '🛠️',
    '📣',
    '🎉',
    '🌱',
    '🔔',
    '🗒️',
    '⚙️',
    '🏆',
  ];

  let _emojiPickerPid = null;

  /**
   * Opens a floating emoji picker anchored below the given element.
   * Includes a free-text input for custom emoji and a grid of common choices.
   * Calling again for the same task ID closes the picker.
   * @param {string}      pid    - Plan task ID.
   * @param {HTMLElement} anchor - Element to position the picker below.
   */
  function openEmojiPicker(pid, anchor) {
    // Remove any existing picker
    const existing = document.getElementById('__emojiPicker');
    if (existing) {
      existing.remove();
      if (_emojiPickerPid === pid) {
        _emojiPickerPid = null;
        return;
      }
    }
    _emojiPickerPid = pid;
    const task = planTasks.find((t) => t.id === pid);
    if (!task) return;

    const picker = document.createElement('div');
    picker.id = '__emojiPicker';
    picker.className = 'emoji-picker';

    const input = document.createElement('input');
    input.className = 'emoji-picker-input';
    input.placeholder = 'type or paste any emoji…';
    input.value = task.emoji || '';
    picker.appendChild(input);

    const grid = document.createElement('div');
    grid.className = 'emoji-picker-grid';
    EMOJI_COMMON.forEach((em) => {
      const b = document.createElement('button');
      b.textContent = em;
      b.type = 'button';
      b.addEventListener('click', () => setTaskEmoji(pid, em));
      grid.appendChild(b);
    });
    picker.appendChild(grid);

    const clear = document.createElement('button');
    clear.className = 'emoji-picker-clear';
    clear.textContent = '✕ remove emoji';
    clear.addEventListener('click', () => setTaskEmoji(pid, null));
    picker.appendChild(clear);

    // Position below anchor
    document.body.appendChild(picker);
    const rect = anchor.getBoundingClientRect();
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    picker.style.top = rect.bottom + scrollY + 4 + 'px';
    picker.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';

    input.focus();
    input.select();
    // Confirm typed emoji on Enter
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = input.value.trim();
        setTaskEmoji(pid, val || null);
      }
      if (e.key === 'Escape') {
        picker.remove();
        _emojiPickerPid = null;
      }
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function close(ev) {
        if (!picker.contains(ev.target)) {
          picker.remove();
          _emojiPickerPid = null;
          document.removeEventListener('click', close);
        }
      });
    }, 50);
  }

  /**
   * Saves an emoji to a plan task and closes the picker.
   * Pass null or an empty string to remove the task's emoji.
   * @param {string}      pid   - Plan task ID.
   * @param {string|null} emoji - Emoji character to assign, or null to remove.
   */
  function setTaskEmoji(pid, emoji) {
    const task = planTasks.find((t) => t.id === pid);
    if (!task) return;
    if (emoji) task.emoji = emoji;
    else delete task.emoji;
    const p = document.getElementById('__emojiPicker');
    if (p) {
      p.remove();
      _emojiPickerPid = null;
    }
    savePlan();
    renderPlan();
  }

  /**
   * Reads the plan-input field and adds a new "todo" task to today's plan.
   * Inherits the currently selected tag and that category's billable default.
   * No-ops if the input is empty.
   */
  function addPlanTask() {
    const inp = document.getElementById('planInput');
    const text = inp.value.trim();
    if (!text) return;
    planTasks.push({
      id: Date.now() + '',
      text,
      status: 'todo',
      tag: selectedTag,
      date: dk(new Date()),
      billable: getCat(selectedTag).billable !== false,
    });
    inp.value = '';
    savePlan();
    renderPlan();
    inp.focus();
  }

  document.getElementById('planAddBtn').addEventListener('click', addPlanTask);
  document.getElementById('planInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addPlanTask();
  });
  document.getElementById('planHeader').addEventListener('click', () => {
    planCollapsed = !planCollapsed;
    renderPlan();
  });
  let upcomingCollapsed = false;
  document.getElementById('upcomingHeader').addEventListener('click', () => {
    upcomingCollapsed = !upcomingCollapsed;
    document.getElementById('upcomingSection').classList.toggle('collapsed', upcomingCollapsed);
  });
  document.getElementById('pendingHeader').addEventListener('click', () => {
    pendingCollapsed = !pendingCollapsed;
    renderPlan();
  });

  // ── 10b-signifiers.js ──
  // ── 10b-signifiers.js — Entry signifiers ──

  const SIG_CYCLE = ['billable', 'event', 'flagged', 'migrated', 'cancelled', 'overtime'];
  const SIG_SYMBOL = {
    billable: '●',
    event: '○',
    flagged: '★',
    migrated: '→',
    cancelled: '✗',
    overtime: '!',
  };
  const SIG_TITLE = {
    billable: 'Billable',
    event: 'Meeting / event',
    flagged: 'Flagged for review',
    migrated: 'Migrated',
    cancelled: 'Cancelled — excluded from totals',
    overtime: 'Overtime',
  };

  function sigSymbol(entry) {
    return SIG_SYMBOL[entry.signifier] || '●';
  }

  function sigTitle(entry) {
    return SIG_TITLE[entry.signifier] || 'Billable';
  }

  function cycleSignifier(entryId) {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    const cur = entry.signifier || 'billable';
    const idx = SIG_CYCLE.indexOf(cur);
    entry.signifier = SIG_CYCLE[(idx + 1) % SIG_CYCLE.length];
    save();
    render();
  }

  function sigHtml(entry) {
    return `<span class="esig sig-${entry.signifier || 'billable'}"
               data-entry-id="${escHtml(entry.id)}"
               title="${sigTitle(entry)}"
               role="button" tabindex="0"
               aria-label="Signifier: ${sigTitle(entry)}">
    ${sigSymbol(entry)}
  </span>`;
  }

  function bindSignifierClicks() {
    document.querySelectorAll('.esig').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        cycleSignifier(el.dataset.entryId);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cycleSignifier(el.dataset.entryId);
        }
      });
    });
  }

  // ── 11-timeblock.js ──
  /* ── Timeblock ── */
  /**
   * localStorage key for the time-block array.
   * @type {string}
   */
  const STORE_BLOCKS = 'wl_blocks_v1';
  // Assumption: a standard workday starts no earlier than 07:00 and ends no later
  // than 21:00. Tasks scheduled outside this window are rare enough that they do
  // not need to appear in the visual grid. If the assumption changes, update
  // TB_START / TB_END here — slots and pixel heights are derived automatically.
  const TB_START = 7; // 07:00
  const TB_END = 21; // 21:00
  const TB_SLOTS = (TB_END - TB_START) * 2; // 28 half-hour slots
  const TB_SLOT_H = 36; // px per slot

  let tbCollapsed = false;
  let tbDragSource = null; // 'grid' | 'plan'
  let tbDragId = null; // block id when dragging from grid
  let tbDragText = null; // text when dragging from plan
  let tbDragTag = null; // tag when dragging from plan
  let tbDragPid = null; // plan task id when dragging from plan
  const notifiedBlocks = new Set();

  /**
   * Loads time blocks from localStorage into `blocks`, filtering invalid entries.
   * Drops are reported via wlLog.warn so data-quality issues are visible in DevTools.
   * Applies a one-time migration to shift existing block slots by +2 when the
   * time-block grid start time changed from 08:00 to 07:00.
   */
  function loadBlocks() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_BLOCKS) || '[]');
      const all = Array.isArray(raw) ? raw : [];
      blocks = all.filter(validBlock);
      if (blocks.length < all.length)
        wlLog.warn(`loadBlocks: dropped ${all.length - blocks.length} invalid block record(s)`, {
          total: all.length,
          kept: blocks.length,
        });
    } catch (e) {
      blocks = [];
      wlLog.error('loadBlocks: failed to parse time blocks from localStorage', e);
    }
    // One-time migration: TB_START shifted from 8→7, add 2 slots to all existing blocks
    if (!localStorage.getItem('wl_tb_migrated_7')) {
      blocks = blocks.map((b) => ({ ...b, slot: b.slot + 2 }));
      saveBlocks();
      localStorage.setItem('wl_tb_migrated_7', '1');
    }
  }
  /** Persists the current `blocks` array to localStorage. */
  function saveBlocks() {
    localStorage.setItem(STORE_BLOCKS, JSON.stringify(blocks));
  }

  /**
   * Converts a 0-based half-hour slot index to an "HH:MM" label.
   * Slot 0 = `TB_START:00`, slot 2 = `TB_START+1:00`, etc.
   * @param {number} slot - 0-based slot index.
   * @returns {string} "HH:MM" formatted time string.
   */
  function slotToTime(slot) {
    const total = TB_START * 60 + slot * 30;
    return (
      String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
    );
  }
  /**
   * Converts a time value to a 0-based slot index relative to `TB_START`.
   * Accepts either an "HH:MM" string or two separate (hours, minutes) arguments.
   * @param {string|number} hhmm - "HH:MM" string, or hours when `m2` is provided.
   * @param {number}        [m2] - Minutes (only when `hhmm` is a number).
   * @returns {number} 0-based slot index.
   */
  function timeToSlot(hhmm, m2) {
    // Accept either "HH:MM" string or (hours, minutes) numbers
    const h = m2 !== undefined ? hhmm : parseInt(hhmm.split(':')[0]);
    const m = m2 !== undefined ? m2 : parseInt(hhmm.split(':')[1]);
    return (h - TB_START) * 2 + Math.round(m / 30);
  }

  /**
   * Renders the full time-block grid for the currently viewed date: time labels,
   * grid rows, planned blocks (with drag-to-move), live timer block, a "now" line,
   * and the plan-task drag targets. Also handles drag-and-drop wiring for
   * moving existing blocks and dropping tasks from the plan list.
   */
  function renderTimeblock() {
    const dateKey = dk(viewDate);
    const liveEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
    document.getElementById('tbSection').classList.toggle('collapsed', tbCollapsed);

    // Time labels
    const timesEl = document.getElementById('tbTimes');
    timesEl.innerHTML = '';
    for (let i = 0; i <= TB_SLOTS; i++) {
      const d = document.createElement('div');
      d.className = 'tb-time-lbl' + (i === TB_SLOTS ? ' end' : '');
      d.textContent = slotToTime(i);
      timesEl.appendChild(d);
    }

    // Build grid slots
    const grid = document.getElementById('tbGrid');
    grid.innerHTML = '';
    for (let i = 0; i < TB_SLOTS; i++) {
      const s = document.createElement('div');
      s.className = 'tb-slot' + (i % 2 === 1 ? ' half' : '');
      s.dataset.slot = i;
      grid.appendChild(s);
    }

    // ── Auto blocks from log entries (render first = below manual blocks) ──
    const liveId = activeTimer ? activeTimer.entryId : null;
    const tbStart = TB_START * 60,
      tbEnd = TB_END * 60;

    function minsFromTs(ts) {
      const d = new Date(ts);
      return d.getHours() * 60 + d.getMinutes();
    }
    function autoBlockEl(text, tag, startTs, endTs, isLive) {
      const cat = getCat(tag || 'other');
      const startMins = minsFromTs(startTs);
      const endMins = minsFromTs(endTs);
      if (startMins >= tbEnd || endMins <= tbStart) return null;
      const cStart = Math.max(startMins, tbStart);
      const cEnd = Math.min(endMins, tbEnd);
      const topPx = ((cStart - tbStart) / 30) * TB_SLOT_H;
      const hPx = Math.max(TB_SLOT_H * 0.5, ((cEnd - cStart) / 30) * TB_SLOT_H);
      const dur = Math.round((endTs - startTs) / 60000);
      const h = Math.floor(dur / 60),
        m = dur % 60;
      const durStr = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
      const el = document.createElement('div');
      el.className = 'tb-block auto' + (isLive ? ' live' : '');
      if (isLive) el.id = 'tb-live-block';
      el.style.top = topPx + 'px';
      el.style.height = hPx + 'px';
      el.style.background = cat.color + '28';
      el.style.borderLeftColor = cat.color;
      el.style.color = cat.color;
      const icon = isLive ? '▶ ' : '● ';
      el.innerHTML =
        `<div class="tb-block-name">${icon}${escHtml(text)}</div>` +
        `<div class="tb-block-sub" id="${isLive ? 'tb-live-sub' : ''}">${escHtml(cat.label)} · ${durStr}</div>`;
      return el;
    }

    const meetingNames = new Set(
      blocks
        .filter((b) => b.date === dateKey && b.type === 'meeting')
        .map((b) => b.text.toLowerCase())
    );

    // Merge same-task entries with < 30 min gap into a single visual block
    function mergeAutoEntries(rawEntries) {
      const sorted = [...rawEntries].sort((a, b) => a.ts - b.ts);
      const merged = [];
      for (const e of sorted) {
        const prev = merged[merged.length - 1];
        const prevEnd = prev ? prev._mergedEnd || prev.ts : 0;
        if (
          prev &&
          prev.text.toLowerCase() === e.text.toLowerCase() &&
          e.ts - prevEnd <= 30 * 60 * 1000
        ) {
          prev._mergedEnd = Math.max(prevEnd, e.tsEnd || e.ts);
          prev.tag = prev.tag || e.tag;
        } else {
          merged.push({ ...e, _mergedEnd: e.tsEnd || e.ts });
        }
      }
      return merged;
    }

    const dayAutoEntries = entries.filter(
      (e) =>
        e.date === dateKey &&
        e.id !== liveId &&
        !meetingNames.has(e.text.replace(/^📅\s*/, '').toLowerCase()) &&
        !meetingNames.has(e.text.toLowerCase()) &&
        (e.tsEnd || isToday(viewDate))
    );
    mergeAutoEntries(dayAutoEntries).forEach((e) => {
      const endTs = e._mergedEnd || (isToday(viewDate) ? Date.now() : null);
      if (!endTs) return;
      const el = autoBlockEl(e.text, e.tag, e.ts, endTs, false);
      if (el) grid.appendChild(el);
    });

    // Live timer block — skip if the active timer is a meeting block (it will pulse instead)
    if (liveId) {
      const le = entries.find((e) => e.id === liveId);
      const isMeetingBlock =
        le &&
        blocks.some(
          (b) =>
            b.date === dateKey &&
            b.type === 'meeting' &&
            b.text.toLowerCase() === le.text.toLowerCase()
        );
      if (le && le.date === dateKey && !isMeetingBlock) {
        const fakeEnd = activeTimer.paused
          ? le.ts + (activeTimer.accumulatedMs || 0) // paused: stop at pause point
          : Math.max(Date.now(), le.ts + 60000); // running: extend to now
        const el = autoBlockEl(le.text, le.tag, le.ts, fakeEnd, true);
        if (el) grid.appendChild(el);
      }
    }

    // ── Manual planned blocks (render last = on top, dashed border) ──
    const dayBlocks = blocks.filter((b) => b.date === dateKey);
    const tbLiveEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
    dayBlocks.forEach((b) => {
      const cat = getCat(b.tag || 'other');
      const el = document.createElement('div');
      const isDone = planTasks.some(
        (t) =>
          t.date === dateKey && t.text.toLowerCase() === b.text.toLowerCase() && t.status === 'done'
      );
      const cleanLiveText = tbLiveEntry ? tbLiveEntry.text.replace(/^📅\s*/, '').toLowerCase() : '';
      const isMeetingBlock =
        tbLiveEntry &&
        b.type === 'meeting' &&
        (b.text.toLowerCase() === cleanLiveText ||
          b.text.toLowerCase() === tbLiveEntry.text.toLowerCase());
      el.className =
        'tb-block plan' + (isDone ? ' task-done' : '') + (isMeetingBlock ? ' live' : '');
      el.dataset.bid = b.id;
      el.draggable = true;
      el.style.top = b.slot * TB_SLOT_H + 1 + 'px';
      el.style.height = b.duration * TB_SLOT_H - 3 + 'px';
      el.style.background = cat.color + '18';
      el.style.borderLeftColor = cat.color;
      el.style.color = cat.color;

      const icon = b.type === 'meeting' ? '📅 ' : '';
      const emojiPrefix = b.emoji ? escHtml(b.emoji) + ' ' : '';
      const dur = b.duration * 30;
      const h = Math.floor(dur / 60),
        m = dur % 60;
      const durStr = h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
      el.innerHTML =
        `<div class="tb-block-name">${emojiPrefix}${icon}${escHtml(b.text)}</div>` +
        (b.duration > 1
          ? `<div class="tb-block-sub">${escHtml(cat.label)} · ${durStr}</div>`
          : '') +
        (b.type !== 'meeting'
          ? `<button class="tb-block-start" data-bid="${b.id}" draggable="false">▶ start</button>`
          : '') +
        `<button class="tb-block-emoji${b.emoji ? ' has-emoji' : ''}" data-bid="${b.id}" title="add emoji" draggable="false">${b.emoji ? escHtml(b.emoji) : '✦'}</button>` +
        `<button class="tb-block-del" data-bid="${b.id}" draggable="false">&times;</button>`;

      el.addEventListener('dragstart', (e) => {
        tbDragSource = 'grid';
        tbDragId = b.id;
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        tbDragSource = null;
        tbDragId = null;
      });
      el.querySelector('.tb-block-del').addEventListener('click', (ev) => {
        ev.stopPropagation();
        blocks = blocks.filter((bl) => bl.id !== b.id);
        saveBlocks();
        renderTimeblock();
      });
      const startBtn = el.querySelector('.tb-block-start');
      if (startBtn)
        startBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          tbStartBlock(b.id);
        });
      el.querySelector('.tb-block-emoji').addEventListener('click', (ev) => {
        ev.stopPropagation();
        openBlockEmojiPicker(b.id, ev.currentTarget);
      });
      grid.appendChild(el);
    });

    // Untracked time — show faint label on past slots with no coverage
    if (isToday(viewDate) || !isToday(viewDate)) {
      // show on any viewed date
      const nowMins = isToday(viewDate)
        ? new Date().getHours() * 60 + new Date().getMinutes()
        : TB_END * 60; // for past days, all slots are "past"

      // Use start-of-day as floor — slots before work started aren't "untracked"
      const sodTs = isToday(viewDate) ? getDayStart() : null;
      const sodMins = sodTs
        ? new Date(sodTs).getHours() * 60 + new Date(sodTs).getMinutes()
        : TB_START * 60; // no start set — use grid start as default

      // Build a set of 30-min slots that have coverage (from entries or planned blocks)
      const coveredSlots = new Set();
      entries
        .filter((e) => e.date === dateKey && e.tsEnd)
        .forEach((e) => {
          const startSlot = timeToSlot(new Date(e.ts).getHours(), new Date(e.ts).getMinutes());
          // If tsEnd is exactly on a 30-min boundary (e.g. 09:30:00), back off 1 minute
          // so we don't accidentally mark the NEXT slot as covered
          const endD = new Date(e.tsEnd);
          const onBoundary = endD.getMinutes() % 30 === 0 && endD.getSeconds() === 0;
          // timeToSlot uses Math.round(m/30), so backing off 1 min (→29) still rounds to slot+1.
          // Instead compute endSlot directly: if on a boundary, the entry ends AT that boundary,
          // meaning the boundary's slot is NOT covered — use the slot before it.
          const endSlot = onBoundary
            ? timeToSlot(endD.getHours(), endD.getMinutes()) - 1
            : timeToSlot(endD.getHours(), endD.getMinutes());
          for (let s = Math.max(0, startSlot); s < Math.min(TB_SLOTS, endSlot + 1); s++)
            coveredSlots.add(s);
        });
      if (activeTimer && liveEntry && liveEntry.date === dateKey) {
        const startSlot = timeToSlot(
          new Date(liveEntry.ts).getHours(),
          new Date(liveEntry.ts).getMinutes()
        );
        if (activeTimer.paused) {
          // Paused: only cover slots up to the pause point
          const pauseEnd = new Date(liveEntry.ts + (activeTimer.accumulatedMs || 0));
          const endSlot = timeToSlot(pauseEnd.getHours(), pauseEnd.getMinutes());
          for (let s = Math.max(0, startSlot); s < Math.min(TB_SLOTS, endSlot + 1); s++)
            coveredSlots.add(s);
        } else {
          for (let s = Math.max(0, startSlot); s < TB_SLOTS; s++) coveredSlots.add(s);
        }
      }
      blocks
        .filter((b) => b.date === dateKey)
        .forEach((b) => {
          for (let s = b.slot; s < Math.min(TB_SLOTS, b.slot + b.duration); s++)
            coveredSlots.add(s);
        });

      for (let slot = 0; slot < TB_SLOTS; slot++) {
        const slotStartMins = TB_START * 60 + slot * 30;
        if (slotStartMins < sodMins) continue; // before work started — not untracked
        const isPast = slotStartMins < nowMins; // slot has started (not necessarily fully elapsed)
        if (!isPast || coveredSlots.has(slot)) continue;
        const untracked = document.createElement('div');
        untracked.className = 'tb-untracked';
        untracked.style.top = slot * TB_SLOT_H + 1 + 'px';
        untracked.style.height = TB_SLOT_H - 2 + 'px';
        untracked.textContent = 'untracked';
        grid.appendChild(untracked);
      }
    }

    // Current time indicator (today only)
    if (isToday(viewDate)) {
      const nowLine = document.createElement('div');
      nowLine.className = 'tb-now-line';
      nowLine.id = 'tbNowLine';
      grid.appendChild(nowLine);
      positionNowLine();
    }

    // Grid-level drag/drop (works even when blocks overlap slots)
    grid._dragSlot = 0;
    grid.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = grid.getBoundingClientRect();
      const slot = Math.max(
        0,
        Math.min(TB_SLOTS - 1, Math.floor((e.clientY - rect.top) / TB_SLOT_H))
      );
      grid.querySelectorAll('.tb-slot.drag-over').forEach((s) => s.classList.remove('drag-over'));
      const slotEl = grid.querySelector(`[data-slot="${slot}"]`);
      if (slotEl) slotEl.classList.add('drag-over');
      grid._dragSlot = slot;
    });
    grid.addEventListener('dragleave', (e) => {
      if (!grid.contains(e.relatedTarget))
        grid.querySelectorAll('.tb-slot.drag-over').forEach((s) => s.classList.remove('drag-over'));
    });
    grid.addEventListener('drop', (e) => {
      e.preventDefault();
      grid.querySelectorAll('.tb-slot.drag-over').forEach((s) => s.classList.remove('drag-over'));
      const target = grid._dragSlot;

      if (tbDragSource === 'grid' && tbDragId) {
        const b = blocks.find((bl) => bl.id === tbDragId);
        if (b) {
          const newSlot = Math.min(target, TB_SLOTS - b.duration);
          const newStart = TB_START * 60 + newSlot * 30;
          const newEnd = newStart + b.duration * 30;
          const hits = tbOverlaps(newStart, newEnd, dateKey, b.id);
          if (hits.length && !confirm(`This overlaps with ${hits}.\n\nMove here anyway?`)) {
            tbDragSource = null;
            tbDragId = null;
            return;
          }
          b.slot = newSlot;
          saveBlocks();
          renderTimeblock();
        }
      }
      tbDragSource = null;
      tbDragId = null;
      tbDragText = null;
      tbDragTag = null;
    });
  }

  /**
   * Returns a comma-separated string of task names that overlap a proposed time
   * range, checking both planned blocks and logged time entries. Returns an
   * empty string if there are no overlaps.
   * @param {number} newStartMins - Proposed start time in minutes from midnight.
   * @param {number} newEndMins   - Proposed end time in minutes from midnight.
   * @param {string} dateKey      - Date string in YYYY-MM-DD format.
   * @param {string} [excludeId]  - Block ID to exclude from the check (when moving).
   * @returns {string} Overlapping task names, or '' if none.
   */
  function tbOverlaps(newStartMins, newEndMins, dateKey, excludeId) {
    const hits = [];
    // Check against manual planned blocks
    blocks
      .filter((b) => b.date === dateKey && b.id !== excludeId)
      .forEach((b) => {
        const s = TB_START * 60 + b.slot * 30,
          e = s + b.duration * 30;
        if (newStartMins < e && newEndMins > s) hits.push(b.text);
      });
    // Check against completed log entries
    entries
      .filter((e) => e.date === dateKey && e.tsEnd && e.tsEnd > e.ts)
      .forEach((e) => {
        const s = new Date(e.ts).getHours() * 60 + new Date(e.ts).getMinutes();
        const en = new Date(e.tsEnd).getHours() * 60 + new Date(e.tsEnd).getMinutes();
        if (newStartMins < en && newEndMins > s) hits.push(e.text);
      });
    // Deduplicate and format
    const unique = [...new Set(hits)];
    if (!unique.length) return '';
    return unique.map((t) => `"${t}"`).join(', ');
  }

  // Meeting form removed — no event listeners needed
  document.getElementById('tbHeader').addEventListener('click', () => {
    tbCollapsed = !tbCollapsed;
    renderTimeblock();
  });

  /**
   * Opens a floating emoji picker anchored below `anchor` for a time block.
   * Identical behaviour to `openEmojiPicker` but operates on `blocks` instead
   * of `planTasks`. Calling again for the same block ID closes the picker.
   * @param {string}      bid    - Block ID.
   * @param {HTMLElement} anchor - Element to position the picker below.
   */
  function openBlockEmojiPicker(bid, anchor) {
    const existing = document.getElementById('__emojiPicker');
    if (existing) {
      existing.remove();
      if (_emojiPickerPid === bid) {
        _emojiPickerPid = null;
        return;
      }
    }
    _emojiPickerPid = bid;
    const block = blocks.find((b) => b.id === bid);
    if (!block) return;

    const picker = document.createElement('div');
    picker.id = '__emojiPicker';
    picker.className = 'emoji-picker';

    const input = document.createElement('input');
    input.className = 'emoji-picker-input';
    input.placeholder = 'type or paste any emoji…';
    input.value = block.emoji || '';
    picker.appendChild(input);

    const grid = document.createElement('div');
    grid.className = 'emoji-picker-grid';
    EMOJI_COMMON.forEach((em) => {
      const b = document.createElement('button');
      b.textContent = em;
      b.type = 'button';
      b.addEventListener('click', () => setBlockEmoji(bid, em));
      grid.appendChild(b);
    });
    picker.appendChild(grid);

    const clear = document.createElement('button');
    clear.className = 'emoji-picker-clear';
    clear.textContent = '✕ remove emoji';
    clear.addEventListener('click', () => setBlockEmoji(bid, null));
    picker.appendChild(clear);

    document.body.appendChild(picker);
    const rect = anchor.getBoundingClientRect();
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    picker.style.top = rect.bottom + scrollY + 4 + 'px';
    picker.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';

    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = input.value.trim();
        setBlockEmoji(bid, v || null);
      }
      if (e.key === 'Escape') {
        picker.remove();
        _emojiPickerPid = null;
      }
    });
    setTimeout(() => {
      document.addEventListener('click', function close(ev) {
        if (!picker.contains(ev.target)) {
          picker.remove();
          _emojiPickerPid = null;
          document.removeEventListener('click', close);
        }
      });
    }, 50);
  }

  /**
   * Saves an emoji to a time block and closes the picker.
   * Pass null or an empty string to remove the block's emoji.
   * @param {string}      bid   - Block ID.
   * @param {string|null} emoji - Emoji character to assign, or null to remove.
   */
  function setBlockEmoji(bid, emoji) {
    const block = blocks.find((b) => b.id === bid);
    if (!block) return;
    if (emoji) block.emoji = emoji;
    else delete block.emoji;
    const p = document.getElementById('__emojiPicker');
    if (p) {
      p.remove();
      _emojiPickerPid = null;
    }
    saveBlocks();
    renderTimeblock();
  }

  /**
   * Checks all of today's time blocks and acts on ones that have just become active:
   * - Meeting blocks: auto-starts a log entry and timer at the scheduled start time.
   * - Task blocks: prompts the user to switch/start within a 3-minute window.
   * Each block is only acted on once (tracked in `notifiedBlocks`).
   * No-ops when not viewing today.
   */
  function checkBlockNotifications() {
    if (!isToday(viewDate)) return;
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const todayKey = dk(new Date());

    const pending = blocks.filter((b) => b.date === todayKey && !notifiedBlocks.has(b.id));

    for (const b of pending) {
      const startMins = TB_START * 60 + b.slot * 30;
      const endMins = startMins + b.duration * 30;

      if (b.type === 'meeting') {
        // Auto-start if currently in progress (started but not ended yet)
        if (nowMins >= startMins && nowMins < endMins) {
          notifiedBlocks.add(b.id);
          // Skip if already logged or timer already running for this meeting
          const alreadyLogged = entries.some(
            (e) => e.date === todayKey && e.text.toLowerCase() === b.text.toLowerCase() && !e.tsEnd // only count open entries — not pre-created completed ones
          );
          const curEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
          const alreadyActive = curEntry && curEntry.text.toLowerCase() === b.text.toLowerCase();
          if (!alreadyLogged && !alreadyActive) {
            // Use the meeting's scheduled start time, not now
            const d = new Date();
            const scheduledTs = new Date(
              d.getFullYear(),
              d.getMonth(),
              d.getDate(),
              Math.floor((TB_START * 60 + b.slot * 30) / 60),
              (TB_START * 60 + b.slot * 30) % 60,
              0
            ).getTime();
            tbStartBlock(b.id, scheduledTs);
          }
        }
      } else {
        // Task blocks — prompt within 3-minute window after start
        if (nowMins < startMins || nowMins >= startMins + 3) continue;
        notifiedBlocks.add(b.id);
        if (activeTimer) {
          const cur = entries.find((e) => e.id === activeTimer.entryId);
          const curName = cur ? cur.text : 'current task';
          const sw = confirm(`⏰ Time for: "${b.text}"\n\nSwitch from "${curName}"?`);
          if (sw) {
            tbStartBlock(b.id);
          } else {
            blocks = blocks.filter((bl) => bl.id !== b.id);
            saveBlocks();
            renderTimeblock();
          }
        } else {
          const go = confirm(`⏰ Time for: "${b.text}"\n\nStart timer?`);
          if (go) {
            tbStartBlock(b.id);
          } else {
            blocks = blocks.filter((bl) => bl.id !== b.id);
            saveBlocks();
            renderTimeblock();
          }
        }
        break;
      }
    }
  }

  /**
   * Positions the "now" indicator line in the time-block grid to reflect the
   * current time. Hides the line when outside the grid's time range
   * (`TB_START`–`TB_END`).
   */
  function positionNowLine() {
    const el = document.getElementById('tbNowLine');
    if (!el) return;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const tbStartMins = TB_START * 60,
      tbEndMins = TB_END * 60;
    if (mins < tbStartMins || mins > tbEndMins) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.top = ((mins - tbStartMins) / 30) * TB_SLOT_H + 'px';
  }

  /**
   * Starts a timer for the given time block: creates (or promotes) the matching
   * plan task to "in progress", stops any running timer, creates a new log entry,
   * and starts the tick interval. Uses `overrideTs` as the entry start time so
   * elapsed time is counted from the scheduled start, not wall-clock now.
   * @param {string} blockId       - ID of the time block to start.
   * @param {number} [overrideTs]  - Optional explicit start timestamp (ms). Defaults to `safeRoundedStart()`.
   */
  function tbStartBlock(blockId, overrideTs) {
    const b = blocks.find((bl) => bl.id === blockId);
    if (!b) return;
    const todayKey = dk(new Date());
    let task = planTasks.find(
      (t) => t.date === todayKey && t.text.toLowerCase() === b.text.toLowerCase()
    );
    if (!task) {
      task = {
        id: Date.now() + '',
        text: b.text,
        status: 'inprogress',
        tag: b.tag || 'other',
        date: todayKey,
      };
      planTasks.push(task);
    } else if (task.status !== 'done') {
      task.status = 'inprogress';
    }
    savePlan();
    if (activeTimer) stopTimer();
    const ts = overrideTs || safeRoundedStart();
    const entry = {
      id: Date.now() + 1 + '',
      text: b.text,
      tag: b.tag || 'other',
      ts,
      date: todayKey,
    };
    entries.push(entry);
    // Set timer startTs so elapsed = time since scheduled start, not since now
    viewDate = new Date();
    save();
    activeTimer = { entryId: entry.id, startTs: ts, accumulatedMs: 0, paused: false };
    save();
    tickTimer();
    timerInterval = setInterval(tickTimer, 1000);
    updateTimerBar();
    updateTimerBtn(true);
    render();
  }

  /**
   * Applies data migrations and status patches to today's plan tasks after
   * carry-over:
   * - Stamps `billable: true` on tasks/categories that predate the feature.
   * - Stamps `completedAt` on done tasks missing a timestamp.
   * - Promotes today's task status to match the most recent past version when
   *   that version was pending/blocked/upcoming or in-progress.
   */
  function patchCarriedTasks() {
    const todayKey = dk(new Date());
    const todayTasks = planTasks.filter((t) => t.date === todayKey);
    const pastTasks = planTasks.filter((t) => t.date < todayKey);

    // Migration: stamp billable on tasks and categories that predate the feature.
    // Assumption: the app was originally developed for billable contract work, so
    // any task or category without an explicit flag is assumed billable to avoid
    // retroactively understating tracked hours.
    planTasks.forEach((t) => {
      if (t.billable === undefined) t.billable = true;
    });
    categories.forEach((c) => {
      if (c.billable === undefined) c.billable = true;
    });

    // Migration: stamp completedAt on any done task missing it
    let changed = false;
    planTasks.forEach((t) => {
      if (t.status === 'done' && !t.completedAt) {
        t.completedAt = new Date((t.date || todayKey) + 'T00:00:00').getTime();
        changed = true;
      }
    });

    if (!todayTasks.length || !pastTasks.length) {
      if (changed) savePlan();
      return;
    }

    todayTasks.forEach((todayTask) => {
      const prev = pastTasks
        .filter((t) => t.text.toLowerCase() === todayTask.text.toLowerCase())
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (!prev) return;

      // If the most recent past version was pending/blocked, carry that status forward
      // regardless of what intermediate copies were (fixes: marked upcoming on Friday
      // but Saturday/Sunday copies were already todo)
      if (
        (prev.status === 'pending' || prev.status === 'blocked' || prev.status === 'upcoming') &&
        (todayTask.status === 'todo' || todayTask.status === 'inprogress')
      ) {
        todayTask.status = prev.status;
        if (prev.statusComments && prev.statusComments.length && !todayTask.statusComments) {
          todayTask.statusComments = prev.statusComments.map((c) => ({ ...c }));
        }
        changed = true;
      }

      // Only promote todo→inprogress if the most recent past version was inprogress
      if (todayTask.status === 'todo' && prev.status === 'inprogress') {
        todayTask.status = 'inprogress';
        changed = true;
      }
    });

    if (changed) savePlan();
  }

  /**
   * Carries unfinished plan tasks from past days into today — runs once per day
   * (guarded by a localStorage flag). Deduplicates by text, preserving the most
   * recent past status and status-comment history. Checkpoints are carried forward
   * with `done` reset to false for a fresh day.
   * @returns {number|undefined} Number of tasks newly carried, or undefined if
   *   carry has already run today.
   */
  function autoCarryTasks() {
    const todayKey = dk(new Date());
    const carryKey = 'wl_carried_' + todayKey;
    if (localStorage.getItem(carryKey)) return;
    // 'upcoming' tasks are intentionally scheduled for a future date by the user
    // and should never be auto-carried — they will appear naturally on their target date.
    // 'done' tasks are complete and need no carry.
    const unfinished = planTasks.filter(
      (t) => t.date < todayKey && t.status !== 'done' && t.status !== 'upcoming'
    );
    if (!unfinished.length) {
      localStorage.setItem(carryKey, '1');
      return;
    }

    // Deduplicate by text — keep only the MOST RECENT past version of each task.
    // Without this, an older 'inprogress' copy could be carried instead of a newer 'pending' one.
    const latestByText = {};
    unfinished.forEach((t) => {
      const key = t.text.toLowerCase();
      if (!latestByText[key] || t.date > latestByText[key].date) {
        latestByText[key] = t;
      }
    });
    const toCarry = Object.values(latestByText);

    // First pass: create new tasks, build old-id → new-id map
    const idMap = {};
    let carried = 0;
    toCarry.forEach((t) => {
      const exists = planTasks.some(
        (e) => e.date === todayKey && e.text.toLowerCase() === t.text.toLowerCase()
      );
      if (!exists) {
        const newId = 'c' + Date.now() + Math.random().toString(36).slice(2);
        idMap[t.id] = newId;
        planTasks.push({
          id: newId,
          text: t.text,
          tag: t.tag,
          status: t.status, // preserve inprogress/todo/pending/blocked
          ...(t.statusComments && t.statusComments.length
            ? { statusComments: t.statusComments.map((c) => ({ ...c })) }
            : {}),
          // Carry checkpoints forward — reset done state for a fresh day
          ...(t.checkpoints && t.checkpoints.length
            ? { checkpoints: t.checkpoints.map((c) => ({ ...c, done: false })) }
            : {}),
          date: todayKey,
        });
        carried++;
      }
    });

    if (carried > 0) savePlan();
    localStorage.setItem(carryKey, '1');
    return carried;
  }

  let completedCollapsed = false;

  // ── Iteration expiry dates (stored in localStorage, seeded on first load) ──
  const STORE_EXPIRY = 'wl_expiry_dates';
  const EXPIRY_SEED = [
    // PI 26-1
    '2026-01-31',
    '2026-02-14',
    '2026-02-28',
    '2026-03-14',
    '2026-03-28',
    // PI 26-2
    '2026-04-11',
    '2026-04-25',
    '2026-05-09',
    '2026-05-23',
    '2026-06-06',
    // PI 26-3
    '2026-06-20',
    '2026-07-04',
    '2026-07-18',
    '2026-08-01',
    '2026-08-15',
    '2026-08-29',
    // PI 26-4
    '2026-09-12',
    '2026-09-26',
    '2026-10-10',
    '2026-10-24',
    '2026-11-07',
    // PI 26-5
    '2026-11-21',
    '2026-12-05',
    '2026-12-19',
    '2027-01-02',
    '2027-01-16',
  ];

  let _expiryDates = null; // cached; invalidated when user saves changes

  /**
   * Loads iteration expiry dates from localStorage into `_expiryDates`.
   * Seeds localStorage with `EXPIRY_SEED` on first run.
   */
  function loadExpiryDates() {
    try {
      const raw = localStorage.getItem(STORE_EXPIRY);
      if (raw) {
        _expiryDates = JSON.parse(raw)
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
          .sort();
        return;
      }
    } catch (e) {}
    // Seed localStorage with defaults on first load
    _expiryDates = [...EXPIRY_SEED];
    localStorage.setItem(STORE_EXPIRY, JSON.stringify(_expiryDates));
  }

  /**
   * Returns the first iteration expiry date that is strictly later than
   * `completedDay`, or null if none is configured beyond that date.
   * @param {string} completedDay - Completion date in "YYYY-MM-DD" format.
   * @returns {string|null} The next expiry date, or null.
   */
  function getIterationExpiry(completedDay) {
    if (!_expiryDates) loadExpiryDates();
    return _expiryDates.find((d) => d > completedDay) || null;
  }

  /**
   * Opens the iteration-expiry editor modal, pre-filling the textarea with the
   * current expiry dates (one per line).
   */
  function openExpiryModal() {
    if (!_expiryDates) loadExpiryDates();
    document.getElementById('expiryTextarea').value = _expiryDates.join('\n');
    document.getElementById('expiryFeedback').textContent = '';
    document.getElementById('expiryOverlay').classList.add('show');
    document.getElementById('expiryTextarea').focus();
  }

  /**
   * Reads the expiry-date textarea, validates each line against YYYY-MM-DD format,
   * deduplicates and sorts the valid dates, persists them to localStorage, and closes
   * the modal. Invalid lines are surfaced in the feedback element but not saved.
   */
  function saveExpiryDates() {
    const raw = document.getElementById('expiryTextarea').value;
    const dates = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l));
    const invalid = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^\d{4}-\d{2}-\d{2}$/.test(l));
    if (invalid.length) {
      const fb = document.getElementById('expiryFeedback');
      fb.style.color = '#f17070';
      fb.textContent = `Invalid lines (ignored): ${invalid.join(', ')}`;
    }
    _expiryDates = [...new Set(dates)].sort();
    localStorage.setItem(STORE_EXPIRY, JSON.stringify(_expiryDates));
    document.getElementById('expiryOverlay').classList.remove('show');
    renderCompleted();
  }

  /**
   * Renders the completed-tasks section for the currently viewed date.
   * Shows tasks that were completed on or before the view date and whose
   * iteration expiry date has not yet passed. Deduplicates by task text,
   * keeping only the most recently completed version. Hides the section when
   * there are no matching tasks.
   */
  function renderCompleted() {
    const viewKey = dk(viewDate);
    const viewTs = new Date(viewKey + 'T12:00:00').getTime();
    // Tasks that are actively inprogress/todo on the current view date
    const activeTodayTexts = new Set(
      planTasks
        .filter((t) => t.date === viewKey && t.status !== 'done')
        .map((t) => t.text.toLowerCase())
    );
    const done = planTasks
      .filter((t) => {
        if (t.status !== 'done') return false;
        // Don't show completed tasks that have a live version on this date
        if (activeTodayTexts.has(t.text.toLowerCase())) return false;
        const completedTs = t.completedAt || new Date((t.date || viewKey) + 'T23:59:00').getTime();
        const completedDay = dk(new Date(completedTs));
        const expiryDay = getIterationExpiry(completedDay);
        // Show from completion day until (but not including) the iteration expiry date.
        // If beyond last known iteration, keep visible indefinitely.
        if (!expiryDay) return viewKey >= completedDay;
        return viewKey >= completedDay && viewKey < expiryDay;
      })
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

    // Deduplicate by text — keep only the most recently completed version of each task
    const seen = new Set();
    const deduped = done.filter((t) => {
      const key = t.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const sec = document.getElementById('completedSection');
    sec.style.display = deduped.length ? '' : 'none';
    if (!deduped.length) {
      // Clear stale items from prior renders so DOM matches the data
      document.getElementById('completedBody').innerHTML = '';
      document.getElementById('completedCount').textContent = '0';
      return;
    }

    document.getElementById('completedCount').textContent = deduped.length;
    sec.classList.toggle('collapsed', completedCollapsed);

    document.getElementById('completedBody').innerHTML = deduped
      .map((t) => {
        const cat = getCat(t.tag || 'other');
        let whenStr = 'date unknown';
        if (t.completedAt) {
          const d = new Date(t.completedAt);
          const mo = d.toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' });
          const hh = d.getHours(),
            mm = d.getMinutes();
          const isSentinel = (hh === 0 && mm === 0) || (hh === 23 && mm === 59);
          whenStr = isSentinel
            ? `completed ${mo}`
            : `completed ${mo} at ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        } else if (t.date) {
          const d = new Date(t.date + 'T12:00:00');
          whenStr = `completed ${d.toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}`;
        }
        return `<div class="completed-item">
        <span class="plan-status done-st" style="pointer-events:none;flex-shrink:0;font-size:10px;padding:1px 7px">Done</span>
        <span class="completed-dot" style="background:${cat.color}"></span>
        <span class="completed-text">${t.emoji ? escHtml(t.emoji) + ' ' : ''}${jiraTicketHtml(t.text)}</span>
        <span class="completed-when">${whenStr}</span>
      </div>`;
      })
      .join('');
  }

  document.getElementById('completedHeader').addEventListener('click', () => {
    completedCollapsed = !completedCollapsed;
    renderCompleted();
  });
  // Delegated bill-btn handler — covers plan, pending, completed sections
  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest('.bill-btn');
      if (!btn) return;
      e.stopPropagation();
      if (btn.dataset.pid) {
        const t = planTasks.find((t) => t.id === btn.dataset.pid);
        if (!t) return;
        t.billable = t.billable === false ? true : false;
        savePlan();
        renderPlan();
        renderCompleted();
      } else if (btn.dataset.etext) {
        // Log entry — save billable directly on the entry, and sync to matching planTasks
        const entry = entries.find((e) => e.id === btn.dataset.eid);
        if (!entry) return;
        const newBill =
          entry.billable === false || entry.billable === undefined
            ? !(getCat(entry.tag || 'other').billable !== false)
            : false;
        // Determine toggle: if currently billable → make non-billable, and vice versa
        const curBill =
          entry.billable !== undefined
            ? entry.billable
            : getCat(entry.tag || 'other').billable !== false;
        entry.billable = !curBill;
        // Also update matching planTasks so plan rows stay in sync
        const key = entry.text.toLowerCase().trim();
        planTasks
          .filter((t) => t.text.toLowerCase().trim() === key)
          .forEach((t) => (t.billable = entry.billable));
        save();
        savePlan();
        render();
      }
    },
    true
  );

  // Delegated prio-btn handler — cycles priority normal → high → low → normal
  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest('.prio-btn');
      if (!btn || !btn.dataset.pid) return;
      e.stopPropagation();
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      if (!t) return;
      const cur = t.priority || 0;
      const next = cur === 0 ? 1 : cur === 1 ? -1 : 0;
      if (next === 0) delete t.priority;
      else t.priority = next;
      savePlan();
      renderPlan();
    },
    true
  );

  // ── 12-misc.js ──
  /* ── Distraction tracking ── */
  const STORE_DISTRACTIONS = 'wl_distractions_v1';
  function loadDistractions() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_DISTRACTIONS) || '[]');
      return Array.isArray(raw) ? raw.filter((d) => d && typeof d.ts === 'number') : [];
    } catch (e) {
      return [];
    }
  }
  function saveDistraction(note) {
    const entry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
    const d = {
      ts: Date.now(),
      date: dk(new Date()),
      task: entry ? entry.text : null,
      note: note || null,
    };
    const all = loadDistractions();
    all.push(d);
    localStorage.setItem(STORE_DISTRACTIONS, JSON.stringify(all));
    renderDistractionCount();
  }
  function renderDistractionCount() {
    const el = document.getElementById('distractionSection');
    if (!el) return;
    const today = dk(new Date());
    const all = loadDistractions().filter((d) => d.date === today);
    if (!all.length) {
      el.innerHTML = '';
      return;
    }
    const rows = all
      .map((d) => {
        const t = new Date(d.ts);
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        const task = d.task
          ? `<span style="color:var(--text3);font-size:11px"> — ${escHtml(d.task)}</span>`
          : '';
        const note = d.note ? `<span style="color:var(--text2)"> "${escHtml(d.note)}"</span>` : '';
        return `<div style="font-size:12px;padding:3px 0;border-bottom:0.5px solid var(--border)">${hh}:${mm}${task}${note}</div>`;
      })
      .join('');
    el.innerHTML = `
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:6px">
        😵 ${all.length} distraction${all.length === 1 ? '' : 's'} today
      </div>
      ${rows}`;
  }

  document.getElementById('timerDistract').addEventListener('click', () => {
    // Pause the timer if running
    if (activeTimer && !activeTimer.paused) pauseTimer();
    // Optional note — short prompt, easily dismissable
    const note = prompt('What pulled you away? (optional — press Enter to skip)');
    if (note === null) {
      // Cancelled — resume timer without logging
      if (activeTimer && activeTimer.paused) pauseTimer();
      return;
    }
    saveDistraction(note.trim() || null);
    // Timer stays paused — user resumes manually
    renderDistractionCount();
  });

  /* ── Parked thoughts ── */
  const STORE_PARKED = 'wl_parked_v1';
  let parkedThoughts = [];

  function saveParked() {
    localStorage.setItem(STORE_PARKED, JSON.stringify(parkedThoughts));
  }
  function loadParked() {
    try {
      parkedThoughts = JSON.parse(localStorage.getItem(STORE_PARKED) || '[]');
    } catch (e) {
      parkedThoughts = [];
    }
  }
  function renderParked() {
    const open = parkedThoughts.filter((p) => !p.done);
    const section = document.getElementById('parkSection');
    const list = document.getElementById('parkList');
    const badge = document.getElementById('parkBadge');
    if (!section || !list) return;
    if (open.length === 0) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';
    if (badge) badge.textContent = open.length;
    list.innerHTML = open
      .map(
        (p) => `
      <div class="parked-item" data-id="${p.id}">
        <div class="parked-item-text">
          ${escHtml(p.text)}
          ${p.fromTask ? `<span class="parked-from">while working on: ${escHtml(p.fromTask)}</span>` : ''}
        </div>
        <button class="parked-promote" data-id="${p.id}">→ task</button>
        <button class="parked-dismiss" data-id="${p.id}" title="dismiss">✓</button>
      </div>`
      )
      .join('');
    list.querySelectorAll('.parked-promote').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = parkedThoughts.find((x) => x.id === btn.dataset.id);
        if (!p) return;
        const todayKey = dk(new Date());
        planTasks.push({
          id: Date.now() + '',
          text: p.text,
          status: 'todo',
          date: todayKey,
          tag: selectedTag,
        });
        savePlan();
        p.done = true;
        saveParked();
        renderParked();
        renderPlan();
      });
    });
    list.querySelectorAll('.parked-dismiss').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = parkedThoughts.find((x) => x.id === btn.dataset.id);
        if (p) {
          p.done = true;
          saveParked();
          renderParked();
        }
      });
    });
  }

  // Park button in timer bar
  (() => {
    const btn = document.getElementById('timerParkBtn');
    const inp = document.getElementById('parkCapture');
    if (!btn || !inp) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const showing = inp.classList.contains('show');
      inp.classList.toggle('show', !showing);
      btn.classList.toggle('active', !showing);
      if (!showing) {
        inp.focus();
      } else {
        inp.value = '';
      }
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = inp.value.trim();
        if (!text) {
          inp.classList.remove('show');
          btn.classList.remove('active');
          return;
        }
        const liveEntry = activeTimer ? entries.find((en) => en.id === activeTimer.entryId) : null;
        parkedThoughts.push({
          id: Date.now() + '',
          text,
          ts: Date.now(),
          fromTask: liveEntry ? liveEntry.text : null,
          done: false,
        });
        saveParked();
        renderParked();
        inp.value = '';
        inp.classList.remove('show');
        btn.classList.remove('active');
      } else if (e.key === 'Escape') {
        inp.value = '';
        inp.classList.remove('show');
        btn.classList.remove('active');
      }
    });
  })();

  /* ── IDKW (I don't know what to do) ── */
  (() => {
    const btn = document.getElementById('idkwBtn');
    if (!btn) return;
    let idkwTimer = null;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const todayKey = dk(new Date());
      const candidates = planTasks.filter(
        (t) => t.date === todayKey && t.status === 'todo' && !t.parentId
      );
      if (!candidates.length) return;
      document
        .querySelectorAll('.idkw-highlight')
        .forEach((el) => el.classList.remove('idkw-highlight'));
      clearTimeout(idkwTimer);
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      const row = document.querySelector(`.plan-row[data-id="${pick.id}"]`);
      if (row) {
        row.classList.add('idkw-highlight');
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        idkwTimer = setTimeout(() => row.classList.remove('idkw-highlight'), 8000);
      }
    });
  })();

  /* ── Make-it-interesting hook (Feature 1) ── */
  const STORE_HOOKS = 'wl_hooks';
  function getHook(taskText) {
    try {
      const map = JSON.parse(localStorage.getItem(STORE_HOOKS) || '{}');
      return map[taskText.toLowerCase()] || null;
    } catch (e) {
      return null;
    }
  }
  function saveHook(taskText, hook) {
    try {
      const map = JSON.parse(localStorage.getItem(STORE_HOOKS) || '{}');
      if (hook === null) {
        delete map[taskText.toLowerCase()];
      } else {
        map[taskText.toLowerCase()] = hook;
      }
      localStorage.setItem(STORE_HOOKS, JSON.stringify(map));
    } catch (e) {}
  }

  (() => {
    const btn = document.getElementById('timerHookBtn');
    const panel = document.getElementById('timerHookPanel');
    const content = document.getElementById('timerHookContent');
    const closeBtn = document.getElementById('timerHookClose');
    if (!btn || !panel || !content || !closeBtn) return;

    function getPromptForTask(taskText) {
      return `Task: "${taskText}"

Provide two short, actionable suggestions to make this task more engaging.

Requirements:
- No preamble, no headers, no numbering, no markdown formatting
- Plain text only
- First suggestion: a genuine curiosity angle or interesting adjacent perspective
- Second suggestion: a way to add time pressure or stakes without real consequences
- Each suggestion: 1-2 sentences max
- Separate them with a blank line`;
    }

    function closePanel() {
      panel.style.display = 'none';
    }
    function showHook(hookText) {
      content.textContent = hookText;
      panel.style.display = 'block';
    }
    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).catch((e) => console.warn('Clipboard failed:', e));
    }

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!activeTimer) return;
      const entry = entries.find((en) => en.id === activeTimer.entryId);
      if (!entry) return;
      const taskText = entry.text.trim();
      const cached = getHook(taskText);
      if (cached) {
        showHook(cached);
        return;
      }

      content.textContent = 'thinking...';
      panel.style.display = 'block';
      try {
        const response = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 600,
            system:
              'You help ADHD users make boring tasks engaging. Provide brief, practical suggestions with no numbering, labels, or preamble. Format: suggestion 1 on first line, blank line, suggestion 2 on third line. Plain text only, no markdown.',
            messages: [{ role: 'user', content: getPromptForTask(taskText) }],
          }),
        });
        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const data = await response.json();
        const hookText = data.content?.[0]?.text || '';
        if (!hookText) throw new Error('No content in response');
        saveHook(taskText, hookText);
        showHook(hookText);
      } catch (err) {
        copyToClipboard(getPromptForTask(taskText));
        content.textContent =
          'AI unavailable — prompt copied to clipboard. (Set AnthropicApiKey in config.local.ps1)';
        panel.style.display = 'block';
      }
    });

    closeBtn.addEventListener('click', closePanel);

    const regenBtn = document.getElementById('timerHookRegen');
    if (regenBtn) {
      regenBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!activeTimer) return;
        const entry = entries.find((en) => en.id === activeTimer.entryId);
        if (!entry) return;
        saveHook(entry.text.trim(), null);
        btn.click();
      });
    }
  })();

  /* ── Accessibility utilities ── */

  // Make a div[role="button"] respond to Enter/Space like a real button.
  function a11yHeaderKeydown(el) {
    if (!el) return;
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  }

  // Wire keyboard nav to all collapsible section headers that have role="button".
  // planHeader is excluded: it contains a nested <button> (idkwBtn), so the outer
  // div must not also carry role="button" or keyboard events would be ambiguous.
  [
    'calHeader',
    'upcomingHeader',
    'pendingHeader',
    'completedHeader',
    'jiraHeader',
    'notionLinksHeader',
    'tbHeader',
  ].forEach((id) => {
    a11yHeaderKeydown(document.getElementById(id));
  });

  // Sync aria-expanded on toggling section headers.
  // Each section header's click listener was set up in other modules; we patch
  // aria-expanded by observing classList changes on the section wrappers.
  // planHeader is excluded: it has no widget role (it contains a nested <button>
  // so role="button" would be invalid), and aria-expanded is not allowed on a
  // generic div — see also the keyboard-nav exclusion note above.
  (function syncAriaExpanded() {
    const pairs = [
      { sectionId: 'calSection', headerId: 'calHeader' },
      { sectionId: 'upcomingSection', headerId: 'upcomingHeader' },
      { sectionId: 'pendingSection', headerId: 'pendingHeader' },
      { sectionId: 'completedSection', headerId: 'completedHeader' },
      { sectionId: 'jiraSection', headerId: 'jiraHeader' },
      { sectionId: 'notionLinksSection', headerId: 'notionLinksHeader' },
      { sectionId: 'tbSection', headerId: 'tbHeader' },
    ];
    pairs.forEach(({ sectionId, headerId }) => {
      const section = document.getElementById(sectionId);
      const header = document.getElementById(headerId);
      if (!section || !header) return;
      // Set initial value from class list
      header.setAttribute('aria-expanded', String(!section.classList.contains('collapsed')));
      // Observe future class mutations
      new MutationObserver(() => {
        header.setAttribute('aria-expanded', String(!section.classList.contains('collapsed')));
      }).observe(section, { attributes: true, attributeFilter: ['class'] });
    });
  })();

  // Focus management for modal dialogs.
  // Saves the element that had focus when a modal opens, restores it on close.
  (function modalFocusManagement() {
    let _eodTrigger = null;
    let _expiryTrigger = null;

    // EOD modal
    const eodBtn = document.getElementById('eodBtn');
    const eodClose = document.getElementById('eodClose');
    const eodOverlay = document.getElementById('eodOverlay');

    if (eodBtn && eodOverlay) {
      eodBtn.addEventListener('click', () => {
        _eodTrigger = document.activeElement;
        setTimeout(() => {
          const first = eodOverlay.querySelector('button, [tabindex]:not([tabindex="-1"])');
          if (first) first.focus();
        }, 50);
      });

      function restoreEodFocus() {
        if (_eodTrigger) {
          _eodTrigger.focus();
          _eodTrigger = null;
        }
      }
      if (eodClose) eodClose.addEventListener('click', restoreEodFocus);
      eodOverlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          eodOverlay.classList.remove('show');
          restoreEodFocus();
        }
      });
    }

    // Expiry modal
    const expiryBtn = document.getElementById('expiryBtn');
    const expiryCancel = document.getElementById('expiryCancel');
    const expirySave = document.getElementById('expirySave');
    const expiryOverlay = document.getElementById('expiryOverlay');

    if (expiryBtn && expiryOverlay) {
      expiryBtn.addEventListener('click', () => {
        _expiryTrigger = document.activeElement;
      });

      function restoreExpiryFocus() {
        if (_expiryTrigger) {
          _expiryTrigger.focus();
          _expiryTrigger = null;
        }
      }
      if (expiryCancel) expiryCancel.addEventListener('click', restoreExpiryFocus);
      if (expirySave) expirySave.addEventListener('click', restoreExpiryFocus);
    }
  })();

  // ── 12a-changelog.js ──
  /* ── Dev changelog ── */
  const STORE_DEV_LOG = 'wl_dev_log';
  const TEST_AREA_NAMES = {
    1: 'Page load',
    2: 'roundToNearest30',
    3: 'localStorage round-trip',
    4: 'Timer display',
    5: 'Timer persistence',
    6: 'completedAt',
    7: 'Auto-carry',
    8: 'Sort order',
    9: 'Plan count header',
    10: 'Week number',
    11: 'Billable tracking',
    12: 'Export format',
    13: 'Timeline rendering',
  };

  // Updated each session by Claude — id format: YYYYMMDD-NNN
  const DEV_CHANGES = [
    {
      id: '20260506-001',
      date: '2026-05-06',
      desc: 'Two-box header layout with week/moon/nameday',
      areas: [1],
    },
    { id: '20260506-002', date: '2026-05-06', desc: 'Week number (ISO) in header', areas: [10] },
    {
      id: '20260506-003',
      date: '2026-05-06',
      desc: 'Sunrise/sunset/day length from Open-Meteo',
      areas: [1, 3],
    },
    {
      id: '20260506-004',
      date: '2026-05-06',
      desc: 'Moon phase calculation and zodiac sign',
      areas: [1],
    },
    {
      id: '20260506-005',
      date: '2026-05-06',
      desc: 'Finnish nameday from nimipaivat.fi',
      areas: [1],
    },
    {
      id: '20260506-006',
      date: '2026-05-06',
      desc: 'Completed tasks section with 14-day rolling window',
      areas: [6, 9],
    },
    {
      id: '20260506-007',
      date: '2026-05-06',
      desc: 'Child task auto-promotes parent to In Progress',
      areas: [7, 8],
    },
    {
      id: '20260506-008',
      date: '2026-05-06',
      desc: 'Plan count header format: X to do · X in progress · X done',
      areas: [9],
    },
    {
      id: '20260506-009',
      date: '2026-05-06',
      desc: 'Critical fix: load() restored to startup sequence',
      areas: [1, 3, 4, 5, 7],
    },
    {
      id: '20260506-010',
      date: '2026-05-06',
      desc: 'save() guard against overwriting data with empty arrays',
      areas: [3],
    },
    {
      id: '20260506-011',
      date: '2026-05-06',
      desc: 'Timer restoration protected against load failures',
      areas: [5],
    },
    {
      id: '20260506-012',
      date: '2026-05-06',
      desc: 'completedAt uses roundToNearest30; 23:59 shown as date-only',
      areas: [6],
    },
    {
      id: '20260506-013',
      date: '2026-05-06',
      desc: 'Rain forecast starts from next hour (no past times)',
      areas: [1],
    },
    { id: '20260506-014', date: '2026-05-06', desc: 'Pomodoro ring empties clockwise', areas: [1] },
    { id: '20260506-015', date: '2026-05-06', desc: 'Pomodoro session log added', areas: [1] },
    {
      id: '20260506-016',
      date: '2026-05-06',
      desc: 'Smoke test suite (38 tests) added',
      areas: [],
    },
    {
      id: '20260506-017',
      date: '2026-05-06',
      desc: 'End-of-day modal with dev changelog',
      areas: [],
    },
    {
      id: '20260508-001',
      date: '2026-05-08',
      desc: 'Focus mode: Pomodoro now visible alongside emergency task',
      areas: [1],
    },
    {
      id: '20260508-002',
      date: '2026-05-08',
      desc: 'safeRoundedStart() prevents rounded entry times overlapping previous tsEnd',
      areas: [2, 3, 4, 5],
    },
    {
      id: '20260508-003',
      date: '2026-05-08',
      desc: 'statToday counts unique task names, not raw entry count',
      areas: [9],
    },
    {
      id: '20260508-004',
      date: '2026-05-08',
      desc: 'Timeblock expanded to 07:00–21:00 with one-time slot migration',
      areas: [1],
    },
    {
      id: '20260508-005',
      date: '2026-05-08',
      desc: 'Plan task statuses: Pending and Blocked added',
      areas: [7, 8, 9],
    },
    {
      id: '20260508-006',
      date: '2026-05-08',
      desc: 'Pending/Blocked tasks show editable comment with timestamp history',
      areas: [7, 8],
    },
    {
      id: '20260508-007',
      date: '2026-05-08',
      desc: 'Auto-complete parent task when all children marked done',
      areas: [7, 8],
    },
    {
      id: '20260508-008',
      date: '2026-05-08',
      desc: 'Auto-stop timer when active task is marked done in task list',
      areas: [4, 5, 7],
    },
    {
      id: '20260508-009',
      date: '2026-05-08',
      desc: 'Export .txt includes day started, ended, and total workday length',
      areas: [1],
    },
    {
      id: '20260508-010',
      date: '2026-05-08',
      desc: 'File System Access API: exports saved to timesheets/ and JSON backups/ subfolders',
      areas: [1],
    },
    {
      id: '20260513-001',
      date: '2026-05-13',
      desc: 'Quick pick: remove button to hide tasks from recent list',
      areas: [],
    },
    {
      id: '20260513-002',
      date: '2026-05-13',
      desc: 'Quick pick: restore hidden items button; hidden list persists in localStorage',
      areas: [],
    },
    {
      id: '20260513-003',
      date: '2026-05-13',
      desc: 'Inline entry editing: click entry text to edit in place',
      areas: [3],
    },
    {
      id: '20260513-004',
      date: '2026-05-13',
      desc: 'Timelog header added above entry list',
      areas: [],
    },
    {
      id: '20260513-005',
      date: '2026-05-13',
      desc: 'Chart label column widened from 120px to 200px',
      areas: [],
    },
    {
      id: '20260515-001',
      date: '2026-05-15',
      desc: 'Restore "Today\'s name day:" prefix in nameday display (API and fallback)',
      areas: [1],
    },
    {
      id: '20260515-002',
      date: '2026-05-15',
      desc: 'Restore SVG Finnish flag + "Next flag day:" prefix in calendar event display',
      areas: [1],
    },
    {
      id: '20260515-003',
      date: '2026-05-15',
      desc: 'Use full month name (e.g. June 4) in next flag day display',
      areas: [1],
    },
    {
      id: '20260515-004',
      date: '2026-05-15',
      desc: 'Fix streakDays sub-stat to start from yesterday (consistent with calcStreak)',
      areas: [],
    },
    {
      id: '20260515-005',
      date: '2026-05-15',
      desc: 'Add nimipaivarajapinta.fi to CSP connect-src',
      areas: [1],
    },
    {
      id: '20260515-006',
      date: '2026-05-15',
      desc: 'Calendar events: SVG Finnish flag for flag days, 📅 for holidays/notable days, no text prefix',
      areas: [1],
    },
    {
      id: '20260515-007',
      date: '2026-05-15',
      desc: 'Nameday: Finnish names plain, Swedish names smaller/dimmed with sv: label',
      areas: [1],
    },
    {
      id: '20260515-008',
      date: '2026-05-15',
      desc: 'Calendar events: add "Upcoming:" prefix for non-today events',
      areas: [1],
    },
    {
      id: '20260515-009',
      date: '2026-05-15',
      desc: 'Re-add parked thoughts feature (💭 in timer bar, park section, → task / ✓ dismiss)',
      areas: [],
    },
    {
      id: '20260515-010',
      date: '2026-05-15',
      desc: 'Re-add IDKW 🎲 button in plan header — picks random todo task',
      areas: [],
    },
    {
      id: '20260515-011',
      date: '2026-05-15',
      desc: 'Add ⊕ split button on tasks — creates child subtasks with parentId',
      areas: [],
    },
    {
      id: '20260515-012',
      date: '2026-05-15',
      desc: 'Child tasks render indented under parent, sorted grouped',
      areas: [],
    },
    {
      id: '20260515-013',
      date: '2026-05-15',
      desc: 'Park capture auto-closes when timer stops',
      areas: [],
    },
    {
      id: '20260515-014',
      date: '2026-05-15',
      desc: 'Jira ticket links: PROJ-XXXXX prefix becomes clickable link to the configured Jira instance',
      areas: [],
    },
    {
      id: '20260515-015',
      date: '2026-05-15',
      desc: "M365 calendar: ICS feed shows today's meetings in header strip with time, duration, Teams join link",
      areas: [],
    },
    {
      id: '20260518-001',
      date: '2026-05-18',
      desc: 'Calendar: read from all Outlook accounts (GetDefaultFolder + folder tree walk)',
      areas: [],
    },
    {
      id: '20260518-002',
      date: '2026-05-18',
      desc: "Calendar: TODAY'S MEETINGS section header, collapsible, matches plan-section style",
      areas: [],
    },
    {
      id: '20260518-003',
      date: '2026-05-18',
      desc: 'Calendar: past meetings grey/italic, ongoing meeting pulses blue, stops when meeting ends',
      areas: [],
    },
    {
      id: '20260518-004',
      date: '2026-05-18',
      desc: 'Calendar: configurable account labels shown per meeting (see CAL_ACCOUNT_LABELS in 00-config.js)',
      areas: [],
    },
    {
      id: '20260518-005',
      date: '2026-05-18',
      desc: "Calendar: ▶ start button adds meeting to today's plan and starts timer",
      areas: [],
    },
    {
      id: '20260518-006',
      date: '2026-05-18',
      desc: "Calendar section moved above today's tasks",
      areas: [],
    },
    {
      id: '20260518-007',
      date: '2026-05-18',
      desc: 'Nameday: Swedish flag SVG replaces emoji (reliable on all Windows fonts)',
      areas: [1],
    },
    {
      id: '20260518-008',
      date: '2026-05-18',
      desc: "Flag days: add Kaatuneitten muistopäivä (3rd Sun May), Eino Leino, Miina Sillanpää, Swedish Heritage Day, Children's Rights Day, Finnish Nature Day",
      areas: [1],
    },
    {
      id: '20260518-009',
      date: '2026-05-18',
      desc: 'Nameday + calendar API proxied through local server to bypass CORS (works on any port)',
      areas: [],
    },
    {
      id: '20260518-010',
      date: '2026-05-18',
      desc: 'CSP: allow any localhost port and 127.0.0.1 for server flexibility',
      areas: [],
    },
    {
      id: '20260518-011',
      date: '2026-05-18',
      desc: 'Timesheets folder removed from git tracking, added to .gitignore (stays local only)',
      areas: [],
    },
    {
      id: '20260518-012',
      date: '2026-05-18',
      desc: "Fix carry-over: pending/blocked status from most recent past version propagates to today's copy",
      areas: [],
    },
    {
      id: '20260518-013',
      date: '2026-05-18',
      desc: 'Re-implement upcoming status and 🔜 Upcoming Tasks section (lost in force push)',
      areas: [],
    },
    {
      id: '20260518-014',
      date: '2026-05-18',
      desc: 'Calendar: ✕ delete button on each meeting hides it for the day (persists in localStorage)',
      areas: [],
    },
    {
      id: '20260518-015',
      date: '2026-05-18',
      desc: 'Fix: timer input fields now have bright white text on dark background for readability',
      areas: [1],
    },
    {
      id: '20260518-016',
      date: '2026-05-18',
      desc: 'EOD modal: notes-for-tomorrow section with per-task handoff inputs; note shown inline in plan rows next morning',
      areas: [],
    },
    {
      id: '20260519-001',
      date: '2026-05-19',
      desc: 'Task checkpoints: inline step list with progress bar, tick-off, delete, drag-to-reorder; carried forward (reset) on day rollover',
      areas: [],
    },
    {
      id: '20260519-008',
      date: '2026-05-19',
      desc: 'Focus mode: checkpoints shown for active task, pomodoro fixed top-right, tagRow/timeline/calSection hidden',
      areas: [],
    },
    {
      id: '20260520-005',
      date: '2026-05-20',
      desc: 'Billable emoji shown in time log entries; clickable to toggle matching plan task',
      areas: [3, 11],
    },
    {
      id: '20260520-001',
      date: '2026-05-20',
      desc: 'Billable/non-billable: 💰/💸 toggle on all task rows + category default; retroactive update on category change; new tasks default billable',
      areas: [3, 11],
    },
    {
      id: '20260520-002',
      date: '2026-05-20',
      desc: 'Export: billable/non-billable totals in header; pasteable summary line grouped by category at end of .txt',
      areas: [11, 12],
    },
    {
      id: '20260520-003',
      date: '2026-05-20',
      desc: 'Quick-pick: tasks past iteration boundary hidden automatically',
      areas: [3],
    },
    {
      id: '20260520-004',
      date: '2026-05-20',
      desc: 'Timeline + export: consecutive same-task blocks with <30min gap merged into single block',
      areas: [4, 8, 12, 13],
    },
    {
      id: '20260521-001',
      date: '2026-05-21',
      desc: 'Notion integration: 📋 button on each task — sends to Notion second brain as child page under matching project (auto-matched by epic). Uses Claude API + Notion MCP; Anthropic key stored in localStorage',
      areas: [3],
    },
    {
      id: '20260521-002',
      date: '2026-05-21',
      desc: 'Fix: scheduled smoke tests not running (require() broke when package.json got "type":"module"); renamed smoke-tests.js → .cjs',
      areas: [],
    },
    {
      id: '20260521-003',
      date: '2026-05-21',
      desc: 'Fix: paused timers were silently discarded on reload (validTimer rejected startTs:null); now accepts paused timers with accumulatedMs',
      areas: [3, 5],
    },
    {
      id: '20260521-004',
      date: '2026-05-21',
      desc: 'Fix: export "Ended:" line ignored active timer; now factors in running/paused timer\'s effective end',
      areas: [12],
    },
    {
      id: '20260521-005',
      date: '2026-05-21',
      desc: 'Fix: completed section left stale .completed-item DOM nodes when filtered empty (caused phantom items on date change)',
      areas: [6],
    },
    {
      id: '20260521-006',
      date: '2026-05-21',
      desc: 'Focus mode: checkpoints for active task auto-expand after exit',
      areas: [],
    },
    {
      id: '20260521-007',
      date: '2026-05-21',
      desc: "Calendar: tasks started from today's meetings always default to the meeting category (not the currently-selected tag)",
      areas: [],
    },
    {
      id: '20260521-008',
      date: '2026-05-21',
      desc: 'EOD: clicking 🌙 end-the-day auto-deploys the portable build (rebuilds + copies to the saved destination) via PS server /api/portable-deploy. Fire-and-forget — never blocks the modal',
      areas: [],
    },
    {
      id: '20260521-009',
      date: '2026-05-21',
      desc: 'Time-by-task chart: active timer\'s row updates live — synthetic tsEnd treats running timer as ending "now" (paused: ts+accumulated). Auto-refreshes every 15 min while a timer runs. Live row has pulsing dot + bar',
      areas: [4, 13],
    },
    {
      id: '20260521-010',
      date: '2026-05-21',
      desc: 'Task row: billable 💰/💸 button moved from end of line to between status dropdown and task name (more discoverable, less visual clutter at the action-button cluster)',
      areas: [11],
    },
    {
      id: '20260521-011',
      date: '2026-05-21',
      desc: 'EOD: portable deploy moved from modal-open to "Done — close" button so JSON + .txt have time to flush to OneDrive before the build script reads them. Status shown via top-right toast',
      areas: [],
    },
    {
      id: '20260519-011',
      date: '2026-05-19',
      desc: 'Calendar meetings sorted by start time (not by calendar source)',
      areas: [],
    },
    {
      id: '20260519-010',
      date: '2026-05-19',
      desc: "Moved parked thoughts section between today's meetings and today's tasks",
      areas: [],
    },
    {
      id: '20260519-009',
      date: '2026-05-19',
      desc: 'EOD handoff notes: only show tasks actually worked on today',
      areas: [],
    },
    {
      id: '20260519-007',
      date: '2026-05-19',
      desc: 'Checkpoint steps: double-click label to edit inline; Enter/blur saves, Escape cancels',
      areas: [],
    },
    {
      id: '20260519-006',
      date: '2026-05-19',
      desc: 'Fix: checkpoint badge status color only applied when checkpoints exist (0/N); + steps badge stays gray',
      areas: [],
    },
    {
      id: '20260519-005',
      date: '2026-05-19',
      desc: 'Fix: checkpoint badge color mirrors task status (amber for in-progress, purple for pending, red for blocked) until progress begins',
      areas: [],
    },
    {
      id: '20260519-004',
      date: '2026-05-19',
      desc: 'Iteration expiry dates moved to localStorage (wl_expiry_dates); seeded from EXPIRY_SEED on first load; editable via 📅 iterations button',
      areas: [6],
    },
    {
      id: '20260519-003',
      date: '2026-05-19',
      desc: 'Completed tasks expire at iteration boundaries instead of a 14-day rolling window',
      areas: [6],
    },
    {
      id: '20260519-002',
      date: '2026-05-19',
      desc: 'Smoke tests: fix test 24 streak assertion, fix test 25 cal-delete-btn via renderCalStrip injection, add tests 32–34 (checkpoints, handoff notes, parked thoughts)',
      areas: [],
    },
    {
      id: '20260513-006',
      date: '2026-05-13',
      desc: 'Jira CSV importer: drag and drop Jira export to load issues',
      areas: [],
    },
    {
      id: '20260513-007',
      date: '2026-05-13',
      desc: 'Jira CSV importer: category mapping, select/deselect tasks, duplicate detection',
      areas: [7, 9],
    },
    {
      id: '20260513-008',
      date: '2026-05-13',
      desc: 'Plan section headers restyled: smaller, uppercase, icon prefixes',
      areas: [],
    },
    {
      id: '20260513-009',
      date: '2026-05-13',
      desc: 'Pending/Blocked: dedicated tinted section with amber/red accent',
      areas: [7, 8],
    },
    {
      id: '20260513-010',
      date: '2026-05-13',
      desc: 'Pending/Blocked: status comment history with timestamps and expand toggle',
      areas: [7, 8],
    },
    {
      id: '20260513-011',
      date: '2026-05-13',
      desc: 'Timeblock: emoji picker added to slots',
      areas: [],
    },
    {
      id: '20260513-012',
      date: '2026-05-13',
      desc: 'Timeblock: meeting form removed, block editing simplified',
      areas: [],
    },
    {
      id: '20260513-013',
      date: '2026-05-13',
      desc: 'Day start and end times tracked and shown in exports',
      areas: [1],
    },
    {
      id: '20260513-014',
      date: '2026-05-13',
      desc: 'Fix: streak counter now shows correct days at start of day',
      areas: [1, 24],
    },
    {
      id: '20260513-015',
      date: '2026-05-13',
      desc: 'Nameday API: switch from HTML scraping to official Nimipäivärajapinta API',
      areas: [1],
    },
    {
      id: '20260513-016',
      date: '2026-05-13',
      desc: 'Calendar integration: flag days, notable days, and holidays via official API',
      areas: [1],
    },
  ];

  /**
   * Merges the hardcoded {@link DEV_CHANGES} array into the persisted dev log in
   * localStorage, adding only entries whose `id` is not already stored.
   * Maintains chronological sort order by `id`.
   */
  function mergeDevLog() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORE_DEV_LOG) || '[]');
      const storedIds = new Set(stored.map((e) => e.id));
      const newEntries = DEV_CHANGES.filter((e) => !storedIds.has(e.id));
      if (newEntries.length) {
        const merged = [...stored, ...newEntries].sort((a, b) => a.id.localeCompare(b.id));
        localStorage.setItem(STORE_DEV_LOG, JSON.stringify(merged));
      }
    } catch (e) {}
  }

  /**
   * Opens the end-of-day modal: auto-exports the time log and JSON backup, saves
   * the EOD timestamp, populates handoff notes for unfinished tasks, renders today's
   * dev changelog entries, and lists the test areas to review.
   */
  function openEodModal() {
    const todayKey = dk(new Date());
    const d = new Date();
    const dateStr = d.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });

    // Auto-export
    exportTxt();
    exportBackup();
    localStorage.setItem('wl_last_export', todayKey);
    // Save EOD timestamp
    if (!getEodTs()) localStorage.setItem(eodKey(), String(Date.now()));
    renderEodBtn();
    // Note: portable deploy is triggered by the "Done — close" button, NOT here,
    // so the JSON + .txt have time to flush to disk before the build script reads them.
    document.getElementById('eodExportStatus').innerHTML =
      `<div class="eod-exported">✅ Time log (.txt) and backup (.json) exported automatically</div>`;

    document.getElementById('eodSubtitle').textContent = dateStr;

    // Notes for tomorrow — only tasks that were actually worked on today
    const workedToday = new Set(
      entries.filter((e) => e.date === todayKey).map((e) => e.text.toLowerCase().trim())
    );
    const unfinishedTasks = planTasks.filter(
      (t) =>
        t.date === todayKey && t.status !== 'done' && workedToday.has(t.text.toLowerCase().trim())
    );
    let handoffNotes = {};
    try {
      handoffNotes = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
    } catch (e) {}
    const taskNotesEl = document.getElementById('eodTaskNotes');
    if (unfinishedTasks.length) {
      const statusLabel = {
        todo: 'to do',
        inprogress: 'in progress',
        pending: 'pending',
        blocked: 'blocked',
      };
      taskNotesEl.innerHTML = unfinishedTasks
        .map(
          (t) =>
            `<div class="eod-task-note-row">
          <span class="eod-task-note-label" title="${escHtml(t.text)}">${t.emoji ? escHtml(t.emoji) + ' ' : ''}${escHtml(t.text)}</span>
          <span class="eod-task-note-status ${t.status || 'todo'}">${statusLabel[t.status || 'todo'] || t.status}</span>
          <input class="eod-task-note-input" data-task="${escHtml(t.text.toLowerCase().trim())}"
            value="${escHtml(handoffNotes[t.text.toLowerCase().trim()] || '')}"
            placeholder="where to continue…" />
        </div>`
        )
        .join('');
    } else {
      taskNotesEl.innerHTML = `<div class="eod-empty">no tasks worked on today — or all done 🎉</div>`;
    }

    // Today's dev changes
    let allLog = [];
    try {
      allLog = JSON.parse(localStorage.getItem(STORE_DEV_LOG) || '[]');
    } catch (e) {}
    const todayChanges = allLog.filter((e) => e.date === todayKey);
    const changesEl = document.getElementById('eodChanges');
    if (todayChanges.length) {
      changesEl.innerHTML = todayChanges
        .map(
          (e) =>
            `<div class="eod-change">
          <span class="eod-change-desc">${escHtml(e.desc)}</span>
          <span class="eod-change-areas">${e.areas.length ? 'Test ' + e.areas.join(', ') : '—'}</span>
        </div>`
        )
        .join('');
    } else {
      changesEl.innerHTML = `<div class="eod-empty">No code changes logged today</div>`;
    }

    // Affected test areas (deduplicated)
    const affectedAreas = [...new Set(todayChanges.flatMap((e) => e.areas))].sort((a, b) => a - b);
    const areasEl = document.getElementById('eodTestAreas');
    if (affectedAreas.length) {
      areasEl.innerHTML = affectedAreas
        .map(
          (n) =>
            `<div class="eod-test-area">
          <span class="eod-test-num">#${n}</span>
          <span>${escHtml(TEST_AREA_NAMES[n] || 'Unknown')}</span>
        </div>`
        )
        .join('');
    } else {
      areasEl.innerHTML = `<div class="eod-empty">No test areas flagged for review</div>`;
    }

    // Copy to clipboard
    document.getElementById('eodCopyBtn').onclick = () => {
      const lines = [
        `End of day: ${dateStr}`,
        '',
        'Changes implemented:',
        ...todayChanges.map(
          (e) => `  - ${e.desc}${e.areas.length ? ' (Test ' + e.areas.join(', ') + ')' : ''}`
        ),
        '',
        'Test areas to review:',
        ...affectedAreas.map((n) => `  - Test ${n}: ${TEST_AREA_NAMES[n]}`),
      ];
      navigator.clipboard.writeText(lines.join('\n')).then(() => {
        const btn = document.getElementById('eodCopyBtn');
        btn.textContent = '✅ Copied!';
        setTimeout(() => (btn.textContent = '📋 copy to clipboard'), 2000);
      });
    };

    document.getElementById('eodOverlay').classList.add('show');
  }

  document.getElementById('eodBtn').addEventListener('click', () => {
    const ready = confirm(
      '📎 Before closing the day:\n\n' +
        "Have you shared work-log.html with Claude to log today's changes?\n\n" +
        'OK — yes, changes are logged, continue\n' +
        'Cancel — not yet, go back'
    );
    if (ready) openEodModal();
  });
  /**
   * Reads all handoff-note inputs in the EOD modal and persists their values to
   * the `wl_handoff` localStorage key. Empty values are removed from the map.
   */
  function saveEodHandoffNotes() {
    try {
      const notes = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
      document.querySelectorAll('.eod-task-note-input').forEach((inp) => {
        const key = inp.dataset.task;
        const val = inp.value.trim();
        if (val) notes[key] = val;
        else delete notes[key];
      });
      localStorage.setItem('wl_handoff', JSON.stringify(notes));
    } catch (e) {}
  }
  document.getElementById('expiryBtn').addEventListener('click', openExpiryModal);
  document.getElementById('expirySave').addEventListener('click', saveExpiryDates);
  document.getElementById('expiryCancel').addEventListener('click', () => {
    document.getElementById('expiryOverlay').classList.remove('show');
  });
  document.getElementById('expiryOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('expiryOverlay'))
      document.getElementById('expiryOverlay').classList.remove('show');
  });
  document.getElementById('expiryTextarea').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.stopPropagation();
    } // allow newlines
    if (e.key === 'Escape') document.getElementById('expiryOverlay').classList.remove('show');
  });

  document.getElementById('eodClose').addEventListener('click', () => {
    saveEodHandoffNotes();
    // Trigger portable deploy now — the export ran when the modal opened, so the
    // file system has had a few seconds to flush JSON + .txt to OneDrive before
    // the build script reads them.
    triggerPortableDeploy();
    document.getElementById('eodOverlay').classList.remove('show');
    renderPlan();
  });

  /**
   * Fire-and-forget portable deploy: calls `POST /api/portable-deploy` to trigger
   * the PowerShell build script, then displays a transient top-right toast with the
   * result (success, failure, or server unreachable). Never throws.
   */
  function triggerPortableDeploy() {
    const toast = document.createElement('div');
    toast.className = 'wl-toast wl-toast-info';
    toast.textContent = '⏳ Deploying portable build…';
    document.body.appendChild(toast);

    const setToast = (cls, text, lifetimeMs = 5000) => {
      toast.className = 'wl-toast ' + cls;
      toast.textContent = text;
      setTimeout(() => toast.remove(), lifetimeMs);
    };

    (async () => {
      let res;
      try {
        res = await fetch('/api/portable-deploy', { method: 'POST' });
      } catch (err) {
        setToast('wl-toast-err', '⚠ Portable deploy skipped: PS server unreachable');
        return;
      }
      const bodyText = await res.text().catch(() => '');
      let data = null;
      if (bodyText) {
        try {
          data = JSON.parse(bodyText);
        } catch {}
      }

      if (res.status === 404) {
        setToast(
          'wl-toast-err',
          '⚠ Portable deploy unavailable: restart PS server (.\\launch.bat) to pick up updated start-server.ps1'
        );
        return;
      }
      if (res.status === 503) {
        setToast('wl-toast-err', '⚠ Portable deploy skipped: PS server not running');
        return;
      }
      if (res.ok && data && data.ok) {
        const s = (data.durationMs / 1000).toFixed(1);
        setToast('wl-toast-ok', `📦 Portable deployed in ${s}s`, 4000);
        return;
      }
      const msg =
        data && (data.error || data.output)
          ? String(data.error || data.output).slice(0, 200)
          : bodyText
            ? bodyText.slice(0, 200)
            : `HTTP ${res.status} empty body`;
      setToast('wl-toast-err', `⚠ Portable deploy failed: ${msg}`, 8000);
    })();
  }
  document.getElementById('eodOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('eodOverlay')) {
      saveEodHandoffNotes();
      document.getElementById('eodOverlay').classList.remove('show');
      renderPlan();
    }
  });

  load();
  loadExpiryDates();
  mergeDevLog();
  loadBlocks();
  loadPlan();
  const carried = autoCarryTasks();
  patchCarriedTasks();
  // Default to alphabetically first epic
  selectedTag = [...categories].sort((a, b) => a.label.localeCompare(b.label))[0]?.id || 'work';
  renderTagRow();
  checkNewDay();
  render();
  renderSodBtn();
  renderEodBtn();
  checkPomoWeeklyClear();
  renderPlan();
  if (carried > 0) {
    const countEl = document.getElementById('planCount');
    if (countEl)
      countEl.textContent =
        (countEl.textContent ? countEl.textContent + ' · ' : '') +
        `${carried} carried from yesterday`;
  }
  renderTimeblock();
  renderPomoLog();
  renderCompleted();
  resumeTimerIfActive();

  // ── 13-calendar.js ──
  /* ── Calendar (Outlook COM via local server) ── */

  // CAL_ACCOUNT_LABELS is defined in 00-config.js
  let _calMeetingsCache = null;

  /**
   * Resolves a human-readable account label for an Outlook calendar account.
   * The PowerShell server sends the raw `DisplayName` which may be an email
   * address, a display name, or free-form company text. Tries three strategies
   * in order: exact match, email domain extraction, and substring match.
   * @param {string|null} account - Raw Outlook account identifier.
   * @returns {string|null} Display label (e.g. "LähiTapiola"), or null if unknown.
   */
  function calAccountLabel(account) {
    if (!account) return null;
    const raw = String(account);
    const lower = raw.toLowerCase();

    // 1. Exact match (case-insensitive)
    for (const key of Object.keys(CAL_ACCOUNT_LABELS)) {
      if (key.toLowerCase() === lower) return CAL_ACCOUNT_LABELS[key];
    }
    // 2. Email-style: extract second-level domain (e.g. "x@gofore.com" → "gofore")
    const emailMatch = lower.match(/@([^.@\s]+)\./);
    if (emailMatch && CAL_ACCOUNT_LABELS[emailMatch[1]]) return CAL_ACCOUNT_LABELS[emailMatch[1]];
    // 3. Substring match (e.g. "Gofore Mailbox" contains "gofore")
    for (const key of Object.keys(CAL_ACCOUNT_LABELS)) {
      if (lower.includes(key.toLowerCase())) return CAL_ACCOUNT_LABELS[key];
    }
    return null;
  }

  /**
   * Renders the calendar meetings strip for today.
   * Sorts meetings by start time, marks past meetings grey/italic, pulses
   * ongoing meetings, and provides ▶ start and ✕ hide buttons per meeting.
   * @param {Array<Object>} meetings - Array of meeting objects from the PS server.
   */
  function renderCalStrip(meetings) {
    const section = document.getElementById('calSection');
    const el = document.getElementById('calMeetings');
    const countEl = document.getElementById('calCount');
    if (!section || !el) return;
    // Sort by start time regardless of calendar source
    if (Array.isArray(meetings))
      meetings = [...meetings].sort((a, b) => new Date(a.start) - new Date(b.start));

    if (!meetings || meetings.length === 0) {
      section.style.display = '';
      el.innerHTML = '<div class="cal-empty">No meetings today</div>';
      if (countEl) countEl.textContent = '';
      return;
    }

    const now = new Date();
    const fmtTime = (d) =>
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const fmtDur = (s, e) => {
      const m = Math.round((e - s) / 60000);
      return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
    };

    const upcoming = meetings.filter((ev) => new Date(ev.end) > now).length;
    if (countEl) countEl.textContent = upcoming ? `${upcoming} upcoming` : '';

    el.innerHTML = meetings
      .map((ev, idx) => {
        const start = new Date(ev.start);
        const end = new Date(ev.end);
        const isPast = end < now;
        const isNow = start <= now && end > now;
        const cls = isNow ? 'now' : isPast ? 'past' : '';
        const dur = `<span class="cal-meeting-dur">${fmtDur(start, end)}</span>`;
        const join = ev.joinUrl
          ? `<a class="cal-meeting-join" href="${escHtml(ev.joinUrl)}" target="_blank" rel="noopener">Join</a>`
          : '';
        const label = calAccountLabel(ev.account);
        const acct = label ? `<span class="cal-account-label">[${escHtml(label)}]</span>` : '';
        const taskBtn = `<button class="cal-task-btn" data-subject="${escHtml(ev.subject)}">▶ start</button>`;
        const deleteBtn = `<button class="cal-delete-btn" data-meeting-idx="${idx}" title="Hide this meeting">✕</button>`;
        return `<div class="cal-meeting ${cls}">
        <span class="cal-meeting-time">${fmtTime(start)}</span>
        <span class="cal-meeting-title">${escHtml(ev.subject)}</span>
        ${acct} ${dur} ${join} ${taskBtn} ${deleteBtn}
      </div>`;
      })
      .join('');

    // Wire up "▶ start" buttons
    el.querySelectorAll('.cal-task-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const subject = btn.dataset.subject;
        const todayKey = dk(new Date());
        // Meetings always default to the "meeting" category. Try the default id first,
        // then any category whose label matches; fall back to selectedTag if absent.
        const meetingCat =
          categories.find((c) => c.id === 'meeting') ||
          categories.find((c) => (c.label || '').toLowerCase() === 'meeting') ||
          null;
        const meetingTag = meetingCat ? meetingCat.id : selectedTag;
        const exists = planTasks.find(
          (t) => t.date === todayKey && t.text.toLowerCase() === subject.toLowerCase()
        );
        if (!exists) {
          planTasks.push({
            id: Date.now() + '',
            text: subject,
            status: 'todo',
            date: todayKey,
            tag: meetingTag,
          });
          savePlan();
        }
        if (activeTimer) stopTimer();
        const entry = {
          id: Date.now() + '',
          text: subject,
          tag: meetingTag,
          ts: safeRoundedStart(),
          date: todayKey,
        };
        entries.push(entry);
        const task = planTasks.find(
          (t) => t.date === todayKey && t.text.toLowerCase() === subject.toLowerCase()
        );
        if (task && task.status === 'todo') {
          task.status = 'inprogress';
          savePlan();
        }
        viewDate = new Date();
        save();
        startTimer(entry.id);
        render();
      });
    });

    // Wire up delete buttons
    const todayKey = dk(new Date());
    const hiddenMeetings = (() => {
      try {
        return JSON.parse(localStorage.getItem('wl_hidden_meetings_' + todayKey) || '[]');
      } catch (e) {
        return [];
      }
    })();

    el.querySelectorAll('.cal-delete-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.meetingIdx);
        const meeting = meetings[idx];
        if (meeting) {
          // Add to hidden list
          if (!hiddenMeetings.includes(meeting.subject)) {
            hiddenMeetings.push(meeting.subject);
            localStorage.setItem('wl_hidden_meetings_' + todayKey, JSON.stringify(hiddenMeetings));
          }
          // Remove from display
          btn.closest('.cal-meeting').style.opacity = '0.5';
          btn.closest('.cal-meeting').style.textDecoration = 'line-through';
          btn.disabled = true;
          btn.textContent = '✓';
        }
      });
    });

    section.style.display = '';

    // Collapsible header
    const hdr = document.getElementById('calHeader');
    if (hdr && !hdr._calBound) {
      hdr._calBound = true;
      hdr.addEventListener('click', () => section.classList.toggle('collapsed'));
    }
  }

  /**
   * Fetches today's meetings from the local PowerShell proxy (`/api/calendar`),
   * caches the result, filters out user-hidden meetings, and calls
   * {@link renderCalStrip}. Logs a warning and shows a fallback message on error.
   * @returns {Promise<void>}
   */
  async function fetchAndRenderCalendar() {
    try {
      const res = await fetch('/api/calendar');
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      _calMeetingsCache = data;

      // Filter out hidden meetings for today
      const todayKey = dk(new Date());
      const hiddenMeetings = (() => {
        try {
          return JSON.parse(localStorage.getItem('wl_hidden_meetings_' + todayKey) || '[]');
        } catch (e) {
          return [];
        }
      })();
      const filteredData = data.filter((m) => !hiddenMeetings.includes(m.subject));

      renderCalStrip(filteredData);
    } catch (err) {
      console.warn('[wl] Calendar unavailable:', err.message);
      const el = document.getElementById('calMeetings');
      if (el)
        el.innerHTML = `<div class="cal-empty" title="${escHtml(err.message)}">📅 Calendar unavailable — restart server with Outlook open</div>`;
      const sec = document.getElementById('calSection');
      if (sec) sec.style.display = '';
    }
  }

  // ── Transition bridge (Feature 3) ──
  const STORE_SEEN_ENDED = 'wl_seen_ended_v1';

  /**
   * Returns the set of meeting keys (`subject|start`) that have already triggered
   * a bridge banner in this session, loaded from localStorage.
   * @returns {Set<string>}
   */
  function getSeenEnded() {
    try {
      return new Set(JSON.parse(localStorage.getItem(STORE_SEEN_ENDED) || '[]'));
    } catch (e) {
      return new Set();
    }
  }
  /**
   * Persists the set of seen-ended meeting keys to localStorage.
   * @param {Set<string>} s - Updated set to persist.
   */
  function setSeenEnded(s) {
    localStorage.setItem(STORE_SEEN_ENDED, JSON.stringify([...s]));
  }

  /**
   * Returns a stable string key for a meeting used to deduplicate bridge banners.
   * @param {{subject: string, start: string}} m - Meeting object.
   * @returns {string}
   */
  function getMeetingKey(m) {
    return `${m.subject}|${m.start}`;
  }

  let bannerQueue = [];
  let bannerShowing = false;

  /**
   * Shows the post-meeting bridge banner for the given meeting.
   * Queues the meeting if another banner is already visible.
   * @param {{subject: string, start: string, end: string}} meeting - The ended meeting.
   */
  function showBridgeBanner(meeting) {
    if (bannerShowing) {
      bannerQueue.push(meeting);
      return;
    }
    bannerShowing = true;
    const banner = document.getElementById('newdayBanner');
    const msg = document.getElementById('newdayMsg');
    const expanded = document.getElementById('newdayExpanded');
    const bridgeBtn = document.getElementById('newdayBridgeBtn');
    const dismissBtn = document.getElementById('newdayDismiss');
    if (!banner || !msg) {
      bannerShowing = false;
      return;
    }

    msg.textContent = `Just finished "${meeting.subject || '(untitled)'}" — build a bridge to your next thing?`;
    expanded.innerHTML = '';
    expanded.style.display = 'none';
    banner.classList.add('show');

    const onDismiss = () => {
      banner.classList.remove('show');
      bannerShowing = false;
      if (bannerQueue.length) showBridgeBanner(bannerQueue.shift());
    };
    dismissBtn.onclick = onDismiss;
    bridgeBtn.onclick = async (e) => {
      e.stopPropagation();
      await buildBridge(meeting, expanded, bridgeBtn, onDismiss);
    };
  }

  /**
   * Determines the next task to transition to and delegates to {@link fetchBridge}.
   * If multiple tasks are in-flight the user picks from a list; a single in-progress
   * task is auto-selected; the only remaining task is auto-selected.
   * @param {{subject: string}} meeting  - The meeting that just ended.
   * @param {HTMLElement} expandedEl     - Container for the bridge content.
   * @param {HTMLElement} bridgeBtn      - "Build bridge" button (disabled during fetch).
   * @param {Function}    onDismiss      - Callback to dismiss the banner.
   * @returns {Promise<void>}
   */
  async function buildBridge(meeting, expandedEl, bridgeBtn, onDismiss) {
    const todayKey = dk(new Date());
    const notDone = planTasks.filter((t) => t.date === todayKey && t.status !== 'done');
    const inProgress = notDone.filter((t) => t.status === 'inprogress');

    let nextTask = null;
    if (inProgress.length) {
      nextTask = inProgress[0];
    } else if (notDone.length === 1) {
      nextTask = notDone[0];
    } else if (notDone.length > 1) {
      expandedEl.innerHTML = '<div style="font-size:11px;margin-bottom:6px">Pick next task:</div>';
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:4px';
      notDone.forEach((t) => {
        const b = document.createElement('button');
        b.style.cssText =
          'font-size:11px;padding:4px 8px;background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--radius);cursor:pointer;text-align:left;color:var(--text2)';
        b.textContent = t.text;
        b.onclick = async () => {
          list.style.display = 'none';
          await fetchBridge(meeting, t, expandedEl, bridgeBtn, onDismiss);
        };
        list.appendChild(b);
      });
      expandedEl.appendChild(list);
      expandedEl.style.display = 'block';
      return;
    }

    if (!nextTask) {
      expandedEl.textContent = 'No next task found for today.';
      expandedEl.style.display = 'block';
      return;
    }
    await fetchBridge(meeting, nextTask, expandedEl, bridgeBtn, onDismiss);
  }

  /**
   * Calls the Claude API via `/api/ai` to generate 3 concrete physical steps for
   * transitioning from the ended meeting to the next task. Displays the result in
   * `expandedEl`; falls back to copying the prompt to the clipboard on API error.
   * @param {{subject: string}} meeting  - The meeting that just ended.
   * @param {{text: string}}    task     - The next plan task to transition to.
   * @param {HTMLElement} expandedEl     - Container for the bridge content.
   * @param {HTMLElement} bridgeBtn      - "Build bridge" button (disabled during fetch).
   * @param {Function}    onDismiss      - Callback to dismiss the banner.
   * @returns {Promise<void>}
   */
  async function fetchBridge(meeting, task, expandedEl, bridgeBtn, onDismiss) {
    const meetingSubject = meeting.subject || '(untitled)';
    const taskText = task.text || '(untitled)';
    const prompt = `Meeting just finished: "${meetingSubject}"\nNext task to start: "${taskText}"\n\nProvide exactly 3 concrete physical steps to transition from this meeting to starting the task. Each step specific and actionable. Total time: ~3 min. No preamble, no numbering, no labels, plain text only.`;

    expandedEl.innerHTML = '<div style="font-size:11px;color:var(--text3)">thinking…</div>';
    expandedEl.style.display = 'block';
    bridgeBtn.disabled = true;

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system:
            'You help ADHD users switch between tasks smoothly. Reply with exactly 3 concrete physical steps, no preamble, no numbering, no labels. Plain text separated by line breaks.',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      const bridgeText = data.content?.[0]?.text || '';
      if (!bridgeText) throw new Error('No content in response');
      expandedEl.textContent = bridgeText;
    } catch (err) {
      navigator.clipboard.writeText(prompt).catch(() => {});
      expandedEl.innerHTML =
        '<span style="color:var(--red,#e74c3c)">AI unavailable — prompt copied to clipboard. (Set AnthropicApiKey in config.local.ps1)</span>';
    }
    bridgeBtn.disabled = false;
  }

  // Fetch from server every 10 minutes; re-render from cache every minute
  // so past/now/upcoming states update without hammering the server
  fetchAndRenderCalendar();
  setInterval(fetchAndRenderCalendar, 10 * 60 * 1000);
  setInterval(() => {
    if (!_calMeetingsCache) return;
    const todayKey = dk(new Date());
    const hiddenMeetings = (() => {
      try {
        return JSON.parse(localStorage.getItem('wl_hidden_meetings_' + todayKey) || '[]');
      } catch (e) {
        return [];
      }
    })();
    const filteredData = _calMeetingsCache.filter((m) => !hiddenMeetings.includes(m.subject));
    renderCalStrip(filteredData);

    // Detect newly-ended meetings and offer a bridge
    const seen = getSeenEnded();
    const now = new Date();
    filteredData.forEach((m) => {
      const key = getMeetingKey(m);
      const endTime = new Date(m.end);
      if (endTime > now || seen.has(key)) return;
      seen.add(key);
      const nextTooSoon = filteredData.some((other) => {
        const diff = (new Date(other.start) - endTime) / 60000;
        return diff > 0 && diff < 10;
      });
      if (!nextTooSoon) showBridgeBanner(m);
    });
    setSeenEnded(seen);
  }, 60 * 1000);

  loadParked();
  renderParked();

  // Test harness — only active when ?test=1 in URL
  if (new URLSearchParams(window.location.search).get('test') === '1') {
    window.__wl = {
      roundToNearest30,
      dk,
      getISOWeek,
      totalISOWeeks,
      entries,
      categories,
      planTasks,
      blocks,
      activeTimer: () => activeTimer,
      load,
      save,
      savePlan,
      loadPlan,
      loadParked,
      autoCarryTasks,
      patchCarriedTasks,
      render,
      renderPlan,
      renderCompleted,
      renderCalStrip,
      renderParked,
      openEodModal,
      parkedThoughts,
      startTimer,
      stopTimer,
      pauseTimer,
      getCat,
      escHtml,
      renderDistractionCount,
      getIterationExpiry,
      loadExpiryDates,
      exportTxt,
      exportBackup,
      getHook,
      saveHook,
      _showBridgeBanner: showBridgeBanner,
      getState: () => ({ entries, categories, planTasks, blocks, activeTimer }),
      cycleSignifier,
      isEntryBillable,
    };
    // Live viewDate getter/setter so tests can change the view date
    // and renderCompleted re-runs automatically
    Object.defineProperty(window.__wl, 'viewDate', {
      get: () => viewDate,
      set: (v) => {
        viewDate = v instanceof Date ? v : new Date(v);
        renderCompleted();
      },
      enumerable: true,
      configurable: true,
    });
  }

  // ── 14-jira.js ──
  /* ── Jira CSV importer ── */

  /**
   * Self-contained IIFE that sets up the Jira CSV importer:
   * drop-zone, file picker, CSV parsing, category auto-matching, task
   * de-duplication, grouped selection UI, and bulk import into today's plan.
   */
  (function initJiraImporter() {
    const JIRA_SMAP = {
      'in progress': 'inprogress',
      'in-progress': 'inprogress',
      open: 'todo',
      'to do': 'todo',
      todo: 'todo',
      backlog: 'todo',
      new: 'todo',
      'in review': 'inprogress',
      review: 'inprogress',
      testing: 'inprogress',
      blocked: 'blocked',
      impediment: 'blocked',
      pending: 'pending',
      'on hold': 'pending',
      waiting: 'pending',
      done: 'done',
      closed: 'done',
      resolved: 'done',
      "won't do": 'done',
    };
    const JIRA_STATUS_LABEL = {
      todo: 'open',
      inprogress: 'in progress',
      pending: 'pending',
      blocked: 'blocked',
      done: 'done',
    };
    const AUTO_COLORS = [
      '#5DCAA5',
      '#378ADD',
      '#D85A30',
      '#7F77DD',
      '#BA7517',
      '#D4537E',
      '#639922',
      '#185FA5',
      '#993556',
      '#0F6E56',
    ];

    let jiraTasks = [],
      jiraSelected = new Set(),
      jiraCatMap = {};

    /**
     * Maps a raw Jira status string to the internal status token.
     * @param {string} s - Raw Jira status (e.g. "In Progress", "Won't Do").
     * @returns {'todo'|'inprogress'|'pending'|'blocked'|'done'}
     */
    function jiraMapStatus(s) {
      return JIRA_SMAP[(s || '').toLowerCase().trim()] || 'todo';
    }

    /**
     * Returns a Set of lowercased task texts already in today's plan.
     * Used to detect duplicates before import.
     * @returns {Set<string>}
     */
    function jiraGetExistingToday() {
      const today = dk(new Date());
      return new Set(
        planTasks.filter((t) => t.date === today).map((t) => t.text.toLowerCase().trim())
      );
    }

    /**
     * Returns true if the task ("KEY: Summary") already exists in today's plan.
     * @param {{key: string, summary: string}} t - Parsed Jira task.
     * @returns {boolean}
     */
    function jiraIsDup(t) {
      return jiraGetExistingToday().has(`${t.key}: ${t.summary}`.toLowerCase().trim());
    }

    /**
     * Finds an existing category that matches the given Jira parent key or label.
     * Prefers exact ticket-key-prefix matches over label matches to prevent
     * ambiguous substring hits (e.g. "UAT" matching "Pre-UAT").
     * @param {string|null} parentKey - Parent epic key (e.g. "AITO-123").
     * @param {string}      label     - Parent epic label text.
     * @returns {Object|null} Matching category object, or null if none found.
     */
    function jiraMatchCat(parentKey, label) {
      // Match by ticket key prefix first — most reliable, prevents "UAT" matching "Pre-UAT"
      if (parentKey) {
        const byKey = categories.find(
          (c) => c.label.startsWith(parentKey + ':') || c.label === parentKey
        );
        if (byKey) return byKey;
      }
      // Fall back to exact label match only — no fuzzy substring matching
      const lower = label.toLowerCase().trim();
      return categories.find((c) => c.label.toLowerCase().trim() === lower) || null;
    }

    /**
     * Builds `jiraCatMap` — a lookup from "parentKey|parentSummary" to a category
     * object (existing or newly generated). New categories get unique auto-colours
     * not already used by existing ones.
     * @param {Array<Object>} tasks - Parsed Jira task list.
     */
    function jiraBuildCatMap(tasks) {
      jiraCatMap = {};
      const usedColors = new Set(categories.map((c) => c.color));
      let ci = 0;
      const seen = new Set();
      tasks
        .filter((t) => t.parentKey || t.parentSummary)
        .forEach((t) => {
          const mapKey = (t.parentKey || '') + '|' + (t.parentSummary || '');
          if (seen.has(mapKey)) return;
          seen.add(mapKey);
          const label =
            t.parentKey && t.parentSummary
              ? `${t.parentKey}: ${t.parentSummary.trim()}`
              : (t.parentSummary || t.parentKey || '').trim();
          if (!label) return;
          const existing = jiraMatchCat(t.parentKey, label);
          if (existing) {
            jiraCatMap[mapKey] = { ...existing, isNew: false };
          } else {
            const color =
              AUTO_COLORS.find((c) => !usedColors.has(c)) || AUTO_COLORS[ci % AUTO_COLORS.length];
            ci++;
            usedColors.add(color);
            jiraCatMap[mapKey] = {
              id: 'epic_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              label,
              color,
              isNew: true,
            };
          }
        });
    }

    /**
     * Returns the resolved category object for a Jira task using `jiraCatMap`.
     * @param {{parentKey: string|null, parentSummary: string|null}} t - Parsed task.
     * @returns {Object|null} Category object, or null if the task has no parent.
     */
    function jiraGetCat(t) {
      return jiraCatMap[(t.parentKey || '') + '|' + (t.parentSummary || '')] || null;
    }

    /**
     * Updates the importer count line showing total issues, selected count, and
     * how many are already in today's tasks.
     */
    function jiraUpdateCount() {
      const sel = [...jiraSelected].length;
      const dups = jiraTasks.filter((t) => jiraIsDup(t)).length;
      let txt = `${jiraTasks.length} issue${jiraTasks.length !== 1 ? 's' : ''} · ${sel} selected`;
      if (dups) txt += ` · ${dups} already in today's tasks`;
      document.getElementById('jiraCount').textContent = txt;
    }

    /**
     * Renders the grouped task list in the importer UI. Tasks are grouped by
     * category; duplicates are shown with a disabled checkbox and an "already added"
     * badge. Calls {@link jiraUpdateCount} to refresh the summary line.
     */
    function jiraRenderTasks() {
      jiraUpdateCount();
      const container = document.getElementById('jiraTaskRows');
      container.style.display = '';

      // Group tasks by their category key, preserving first-seen order
      const groups = [];
      const groupIndex = {};
      jiraTasks.forEach((t, i) => {
        const cat = jiraGetCat(t);
        const key = cat ? cat.id : '__none__';
        if (!(key in groupIndex)) {
          groupIndex[key] = groups.length;
          groups.push({ cat, tasks: [] });
        }
        groups[groupIndex[key]].tasks.push({ t, i });
      });

      container.innerHTML = groups
        .map(({ cat, tasks }) => {
          const catDot = cat
            ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${escHtml(cat.color)};flex-shrink:0;margin-right:6px;vertical-align:-1px"></span>`
            : '';
          const catName = cat ? escHtml(cat.label) : 'no category';
          const allDup = tasks.every(({ t }) => jiraIsDup(t));
          const newBadge =
            cat && cat.isNew
              ? `<span class="jira-badge jira-badge-new" style="margin-left:6px">new category</span>`
              : '';
          const header = `<div style="display:flex;align-items:center;padding:6px 10px 4px;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-top:6px">
          ${catDot}<span>${catName}</span>${newBadge}
          ${allDup ? `<span class="jira-badge jira-badge-dup" style="margin-left:6px">all added</span>` : ''}
        </div>`;

          const rows = tasks
            .map(({ t, i }) => {
              const mapped = jiraMapStatus(t.status);
              const isDone = mapped === 'done';
              const isDup = jiraIsDup(t);
              const slabel = JIRA_STATUS_LABEL[mapped] || t.status;
              const statusBadge = isDup
                ? `<span class="jira-badge jira-badge-dup">already added</span>`
                : `<span class="jira-badge jira-badge-status-${mapped}">${escHtml(slabel)}</span>`;
              const rowClass = ['jira-task-row', isDup ? 'dup' : '', isDone && !isDup ? 'done' : '']
                .filter(Boolean)
                .join(' ');
              return `<label class="${rowClass}">
            <input type="checkbox" ${jiraSelected.has(i) ? 'checked' : ''} ${isDup ? 'disabled' : ''} data-ji="${i}"
              style="flex-shrink:0" onchange="window.__jiraToggle(${i},this.checked)">
            <span class="jira-task-key">${escHtml(t.key)}</span>
            <span class="jira-task-title">${escHtml(t.summary)}</span>
            ${statusBadge}
          </label>`;
            })
            .join('');

          return header + rows;
        })
        .join('');

      document.getElementById('jiraSelRow').style.display = '';
    }

    /**
     * Minimal RFC-4180 CSV parser with no external dependencies.
     * Returns an array of objects keyed by the first-row headers.
     * @param {string} text - Raw CSV file content.
     * @returns {Array<Object>} Parsed rows; empty array if fewer than 2 rows.
     */
    function parseCSV(text) {
      // Minimal RFC-4180 CSV parser — no external dependency
      const rows = [];
      let field = '',
        row = [],
        inQ = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i],
          next = text[i + 1];
        if (inQ) {
          if (ch === '"' && next === '"') {
            field += '"';
            i++;
          } else if (ch === '"') {
            inQ = false;
          } else {
            field += ch;
          }
        } else {
          if (ch === '"') {
            inQ = true;
          } else if (ch === ',') {
            row.push(field);
            field = '';
          } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
            if (ch === '\r') i++;
            row.push(field);
            field = '';
            rows.push(row);
            row = [];
          } else {
            field += ch;
          }
        }
      }
      if (row.length || field) {
        row.push(field);
        rows.push(row);
      }
      if (rows.length < 2) return [];
      const headers = rows[0];
      return rows
        .slice(1)
        .filter((r) => r.some((f) => f.trim()))
        .map((r) => {
          const o = {};
          headers.forEach((h, i) => {
            o[h.trim()] = (r[i] || '').trim();
          });
          return o;
        });
    }

    /**
     * Parses a Jira CSV export string, builds the category map, pre-selects
     * non-done non-duplicate tasks, and renders the importer UI.
     * @param {string} text - Raw CSV content from the dropped/selected file.
     */
    function jiraParseAndRender(text) {
      let rows;
      try {
        rows = parseCSV(text);
      } catch (e) {
        setJiraMsg('Could not parse CSV: ' + e.message, false);
        return;
      }
      if (!rows.length) {
        setJiraMsg('CSV is empty or could not be parsed.', false);
        return;
      }
      jiraTasks = rows
        .map((r) => ({
          key: (r['Issue key'] || r['Key'] || r['Issue Key'] || '').trim(),
          summary: (r['Summary'] || r['summary'] || '').trim(),
          status: (r['Status'] || r['status'] || '').trim(),
          parentKey: (r['Parent key'] || r['Parent Key'] || '').trim() || null,
          parentSummary:
            (r['Parent summary'] || r['Parent Summary'] || r['Epic Name'] || '').trim() || null,
        }))
        .filter((t) => t.key && t.summary);

      if (!jiraTasks.length) {
        setJiraMsg('No tasks found — expected columns: Issue key, Summary, Status.', false);
        return;
      }
      // Pre-select: skip done and duplicates
      jiraSelected = new Set(
        jiraTasks
          .map((_, i) => i)
          .filter((i) => {
            const t = jiraTasks[i];
            return jiraMapStatus(t.status) !== 'done' && !jiraIsDup(t);
          })
      );
      jiraBuildCatMap(jiraTasks);
      jiraRenderTasks();
      setJiraMsg('', false);
    }

    /**
     * Displays a status/error message in the `#jiraMsg` element.
     * @param {string}  msg - Message text (empty string to clear).
     * @param {boolean} ok  - If true, styles the message as a success; otherwise as an error.
     */
    function setJiraMsg(msg, ok) {
      const el = document.getElementById('jiraMsg');
      el.textContent = msg;
      el.className = 'jira-msg' + (ok ? ' ok' : '');
    }

    /**
     * Reads the given File as UTF-8 text and passes the result to
     * {@link jiraParseAndRender}. No-ops if `f` is falsy.
     * @param {File|null} f - The CSV file to load.
     */
    function jiraHandleFile(f) {
      if (!f) return;
      document.getElementById('jiraMsg').textContent = '';
      document.getElementById('jiraImportBtn').disabled = false;
      const reader = new FileReader();
      reader.onload = (e) => jiraParseAndRender(e.target.result);
      reader.readAsText(f, 'UTF-8');
    }

    // Exposed globally for inline onchange handlers
    window.__jiraToggle = (i, on) => {
      on ? jiraSelected.add(i) : jiraSelected.delete(i);
      jiraUpdateCount();
    };

    // Drop zone
    const drop = document.getElementById('jiraDrop');
    drop.addEventListener('click', () => document.getElementById('jiraFileIn').click());
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f) jiraHandleFile(f);
    });
    document
      .getElementById('jiraFileIn')
      .addEventListener('change', (e) => jiraHandleFile(e.target.files[0]));

    // Toggle collapse
    document.getElementById('jiraHeader').addEventListener('click', () => {
      document.getElementById('jiraSection').classList.toggle('collapsed');
    });

    // Select all / none
    document.getElementById('jiraSelAll').addEventListener('click', () => {
      jiraTasks.forEach((t, i) => {
        if (!jiraIsDup(t)) jiraSelected.add(i);
      });
      document
        .querySelectorAll('#jiraTaskRows input[type=checkbox]:not([disabled])')
        .forEach((cb) => (cb.checked = true));
      jiraUpdateCount();
    });
    document.getElementById('jiraSelNone').addEventListener('click', () => {
      jiraSelected.clear();
      document
        .querySelectorAll('#jiraTaskRows input[type=checkbox]:not([disabled])')
        .forEach((cb) => (cb.checked = false));
      jiraUpdateCount();
    });

    // Import
    document.getElementById('jiraImportBtn').addEventListener('click', () => {
      if (!jiraSelected.size) {
        setJiraMsg('Nothing selected.', false);
        return;
      }
      const today = dk(new Date());
      const existing = new Set(
        planTasks.filter((p) => p.date === today).map((p) => p.text.toLowerCase().trim())
      );

      // Create any new categories
      Object.values(jiraCatMap).forEach((cat) => {
        if (cat.isNew && !categories.find((c) => c.id === cat.id)) {
          categories.push({ id: cat.id, label: cat.label, color: cat.color });
        }
      });

      let added = 0,
        skipped = 0;
      // Import in category-group order (same order as displayed)
      const grouped = [];
      const seen = {};
      jiraTasks.forEach((t, i) => {
        if (!jiraSelected.has(i)) return;
        const cat = jiraGetCat(t);
        const key = cat ? cat.id : '__none__';
        if (!(key in seen)) {
          seen[key] = grouped.length;
          grouped.push([]);
        }
        grouped[seen[key]].push({ t, i });
      });
      grouped.forEach((group) =>
        group.forEach(({ t }) => {
          const text = `${t.key}: ${t.summary}`;
          if (existing.has(text.toLowerCase().trim())) {
            skipped++;
            return;
          }
          const cat = jiraGetCat(t);
          planTasks.push({
            id: 'jira_' + Date.now() + '_' + Math.random().toString(36).slice(2),
            text,
            status: jiraMapStatus(t.status),
            tag: cat ? cat.id : 'other',
            date: today,
          });
          existing.add(text.toLowerCase().trim());
          added++;
        })
      );

      save();
      savePlan();
      render();
      renderPlan();

      // Refresh duplicate markers in the list
      jiraRenderTasks();

      if (added) {
        setJiraMsg(
          `✓ ${added} task${added !== 1 ? 's' : ''} added${skipped ? ` · ${skipped} skipped` : ''}`,
          true
        );
        document.getElementById('jiraImportBtn').disabled = true;
      } else {
        setJiraMsg('All selected tasks already exist for today.', false);
      }
    });
  })();

  // ── 15-notion.js ──
  /* ── Notion integration ── */
  // Task-to-Notion uses Notion REST API directly via /api/notion-add-task (no AI needed).
  // callClaudeWithNotion is kept for the URL-bookmarking form via /api/notion-ai proxy.
  // Notion token lives in config.local.ps1 (server-side, never exposed to the browser).
  const STORE_ANTHROPIC_KEY = 'wl_anthropic_key'; // kept for backward compat with URL bookmarking form

  /**
   * Retrieves the stored Anthropic API key from localStorage (trimmed).
   * @returns {string} The key, or an empty string if not set.
   */
  function getAnthropicKey() {
    return (localStorage.getItem(STORE_ANTHROPIC_KEY) || '').trim();
  }

  /**
   * Stores or removes the Anthropic API key in localStorage.
   * @param {string} key - Key to store; falsy to remove.
   */
  function setAnthropicKey(key) {
    if (key) localStorage.setItem(STORE_ANTHROPIC_KEY, key.trim());
    else localStorage.removeItem(STORE_ANTHROPIC_KEY);
  }

  /**
   * Calls the Claude API with a Notion MCP server attached, via the local proxy
   * at `/api/notion-ai` (API keys never exposed to the browser).
   * Used for the URL-bookmarking form — task imports use {@link addTaskToNotion} instead.
   * @param {string} prompt            - User prompt text.
   * @param {Object} [opts] - Optional overrides (`model` string, `maxTokens` number).
   * @returns {Promise<string>} The concatenated text content of the response.
   * @throws {Error} If the API returns a non-OK status.
   */
  async function callClaudeWithNotion(prompt, opts = {}) {
    const res = await fetch('/api/notion-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model || 'claude-sonnet-4-6',
        max_tokens: opts.maxTokens || 1000,
        mcp_servers: [{ type: 'url', url: 'https://mcp.notion.com/mcp', name: 'notion' }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`API ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`);
    }
    const data = await res.json();
    return (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
  }

  /**
   * Adds a work-log task to Notion as a child page under the matching project.
   * The project is looked up server-side by matching the task's category label to a
   * Notion project's Epic field. Uses `/api/notion-add-task` (Notion REST API, no AI).
   * @param {Object} task - Plan task object with at least `text` and `tag`.
   * @returns {Promise<string>} The URL of the newly created Notion page.
   * @throws {Error} If the API call fails or no URL is returned.
   */
  async function addTaskToNotion(task) {
    const cat = getCat(task.tag || 'other');
    const epic = (cat.label || 'other').toLowerCase();

    const res = await fetch('/api/notion-add-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: task.text, epic }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.detail || data.error || `API ${res.status}`).slice(0, 300);
      throw new Error(msg);
    }
    if (!data.url) throw new Error('No URL returned from Notion');
    return data.url;
  }

  /**
   * Persists the Notion page URL on a plan task so the per-task button changes
   * to an "open in Notion" link on next render.
   * @param {string} taskId - Plan task ID.
   * @param {string} url    - Notion page URL returned by the API.
   */
  function saveTaskNotionUrl(taskId, url) {
    const t = planTasks.find((t) => t.id === taskId);
    if (!t) return;
    t.notionUrl = url;
    savePlan();
    renderPlan();
  }

  // Delegated click handler for the per-task Notion button
  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest('.notion-task-btn');
      if (!btn || !btn.dataset.pid) return;
      e.stopPropagation();
      const t = planTasks.find((x) => x.id === btn.dataset.pid);
      if (!t) return;
      // If already sent, open the Notion page
      if (t.notionUrl) {
        window.open(t.notionUrl, '_blank', 'noopener');
        return;
      }
      btn.disabled = true;
      btn.textContent = '…';
      addTaskToNotion(t)
        .then((url) => {
          if (url && url.startsWith('http')) {
            saveTaskNotionUrl(t.id, url);
          } else {
            btn.textContent = '📋';
            btn.disabled = false;
            alert('Notion responded but no URL: ' + url);
          }
        })
        .catch((err) => {
          btn.textContent = '📋';
          btn.disabled = false;
          alert('Failed to add to Notion: ' + err.message);
        });
    },
    true
  );

  // Expose for the URL-bookmarking form so it shares the same auth path
  window._wlNotion = { callClaudeWithNotion, getAnthropicKey, setAnthropicKey };
})();
