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
 * It also sweeps out RETIRED_KEYS: keys whose owning feature has been
 * removed, so they do not linger in the browser forever.
 *
 * Retiring a key: when you delete a feature, append its key to RETIRED_KEYS
 * and drop the key from DATA.md in the same change. Same rule as MIGRATIONS —
 * never remove an entry once added, or users who skipped that version keep the
 * orphan forever.
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

/**
 * Fixes entry `date` fields that were stored using UTC midnight instead of the
 * user's local calendar date.
 *
 * Background: `dk()` previously called `toISOString()` (UTC). For UTC+ users
 * (e.g., Finland, UTC+2/+3), entries logged between local midnight and 02:00–03:00
 * were stored under the previous day's UTC date. This migration re-derives `date`
 * from the entry's `ts` timestamp using the now-correct local `dk()`.
 *
 * Safe to run multiple times — entries already on the correct local date are untouched.
 */
function migrateEntryDatesToLocal() {
  const raw = localStorage.getItem('wl_entries_v1');
  if (!raw) return;
  try {
    const all = JSON.parse(raw);
    if (!Array.isArray(all)) return;
    let changed = 0;
    const fixed = all.map((e) => {
      if (typeof e.ts !== 'number' || typeof e.date !== 'string') return e;
      const localDate = dk(new Date(e.ts)); // dk() now returns local date
      if (e.date !== localDate) {
        changed++;
        return { ...e, date: localDate };
      }
      return e;
    });
    if (changed > 0) {
      localStorage.setItem('wl_entries_v1', JSON.stringify(fixed));
      wlLog.info(`migrate: corrected ${changed} entry date(s) from UTC to local calendar date`);
    }
  } catch (err) {
    wlLog.warn('migrate: failed to correct entry dates (UTC → local)', err);
  }
}

/**
 * Describes one localStorage key whose owning feature has been removed.
 * @typedef {{ key: string, description: string }} RetiredKey
 */

/**
 * localStorage keys belonging to features that have since been removed.
 * Entries are never deleted from this list — a user upgrading across several
 * versions still needs the key swept out of their browser.
 * @type {RetiredKey[]}
 */
const RETIRED_KEYS = [
  { key: 'wl_seen_ended_v1', description: 'post-meeting transition-bridge banner' },
];

/**
 * Deletes localStorage keys left behind by removed features.
 * Safe to call multiple times — absent keys are skipped. A storage failure on
 * one key is logged and the sweep continues: this is best-effort cleanup, and
 * an orphaned key is never worth aborting page load over.
 * @returns {number} How many keys were actually removed.
 */
function removeRetiredKeys() {
  let removed = 0;
  for (const { key, description } of RETIRED_KEYS) {
    try {
      if (localStorage.getItem(key) === null) continue;
      localStorage.removeItem(key);
      removed++;
      wlLog.info(`migrate: removed retired key "${key}" (${description})`);
    } catch (err) {
      wlLog.warn(`migrate: could not remove retired key "${key}" (${description})`, err);
    }
  }
  return removed;
}

// Run immediately so data is in the right keys before load() is called.
migrateStorage();
migrateEntryDatesToLocal();
removeRetiredKeys();
