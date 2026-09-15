/**
 * @file state-access.js
 * Accessor layer for the app's core mutable state.
 *
 * Part of the ES-module extraction initiative (#336) — see #423 for the
 * full rationale. `01-state.js` and the other ~48 non-leaf files currently
 * hold this state as plain `let` bindings shared through the concatenated
 * build scope, and several of them reassign it directly (`categories =
 * ...`, `selectedTag = ...`). An ES module's `import` binding is live but
 * read-only, so a file that reassigns shared state cannot become a real
 * leaf module until that state is reached through accessor functions
 * instead of a bare binding.
 *
 * This module is a deliberately small first step: it declares the
 * accessors and its own internal state, initialized to the same defaults
 * `01-state.js` uses today, but nothing yet reads or writes through it.
 * `01-state.js` keeps its own bindings unchanged, so the app's behavior is
 * completely unaffected by this file's addition. Follow-up PRs migrate one
 * file's reads/writes to these accessors at a time, per #423's plan.
 */

/** @type {Array<{id: string, label: string, color: string, archived?: boolean, billable?: boolean}>} */
let categories = [];

/**
 * Returns the current category list.
 * @returns {Array<Object>} The live categories array (not a copy).
 */
export function getCategories() {
  return categories;
}

/**
 * Replaces the category list.
 * @param {Array<Object>} next - The new categories array.
 * @returns {void}
 */
export function setCategories(next) {
  categories = next;
}

/** @type {string} */
let selectedTag = 'work';

/**
 * Returns the currently selected epic/category id.
 * @returns {string}
 */
export function getSelectedTag() {
  return selectedTag;
}

/**
 * Sets the currently selected epic/category id.
 * @param {string} next - The new selected tag.
 * @returns {void}
 */
export function setSelectedTag(next) {
  selectedTag = next;
}

/** @type {Array<Object>} */
let entries = [];

/**
 * Returns the current log entries.
 * @returns {Array<Object>} The live entries array (not a copy).
 */
export function getEntries() {
  return entries;
}

/**
 * Replaces the log entries.
 * @param {Array<Object>} next - The new entries array.
 * @returns {void}
 */
export function setEntries(next) {
  entries = next;
}

/** @type {Array<Object>} */
let planTasks = [];

/**
 * Returns the current board/plan tasks.
 * @returns {Array<Object>} The live planTasks array (not a copy).
 */
export function getPlanTasks() {
  return planTasks;
}

/**
 * Replaces the board/plan tasks.
 * @param {Array<Object>} next - The new planTasks array.
 * @returns {void}
 */
export function setPlanTasks(next) {
  planTasks = next;
}

/** @type {Date} */
let viewDate = new Date();

/**
 * Returns the date currently being viewed in the log.
 * @returns {Date}
 */
export function getViewDate() {
  return viewDate;
}

/**
 * Sets the date currently being viewed in the log.
 * @param {Date} next - The new view date.
 * @returns {void}
 */
export function setViewDate(next) {
  viewDate = next;
}

/** @type {Object|null} */
let activeTimer = null;

/**
 * Returns the currently running timer, or null when no timer is active.
 * @returns {Object|null}
 */
export function getActiveTimer() {
  return activeTimer;
}

/**
 * Sets the currently running timer.
 * @param {Object|null} next - The new active timer, or null to clear it.
 * @returns {void}
 */
export function setActiveTimer(next) {
  activeTimer = next;
}

/** @type {number|null} setInterval handle for the running timer's tick. */
let timerInterval = null;

/**
 * Returns the setInterval handle driving the running timer's tick, or null
 * when no timer is active.
 * @returns {number|null}
 */
export function getTimerInterval() {
  return timerInterval;
}

/**
 * Sets the setInterval handle driving the running timer's tick.
 * @param {number|null} next - The new interval handle, or null to clear it.
 * @returns {void}
 */
export function setTimerInterval(next) {
  timerInterval = next;
}

/** @type {Array<Object>} */
let blocks = [];

/**
 * Returns the current timeblock-planner blocks.
 * @returns {Array<Object>} The live blocks array (not a copy).
 */
export function getBlocks() {
  return blocks;
}

/**
 * Replaces the timeblock-planner blocks.
 * @param {Array<Object>} next - The new blocks array.
 * @returns {void}
 */
export function setBlocks(next) {
  blocks = next;
}
