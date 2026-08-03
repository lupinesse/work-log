/**
 * @file 10e-weeklyplan-review.js — Weekly plan review checklist.
 *
 * Surfaces plan tasks explicitly marked 'upcoming' whose date falls within
 * the current ISO week, via the pure findWeeklyPlanReviewTasks() (pure-fns.js),
 * as a dismissible banner once a new week begins — so tasks planned ahead
 * that turned out to already be finished elsewhere get caught before they
 * silently resurface on their date (see 11b-timeblock-carry.js's
 * autoCarryTasks(), which deliberately never touches 'upcoming' tasks).
 * This app has no live Jira connection (14-jira.js is a one-way CSV import),
 * so the checklist can only prompt the user to reconcile manually — it never
 * auto-detects completion.
 */

// Element that had focus when the checklist was opened, restored on close —
// same convention as the gap-report modal in 12c-gapreport.js.
let _planReviewTrigger = null;

/**
 * Returns the current ISO-week key (e.g. '2026-W32'), matching the format
 * checkPomoWeeklyClear() already uses in 07-lifecycle.js.
 * @returns {string}
 */
function currentPlanReviewWeekKey() {
  const today = new Date();
  return `${today.getFullYear()}-W${String(getISOWeek(today)).padStart(2, '0')}`;
}

/**
 * Returns this ISO week's [startKey, endKey) as YYYY-MM-DD date-string
 * bounds, using the existing mondayOfWeek()/dk() helpers.
 * @returns {{weekStartKey: string, weekEndKey: string}}
 */
function planReviewWeekBounds() {
  const weekStart = mondayOfWeek();
  const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
  return { weekStartKey: dk(new Date(weekStart)), weekEndKey: dk(new Date(weekEnd)) };
}

/**
 * Builds one checklist row: date, ticket key (via the existing parseJiraLabel())
 * or plain text, and "done"/"drop" reconcile actions.
 * @param {Object} task - A plan task from findWeeklyPlanReviewTasks().
 * @returns {string} HTML string.
 */
function buildPlanReviewRowHtml(task) {
  const { ticket, name } = parseJiraLabel(task.text);
  const label = ticket
    ? `<span class="plan-review-ticket">${escHtml(ticket)}</span>${name ? `<span class="plan-review-sep">:</span> ${escHtml(name)}` : ''}`
    : escHtml(task.text);
  return `<div class="plan-review-row">
      <span class="plan-review-date">${fmtDateLabel(task.date)}</span>
      <span class="plan-review-text">${label}</span>
      <button type="button" class="plan-review-done" data-id="${task.id}" title="mark done">✓ done</button>
      <button type="button" class="plan-review-drop" data-id="${task.id}" title="remove from plan">✕ drop</button>
    </div>`;
}

/**
 * Rebuilds the checklist list + subtitle from current planTasks state.
 * Shared by the initial open and by each row action, since an action removes
 * exactly one task from the underlying data and the list should reflect that
 * immediately rather than requiring a re-open.
 */
function renderPlanReviewList() {
  const { weekStartKey, weekEndKey } = planReviewWeekBounds();
  const upcoming = findWeeklyPlanReviewTasks(planTasks, weekStartKey, weekEndKey);

  const subtitleEl = document.getElementById('planReviewSubtitle');
  const listEl = document.getElementById('planReviewList');
  if (subtitleEl) {
    subtitleEl.textContent = upcoming.length
      ? `${upcoming.length} ${upcoming.length === 1 ? 'task' : 'tasks'} planned for this week — still accurate?`
      : 'Nothing left to review this week.';
  }
  if (listEl) {
    listEl.innerHTML = upcoming.length
      ? upcoming.map(buildPlanReviewRowHtml).join('')
      : '<div class="plan-review-empty">Nothing to review.</div>';
  }
}

/** Opens the weekly plan review checklist, rebuilding it fresh from current data. */
function openPlanReviewOverlay() {
  const overlay = document.getElementById('planReviewOverlay');
  if (!overlay) return;
  _planReviewTrigger = document.activeElement;
  renderPlanReviewList();
  overlay.classList.add('show');
  setTimeout(() => {
    const first = overlay.querySelector('button, [tabindex]:not([tabindex="-1"])');
    if (first) first.focus();
  }, 50);
}

/** Restores focus to whatever triggered the checklist, then clears it. */
function restorePlanReviewFocus() {
  if (_planReviewTrigger) {
    _planReviewTrigger.focus();
    _planReviewTrigger = null;
  }
}

/** Hides the checklist overlay, restores focus, and marks the week reviewed. */
function closePlanReviewOverlay() {
  const overlay = document.getElementById('planReviewOverlay');
  if (overlay) overlay.classList.remove('show');
  restorePlanReviewFocus();
  markPlanReviewedThisWeek();
}

/**
 * Shows or hides the weekly plan review reminder banner. A nudge, not an
 * automatic reconciliation — this app has no live Jira connection, so only
 * the user can confirm a planned task is still accurate. Hidden once the
 * current ISO week has already been marked reviewed, or when there's
 * nothing to review.
 */
function renderPlanReviewReminder() {
  const banner = document.getElementById('planReviewBanner');
  if (!banner) return;
  const alreadyReviewed =
    localStorage.getItem('wl_plan_review_week') === currentPlanReviewWeekKey();
  const { weekStartKey, weekEndKey } = planReviewWeekBounds();
  const upcoming = findWeeklyPlanReviewTasks(planTasks, weekStartKey, weekEndKey);
  if (alreadyReviewed || !upcoming.length) {
    banner.style.display = 'none';
    return;
  }
  const msgEl = document.getElementById('planReviewMsg');
  if (msgEl) {
    msgEl.textContent = `${upcoming.length} ${upcoming.length === 1 ? 'task' : 'tasks'} planned for this week — still accurate?`;
  }
  banner.style.display = '';
}

/**
 * Marks the current ISO week as reviewed so the reminder banner won't
 * reappear this week, then re-renders the banner (hides it). Called both by
 * the banner's dismiss button and by closing the checklist — either counts
 * as "reviewed," matching the dismiss semantics already used for the
 * long-running-timer and end-of-day-export reminders.
 */
function markPlanReviewedThisWeek() {
  localStorage.setItem('wl_plan_review_week', currentPlanReviewWeekKey());
  renderPlanReviewReminder();
}

const planReviewActionBtn = document.getElementById('planReviewActionBtn');
const planReviewDismissBtn = document.getElementById('planReviewDismissBtn');
const planReviewOverlay = document.getElementById('planReviewOverlay');
const planReviewClose = document.getElementById('planReviewClose');
const planReviewList = document.getElementById('planReviewList');

if (planReviewActionBtn) planReviewActionBtn.addEventListener('click', openPlanReviewOverlay);
if (planReviewDismissBtn) planReviewDismissBtn.addEventListener('click', markPlanReviewedThisWeek);
if (planReviewClose) planReviewClose.addEventListener('click', closePlanReviewOverlay);
if (planReviewOverlay) {
  planReviewOverlay.addEventListener('click', (e) => {
    if (e.target === planReviewOverlay) closePlanReviewOverlay();
  });
  planReviewOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePlanReviewOverlay();
  });
}
if (planReviewList) {
  planReviewList.addEventListener('click', (e) => {
    const doneBtn = e.target.closest('.plan-review-done');
    const dropBtn = e.target.closest('.plan-review-drop');
    if (doneBtn) {
      const task = planTasks.find((t) => t.id === doneBtn.dataset.id);
      if (task) {
        task.status = 'done';
        if (!task.completedAt) task.completedAt = Date.now();
        savePlan();
        renderPlan();
      }
      renderPlanReviewList();
    } else if (dropBtn) {
      planTasks = planTasks.filter((t) => t.id !== dropBtn.dataset.id);
      savePlan();
      renderPlan();
      renderPlanReviewList();
    }
  });
}
