/* ── Today's tasks — rendering: board assembly + emoji picker ──
   Per-row card HTML builders (renderRow and friends) live in 10a-tasks-row.js. */

/**
 * Partitions today's plan tasks into the three kanban column groups.
 * @param {string} viewKey - Date key (YYYY-MM-DD) for the current view.
 * @returns {{ todoTasks: object[], inProgressTasks: object[], todayDoneTasks: object[] }}
 */
function groupTasksByColumn(viewKey) {
  const allViewTasks = planTasks.filter((t) => t.date === viewKey);
  return {
    todoTasks: allViewTasks.filter((t) => !['inprogress', 'done'].includes(t.status)),
    inProgressTasks: allViewTasks.filter((t) => t.status === 'inprogress'),
    todayDoneTasks: allViewTasks.filter((t) => t.status === 'done'),
  };
}

/**
 * Re-renders the entire plan UI as a 3-column kanban board (To Do / In Progress / Done).
 * Pending and blocked tasks absorb into the To Do column with their existing badge treatment.
 * The Done column shows today's completed tasks and a collapsible history expander for older ones.
 *
 * Design trade-off: full DOM re-render on every state change rather than targeted updates.
 * Acceptable for a personal tool where the task list is small (< 20 items).
 */
function renderPlan() {
  /* ── 1. Partition tasks for the current view date ── */
  const viewKey = dk(viewDate);
  const { todoTasks, inProgressTasks, todayDoneTasks } = groupTasksByColumn(viewKey);

  const todoCount = todoTasks.length;
  const progressCount = inProgressTasks.length;
  const doneCount = todayDoneTasks.length;

  /* ── 2. Section header and column count badges ── */
  const mainParts = [];
  if (todoCount > 0) mainParts.push(`${todoCount} to do`);
  if (progressCount > 0) mainParts.push(`${progressCount} in progress`);
  mainParts.push(`${doneCount} done`);
  document.getElementById('planCount').textContent =
    todoCount + progressCount + doneCount ? mainParts.join(' · ') : '';
  document.getElementById('planSection').classList.toggle('collapsed', planCollapsed);

  document.getElementById('todoColCount').textContent = todoCount || '';
  document.getElementById('progressColCount').textContent = progressCount ? `${progressCount}` : '';
  document.getElementById('doneColCount').textContent = doneCount || '';

  // Tab bar count badges (tabbed board mode)
  const tabTodoEl = document.getElementById('tabTodoCount');
  const tabProgEl = document.getElementById('tabProgCount');
  const tabDoneEl = document.getElementById('tabDoneCount');
  if (tabTodoEl) tabTodoEl.textContent = todoCount || '';
  if (tabProgEl) tabProgEl.textContent = progressCount || '';
  if (tabDoneEl) tabDoneEl.textContent = doneCount || '';

  // Hide add form when not viewing today
  const addRow = document.getElementById('planAddRow');
  if (addRow) addRow.style.display = isToday(viewDate) ? '' : 'none';

  // Force-hide legacy stacked sections — their parse-time listeners remain intact
  document.getElementById('upcomingSection').style.display = 'none';
  document.getElementById('pendingSection').style.display = 'none';
  document.getElementById('completedSection').style.display = 'none';

  /* ── 3. Column DOM references ── */
  const todoListEl = document.getElementById('planList');
  const progressListEl = document.getElementById('progressList');
  const doneListEl = document.getElementById('doneList');
  const progressColEl = document.getElementById('progressCol');

  /* ── 4. WIP guard — soft warn when more than 1 task is In Progress ── */
  const isWipOver = progressCount > 1;
  progressColEl.classList.toggle('kb-col--wip', isWipOver);

  // Reset dismiss flag whenever count drops back to safe
  if (!isWipOver) wipWarnDismissed = false;

  /* ── 5. Render To Do column (todo + upcoming + pending + blocked) ── */
  if (!todoTasks.length) {
    todoListEl.innerHTML = `<div class="plan-empty">${
      isToday(viewDate)
        ? inProgressTasks.length
          ? 'all tasks are in progress or done'
          : 'no tasks yet — add some above'
        : 'no tasks were planned for this day'
    }</div>`;
  } else {
    todoListEl.innerHTML = flatSort(todoTasks).map(renderRow).join('');
  }

  /* ── 6. Render In Progress column ── */
  if (!inProgressTasks.length) {
    progressListEl.innerHTML = '<div class="plan-empty kb-empty-quiet"></div>';
  } else {
    // WIP warn banner (prepended inside column, before list)
    const warnHtml =
      isWipOver && !wipWarnDismissed
        ? `<div class="wip-warn" role="alert">
            <span class="wip-warn__msg">⚠ ${progressCount} in progress — pick one to focus</span>
            <button class="wip-warn__dismiss" aria-label="Dismiss WIP warning">×</button>
          </div>`
        : '';
    progressListEl.innerHTML = warnHtml + flatSort(inProgressTasks).map(renderRow).join('');
  }

  /* ── 7. Render Done column (today) + history expander ── */
  const doneHtml = todayDoneTasks.length
    ? flatSort(todayDoneTasks).map(renderRow).join('')
    : '<div class="plan-empty kb-empty-quiet"></div>';
  doneListEl.innerHTML = doneHtml;
  renderBoardDoneHistory(doneListEl, viewKey);

  /* ── 8. Bind all event handlers across the three column lists ── */
  bindPlanEvents([todoListEl, progressListEl, doneListEl]);
  bindBoardColumnDnD();
  updateBoardLive();

  if (isToday(viewDate)) renderTrackRecent();
}

/**
 * Appends the collapsible "older history" expander to the Done column list.
 * Shows completed tasks from prior dates, grouped by day, within the active iteration.
 * @param {HTMLElement} doneListEl - The `#doneList` container element.
 * @param {string}      viewKey   - The current view date key (YYYY-MM-DD).
 */
function renderBoardDoneHistory(doneListEl, viewKey) {
  const activeTodayTexts = new Set(
    planTasks
      .filter((t) => t.date === viewKey && t.status !== 'done')
      .map((t) => t.text.toLowerCase())
  );

  const olderDone = planTasks
    .filter((t) => {
      if (t.status !== 'done') return false;
      if (activeTodayTexts.has(t.text.toLowerCase())) return false;
      const completedTs = t.completedAt || new Date((t.date || viewKey) + 'T23:59:00').getTime();
      const completedDay = dk(new Date(completedTs));
      if (completedDay === viewKey) return false;
      const expiryDay = getIterationExpiry(completedDay);
      if (!expiryDay) return viewKey >= completedDay;
      return viewKey >= completedDay && viewKey < expiryDay;
    })
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  if (!olderDone.length) return;

  // Deduplicate by text — keep most recently completed
  const seen = new Set();
  const deduped = olderDone.filter((t) => {
    const key = t.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!deduped.length) return;

  // Group by completion day
  const byDay = {};
  deduped.forEach((t) => {
    const day = t.completedAt ? dk(new Date(t.completedAt)) : t.date || viewKey;
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(t);
  });

  const btn = document.createElement('button');
  btn.className = 'done-history-btn';
  btn.setAttribute('aria-expanded', doneHistoryOpen ? 'true' : 'false');
  btn.textContent = `${doneHistoryOpen ? '▾' : '▸'} ${deduped.length} earlier this iteration`;

  const historyEl = document.createElement('div');
  historyEl.id = 'doneHistory';
  historyEl.style.display = doneHistoryOpen ? '' : 'none';

  Object.entries(byDay).forEach(([day, tasks]) => {
    const group = document.createElement('div');
    group.className = 'done-history-group';
    group.innerHTML = `<div class="done-history-day">${day}</div>` + tasks.map(renderRow).join('');
    historyEl.appendChild(group);
  });

  btn.addEventListener('click', () => {
    doneHistoryOpen = !doneHistoryOpen;
    btn.setAttribute('aria-expanded', doneHistoryOpen ? 'true' : 'false');
    btn.textContent = `${doneHistoryOpen ? '▾' : '▸'} ${deduped.length} earlier this iteration`;
    historyEl.style.display = doneHistoryOpen ? '' : 'none';
    // Re-bind events for newly revealed tasks
    if (doneHistoryOpen) bindPlanEvents([historyEl]);
  });

  doneListEl.appendChild(btn);
  doneListEl.appendChild(historyEl);
  if (doneHistoryOpen) bindPlanEvents([historyEl]);
}

/**
 * Renders the "+ TRACK RECENT" strip inside `#planTrackRecent`.
 * Shows chips for the most recent unique time-log entries from today so the
 * user can restart a timer with a single click without re-typing.
 * Limits to 5 entries; hidden when no entries exist for today.
 */
function renderTrackRecent() {
  const container = document.getElementById('planTrackRecent');
  if (!container) return;

  const todayKey = dk(new Date());
  // Collect unique recent entries (deduplicated by lower-cased text, newest first)
  const seen = new Set();
  const recent = [];
  [...entries]
    .filter((e) => e.date === todayKey)
    .reverse()
    .forEach((e) => {
      const key = e.text.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        recent.push(e);
      }
    });

  if (!recent.length) {
    container.style.display = 'none';
    return;
  }

  const chips = recent.slice(0, 5).map((e) => {
    const color = getCatColor(e.tag);
    return `<button class="ptr-chip" data-eid="${escHtml(e.id)}" title="Track: ${escHtml(e.text)}">
      <span class="ptr-chip-dot" style="background:${color}" aria-hidden="true"></span>
      ${escHtml(e.text)}
    </button>`;
  });

  container.innerHTML = `<div class="ptr-label">+ track recent</div><div class="ptr-chips">${chips.join('')}</div>`;
  container.style.display = '';

  container.querySelectorAll('.ptr-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const src = entries.find((e) => e.id === chip.dataset.eid);
      if (!src) return;
      if (activeTimer) stopTimer();
      const entry = {
        id: Date.now() + '',
        text: src.text,
        tag: src.tag,
        ts: safeRoundedStart(),
        date: dk(new Date()),
      };
      entries.push(entry);
      save();
      startTimer(entry.id);
      render();
    });
  });
}

const EMOJI_COMMON = [
  '⭐',
  '🔥',
  '✅',
  '❌',
  '⚠️',
  '💡',
  '🚀',
  '🐛',
  '🔧',
  '🔍',
  '📝',
  '📋',
  '💬',
  '📞',
  '🎯',
  '🏃',
  '⏳',
  '🔒',
  '🔑',
  '💻',
  '📊',
  '📈',
  '🌐',
  '🗂️',
  '📌',
  '🧪',
  '🎨',
  '💰',
  '🤔',
  '😅',
  '🙏',
  '👀',
  '✍️',
  '🤝',
  '🚧',
  '⚡',
  '🧩',
  '🛠️',
  '📣',
  '🎉',
  '🌱',
  '🔔',
  '🗒️',
  '⚙️',
  '🏆',
];

// eslint-disable-next-line prefer-const -- reassigned in 11-timeblock.js (cross-file global, concat build model)
let _emojiPickerPid = null;
