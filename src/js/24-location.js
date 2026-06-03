/**
 * @file 24-location.js
 * Per-day work location (Remote / Office) shown in the date-nav header where the
 * ISO week number used to sit. The location is stored against each calendar day
 * so navigating with ← → reveals that day's location. Unset days default to
 * Remote (see DEFAULT_WORK_LOCATION in pure-fns.js).
 *
 * Pure helpers (locationFor, nextLocation, WORK_LOCATIONS) live in pure-fns.js
 * and are unit-tested; this module is the localStorage + DOM glue around them.
 *
 * The storage key (STORE_LOCATION) is declared in 01-state.js alongside the
 * other wl_*_v1 keys. It must live there, not here: modules are concatenated in
 * filename order, and render() (04-render.js) calls renderLocation() during boot
 * — before this file's top-level code would run — so a const declared here would
 * be in the temporal dead zone at that point.
 */

/**
 * Reads the stored location map from localStorage.
 * Returns an empty map (and logs a warning) if the value is missing or corrupt,
 * so a single bad write can never break the header render.
 * @returns {Record<string, string>} Date-key → location-id map.
 */
function loadLocationMap() {
  const raw = localStorage.getItem(STORE_LOCATION);
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
  localStorage.setItem(STORE_LOCATION, JSON.stringify(map));
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
  // Write a fresh copy rather than mutating the loaded object in place.
  saveLocationMap({ ...map, [dateKey]: updated });
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
 * Binds the location toggle button. Called exactly once from the boot sequence
 * in 07-lifecycle.js; there is no re-invocation path, so the click listener is
 * attached without a guard. If a future caller invokes this more than once, add
 * a removeEventListener (or an "already bound" flag) first to avoid duplicate
 * handlers. Safe to call when the button is missing.
 * @returns {void}
 */
function initLocation() {
  const btn = document.getElementById('dateNavLocation');
  if (!btn) return;
  btn.addEventListener('click', toggleViewLocation);
  renderLocation();
}
