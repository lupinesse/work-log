/**
 * @file 00-config.js — App configuration defaults and runtime setters.
 *
 * Static defaults used when the app is opened directly as a file, or when the
 * local server is not running.
 *
 * When the local server IS running, location values are overridden at startup
 * by /api/config (via {@link setWeatherConfig}), which reads from the gitignored
 * config.local.ps1. Edit config.local.ps1 (copy from config.local.example.ps1)
 * to set your actual location without touching source code.
 *
 * JIRA_BASE can be overridden without editing this file:
 *   1. Copy src/js/00-config.local.example.js → src/js/00-config.local.js
 *   2. Call setJiraBase('https://your-instance.atlassian.net/browse') in that file.
 *   3. Run `npm run build`. That file is gitignored and will never be committed.
 */

// ---------------------------------------------------------------------------
// Location — overridden at runtime by /api/config when the server is running
// ---------------------------------------------------------------------------

/**
 * Latitude of the work location (decimal degrees).
 * Default used when the server is not running; normally set via config.local.ps1.
 * @type {number}
 */
export let WEATHER_LAT = 60.1887;

/**
 * Longitude of the work location (decimal degrees).
 * Default used when the server is not running; normally set via config.local.ps1.
 * @type {number}
 */
export let WEATHER_LON = 24.927;

/**
 * Display name for the work location shown next to the weather widget.
 * Default used when the server is not running; normally set via config.local.ps1.
 * @type {string}
 */
export let WEATHER_NAME = 'Helsinki';

/**
 * Updates the weather location from the /api/config response. Each parameter
 * is applied only when the server sends a valid value; missing or invalid
 * values leave the corresponding default unchanged.
 * @param {number|undefined} lat - Latitude (decimal degrees).
 * @param {number|undefined} lon - Longitude (decimal degrees).
 * @param {string|undefined} name - Display name for the location.
 * @returns {void}
 */
export function setWeatherConfig(lat, lon, name) {
  if (Number.isFinite(lat)) WEATHER_LAT = lat;
  if (Number.isFinite(lon)) WEATHER_LON = lon;
  if (name) WEATHER_NAME = name;
}

// ---------------------------------------------------------------------------
// Jira — base URL used to turn ticket keys (e.g. PROJ-123) into links
// ---------------------------------------------------------------------------

/**
 * Base URL for Jira ticket links. Ticket keys found in task names are
 * converted to `<a href="${JIRA_BASE}/${key}">` anchors.
 * Set to `''` to disable link generation.
 * Override via setJiraBase() in src/js/00-config.local.js (gitignored) — copy
 * from src/js/00-config.local.example.js and set your real instance URL.
 * @type {string}
 */
export let JIRA_BASE = 'https://your-instance.atlassian.net/browse';

/**
 * Overrides the Jira base URL at runtime. Call this from 00-config.local.js.
 * @param {string} url - Jira base URL, e.g. 'https://your-instance.atlassian.net/browse'.
 * @returns {void}
 */
export function setJiraBase(url) {
  JIRA_BASE = url;
}

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
export const CAL_ACCOUNT_LABELS = {
  // Replace with your own account keys and labels, e.g.:
  // acme: 'Acme Corp',
  // contractor: 'My Contractor',
};

// ---------------------------------------------------------------------------
// Auto-pause on tab switch
// ---------------------------------------------------------------------------

/**
 * When true, pauses a running timer automatically when the browser tab becomes
 * hidden (visibilitychange → document.hidden). The pause is silent; the event
 * is recorded in the console log via wlLog.info but no UI notification appears.
 * Set to false to disable. Override in 00-config.local.js.
 * @type {boolean}
 * @default false
 */
export const AUTO_PAUSE_ON_TAB_SWITCH = false;

// ---------------------------------------------------------------------------
// Gofore timesheet — End of Day submit button
// ---------------------------------------------------------------------------

/**
 * When true, the End of Day timesheet form shows a "submit to
 * timesheet.gofore.com" button that posts the entry through the local server
 * (Claude in Chrome, then Playwright). When false (default) the form is a
 * draft to copy from: hours and description are shown with a copy button and
 * nothing is sent. Override in 00-config.local.js.
 * @type {boolean}
 * @default false
 */
export const GOFORE_SUBMIT_ENABLED = false;
