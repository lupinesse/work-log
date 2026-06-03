/**
 * @file 24-location.js
 * Per-day work location (Remote / Office) shown in the date-nav header where the
 * ISO week number used to sit. The location is stored against each calendar day
 * so navigating with ← → reveals that day's location. Unset days default to
 * Remote (see DEFAULT_WORK_LOCATION in pure-fns.js).
 *
 * Pure helpers (locationFor, nextLocation, WORK_LOCATIONS) live in pure-fns.js
 * and are unit-tested; this module is the localStorage + DOM glue around them.
 */

/** localStorage key for the date-key → location-id map. */
const LOCATION_STORE_KEY = 'wl_location_v1';

/**
 * Reads the stored location map from localStorage.
 * Returns an empty map (and logs a warning) if the value is missing or corrupt,
 * so a single bad write can never break the header render.
 * @returns {Record<string, string>} Date-key → location-id map.
 */
function loadLocationMap() {
  const raw = localStorage.getItem(LOCATION_STORE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    wlLog.warn('Could not parse stored work-location map; ignoring it', err);
    return {};
  }
}

/**
 * Persists the location map to localStorage.
 * @param {Record<string, string>} map - Date-key → location-id map.
 * @returns {void}
 */
function saveLocationMap(map) {
  localStorage.setItem(LOCATION_STORE_KEY, JSON.stringify(map));
}

/**
 * Resolves the work location for the currently viewed day.
 * @returns {string} A location id present in WORK_LOCATIONS.
 */
function getViewLocation() {
  return locationFor(loadLocationMap(), dk(viewDate));
}

/**
 * Toggles the currently viewed day to the next location (Remote ↔ Office),
 * persists it, logs the decision, and re-renders the header button.
 * @returns {void}
 */
function toggleViewLocation() {
  const dateKey = dk(viewDate);
  const map = loadLocationMap();
  const updated = nextLocation(locationFor(map, dateKey));
  map[dateKey] = updated;
  saveLocationMap(map);
  wlLog.info(`Work location for ${dateKey} set to ${updated}`);
  renderLocation();
}

/**
 * Updates the date-nav location button to reflect the viewed day's location.
 * No-ops when the button is absent (e.g. in a reduced test DOM).
 * @returns {void}
 */
function renderLocation() {
  const btn = document.getElementById('dateNavLocation');
  if (!btn) return;
  const loc = getViewLocation();
  const { emoji, label } = WORK_LOCATIONS[loc];
  btn.querySelector('.date-nav-location__emoji').textContent = emoji;
  btn.querySelector('.date-nav-location__label').textContent = label;
  btn.setAttribute('aria-label', `Work location: ${label}. Click to change.`);
  btn.dataset.location = loc;
}

/**
 * Binds the location toggle button. Called once from DOMContentLoaded in
 * 07-lifecycle.js. Safe to call when the button is missing.
 * @returns {void}
 */
function initLocation() {
  const btn = document.getElementById('dateNavLocation');
  if (!btn) return;
  btn.addEventListener('click', toggleViewLocation);
  renderLocation();
}
