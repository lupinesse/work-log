/**
 * @file date-labels.js
 * Stateless date-to-label helpers: is a given date today, and what should it
 * be called ('today' / 'yesterday' / a short locale date). Only depends on
 * dk() (pure-fns) and JS builtins — no module state, no other-file calls.
 * Extracted from 02-utils.js (issue #336) — the rest of that file (getCat*,
 * renderTagRow, viewEntries, calcStreak, etc.) is genuinely entangled with
 * app state and later-loaded render functions and isn't extractable as a
 * whole; see ARCHITECTURE.md's 02-utils.js entry for why.
 */

import { dk } from './pure-fns.js';

/**
 * Returns true if `d` falls on today's calendar date.
 * @param {Date} d
 * @returns {boolean}
 */
export function isToday(d) {
  return dk(d) === dk(new Date());
}

/**
 * Returns a human-readable day label: 'today', 'yesterday', or a short locale date string.
 * @param {Date} d
 * @returns {string}
 */
export function fmtLabel(d) {
  if (isToday(d)) return 'today';
  const diffMs = new Date(dk(new Date())) - new Date(dk(d));
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays === 1) return 'yesterday';
  return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}
