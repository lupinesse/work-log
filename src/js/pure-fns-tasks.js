/**
 * @file pure-fns-tasks.js
 * Task/day helpers: rapid-capture inline token grammar, carry-forward status
 * resolution, and per-day work-location helpers. Split out of pure-fns.js
 * (re-exported there as a barrel). Pure functions with no side-effects and no
 * global state — a leaf ES module (imports only from pure-fns-format.js).
 */

import { dk } from './pure-fns-format.js';

// ── Rapid-capture inline token grammar ───────────────────────────────────────

/**
 * Signifier shortcode map for quick-capture inline tokens.
 * Maps `!<shortcode>` tokens to signifier values used on entry objects.
 * Unmapped tokens are left in the text unchanged.
 * @type {Object<string, string>}
 */
const RAPID_SIG_SHORTCUTS = {
  event: 'event',
  ev: 'event',
  e: 'event',
  flagged: 'flagged',
  flag: 'flagged',
  f: 'flagged',
  star: 'flagged',
  migrated: 'migrated',
  migrate: 'migrated',
  m: 'migrated',
  cancelled: 'cancelled',
  cancel: 'cancelled',
  x: 'cancelled',
  drop: 'cancelled',
  overtime: 'overtime',
  ot: 'overtime',
};

/**
 * Resolves a `>date` shorthand token to a YYYY-MM-DD date key.
 * Supported tokens: 'today', 'tomorrow', exact 'YYYY-MM-DD', and weekday abbreviations
 * 'mon'–'sun' (resolves to the next occurrence, never today).
 *
 * @param {string} token - Raw date token (without the leading `>`).
 * @param {Date} [now] - Reference date for relative resolution; defaults to new Date().
 * @returns {string|null} Resolved date key, or null if the token is unrecognised.
 */
function resolveRapidDate(token, now) {
  if (!token) return null;
  const ref = now || new Date();
  const t = token.toLowerCase();

  if (t === 'today') return dk(ref);

  if (t === 'tomorrow') {
    const d = new Date(ref);
    d.setDate(d.getDate() + 1);
    return dk(d);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;

  const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const idx = DOW.indexOf(t.slice(0, 3));
  if (idx >= 0) {
    const d = new Date(ref);
    const diff = (idx - d.getDay() + 7) % 7 || 7; // always NEXT occurrence
    d.setDate(d.getDate() + diff);
    return dk(d);
  }

  return null;
}

/**
 * Parses inline shorthand tokens from a raw quick-capture input string and
 * returns a clean text plus structured token values.
 *
 * Supported tokens (each stripped from the returned `text`):
 * - `#<cat>`  — Category: matched against category ids and labels (case-insensitive;
 *               prefix match as fallback). Last occurrence wins.
 * - `!<sig>`  — Signifier shortcode (see RAPID_SIG_SHORTCUTS). Last occurrence wins.
 * - `><date>` — Date pointer: today, tomorrow, YYYY-MM-DD, or weekday mon–sun
 *               (next occurrence). Last occurrence wins.
 *
 * Unrecognised tokens are left in the text unchanged so the user sees them and can
 * correct them without data being silently discarded.
 *
 * @param {string} raw - Raw input text that may contain inline shorthand tokens.
 * @param {Array<{id: string, label: string}>} cats - Available categories for `#` resolution.
 * @param {Date} [now] - Reference date for relative date resolution; defaults to new Date().
 * @returns {{ text: string, tag: string|null, signifier: string|null, date: string|null }}
 */
export function parseRapidTokens(raw, cats, now) {
  let text = raw;
  let tag = null;
  let signifier = null;
  let date = null;

  // ── #category ──────────────────────────────────────────────────────────────
  text = text.replace(/#([\w-]+)/g, function (match, tok) {
    const lower = tok.toLowerCase();
    const catArr = cats || [];
    // Exact id match → label match → id-prefix match → label-prefix match
    const resolved =
      catArr.find((c) => c.id.toLowerCase() === lower) ||
      catArr.find((c) => c.label.toLowerCase() === lower) ||
      catArr.find((c) => c.id.toLowerCase().startsWith(lower)) ||
      catArr.find((c) => c.label.toLowerCase().startsWith(lower)) ||
      null;
    if (resolved) {
      tag = resolved.id;
      return '';
    }
    return match; // unrecognised — leave in text
  });

  // ── !signifier ─────────────────────────────────────────────────────────────
  text = text.replace(/!(\w+)/g, function (match, tok) {
    const key = tok.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(RAPID_SIG_SHORTCUTS, key)) {
      signifier = RAPID_SIG_SHORTCUTS[key];
      return '';
    }
    return match; // unrecognised — leave in text
  });

  // ── >date ──────────────────────────────────────────────────────────────────
  text = text.replace(/>([A-Za-z0-9-]+)/g, function (match, tok) {
    const resolved = resolveRapidDate(tok, now);
    if (resolved) {
      date = resolved;
      return '';
    }
    return match; // unrecognised — leave in text
  });

  // Collapse extra whitespace produced by token removal
  text = text.replace(/\s{2,}/g, ' ').trim();

  return { text, tag, signifier, date };
}

/**
 * Determines the carry-forward status a today-task should adopt based on its
 * most recent past peer, implementing the following rules:
 *
 * - `pending` or `blocked` prev overrides `todo` or `inprogress` today — the
 *   task is still blocked so the blocking state wins.
 * - `upcoming` prev overrides **only** a `todo` today — a todo placeholder
 *   created from an even-older copy should reflect the more recent intent to
 *   defer. It must NOT override `inprogress`, because the user explicitly
 *   started the task and a reload must not undo that.
 * - `inprogress` prev promotes a `todo` today — the task was already being
 *   worked on and the carry placeholder should show that.
 *
 * Returns `null` when no change is needed.
 *
 * @param {{ status: string, text: string }} todayTask - Today's task object.
 * @param {{ status: string, text: string, date: string }} prev - Most recent
 *   past task with the same text (case-insensitive).
 * @returns {string|null} The new status to apply, or `null` for no change.
 * @example
 * resolveCarryStatus({ status: 'todo' }, { status: 'upcoming' }) // → 'upcoming'
 * resolveCarryStatus({ status: 'inprogress' }, { status: 'upcoming' }) // → null
 * resolveCarryStatus({ status: 'todo' }, { status: 'pending' })  // → 'pending'
 */
export function resolveCarryStatus(todayTask, prev) {
  const prevIsBlocking = prev.status === 'pending' || prev.status === 'blocked';
  const todayIsTodo = todayTask.status === 'todo';
  const todayIsActive = todayIsTodo || todayTask.status === 'inprogress';

  if (prevIsBlocking && todayIsActive) return prev.status;

  if (prev.status === 'upcoming' && todayIsTodo) return 'upcoming';

  if (todayIsTodo && prev.status === 'inprogress') return 'inprogress';

  return null;
}

/**
 * Finds plan tasks explicitly scheduled as 'upcoming' whose date falls within
 * `[weekStartKey, weekEndKey)` — candidates for the weekly plan review
 * checklist, run once a new ISO week begins so stale "upcoming" tasks (ones
 * already finished elsewhere before their target week arrived) get caught
 * and reconciled instead of silently resurfacing on their date.
 *
 * Compares `date` as strings, not timestamps: `YYYY-MM-DD` keys already sort
 * and compare correctly lexicographically, so no Date conversion is needed.
 *
 * @param {Array<Object>} planTasks - All plan/board tasks.
 * @param {string} weekStartKey - Inclusive YYYY-MM-DD (e.g. this week's Monday).
 * @param {string} weekEndKey - Exclusive YYYY-MM-DD (e.g. next week's Monday).
 * @returns {Array<Object>} Matching tasks, sorted by date ascending.
 * @example
 * findWeeklyPlanReviewTasks(
 *   [{ id: '1', text: 'PROJ-1: Fix login', status: 'upcoming', date: '2026-06-03' }],
 *   '2026-06-01', '2026-06-08'
 * )
 * // → [{ id: '1', text: 'PROJ-1: Fix login', status: 'upcoming', date: '2026-06-03' }]
 */
export function findWeeklyPlanReviewTasks(planTasks, weekStartKey, weekEndKey) {
  return (planTasks || [])
    .filter((t) => t.status === 'upcoming' && t.date >= weekStartKey && t.date < weekEndKey)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Finds today's plan task matching `text` (case-insensitive), for promotion
 * to "in progress" when a timer starts on that text — regardless of which UI
 * control (hero composer, recent chip, capture input, board's own "track"
 * button) started it. Returns `null` when there's no match, or the match
 * isn't in a promotable state (only `todo`/`upcoming` tasks are promoted —
 * an already-`inprogress`, `pending`, `blocked`, or `done` task is left
 * alone). Doesn't mutate `planTasks`; callers apply the status change.
 *
 * Task/entry linkage is by date + case-insensitive text match — the same
 * convention {@link buildTaskNoteMap} uses, because plan tasks and log
 * entries share no `taskId` field.
 *
 * @param {Array<Object>} planTasks - All plan/board tasks.
 * @param {string} text - The entry text a timer was just started on.
 * @param {string} todayKey - Today's date key (YYYY-MM-DD).
 * @returns {Object|null} The matching plan task to promote, or null.
 * @example
 * findPromotableTask(
 *   [{ id: 't1', text: 'Fix login', date: '2026-06-04', status: 'todo' }],
 *   'Fix login',
 *   '2026-06-04'
 * ) // → { id: 't1', text: 'Fix login', date: '2026-06-04', status: 'todo' }
 * @example
 * findPromotableTask(
 *   [{ id: 't1', text: 'Fix login', date: '2026-06-04', status: 'inprogress' }],
 *   'Fix login',
 *   '2026-06-04'
 * ) // → null — already in progress, nothing to promote
 */
export function findPromotableTask(planTasks, text, todayKey) {
  const task = (planTasks || []).find(
    (t) => t.date === todayKey && t.text.toLowerCase() === (text || '').toLowerCase()
  );
  if (!task || (task.status !== 'todo' && task.status !== 'upcoming')) return null;
  return task;
}

/* ── Work location ── */

/**
 * Work-location presets keyed by their stored id. Each entry carries the emoji
 * and human-readable label shown in the date-nav header. The first key is the
 * default applied to any day with no stored location.
 * @type {Readonly<Record<string, { emoji: string, label: string }>>}
 */
export const WORK_LOCATIONS = Object.freeze({
  remote: { emoji: '🏠', label: 'Remote' },
  office: { emoji: '🏢', label: 'Office' },
});

/** Location id used for any day that has no stored value. */
const DEFAULT_WORK_LOCATION = 'remote';

/**
 * Resolves the stored work location for a given day, falling back to the
 * default when the day is unset or holds an unknown value.
 * @param {Record<string, string>} map - Date-key → location-id map.
 * @param {string} dateKey - Day key in YYYY-MM-DD form (see {@link dk}).
 * @returns {string} A valid location id present in {@link WORK_LOCATIONS}.
 * @example
 * locationFor({ '2026-06-03': 'office' }, '2026-06-03') // → 'office'
 * locationFor({}, '2026-06-03')                         // → 'remote'
 * locationFor({ '2026-06-03': 'bogus' }, '2026-06-03')  // → 'remote'
 */
export function locationFor(map, dateKey) {
  const stored = map && map[dateKey];
  return Object.prototype.hasOwnProperty.call(WORK_LOCATIONS, stored)
    ? stored
    : DEFAULT_WORK_LOCATION;
}

/**
 * Returns the next location id when toggling, cycling through the keys of
 * {@link WORK_LOCATIONS}. With the two presets this flips Remote ↔ Office.
 * An unrecognised `loc` (indexOf → -1) is treated as "before the first" and
 * wraps to the first location, so the toggle always recovers to a valid state.
 * @param {string} loc - Current location id.
 * @returns {string} The following location id (wraps around).
 * @example
 * nextLocation('remote') // → 'office'
 * nextLocation('office') // → 'remote'
 * nextLocation('bogus')  // → 'remote'  (unknown input recovers to the first)
 */
export function nextLocation(loc) {
  const ids = Object.keys(WORK_LOCATIONS);
  const idx = ids.indexOf(loc);
  return ids[(idx + 1) % ids.length];
}
