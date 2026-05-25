/* ── App configuration ──
 *
 * Edit the constants below to adapt the Work Log to your environment.
 * All values are compile-time constants included in the built script.js;
 * changing them requires re-running `npm run build` (or `node build.js`).
 *
 * These were previously scattered across 09-clock-weather.js and
 * 13-calendar.js — centralised here so you only need to edit one file.
 */

// ---------------------------------------------------------------------------
// Location — used for the Open-Meteo weather API call
// ---------------------------------------------------------------------------

/**
 * Latitude of the work location (decimal degrees).
 * @type {number}
 */
const WEATHER_LAT = 60.1887;

/**
 * Longitude of the work location (decimal degrees).
 * @type {number}
 */
const WEATHER_LON = 24.927;

/**
 * Display name for the work location shown next to the weather widget.
 * @type {string}
 */
const WEATHER_NAME = 'Helsinki';

// ---------------------------------------------------------------------------
// Jira — base URL used to turn ticket keys (e.g. PROJ-123) into links
// ---------------------------------------------------------------------------

/**
 * Base URL for Jira ticket links. Ticket keys found in task names are
 * converted to `<a href="${JIRA_BASE}/${key}">` anchors.
 * Set to `''` to disable link generation.
 * @type {string}
 */
const JIRA_BASE = 'https://lahitapiola.atlassian.net/browse';

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
