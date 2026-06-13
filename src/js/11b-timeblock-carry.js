/* ── Timeblock — day-boundary carry & completed history ── */
// Split out of 11-timeblock.js (QA finding: module size). Contains the
// plan-task day-boundary lifecycle: carry-over of unfinished tasks
// (autoCarryTasks), post-carry migrations and status patches
// (patchCarriedTasks), iteration expiry dates (seed, load, edit modal, save),
// the completed-task history renderer with its collapse state, and the
// delegated bill-btn / prio-btn document-level click handlers.
//
// Load order: this file must keep its 11 prefix so it concatenates before
// 12a-changelog.js, whose top-level bootstrap calls loadExpiryDates(),
// autoCarryTasks(), patchCarriedTasks() and renderCompleted() — their bodies
// dereference the top-level const/let state declared here.

/**
 * Applies data migrations and status patches to today's plan tasks after
 * carry-over:
 * - Stamps `billable: true` on tasks/categories that predate the feature.
 * - Stamps `completedAt` on done tasks missing a timestamp.
 * - Promotes today's task status to match the most recent past version when
 *   that version was pending/blocked/upcoming or in-progress.
 */
function patchCarriedTasks() {
  const todayKey = dk(new Date());
  const todayTasks = planTasks.filter((t) => t.date === todayKey);
  const pastTasks = planTasks.filter((t) => t.date < todayKey);

  // Migration: stamp billable on tasks and categories that predate the feature.
  // Assumption: the app was originally developed for billable contract work, so
  // any task or category without an explicit flag is assumed billable to avoid
  // retroactively understating tracked hours.
  planTasks.forEach((t) => {
    if (t.billable === undefined) t.billable = true;
  });
  categories.forEach((c) => {
    if (c.billable === undefined) c.billable = true;
  });

  // Migration: stamp completedAt on any done task missing it
  let changed = false;
  planTasks.forEach((t) => {
    if (t.status === 'done' && !t.completedAt) {
      t.completedAt = new Date((t.date || todayKey) + 'T00:00:00').getTime();
      changed = true;
    }
  });

  if (!todayTasks.length || !pastTasks.length) {
    if (changed) savePlan();
    return;
  }

  todayTasks.forEach((todayTask) => {
    const prev = pastTasks
      .filter((t) => t.text.toLowerCase() === todayTask.text.toLowerCase())
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!prev) return;

    const newStatus = resolveCarryStatus(todayTask, prev);
    if (newStatus === null) return;

    todayTask.status = newStatus;
    if (
      ['pending', 'blocked', 'upcoming'].includes(newStatus) &&
      prev.statusComments &&
      prev.statusComments.length &&
      !todayTask.statusComments
    ) {
      todayTask.statusComments = prev.statusComments.map((c) => ({ ...c }));
    }
    changed = true;
  });

  if (changed) savePlan();
}

/**
 * Carries unfinished plan tasks from past days into today — runs once per day
 * (guarded by a localStorage flag). Deduplicates by text, preserving the most
 * recent past status and status-comment history. Checkpoints are carried forward
 * with `done` reset to false for a fresh day.
 * @returns {number|undefined} Number of tasks newly carried, or undefined if
 *   carry has already run today.
 */
function autoCarryTasks() {
  const todayKey = dk(new Date());
  const carryKey = 'wl_carried_' + todayKey;
  if (localStorage.getItem(carryKey)) return;
  // 'upcoming' tasks are intentionally scheduled for a future date by the user
  // and should never be auto-carried — they will appear naturally on their target date.
  // 'done' tasks are complete and need no carry.
  const unfinished = planTasks.filter(
    (t) => t.date < todayKey && t.status !== 'done' && t.status !== 'upcoming'
  );
  if (!unfinished.length) {
    localStorage.setItem(carryKey, '1');
    return;
  }

  // Deduplicate by text — keep only the MOST RECENT past version of each task.
  // Without this, an older 'inprogress' copy could be carried instead of a newer 'pending' one.
  const latestByText = {};
  unfinished.forEach((t) => {
    const key = t.text.toLowerCase();
    if (!latestByText[key] || t.date > latestByText[key].date) {
      latestByText[key] = t;
    }
  });
  const toCarry = Object.values(latestByText);

  // First pass: create new tasks, build old-id → new-id map
  const idMap = {};
  let carried = 0;
  toCarry.forEach((t) => {
    const exists = planTasks.some(
      (e) => e.date === todayKey && e.text.toLowerCase() === t.text.toLowerCase()
    );
    if (!exists) {
      const newId = 'c' + Date.now() + Math.random().toString(36).slice(2);
      idMap[t.id] = newId;
      planTasks.push({
        id: newId,
        text: t.text,
        tag: t.tag,
        status: t.status, // preserve inprogress/todo/pending/blocked
        ...(t.statusComments && t.statusComments.length
          ? { statusComments: t.statusComments.map((c) => ({ ...c })) }
          : {}),
        // Carry checkpoints forward — reset done state for a fresh day
        ...(t.checkpoints && t.checkpoints.length
          ? { checkpoints: t.checkpoints.map((c) => ({ ...c, done: false })) }
          : {}),
        date: todayKey,
      });
      carried++;
    }
  });

  if (carried > 0) savePlan();
  localStorage.setItem(carryKey, '1');
  return carried;
}

let completedCollapsed = readCollapseState('completedSection', true);

// ── Iteration expiry dates (stored in localStorage, seeded on first load) ──
const STORE_EXPIRY = 'wl_expiry_dates';
const EXPIRY_SEED = [
  // PI 26-1
  '2026-01-31',
  '2026-02-14',
  '2026-02-28',
  '2026-03-14',
  '2026-03-28',
  // PI 26-2
  '2026-04-11',
  '2026-04-25',
  '2026-05-09',
  '2026-05-23',
  '2026-06-06',
  // PI 26-3
  '2026-06-20',
  '2026-07-04',
  '2026-07-18',
  '2026-08-01',
  '2026-08-15',
  '2026-08-29',
  // PI 26-4
  '2026-09-12',
  '2026-09-26',
  '2026-10-10',
  '2026-10-24',
  '2026-11-07',
  // PI 26-5
  '2026-11-21',
  '2026-12-05',
  '2026-12-19',
  '2027-01-02',
  '2027-01-16',
];

let _expiryDates = null; // cached; invalidated when user saves changes

/**
 * Loads iteration expiry dates from localStorage into `_expiryDates`.
 * Seeds localStorage with `EXPIRY_SEED` on first run.
 */
function loadExpiryDates() {
  try {
    const raw = localStorage.getItem(STORE_EXPIRY);
    if (raw) {
      _expiryDates = JSON.parse(raw)
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();
      return;
    }
  } catch (err) {
    wlLog.warn('loadExpiryDates: failed to parse stored expiry dates — using defaults', err);
  }
  // Seed localStorage with defaults on first load
  _expiryDates = [...EXPIRY_SEED];
  localStorage.setItem(STORE_EXPIRY, JSON.stringify(_expiryDates));
}

/**
 * Returns the first iteration expiry date that is strictly later than
 * `completedDay`, or null if none is configured beyond that date.
 * @param {string} completedDay - Completion date in "YYYY-MM-DD" format.
 * @returns {string|null} The next expiry date, or null.
 */
function getIterationExpiry(completedDay) {
  if (!_expiryDates) loadExpiryDates();
  return _expiryDates.find((d) => d > completedDay) || null;
}

/**
 * Opens the iteration-expiry editor modal, pre-filling the textarea with the
 * current expiry dates (one per line).
 */
function openExpiryModal() {
  if (!_expiryDates) loadExpiryDates();
  document.getElementById('expiryTextarea').value = _expiryDates.join('\n');
  document.getElementById('expiryFeedback').textContent = '';
  document.getElementById('expiryOverlay').classList.add('show');
  document.getElementById('expiryTextarea').focus();
}

/**
 * Reads the expiry-date textarea, validates each line against YYYY-MM-DD format,
 * deduplicates and sorts the valid dates, persists them to localStorage, and closes
 * the modal. Invalid lines are surfaced in the feedback element but not saved.
 */
function saveExpiryDates() {
  const raw = document.getElementById('expiryTextarea').value;
  const dates = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l));
  const invalid = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\d{4}-\d{2}-\d{2}$/.test(l));
  if (invalid.length) {
    const fb = document.getElementById('expiryFeedback');
    fb.style.color = '#f17070';
    fb.textContent = `Invalid lines (ignored): ${invalid.join(', ')}`;
  }
  _expiryDates = [...new Set(dates)].sort();
  localStorage.setItem(STORE_EXPIRY, JSON.stringify(_expiryDates));
  document.getElementById('expiryOverlay').classList.remove('show');
  renderCompleted();
}

/**
 * Renders the completed-tasks section for the currently viewed date.
 * Shows tasks that were completed on or before the view date and whose
 * iteration expiry date has not yet passed. Deduplicates by task text,
 * keeping only the most recently completed version. Hides the section when
 * there are no matching tasks.
 */
function renderCompleted() {
  const viewKey = dk(viewDate);
  const viewTs = new Date(viewKey + 'T12:00:00').getTime();
  // Tasks that are actively inprogress/todo on the current view date
  const activeTodayTexts = new Set(
    planTasks
      .filter((t) => t.date === viewKey && t.status !== 'done')
      .map((t) => t.text.toLowerCase())
  );
  const done = planTasks
    .filter((t) => {
      if (t.status !== 'done') return false;
      // Don't show completed tasks that have a live version on this date
      if (activeTodayTexts.has(t.text.toLowerCase())) return false;
      const completedTs = t.completedAt || new Date((t.date || viewKey) + 'T23:59:00').getTime();
      const completedDay = dk(new Date(completedTs));
      const expiryDay = getIterationExpiry(completedDay);
      // Show from completion day until (but not including) the iteration expiry date.
      // If beyond last known iteration, keep visible indefinitely.
      if (!expiryDay) return viewKey >= completedDay;
      return viewKey >= completedDay && viewKey < expiryDay;
    })
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  // Deduplicate by text — keep only the most recently completed version of each task
  const seen = new Set();
  const deduped = done.filter((t) => {
    const key = t.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sec = document.getElementById('completedSection');
  // Completed history is now shown in the board Done column expander; keep this section hidden.
  sec.style.display = 'none';
  if (!deduped.length) {
    document.getElementById('completedBody').innerHTML = '';
    document.getElementById('completedCount').textContent = '0';
    return;
  }

  document.getElementById('completedCount').textContent = `${deduped.length} completed`;
  sec.classList.toggle('collapsed', completedCollapsed);

  document.getElementById('completedBody').innerHTML = deduped
    .map((t) => {
      const cat = getCat(t.tag || 'other');
      let whenStr = 'date unknown';
      if (t.completedAt) {
        const d = new Date(t.completedAt);
        const mo = d.toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' });
        const hh = d.getHours(),
          mm = d.getMinutes();
        const isSentinel = (hh === 0 && mm === 0) || (hh === 23 && mm === 59);
        whenStr = isSentinel
          ? `completed ${mo}`
          : `completed ${mo} at ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      } else if (t.date) {
        const d = new Date(t.date + 'T12:00:00');
        whenStr = `completed ${d.toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}`;
      }
      return `<div class="completed-item">
        <span class="plan-status done-st" style="pointer-events:none;flex-shrink:0;font-size:10px;padding:1px 7px">Done</span>
        <span class="completed-dot" style="background:${safeCssColor(cat.color)}"></span>
        <span class="completed-text">${t.emoji ? escHtml(t.emoji) + ' ' : ''}${jiraTicketHtml(t.text)}</span>
        <span class="completed-when">${whenStr}</span>
      </div>`;
    })
    .join('');
}

document.getElementById('completedHeader').addEventListener('click', () => {
  completedCollapsed = !completedCollapsed;
  writeCollapseState('completedSection', completedCollapsed);
  renderCompleted();
});
// Delegated bill-btn handler — covers plan, pending, completed sections
document.addEventListener(
  'click',
  (e) => {
    const btn = e.target.closest('.bill-btn');
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.pid) {
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      if (!t) return;
      t.billable = t.billable === false ? true : false;
      savePlan();
      renderPlan();
      renderCompleted();
    } else if (btn.dataset.etext) {
      // Log entry — save billable directly on the entry, and sync to matching planTasks
      const entry = entries.find((e) => e.id === btn.dataset.eid);
      if (!entry) return;
      // Determine toggle: if currently billable → make non-billable, and vice versa
      const curBill =
        entry.billable !== undefined
          ? entry.billable
          : getCat(entry.tag || 'other').billable !== false;
      entry.billable = !curBill;
      // Also update matching planTasks so plan rows stay in sync
      const key = entry.text.toLowerCase().trim();
      planTasks
        .filter((t) => t.text.toLowerCase().trim() === key)
        .forEach((t) => (t.billable = entry.billable));
      save();
      savePlan();
      render();
    }
  },
  true
);

// Delegated prio-btn handler — cycles priority normal → high → low → normal
document.addEventListener(
  'click',
  (e) => {
    const btn = e.target.closest('.prio-btn');
    if (!btn || !btn.dataset.pid) return;
    e.stopPropagation();
    const t = planTasks.find((t) => t.id === btn.dataset.pid);
    if (!t) return;
    const cur = t.priority || 0;
    const next = cur === 0 ? 1 : cur === 1 ? -1 : 0;
    if (next === 0) delete t.priority;
    else t.priority = next;
    savePlan();
    renderPlan();
  },
  true
);
