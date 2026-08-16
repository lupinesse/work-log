/**
 * @file app-constants.js
 * Static configuration constants: localStorage key names, the built-in
 * category seed list, and the palette offered when creating a new category.
 * Pure literal values with no dependencies on other modules or app state.
 * Extracted from 01-state.js (issue #336) as the first step of the ongoing
 * ES-module extraction — see ARCHITECTURE.md and build-config.js's
 * LEAF_MODULES comment for why this matters.
 */

/** localStorage key for logged work entries. */
export const STORE_ENTRIES = 'wl_entries_v1';
/** localStorage key for the active timer state. */
export const STORE_TIMER = 'wl_timer_v1';
/** localStorage key for the pomodoro session log. */
export const STORE_POMO_LOG = 'wl_pomoLog_v1';
/** localStorage key for custom work categories. */
export const STORE_CATS = 'wl_cats_v1';
/** localStorage key for quick-pick items the user has dismissed. */
export const STORE_QP_HIDDEN = 'wl_qp_hidden_v1';
/** localStorage key for ad-hoc log notes. */
export const STORE_LOGNOTES = 'wl_lognotes_v1';
/** localStorage key for tracker progress grids. */
export const STORE_TRACKERS = 'wl_trackers_v1';
/** localStorage key for the end-of-month migration record. */
export const STORE_MIGRATION = 'wl_migration_v1';
/** localStorage key for the per-day work-location record. */
export const STORE_LOCATION = 'wl_location_v1';

/** Built-in categories seeded on first run. */
export const DEFAULT_CATS = [
  { id: 'work', label: 'work', color: '#378ADD' },
  { id: 'meeting', label: 'meeting', color: '#7EC8E3' },
  { id: 'focus', label: 'deep focus', color: '#1D9E75' },
  { id: 'break', label: 'break', color: '#BA7517' },
  { id: 'other', label: 'other', color: '#888780' },
];

/** Palette offered when creating a new category, in preference order. */
export const CUSTOM_PALETTE = [
  '#7B61FF',
  '#E67E22',
  '#0d9488',
  '#3F51B5',
  '#16A085',
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
