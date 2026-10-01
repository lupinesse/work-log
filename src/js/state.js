/**
 * @file state.js — accessor layer for core shared mutable state; prerequisite for ES-module extraction (#423, #336).
 */

import { DEFAULT_CATS } from './app-constants.js';

/* ── Core mutable state ── */

let _entries = [];
let _activeTimer = null;
let _timerInterval = null;
let _categories = [...DEFAULT_CATS];
let _selectedTag = 'work';
let _viewDate = new Date();
let _logNotes = [];
let _trackers = [];
let _blocks = [];
let _planTasks = [];

/* ── entries ── */

/**
 * Returns the current array of work-log entries.
 * @returns {Array} The live entries array.
 */
export function getEntries() {
  return _entries;
}

/**
 * Replaces the entries array.
 * @param {Array} next - New entries array.
 */
export function setEntries(next) {
  _entries = next;
}

/* ── activeTimer ── */

/**
 * Returns the current active timer object, or null when no timer is running.
 * @returns {object|null} The active timer state object, or null.
 */
export function getActiveTimer() {
  return _activeTimer;
}

/**
 * Replaces the active timer state.
 * @param {object|null} next - New timer object, or null to clear it.
 */
export function setActiveTimer(next) {
  _activeTimer = next;
}

/* ── timerInterval ── */

/**
 * Returns the current setInterval ID for the running timer, or null.
 * @returns {number|null} The interval ID, or null when not ticking.
 */
export function getTimerInterval() {
  return _timerInterval;
}

/**
 * Stores a new timer interval ID (or null to clear it).
 * @param {number|null} next - The new interval ID.
 */
export function setTimerInterval(next) {
  _timerInterval = next;
}

/**
 * Stops the running timer's tick, if one is held, and resets the stored ID to
 * null. A no-op when nothing is ticking. Callers used to repeat the
 * read/clear/reset sequence by hand; keeping it here means the interval can
 * never be cleared without also being forgotten.
 * @returns {void}
 */
export function clearTimerInterval() {
  if (_timerInterval) clearInterval(_timerInterval);
  _timerInterval = null;
}

/* ── categories ── */

/**
 * Returns the live categories array.
 * @returns {Array<{id: string, label: string, color: string}>} Categories array.
 */
export function getCategories() {
  return _categories;
}

/**
 * Replaces the categories array.
 * @param {Array<{id: string, label: string, color: string}>} next - New categories.
 */
export function setCategories(next) {
  _categories = next;
}

/* ── selectedTag ── */

/**
 * Returns the currently selected tag (e.g. 'work', 'personal').
 * @returns {string} The selected tag.
 */
export function getSelectedTag() {
  return _selectedTag;
}

/**
 * Sets the currently selected tag.
 * @param {string} next - The new tag value.
 */
export function setSelectedTag(next) {
  _selectedTag = next;
}

/* ── viewDate ── */

/**
 * Returns the Date the timeline is currently showing.
 * @returns {Date} The view date.
 */
export function getViewDate() {
  return _viewDate;
}

/**
 * Replaces the view date.
 * @param {Date} next - The new view date.
 */
export function setViewDate(next) {
  _viewDate = next;
}

/* ── logNotes ── */

/**
 * Returns the live log-notes array.
 * @returns {Array} The log notes.
 */
export function getLogNotes() {
  return _logNotes;
}

/**
 * Replaces the log-notes array.
 * @param {Array} next - New log-notes array.
 */
export function setLogNotes(next) {
  _logNotes = next;
}

/* ── trackers ── */

/**
 * Returns the live trackers array.
 * @returns {Array} The trackers.
 */
export function getTrackers() {
  return _trackers;
}

/**
 * Replaces the trackers array.
 * @param {Array} next - New trackers array.
 */
export function setTrackers(next) {
  _trackers = next;
}

/* ── blocks ── */

/**
 * Returns the live time-blocks array.
 * @returns {Array} The blocks.
 */
export function getBlocks() {
  return _blocks;
}

/**
 * Replaces the time-blocks array.
 * @param {Array} next - New blocks array.
 */
export function setBlocks(next) {
  _blocks = next;
}

/* ── planTasks ── */

/**
 * Returns the live plan-tasks array.
 * @returns {Array} The plan tasks.
 */
export function getPlanTasks() {
  return _planTasks;
}

/**
 * Replaces the plan-tasks array.
 * @param {Array} next - New plan-tasks array.
 */
export function setPlanTasks(next) {
  _planTasks = next;
}
