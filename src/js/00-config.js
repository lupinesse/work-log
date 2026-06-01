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
 * JIRA_BASE can be overridden without editing this file:
 *   1. Copy src/js/00-config.local.example.js → src/js/00-config.local.js
 *   2. Set your real Jira instance URL in that file.
 *   3. Run `npm run build`.  That file is gitignored and will never be committed.
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
 * Override in src/js/00-config.local.js (gitignored) — copy from
 * src/js/00-config.local.example.js and set your real instance URL.
 * @type {string}
 */
let JIRA_BASE = 'https://your-instance.atlassian.net/browse';

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

// ---------------------------------------------------------------------------
// Daily tracking goal — used for the header pace bar
// ---------------------------------------------------------------------------

/**
 * Daily tracking goal in milliseconds. The header pace bar fills proportionally
 * as today's logged time approaches this value.
 * Default: 7 hours 30 minutes. Override in 00-config.local.js.
 * @type {number}
 */
const DAILY_GOAL_MS = 7.5 * 60 * 60 * 1000; // 7h 30m

// ---------------------------------------------------------------------------
// Auto-pause on tab switch
// ---------------------------------------------------------------------------

/**
 * When true, pauses a running timer automatically when the browser tab becomes
 * hidden (visibilitychange → document.hidden). The pause is silent; the event
 * is recorded in the console log via wlLog.info but no UI notification appears.
 * Set to false to disable. Override in 00-config.local.js.
 * @type {boolean}
 */
const AUTO_PAUSE_ON_TAB_SWITCH = true;
