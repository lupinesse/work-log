// ── 22-trackers.js — Custom time-goal progress trackers ──

function loadTrackers() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_TRACKERS) || '[]');
    trackers = Array.isArray(raw) ? raw : [];
  } catch (e) {
    trackers = [];
  }
}

function saveTrackers() {
  localStorage.setItem(STORE_TRACKERS, JSON.stringify(trackers));
}

/**
 * Returns 'hit' | 'partial' | 'miss' for a given tracker on a given day.
 * @param {Object} tracker - Tracker object with tags and targetMinutes.
 * @param {string} dateKey - YYYY-MM-DD date key.
 * @returns {'hit'|'partial'|'miss'}
 */
function trackerDayStatus(tracker, dateKey) {
  const ms = entries
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
 * @param {Object} tracker
 * @returns {number} Number of consecutive hit days.
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
 * Shows a 28-day grid, streak, and hit count for each tracker.
 */
function renderTrackers() {
  const el = document.getElementById('trackerList');
  if (!el) return;

  if (!trackers.length) {
    el.innerHTML = '<div class="plan-empty">No trackers yet — click + New above.</div>';
    return;
  }

  // Last 28 days (oldest → newest)
  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (27 - i));
    return dk(d);
  });

  el.innerHTML = trackers
    .map((t) => {
      const streak = trackerStreak(t);
      const cells = days
        .map((dateKey) => {
          const status = trackerDayStatus(t, dateKey);
          const bg =
            status === 'hit' ? t.color : status === 'partial' ? t.color + '55' : 'var(--bg3)';
          return `<div class="tr-cell" style="background:${bg}" title="${dateKey}: ${status}"></div>`;
        })
        .join('');
      const hitCount = days.filter((d) => trackerDayStatus(t, d) === 'hit').length;
      const targetLabel =
        t.targetMinutes >= 60 ? `${t.targetMinutes / 60}h/day` : `${t.targetMinutes}m/day`;

      return `
      <div class="tracker-card">
        <div class="tracker-card-head">
          <span class="edot" style="background:${t.color}"></span>
          <span class="tracker-name">${escHtml(t.name)}</span>
          <span class="tracker-target">${targetLabel}</span>
          ${streak ? `<span class="tracker-streak">🔥 ${streak} day streak</span>` : '<span class="tracker-streak"></span>'}
          <button class="tracker-delete" data-id="${escHtml(t.id)}" aria-label="Delete tracker">✕</button>
        </div>
        <div class="tr-grid">${cells}</div>
        <div class="tracker-footer"><span>${hitCount}/28 days hit</span></div>
      </div>`;
    })
    .join('');

  document.querySelectorAll('.tracker-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      trackers = trackers.filter((t) => t.id !== btn.dataset.id);
      saveTrackers();
      renderTrackers();
    });
  });
}

let _trackerFormOpen = false;

/** Renders the new-tracker form inside #trackerNewForm. */
function openTrackerForm() {
  const formEl = document.getElementById('trackerNewForm');
  if (!formEl) return;
  _trackerFormOpen = true;
  formEl.style.display = '';
  const defaultColor = categories[0] ? categories[0].color : '#378ADD';
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
      <div class="tr-form-row">
        <label class="tr-form-lbl">Categories to count</label>
        <div class="tr-form-tags" id="trFormTags">
          ${categories
            .map(
              (c) =>
                `<label class="tr-tag-check">
              <input type="checkbox" value="${escHtml(c.id)}" />
              <span class="qp-chip" style="border-color:${c.color}44;color:${c.color};background:${c.color}11">${escHtml(c.label)}</span>
            </label>`
            )
            .join('')}
        </div>
      </div>
      <div class="tr-form-row">
        <label class="tr-form-lbl" for="trFormColor">Colour</label>
        <input type="color" id="trFormColor" value="${defaultColor}"
               style="width:40px;height:28px;cursor:pointer;border:none;background:none;padding:0" />
      </div>
      <div class="tr-form-actions">
        <button class="add-btn" id="trFormCancel">Cancel</button>
        <button class="add-btn refl-save" id="trFormSave">Add tracker</button>
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

function closeTrackerForm() {
  const formEl = document.getElementById('trackerNewForm');
  if (formEl) formEl.style.display = 'none';
  _trackerFormOpen = false;
}

function saveTrackerForm() {
  const name = (document.getElementById('trFormName')?.value || '').trim();
  if (!name) {
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
    alert('Please select at least one category.');
    return;
  }
  trackers.push({
    id: Date.now() + '',
    name,
    targetMinutes,
    tags,
    color,
  });
  saveTrackers();
  closeTrackerForm();
  renderTrackers();
}

function initTrackers() {
  renderTrackers();
  document.getElementById('trackerAddBtn')?.addEventListener('click', () => {
    if (_trackerFormOpen) {
      closeTrackerForm();
    } else {
      openTrackerForm();
    }
  });
}
