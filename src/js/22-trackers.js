/**
 * @file 22-trackers.js — Custom time-goal progress trackers: load/save,
 * rendering, streak calculation, and the new-tracker form lifecycle.
 */

import { STORE_TRACKERS } from './app-constants.js';
import { getTrackers, setTrackers, getEntries, getCategories } from './state.js';
import { wlLog } from './logger.js';
import { dk, escHtml, safeCssColor } from './pure-fns-format.js';
import { pickableCategories } from './pure-fns-epics.js';

/**
 * Loads the trackers array from localStorage into module state.
 * Falls back to an empty array and logs a warning on parse failure.
 * @returns {void}
 */
export function loadTrackers() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_TRACKERS) || '[]');
    setTrackers(Array.isArray(raw) ? raw : []);
  } catch (err) {
    setTrackers([]);
    wlLog.warn('loadTrackers: failed to parse trackers from localStorage', err);
  }
}

/**
 * Persists the current trackers array to localStorage.
 * @returns {void}
 */
export function saveTrackers() {
  localStorage.setItem(STORE_TRACKERS, JSON.stringify(getTrackers()));
}

/**
 * Returns 'hit' | 'partial' | 'miss' for a given tracker on a given day.
 * @param {Object} tracker - Tracker object with tags and targetMinutes.
 * @param {string} dateKey - YYYY-MM-DD date key.
 * @returns {'hit'|'partial'|'miss'}
 */
export function trackerDayStatus(tracker, dateKey) {
  const ms = getEntries()
    .filter(
      (e) =>
        e.date === dateKey && tracker.tags.includes(e.tag) && e.tsEnd && e.signifier !== 'cancelled'
    )
    .reduce((sum, e) => sum + (e.tsEnd - e.ts), 0);
  const mins = ms / 60000;
  if (mins >= tracker.targetMinutes) return 'hit';
  if (mins >= tracker.targetMinutes * 0.5) return 'partial';
  return 'miss';
}

/**
 * Calculates the current consecutive "hit" streak for a tracker, ending today.
 * Walks backwards day-by-day (up to 60 days) and stops at the first non-hit day.
 * @param {Object} tracker - Tracker object with `tags` and `targetMinutes`.
 * @returns {number} Number of consecutive hit days ending today.
 */
function trackerStreak(tracker) {
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 60; i++) {
    const dateKey = dk(d);
    if (trackerDayStatus(tracker, dateKey) === 'hit') {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Renders all tracker cards into #trackerList.
 * Each card shows a 28-day hit/partial/miss grid, current streak, and total hit count.
 * Attaches delete-button listeners after render.
 * @returns {void}
 */
export function renderTrackers() {
  const el = document.getElementById('trackerList');
  if (!el) return;

  const trackers = getTrackers();
  if (!trackers.length) {
    wlLog.info('renderTrackers: empty state');
    el.innerHTML = '<div class="plan-empty">No trackers yet — click + New above.</div>';
    return;
  }
  wlLog.info('renderTrackers: rendering trackers', { count: trackers.length });

  // Last 28 days (oldest → newest)
  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (27 - i));
    return dk(d);
  });

  el.innerHTML = trackers
    .map((tracker) => {
      const streak = trackerStreak(tracker);
      const cells = days
        .map((dateKey) => {
          const status = trackerDayStatus(tracker, dateKey);
          const bg =
            status === 'hit'
              ? tracker.color
              : status === 'partial'
                ? tracker.color + '55'
                : 'var(--bg3)';
          return `<div class="tr-cell" style="background:${bg}" title="${dateKey}: ${status}" aria-hidden="true"></div>`;
        })
        .join('');
      const hitCount = days.filter((day) => trackerDayStatus(tracker, day) === 'hit').length;
      const targetLabel =
        tracker.targetMinutes >= 60
          ? `${tracker.targetMinutes / 60}h/day`
          : `${tracker.targetMinutes}m/day`;

      return `
      <div class="tracker-card">
        <div class="tracker-card-head">
          <span class="edot" style="background:${safeCssColor(tracker.color)}" aria-hidden="true"></span>
          <span class="tracker-name">${escHtml(tracker.name)}</span>
          <span class="tracker-target">${targetLabel}</span>
          ${streak ? `<span class="tracker-streak">🔥 ${streak} day streak</span>` : '<span class="tracker-streak"></span>'}
          <button class="tracker-delete" data-id="${escHtml(tracker.id)}" aria-label="Delete tracker: ${escHtml(tracker.name)}">✕</button>
        </div>
        <div class="tr-grid" role="img" aria-label="28-day activity grid for ${escHtml(tracker.name)}">${cells}</div>
        <div class="tracker-footer"><span>${hitCount}/28 days hit</span></div>
      </div>`;
    })
    .join('');

  document.querySelectorAll('.tracker-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTrackers(getTrackers().filter((tracker) => tracker.id !== btn.dataset.id));
      saveTrackers();
      renderTrackers();
    });
  });
}

let _trackerFormOpen = false;

/**
 * Shows and populates the new-tracker form inside #trackerNewForm.
 * Pre-fills the colour picker with the first category's colour.
 * Attaches Save / Cancel / keyboard listeners.
 * @returns {void}
 */
function openTrackerForm() {
  const formEl = document.getElementById('trackerNewForm');
  if (!formEl) return;
  _trackerFormOpen = true;
  formEl.style.display = '';
  const cats = getCategories();
  const defaultColor = cats[0] ? cats[0].color : '#378ADD';
  formEl.innerHTML = `
    <div class="tr-form">
      <div class="tr-form-row">
        <label class="tr-form-lbl" for="trFormName">Name</label>
        <input class="capture-input tr-form-name" id="trFormName"
               placeholder="e.g. Deep work" autocomplete="off" />
      </div>
      <div class="tr-form-row">
        <label class="tr-form-lbl" for="trFormMins">Daily target (minutes)</label>
        <input class="capture-input" id="trFormMins" type="number"
               min="5" max="480" value="60" style="width:80px" />
      </div>
      <fieldset class="tr-form-row tr-form-row--fieldset">
        <legend class="tr-form-lbl">Categories to count</legend>
        <div class="tr-form-tags" id="trFormTags">
          ${pickableCategories(cats)
            .map(
              (cat) =>
                `<label class="tr-tag-check">
              <input type="checkbox" value="${escHtml(cat.id)}" />
              <span class="qp-chip" style="border-color:${safeCssColor(cat.color)}44;color:${safeCssColor(cat.color)};background:${safeCssColor(cat.color)}11">${escHtml(cat.label)}</span>
            </label>`
            )
            .join('')}
        </div>
      </fieldset>
      <div class="tr-form-row">
        <label class="tr-form-lbl" for="trFormColor">Colour</label>
        <input type="color" id="trFormColor" value="${defaultColor}"
               style="width:40px;height:28px;cursor:pointer;border:none;background:none;padding:0" />
      </div>
      <div class="tr-form-actions">
        <button class="add-btn" id="trFormCancel">Cancel</button>
        <button class="add-btn add-btn--save" id="trFormSave">Add tracker</button>
      </div>
    </div>`;

  document.getElementById('trFormCancel').addEventListener('click', closeTrackerForm);
  document.getElementById('trFormSave').addEventListener('click', saveTrackerForm);
  document.getElementById('trFormName').focus();
  document.getElementById('trFormName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveTrackerForm();
    if (e.key === 'Escape') closeTrackerForm();
  });
}

/**
 * Hides the new-tracker form and resets the open-state flag.
 * @returns {void}
 */
function closeTrackerForm() {
  const formEl = document.getElementById('trackerNewForm');
  if (formEl) formEl.style.display = 'none';
  _trackerFormOpen = false;
}

/**
 * Reads the new-tracker form, validates inputs, pushes the tracker to the
 * trackers array, persists it, and re-renders. Shows an alert if no category
 * is selected; focuses the name field if the name is empty.
 * @returns {void}
 */
function saveTrackerForm() {
  const name = (document.getElementById('trFormName')?.value || '').trim();
  if (!name) {
    wlLog.info('saveTrackerForm: rejected — empty name');
    document.getElementById('trFormName')?.focus();
    return;
  }
  const minsRaw = parseInt(document.getElementById('trFormMins')?.value || '60', 10);
  const targetMinutes = isNaN(minsRaw) || minsRaw < 1 ? 60 : minsRaw;
  const color = document.getElementById('trFormColor')?.value || '#378ADD';
  const tags = [...document.querySelectorAll('#trFormTags input[type=checkbox]:checked')].map(
    (cb) => cb.value
  );
  if (!tags.length) {
    wlLog.info('saveTrackerForm: rejected — no categories selected', { name });
    alert('Please select at least one category.');
    return;
  }
  setTrackers([
    ...getTrackers(),
    {
      id: Date.now() + '',
      name,
      targetMinutes,
      tags,
      color,
    },
  ]);
  saveTrackers();
  wlLog.info('saveTrackerForm: tracker added', { name, targetMinutes, tagCount: tags.length });
  closeTrackerForm();
  renderTrackers();
}

/**
 * Bootstraps the Trackers feature: performs the initial render and wires up
 * the "+ New" button to toggle the tracker form open/closed.
 * Called once on DOMContentLoaded.
 * @returns {void}
 */
export function initTrackers() {
  renderTrackers();
  document.getElementById('trackerAddBtn')?.addEventListener('click', () => {
    if (_trackerFormOpen) {
      closeTrackerForm();
    } else {
      openTrackerForm();
    }
  });
}
