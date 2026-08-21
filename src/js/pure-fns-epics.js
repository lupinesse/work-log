/**
 * @file pure-fns-epics.js
 * Pure helpers for epic (category) lifecycle management: deciding which epics
 * have gone stale and should be archived out of the pickers, and filtering a
 * category list down to the ones a user should be offered.
 *
 * Archiving is deliberately non-destructive. A stale epic keeps its record in
 * the categories array with `archived: true`, so `getCat()` (02-utils.js) can
 * still resolve its label and colour for historical log entries, timesheets,
 * and the monthly/weekly reports. Hard-deleting instead would silently repaint
 * every past entry that used it as the grey "other" fallback.
 */

/** Days of inactivity after which an epic is offered up for archiving. */
export const EPIC_STALE_DAYS = 21;

/**
 * Built-in epic IDs that must never be archived. They are seeded on first run
 * (DEFAULT_CATS in app-constants.js) and 'other' doubles as the fallback that
 * `getCat()` resolves unknown tags to, so removing it from the pickers would
 * leave orphaned entries with nothing to point at.
 * @type {string[]}
 */
export const PROTECTED_CAT_IDS = ['work', 'meeting', 'focus', 'break', 'other'];

/**
 * Returns the ISO date (YYYY-MM-DD) that starts an inactivity window ending
 * today. The window is inclusive of both ends: with `windowDays` of 21 and a
 * `todayIso` of 2026-08-21, the cutoff is 2026-08-01 and an epic last used on
 * exactly that date still counts as active.
 * @param {string} todayIso - Today's date as YYYY-MM-DD.
 * @param {number} windowDays - Length of the activity window in days.
 * @returns {string} The inclusive cutoff date as YYYY-MM-DD.
 * @example
 * epicCutoffDate('2026-08-21', 21) // → '2026-08-01'
 */
export function epicCutoffDate(todayIso, windowDays) {
  const cutoff = new Date(`${todayIso}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (windowDays - 1));
  return cutoff.toISOString().slice(0, 10);
}

/**
 * Collects the IDs of every epic referenced by a log entry or a board task
 * dated on or after `cutoffIso`. Records with no `date` are ignored rather
 * than assumed recent — an undated record cannot vouch for an epic's
 * freshness, and treating it as recent would keep stale epics alive forever.
 * @param {{ entries?: Array<{tag?: string, date?: string}>, planTasks?: Array<{tag?: string, date?: string}> }} sources - Log entries and board tasks to scan.
 * @param {string} cutoffIso - Inclusive start of the window, as YYYY-MM-DD.
 * @returns {Set<string>} Epic IDs used within the window.
 */
export function collectRecentlyUsedCatIds({ entries = [], planTasks = [] }, cutoffIso) {
  const used = new Set();
  const scan = (records) => {
    records.forEach((record) => {
      if (!record || !record.tag || !record.date) return;
      if (record.date >= cutoffIso) used.add(record.tag);
    });
  };
  scan(entries);
  scan(planTasks);
  return used;
}

/**
 * Works out which epics have had no recorded activity inside the window and
 * are therefore safe to archive out of the pickers.
 *
 * An epic is kept when any of these hold: it is a built-in
 * (PROTECTED_CAT_IDS), it is the epic currently selected in the tag row, it is
 * already archived, or a log entry or board task dated within the window
 * references it.
 * @param {Object} params - Inputs for the staleness decision.
 * @param {Array<{id: string, label: string, archived?: boolean}>} params.categories - All known epics.
 * @param {Array<{tag?: string, date?: string}>} [params.entries] - Log entries to scan for usage.
 * @param {Array<{tag?: string, date?: string}>} [params.planTasks] - Board tasks to scan for usage.
 * @param {string} params.todayIso - Today's date as YYYY-MM-DD.
 * @param {number} [params.windowDays] - Inactivity window in days.
 * @param {string} [params.selectedTag] - Epic currently selected in the tag row; never archived.
 * @returns {{ staleIds: string[], cutoffIso: string }} IDs to archive (in `categories` order) and the cutoff date used.
 */
export function findStaleCategories({
  categories = [],
  entries = [],
  planTasks = [],
  todayIso,
  windowDays = EPIC_STALE_DAYS,
  selectedTag = null,
}) {
  const cutoffIso = epicCutoffDate(todayIso, windowDays);
  const used = collectRecentlyUsedCatIds({ entries, planTasks }, cutoffIso);
  const staleIds = categories
    .filter(
      (cat) =>
        cat &&
        !cat.archived &&
        !PROTECTED_CAT_IDS.includes(cat.id) &&
        cat.id !== selectedTag &&
        !used.has(cat.id)
    )
    .map((cat) => cat.id);
  return { staleIds, cutoffIso };
}

/**
 * Filters a category list down to the epics a picker should offer. Archived
 * epics are hidden, except for `keepId` — the currently selected epic stays
 * visible even once archived so an entry already tagged with it still renders
 * its own selection instead of appearing untagged.
 * @param {Array<{id: string, archived?: boolean}>} categories - All known epics.
 * @param {string|null} [keepId] - Epic ID to keep regardless of archived state.
 * @returns {Array<{id: string, archived?: boolean}>} The epics to offer, in input order.
 */
export function pickableCategories(categories = [], keepId = null) {
  return categories.filter((cat) => cat && (!cat.archived || cat.id === keepId));
}

/**
 * Returns a copy of `categories` with `archived: true` stamped on every epic
 * whose ID is in `staleIds`. Non-destructive: no record is dropped and every
 * other field is preserved untouched.
 * @param {Array<{id: string}>} categories - All known epics.
 * @param {string[]} staleIds - Epic IDs to archive.
 * @returns {Array<Object>} A new array with the archived epics flagged.
 */
export function applyEpicArchive(categories = [], staleIds = []) {
  const stale = new Set(staleIds);
  return categories.map((cat) => (stale.has(cat.id) ? { ...cat, archived: true } : cat));
}

/**
 * Returns a copy of `categories` with the `archived` flag cleared from one
 * epic, bringing it back into the pickers.
 * @param {Array<{id: string}>} categories - All known epics.
 * @param {string} catId - Epic ID to restore.
 * @returns {Array<Object>} A new array with the epic un-archived.
 */
export function restoreArchivedCategory(categories = [], catId) {
  return categories.map((cat) => {
    if (cat.id !== catId) return cat;
    const restored = { ...cat };
    delete restored.archived;
    return restored;
  });
}
