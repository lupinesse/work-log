// ── 01c-save.js — localStorage persistence and save-failure banner ──
//
// Leaf ES module: save() + the transient save-failure banner that prompts
// the user to export a backup on quota failure. Extracted from 01-state.js
// (issue #336, extraction #15).
//
// exportBackup is a non-leaf function; callers must register it via
// setExportBackupCallback() during app startup before any save failure
// can occur.

import { STORE_ENTRIES, STORE_TIMER, STORE_CATS } from './app-constants.js';
import { getEntries, getActiveTimer, getCategories } from './state.js';
import { wlLog } from './logger.js';

/** Registered exportBackup function, injected at startup to avoid a non-leaf dep. */
let _exportBackupFn = null;

/**
 * Registers the exportBackup function so the save-failure banner's export
 * button can invoke it. Must be called once during app startup, before any
 * save() call that could fail.
 * @param {Function} fn - The exportBackup function from 05a-export.js.
 */
export function setExportBackupCallback(fn) {
  _exportBackupFn = fn;
}

// Reference to the currently-shown save-failure banner, or null when hidden.
let saveFailBanner = null;

/**
 * Shows a persistent, dismissible banner warning that saving to localStorage
 * is failing (e.g. quota exceeded), with a button to export a backup on the
 * spot. Idempotent — a second failed save while the banner is already up
 * does nothing, so repeat failures don't spam duplicate banners.
 */
export function showSaveFailureBanner() {
  if (saveFailBanner) return;

  const banner = document.createElement('div');
  banner.className = 'save-fail-banner';
  banner.id = 'saveFailBanner';
  banner.setAttribute('role', 'alert');

  const msg = document.createElement('span');
  msg.className = 'save-fail-banner__msg';
  msg.textContent = '⚠ Saving failed — your data may not persist. Export a backup now.';

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'save-fail-banner__action';
  exportBtn.textContent = 'Export backup';
  exportBtn.addEventListener('click', () => _exportBackupFn?.());

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'save-fail-banner__dismiss';
  dismissBtn.setAttribute('aria-label', 'Dismiss saving-failed warning');
  dismissBtn.textContent = '×';
  dismissBtn.addEventListener('click', () => hideSaveFailureBanner());

  banner.appendChild(msg);
  banner.appendChild(exportBtn);
  banner.appendChild(dismissBtn);
  document.body.prepend(banner);
  saveFailBanner = banner;
}

/** Removes the save-failure banner, if one is currently shown. */
export function hideSaveFailureBanner() {
  saveFailBanner?.remove();
  saveFailBanner = null;
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
 *
 * If localStorage.setItem throws (e.g. QuotaExceededError), the failure is
 * caught so it never propagates to save()'s many callers — silently losing
 * data with no signal to the user is worse than a caught, logged, and
 * surfaced failure. A persistent banner tells the user to export a backup;
 * it clears itself automatically the next time a save() call succeeds.
 */
export function save() {
  // Never overwrite real data with empty arrays
  const existing = localStorage.getItem(STORE_ENTRIES);
  if (!getEntries().length && existing && existing !== '[]') {
    wlLog.warn('save() blocked — refusing to overwrite existing entries with empty array');
    return;
  }
  try {
    localStorage.setItem(STORE_ENTRIES, JSON.stringify(getEntries()));
    localStorage.setItem(STORE_TIMER, JSON.stringify(getActiveTimer()));
    localStorage.setItem(STORE_CATS, JSON.stringify(getCategories()));
    hideSaveFailureBanner();
  } catch (err) {
    wlLog.error('save: localStorage.setItem failed — data is not persisting', err);
    showSaveFailureBanner();
  }
}
