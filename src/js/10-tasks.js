/* ── Today's tasks — state and persistence ── */
const STORE_PLAN = 'wl_plan_v1';

/**
 * Plan task list — each item:
 * `{ id, text, status, tag, date, [billable], [notionUrl], [emoji], [checkpoints], [parentId], [priority], [note] }`
 * @type {Array<Object>}
 */
let planTasks = [];
let planCollapsed = readCollapseState('planSection', false);
let pendingCollapsed = readCollapseState('pendingSection', true);
// eslint-disable-next-line prefer-const -- reassigned by 10b-tasks-events.js
let editingPlanId = null;
// eslint-disable-next-line prefer-const -- reassigned by 10b-tasks-events.js
let _pendingCommentId = null;
// eslint-disable-next-line prefer-const -- reassigned by 10b-tasks-events.js
let splitInputId = null;
// eslint-disable-next-line prefer-const -- reassigned by 10b-tasks-events.js
let _pendingCommentText = '';
// eslint-disable-next-line prefer-const -- reassigned by 10b-tasks-events.js
let _expandedHistoryId = null;
const _cpOpenIds = new Set();
// eslint-disable-next-line prefer-const -- reassigned by 10b-tasks-events.js
let _cpEditId = null; // pid of task whose checkpoint is being edited
// eslint-disable-next-line prefer-const -- reassigned by 10b-tasks-events.js
let _cpEditIdx = null; // index of checkpoint being edited
const _noteOpenIds = new Set();
/** Whether the Done column's older-history expander is open. */
// eslint-disable-next-line prefer-const -- reassigned by 10a-tasks-render.js
let doneHistoryOpen = false;
/** Whether the WIP-over warning banner has been dismissed this render cycle. */
// eslint-disable-next-line prefer-const -- reassigned by 10a-tasks-render.js, 10b-tasks-events.js
let wipWarnDismissed = false;

/**
 * Loads plan tasks from localStorage into `planTasks`, filtering out invalid
 * entries via `validPlanTask`. Drops are reported via wlLog.warn so data-quality
 * issues are visible in DevTools. Resets to empty array on parse error.
 * @returns {void}
 */
function loadPlan() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_PLAN) || '[]');
    const all = Array.isArray(raw) ? raw : [];
    planTasks = all.filter(validPlanTask);
    if (planTasks.length < all.length)
      wlLog.warn(`loadPlan: dropped ${all.length - planTasks.length} invalid task record(s)`, {
        total: all.length,
        kept: planTasks.length,
      });
  } catch (err) {
    planTasks = [];
    wlLog.error('loadPlan: failed to parse plan tasks from localStorage', err);
  }
}

/**
 * Persists the current `planTasks` array to localStorage.
 * @returns {void}
 */
function savePlan() {
  localStorage.setItem(STORE_PLAN, JSON.stringify(planTasks));
}

/**
 * Sorts a flat list of plan tasks by status order and priority, inserting
 * child tasks immediately after their parent. Tasks matching the currently
 * running timer text are sorted first. Orphaned children (whose parent has
 * been deleted or moved) are appended at the end.
 * @param {Array<Object>} tasks - Array of plan task objects to sort.
 * @returns {Array<Object>} New sorted array with children interleaved after parents.
 */
function flatSort(tasks) {
  // Assumption: STATUS_ORDER defines the canonical sort priority for visible task sections.
  // 'done' sorts last so completed work doesn't push active items down.
  const STATUS_ORDER = { inprogress: 0, todo: 1, pending: 2, blocked: 3, done: 4 };
  const liveEntry = activeTimer ? entries.find((entry) => entry.id === activeTimer.entryId) : null;
  const liveText = liveEntry ? liveEntry.text.toLowerCase() : null;

  const parents = tasks.filter((task) => !task.parentId);
  const children = tasks.filter((task) => !!task.parentId);
  const sorted = [...parents].sort((taskA, taskB) => {
    const aLive = liveText && taskA.text.toLowerCase() === liveText;
    const bLive = liveText && taskB.text.toLowerCase() === liveText;
    if (aLive && !bLive) return -1;
    if (!aLive && bLive) return 1;
    const aOrd = STATUS_ORDER[taskA.status || 'todo'] ?? 1;
    const bOrd = STATUS_ORDER[taskB.status || 'todo'] ?? 1;
    if (aOrd !== bOrd) return aOrd - bOrd;
    // Within the same status: higher priority first (high=1, normal=0, low=-1)
    const aPri = taskA.priority || 0;
    const bPri = taskB.priority || 0;
    if (aPri !== bPri) return bPri - aPri;
    return taskA.text.localeCompare(taskB.text);
  });
  // Insert children right after their parent
  const result = [];
  sorted.forEach((parentTask) => {
    result.push(parentTask);
    const kids = children
      .filter((child) => child.parentId === parentTask.id)
      .sort((childA, childB) => childA.text.localeCompare(childB.text));
    kids.forEach((kid) => result.push(kid));
  });
  // Orphaned children (parent deleted/moved) go at end
  children
    .filter((child) => !parents.find((parent) => parent.id === child.parentId))
    .forEach((orphan) => result.push(orphan));
  return result;
}

/**
 * Reads the plan-input field and adds a new "todo" task to today's plan.
 * Inherits the currently selected tag and that category's billable default.
 * No-ops if the input is empty.
 * @returns {void}
 */
function addPlanTask() {
  const inp = document.getElementById('planInput');
  const text = inp.value.trim();
  if (!text) return;
  planTasks.push({
    id: Date.now() + '',
    text,
    status: 'todo',
    tag: selectedTag,
    date: dk(new Date()),
    billable: getCat(selectedTag).billable !== false,
  });
  inp.value = '';
  savePlan();
  renderPlan();
  inp.focus();
}

/**
 * Promotes today's plan task matching `text` to "in progress", if one
 * exists and is still in a promotable state. Called whenever a timer starts
 * on text that might correspond to an existing board card — the hero
 * composer, a recent chip, the log capture input, and the board's own
 * "track" button all funnel through this so the Kanban board stays in sync
 * no matter which control was used to start tracking.
 * @param {string} text - The entry text a timer was just started on.
 * @returns {void}
 */
function promoteMatchingTaskToInProgress(text) {
  const task = findPromotableTask(planTasks, text, dk(new Date()));
  if (!task) return;
  task.status = 'inprogress';
  delete task.completedAt;
  if (task.parentId) {
    const parent = planTasks.find((planTask) => planTask.id === task.parentId);
    if (parent && parent.status === 'todo') parent.status = 'inprogress';
  }
  savePlan();
}

// Event listeners bound at parse time — safe because script runs after DOM is built.
document.getElementById('planAddBtn').addEventListener('click', addPlanTask);
document.getElementById('planInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addPlanTask();
});
document.getElementById('planHeader').addEventListener('click', () => {
  planCollapsed = !planCollapsed;
  writeCollapseState('planSection', planCollapsed);
  renderPlan();
});
let upcomingCollapsed = readCollapseState('upcomingSection', true);
document.getElementById('upcomingHeader').addEventListener('click', () => {
  upcomingCollapsed = !upcomingCollapsed;
  writeCollapseState('upcomingSection', upcomingCollapsed);
  document.getElementById('upcomingSection').classList.toggle('collapsed', upcomingCollapsed);
});
document.getElementById('pendingHeader').addEventListener('click', () => {
  pendingCollapsed = !pendingCollapsed;
  writeCollapseState('pendingSection', pendingCollapsed);
  renderPlan();
});
