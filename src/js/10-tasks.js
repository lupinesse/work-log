/* ── Today's tasks ── */
const STORE_PLAN = 'wl_plan_v1';
/**
 * Plan task list — each item:
 * `{ id, text, status, tag, date, [billable], [notionUrl], [emoji], [checkpoints], [parentId], [priority] }`
 * @type {Array<Object>}
 */
let planTasks = [];
let planCollapsed = false;
let pendingCollapsed = false;
let editingPlanId = null;
let _pendingCommentId = null;
let splitInputId = null;
let _pendingCommentText = '';
let _expandedHistoryId = null;
let _cpOpenIds = new Set();
let _cpEditId = null; // pid of task whose checkpoint is being edited
let _cpEditIdx = null; // index of checkpoint being edited

/**
 * Loads plan tasks from localStorage into `planTasks`, filtering out invalid
 * entries via `validPlanTask`. Drops are reported via wlLog.warn so data-quality
 * issues are visible in DevTools. Resets to empty array on parse error.
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
  } catch (e) {
    planTasks = [];
    wlLog.error('loadPlan: failed to parse plan tasks from localStorage', e);
  }
}
/** Persists the current `planTasks` array to localStorage. */
function savePlan() {
  localStorage.setItem(STORE_PLAN, JSON.stringify(planTasks));
}

/**
 * Re-renders the entire plan UI for the currently viewed date: main task list,
 * pending/blocked section, upcoming section, all associated controls (status
 * dropdowns, checkpoints, billable buttons, Notion/emoji buttons), and section
 * headers with counts. Also renders the completed-tasks section.
 */
function renderPlan() {
  const viewKey = dk(viewDate);
  const todayKey = dk(new Date());
  const allViewTasks = planTasks.filter((t) => t.date === viewKey);
  const mainTasks = allViewTasks.filter(
    (t) =>
      t.status !== 'done' &&
      t.status !== 'pending' &&
      t.status !== 'blocked' &&
      t.status !== 'upcoming'
  );
  const pendingTasks = allViewTasks.filter((t) => t.status === 'pending' || t.status === 'blocked');
  const upcomingTasks = allViewTasks.filter((t) => t.status === 'upcoming');
  const todoCount = allViewTasks.filter((t) => (t.status || 'todo') === 'todo').length;
  const progressCount = allViewTasks.filter((t) => t.status === 'inprogress').length;
  const pendingCount = allViewTasks.filter((t) => t.status === 'pending').length;
  const blockedCount = allViewTasks.filter((t) => t.status === 'blocked').length;
  const upcomingCount = allViewTasks.filter((t) => t.status === 'upcoming').length;
  const doneCount = isToday(viewDate)
    ? planTasks.filter((t) => t.date === viewKey && t.status === 'done').length
    : allViewTasks.filter((t) => t.status === 'done').length;

  // Main section header — only counts active/done tasks
  const mainParts = [];
  if (todoCount > 0) mainParts.push(`${todoCount} to do`);
  if (progressCount > 0) mainParts.push(`${progressCount} in progress`);
  mainParts.push(`${doneCount} done`);
  document.getElementById('planCount').textContent =
    todoCount + progressCount + doneCount ? mainParts.join(' · ') : '';
  document.getElementById('planSection').classList.toggle('collapsed', planCollapsed);

  // Upcoming section
  const upcomingSectionEl = document.getElementById('upcomingSection');
  if (upcomingTasks.length > 0) {
    upcomingSectionEl.style.display = '';
    document.getElementById('upcomingCount').textContent = `${upcomingCount} upcoming`;
  } else {
    upcomingSectionEl.style.display = 'none';
  }

  // Pending section header
  const pendingParts = [];
  if (pendingCount > 0) pendingParts.push(`${pendingCount} pending`);
  if (blockedCount > 0) pendingParts.push(`${blockedCount} blocked`);
  const pendingSectionEl = document.getElementById('pendingSection');
  if (pendingTasks.length > 0) {
    pendingSectionEl.style.display = '';
    pendingSectionEl.classList.toggle('collapsed', pendingCollapsed);
    document.getElementById('pendingCount').textContent = pendingParts.join(' · ');
  } else {
    pendingSectionEl.style.display = 'none';
  }

  // Hide add form when not viewing today
  const addRow = document.getElementById('planAddRow');
  if (addRow) addRow.style.display = isToday(viewDate) ? '' : 'none';

  const mainListEl = document.getElementById('planList');
  const pendingListEl = document.getElementById('pendingList');
  const upcomingListEl = document.getElementById('upcomingList');

  // Empty-state for main list (the pending list is shown/hidden entirely)
  if (!mainTasks.length) {
    mainListEl.innerHTML = `<div class="plan-empty">${
      isToday(viewDate)
        ? pendingTasks.length
          ? 'all active tasks are pending or blocked — see below'
          : 'no tasks yet — add some above'
        : 'no tasks were planned for this day'
    }</div>`;
  }

  const STATUS_ORDER = { inprogress: 0, todo: 1, pending: 2, blocked: 3, done: 4 };

  const liveEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
  const liveText = liveEntry ? liveEntry.text.toLowerCase() : null;

  const flatSort = (tasks) => {
    const parents = tasks.filter((t) => !t.parentId);
    const children = tasks.filter((t) => !!t.parentId);
    const sorted = [...parents].sort((a, b) => {
      const aLive = liveText && a.text.toLowerCase() === liveText;
      const bLive = liveText && b.text.toLowerCase() === liveText;
      if (aLive && !bLive) return -1;
      if (!aLive && bLive) return 1;
      const aOrd = STATUS_ORDER[a.status || 'todo'] ?? 1;
      const bOrd = STATUS_ORDER[b.status || 'todo'] ?? 1;
      if (aOrd !== bOrd) return aOrd - bOrd;
      // Within the same status: higher priority first (high=1, normal=0, low=-1)
      const aPri = a.priority || 0;
      const bPri = b.priority || 0;
      if (aPri !== bPri) return bPri - aPri;
      return a.text.localeCompare(b.text);
    });
    // Insert children right after their parent
    const result = [];
    sorted.forEach((p) => {
      result.push(p);
      const kids = children
        .filter((c) => c.parentId === p.id)
        .sort((a, b) => a.text.localeCompare(b.text));
      kids.forEach((k) => result.push(k));
    });
    // Orphaned children (parent deleted/moved) go at end
    children
      .filter((c) => !parents.find((p) => p.id === c.parentId))
      .forEach((c) => result.push(c));
    return result;
  };

  const statusOpts = (cur) =>
    ['todo', 'inprogress', 'upcoming', 'pending', 'blocked', 'done']
      .map((s) => {
        const labels = {
          todo: 'To do',
          inprogress: 'In progress',
          upcoming: 'Upcoming',
          pending: 'Pending',
          blocked: 'Blocked',
          done: 'Done',
        };
        return `<option value="${s}"${cur === s ? ' selected' : ''}>${labels[s]}</option>`;
      })
      .join('');

  const mainSorted = flatSort(mainTasks);
  const pendingSorted = flatSort(pendingTasks);
  const upcomingSorted = flatSort(upcomingTasks);

  const fmtMins = (mins) => {
    const h = Math.floor(mins / 60),
      m = mins % 60;
    return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  };

  // Priority button: click cycles 0 (normal) → 1 (high) → -1 (low) → 0
  function prioBtnHtml(t) {
    const p = t.priority || 0;
    const icon = p === 1 ? '⭐' : p === -1 ? '⬇' : '☆';
    const cls = p === 1 ? ' prio-high' : p === -1 ? ' prio-low' : '';
    const next = p === 0 ? 'high' : p === 1 ? 'low' : 'normal';
    return `<button class="prio-btn${cls}" data-pid="${t.id}" title="priority: ${p === 1 ? 'high' : p === -1 ? 'low' : 'normal'} — click for ${next}">${icon}</button>`;
  }

  // Notion button: 📋 send to Notion. If already sent, becomes a link icon.
  function notionBtnHtml(t) {
    if (t.notionUrl) {
      return `<button class="notion-task-btn notion-sent" data-pid="${t.id}" title="open in Notion: ${escHtml(t.notionUrl)}">🔗</button>`;
    }
    return `<button class="notion-task-btn" data-pid="${t.id}" title="send to Notion second brain">📋</button>`;
  }

  // Billable button: 💰/💸 — sits between status dropdown and task name.
  // Hidden (not rendered) for pending/blocked/upcoming; the t.billable value
  // is preserved on the task object and reappears when status returns to today.
  function billBtnHtml(t, status) {
    if (status === 'pending' || status === 'blocked' || status === 'upcoming') return '';
    const icon = t.billable === false ? '💸' : '💰';
    const title = t.billable === false ? 'mark billable' : 'mark non-billable';
    return `<button class="bill-btn bill-btn-left" data-pid="${t.id}" title="${title}">${icon}</button>`;
  }

  function renderRow(t) {
    const status = t.status || 'todo';
    const tag = t.tag || 'other';
    const cat = getCat(tag);
    const loggedMins = entries
      .filter((e) => e.date === viewKey && e.text.toLowerCase() === t.text.toLowerCase() && e.tsEnd)
      .reduce((sum, e) => sum + Math.round((e.tsEnd - e.ts) / 60000), 0);
    const timeSpent = loggedMins > 0 ? fmtMins(loggedMins) : '';

    if (editingPlanId === t.id) {
      return `<div class="plan-item" data-pid="${t.id}">
          <select class="plan-status ${status === 'done' ? 'done-st' : status}" data-pid="${t.id}">${statusOpts(status)}</select>
          <div class="plan-inline-edit">
            <input class="plan-inline-input" id="planEditInput" value="${escHtml(t.text)}" data-pid="${t.id}" />
            <button class="plan-inline-ok" id="planEditOk" data-pid="${t.id}">&#10003;</button>
            <button class="plan-inline-cancel" id="planEditCancel">&#10005;</button>
          </div>
        </div>`;
    }

    const isLive = liveText && t.text.toLowerCase() === liveText;
    const catOpts =
      [...categories]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(
          (c) =>
            `<button class="cat-opt${t.tag === c.id ? ' sel' : ''}" data-pid="${t.id}" data-cat="${c.id}" style="${t.tag === c.id ? `background:${c.color};color:#fff;border-color:transparent` : `color:${c.color}`}">${escHtml(c.label)}</button>`
        )
        .join('') +
      `<button class="cat-cancel" data-pid="${t.id}">cancel</button>` +
      `<div class="pcat-add-row">` +
      `<button class="pcat-add-btn" data-pid="${t.id}">+ new epic</button>` +
      `<div class="pcat-add-form" id="pcaf-${t.id}">` +
      `<input class="pcat-add-input" placeholder="name…" />` +
      `<button class="pcat-add-ok" data-pid="${t.id}">&#10003;</button>` +
      `<button class="pcat-add-cancel2" data-pid="${t.id}">&#10005;</button>` +
      `</div></div>`;

    // Comment row + bubble for pending/blocked
    let commentRowHtml = '';
    let pbTsText = '';
    let pbCommentBubble = '';
    if (status === 'pending' || status === 'blocked') {
      const inFlight = _pendingCommentId === t.id;
      const activeComment = t.statusComments
        ? [...t.statusComments].reverse().find((c) => c.status === status)
        : null;
      const showInput = inFlight || (activeComment && !activeComment.comment);

      // Timestamp — use activeComment.ts or any matching statusComment.ts
      const tsSource =
        activeComment ||
        (t.statusComments
          ? [...t.statusComments].reverse().find((c) => c.status === status)
          : null);
      if (tsSource && tsSource.ts) {
        const td = new Date(tsSource.ts);
        const hh = String(td.getHours()).padStart(2, '0');
        const mm = String(td.getMinutes()).padStart(2, '0');
        const isToday2 = dk(td) === dk(new Date());
        const dateLabel = isToday2
          ? 'today'
          : td.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
        pbTsText = `${status} ${dateLabel}, at ${hh}:${mm}`;
      }

      if (showInput) {
        const val = inFlight
          ? escHtml(_pendingCommentText || '')
          : activeComment
            ? escHtml(activeComment.comment || '')
            : '';
        commentRowHtml = `<div class="plan-comment-row">
            <input class="plan-comment-input" id="pc-inp-${t.id}" data-pid="${t.id}" value="${val}" placeholder="why is this ${status}? (optional)" />
            <button class="plan-comment-ok" data-pid="${t.id}">&#10003;</button>
            <button class="plan-comment-skip" data-pid="${t.id}">skip</button>
          </div>`;
      } else if (activeComment && activeComment.comment) {
        // Comment shown as tooltip on bubble — no separate row
        pbCommentBubble = `<span class="plan-comment-bubble" title="${escHtml(activeComment.comment)}">💬</span>`;
      } else {
        // No comment yet — dim bubble that opens the input
        pbCommentBubble = `<button class="plan-comment-bubble plan-comment-bubble-empty plan-comment-edit" data-pid="${t.id}" title="add reason">💬</button>`;
      }
    }

    const taskNameHtml = isLive
      ? `▶ <strong>${tag === 'meeting' ? '📅 ' : ''}${t.emoji ? escHtml(t.emoji) + ' ' : ''}${jiraTicketHtml(t.text)}</strong>`
      : `${tag === 'meeting' ? '📅 ' : ''}${t.emoji ? escHtml(t.emoji) + ' ' : ''}${jiraTicketHtml(t.text)}`;

    const catLineHtml = `<div class="plan-cat-line" data-pid="${t.id}">
            <span class="plan-cat-dot" style="background:${cat.color}"></span>
            <span class="plan-cat-name" style="color:${cat.color}">${escHtml(cat.label)}</span>
            <span class="plan-cat-chevron">▾</span>
          </div>
          <div class="plan-cat-picker" id="pcp-${t.id}">${catOpts}</div>`;

    // Handoff note from wl_handoff
    let handoffNoteHtml = '';
    if (status !== 'done') {
      try {
        const _hn = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
        const _note = _hn[t.text.toLowerCase().trim()];
        if (_note)
          handoffNoteHtml = `<div class="plan-handoff-note"><span class="plan-handoff-text">↳ ${escHtml(_note)}</span><button class="plan-handoff-dismiss" data-task="${escHtml(t.text.toLowerCase().trim())}" title="dismiss note">×</button></div>`;
      } catch (e) {}
    }

    // Checkpoint badge + expandable area
    const cps = Array.isArray(t.checkpoints) ? t.checkpoints : [];
    const cpDone = cps.filter((c) => c.done).length;
    const cpTotal = cps.length;
    const cpOpen = _cpOpenIds.has(t.id);
    let cpBadgeClass = 'cp-badge';
    if (cpDone > 0 && cpDone < cpTotal) cpBadgeClass += ' cp-has-progress';
    else if (cpTotal > 0 && cpDone === cpTotal) cpBadgeClass += ' cp-done-all';
    else if (cpTotal > 0) cpBadgeClass += ` cp-st-${status}`; // has steps but none ticked yet — mirror task status color
    const cpBadgeLabel =
      cpTotal === 0 ? '+ steps' : cpDone === cpTotal ? `✓ ${cpTotal}` : `${cpDone}/${cpTotal}`;

    let cpAreaHtml = '';
    if (cpOpen || (cpTotal === 0 && cpOpen)) {
      const pct = cpTotal ? Math.round((cpDone / cpTotal) * 100) : 0;
      const rowsHtml = cps
        .map(
          (cp, i) =>
            `<div class="cp-row${_cpEditId === t.id && _cpEditIdx === i ? ' cp-editing' : ''}" draggable="${_cpEditId === t.id && _cpEditIdx === i ? 'false' : 'true'}" data-pid="${t.id}" data-cpidx="${i}">
            <span class="cp-handle" title="drag to reorder">⠿</span>
            <div class="cp-check${cp.done === true ? ' cp-checked' : cp.done === 'partial' ? ' cp-partial' : ''}" data-pid="${t.id}" data-cpidx="${i}">${cp.done === 'partial' ? '–' : '✓'}</div>
            ${
              _cpEditId === t.id && _cpEditIdx === i
                ? `<input class="cp-edit-input" data-pid="${t.id}" data-cpidx="${i}" value="${escHtml(cp.text)}" />`
                : `<span class="cp-label${cp.done === true ? ' cp-checked' : cp.done === 'partial' ? ' cp-partial' : ''}" data-pid="${t.id}" data-cpidx="${i}">${escHtml(cp.text)}</span>`
            }
            <button class="cp-del-btn" data-pid="${t.id}" data-cpidx="${i}" title="remove">×</button>
          </div>`
        )
        .join('');
      cpAreaHtml = `<div class="cp-area">
          ${
            cpTotal > 0
              ? `<div class="cp-progress-row">
            <div class="cp-bar"><div class="cp-fill" style="width:${pct}%"></div></div>
            <span class="cp-frac">${cpDone}/${cpTotal}</span>
          </div>`
              : ''
          }
          ${rowsHtml}
          <div class="cp-add-row">
            <span class="cp-add-icon">+</span>
            <input class="cp-add-input" data-pid="${t.id}" placeholder="add a step… (Enter to save)" />
          </div>
        </div>`;
    }

    // Pending/blocked: simplified layout — no action buttons, bubble tooltip, timestamp at far right
    if (status === 'pending' || status === 'blocked') {
      return `<div class="plan-item plan-pb-item${isLive ? ' active-timer' : ''}" data-pid="${t.id}" data-dtxt="${escHtml(t.text)}" data-dtag="${tag}">
          <select class="plan-status ${status}" data-pid="${t.id}">${statusOpts(status)}</select>
          ${billBtnHtml(t, status)}
          <div class="plan-left">
            <div class="plan-top">
              <span class="plan-text">${taskNameHtml}${pbCommentBubble ? '&thinsp;' + pbCommentBubble : ''}<button class="${cpBadgeClass}" data-pid="${t.id}" title="${cpOpen ? 'collapse steps' : 'expand steps'}">${cpBadgeLabel}</button>${prioBtnHtml(t)}${notionBtnHtml(t)}</span>
            </div>
            ${handoffNoteHtml}
            ${cpAreaHtml}
            ${commentRowHtml}
            ${catLineHtml}
          </div>
          ${pbTsText ? `<span class="plan-pb-ts">${escHtml(pbTsText)}</span>` : ''}
        </div>`;
    }

    const childCount = planTasks.filter(
      (c) => c.parentId === t.id && c.date === viewKey && c.status !== 'done'
    ).length;
    const childBadge = childCount > 0 ? `<span class="plan-child-badge">${childCount}</span>` : '';
    const isChild = !!t.parentId;
    const indent = isChild ? ' plan-child-item' : '';
    const childPrefix = isChild ? '<span class="plan-child-arrow">↳</span>' : '';

    return `<div class="plan-item${status === 'done' ? ' done' : ''}${isLive ? ' active-timer' : ''}${indent}" data-pid="${t.id}" data-dtxt="${escHtml(t.text)}" data-dtag="${tag}">
        ${childPrefix}<select class="plan-status ${status === 'done' ? 'done-st' : status}" data-pid="${t.id}">${statusOpts(status)}</select>
        ${billBtnHtml(t, status)}
        <div class="plan-left">
          <div class="plan-top">
            <span class="plan-text">${taskNameHtml}${!isChild ? `<button class="${cpBadgeClass}" data-pid="${t.id}" title="${cpOpen ? 'collapse steps' : 'expand steps'}">${cpBadgeLabel}</button>` : ''}${prioBtnHtml(t)}${notionBtnHtml(t)}</span>
          </div>
          ${handoffNoteHtml}
          ${!isChild ? cpAreaHtml : ''}
          ${commentRowHtml}
          ${isChild ? '' : catLineHtml}
        </div>
        <div class="plan-actions">
          ${childBadge}
          ${status !== 'done' && !isChild ? `<button class="plan-split-btn" data-pid="${t.id}" title="split into subtasks">⊕</button>` : ''}
          <button class="plan-log-btn" data-pid="${t.id}" data-text="${escHtml(t.text)}">▶ start</button>
          <button class="plan-edit-btn" data-pid="${t.id}" title="edit">&#9998;</button>
          <button class="plan-del-btn" data-pid="${t.id}">&times;</button>
        </div>
      </div>
      ${
        splitInputId === t.id
          ? `<div class="plan-split-row" data-parent="${t.id}">
        <span class="plan-child-arrow">↳</span>
        <input class="plan-split-input" id="splitInp-${t.id}" placeholder="subtask name… ↵ to add" />
        <button class="plan-split-done" data-pid="${t.id}">done</button>
      </div>`
          : ''
      }`;
  }

  // Render all three lists
  if (mainTasks.length) mainListEl.innerHTML = mainSorted.map(renderRow).join('');
  pendingListEl.innerHTML = pendingSorted.map(renderRow).join('');
  upcomingListEl.innerHTML = upcomingSorted.map(renderRow).join('');

  // Event handlers bound across all three lists (main, pending, upcoming)
  const lists = [mainListEl, pendingListEl, upcomingListEl];
  const qa = (sel) => lists.flatMap((L) => [...L.querySelectorAll(sel)]);
  qa('.plan-text').forEach((span) => {
    span.addEventListener('click', () => {
      const pid = span.closest('.plan-item').dataset.pid;
      if (pid) {
        editingPlanId = pid;
        renderPlan();
      }
    });
  });

  // Category picker
  qa('.plan-cat-line').forEach((line) => {
    line.addEventListener('click', () => {
      const pid = line.dataset.pid;
      const picker = document.getElementById('pcp-' + pid);
      const isOpen = picker.classList.contains('open');
      lists.forEach((L) =>
        L.querySelectorAll('.plan-cat-picker.open').forEach((p) => p.classList.remove('open'))
      );
      if (!isOpen) picker.classList.add('open');
    });
  });
  qa('.plan-cat-picker .cat-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      if (t) {
        t.tag = btn.dataset.cat;
        savePlan();
        renderPlan();
      }
    });
  });
  qa('.plan-cat-picker .cat-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('pcp-' + btn.dataset.pid).classList.remove('open');
    });
  });

  // + new epic inside picker
  qa('.pcat-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.style.display = 'none';
      const form = document.getElementById('pcaf-' + btn.dataset.pid);
      form.classList.add('open');
      form.querySelector('.pcat-add-input').focus();
    });
  });
  qa('.pcat-add-ok').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = document.getElementById('pcaf-' + btn.dataset.pid);
      const input = form.querySelector('.pcat-add-input');
      const label = input.value.trim();
      if (!label) {
        input.focus();
        return;
      }
      if (categories.find((c) => c.label.toLowerCase() === label.toLowerCase())) {
        input.style.borderColor = '#C62828';
        input.focus();
        return;
      }
      const color = nextDistinctColor();
      const id = 'cat_' + Date.now();
      categories.push({ id, label, color });
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      if (t) t.tag = id;
      save();
      savePlan();
      renderTagRow();
      renderPlan();
    });
  });
  qa('.pcat-add-input').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') inp.closest('.pcat-add-form').querySelector('.pcat-add-ok').click();
      if (e.key === 'Escape')
        inp.closest('.pcat-add-form').querySelector('.pcat-add-cancel2').click();
    });
  });
  qa('.pcat-add-cancel2').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = document.getElementById('pcaf-' + btn.dataset.pid);
      form.classList.remove('open');
      const addBtn = form.closest('.pcat-add-row').querySelector('.pcat-add-btn');
      if (addBtn) addBtn.style.display = '';
    });
  });

  // Status change — handles pending/blocked entry creation and in-flight comment carry-over
  qa('.plan-status').forEach((sel) => {
    sel.addEventListener('change', () => {
      const t = planTasks.find((t) => t.id === sel.dataset.pid);
      if (!t) return;
      const prevStatus = t.status;
      const newStatus = sel.value;

      // Capture in-flight typed text BEFORE re-render
      let liveTyped = null;
      if (_pendingCommentId === t.id) {
        const inp = document.getElementById('pc-inp-' + t.id);
        liveTyped = inp ? inp.value : _pendingCommentText;
      }

      t.status = newStatus;
      if (newStatus === 'done' && !t.completedAt) t.completedAt = roundToNearest30(Date.now());
      if (newStatus !== 'done') delete t.completedAt;

      // If child goes inprogress, promote parent too (unless already done)
      if (newStatus === 'inprogress' && t.parentId) {
        const parent = planTasks.find((p) => p.id === t.parentId);
        if (parent && parent.status === 'todo') {
          parent.status = 'inprogress';
        }
      }
      // When marking done, retire older versions of the same task
      if (newStatus === 'done') {
        planTasks
          .filter(
            (p) =>
              p.id !== t.id && p.text.toLowerCase() === t.text.toLowerCase() && p.status !== 'done'
          )
          .forEach((p) => {
            p.status = 'done';
            if (!p.completedAt) p.completedAt = t.completedAt;
          });
      }
      // Auto-complete parent when all its children are done
      if (newStatus === 'done' && t.parentId) {
        const parent = planTasks.find((p) => p.id === t.parentId);
        if (parent && parent.status !== 'done') {
          const siblings = planTasks.filter((c) => c.parentId === parent.id && c.date === t.date);
          if (siblings.length > 0 && siblings.every((c) => c.status === 'done' || c.id === t.id)) {
            parent.status = 'done';
            if (!parent.completedAt) parent.completedAt = roundToNearest30(Date.now());
          }
        }
      }
      // Auto-stop timer when active task is marked done
      if (newStatus === 'done' && activeTimer) {
        const timerEntry = entries.find((e) => e.id === activeTimer.entryId);
        if (timerEntry && timerEntry.text.toLowerCase() === t.text.toLowerCase()) {
          stopTimer();
        }
      }

      // Pending/blocked transitions
      const wasPB = prevStatus === 'pending' || prevStatus === 'blocked';
      const isPB = newStatus === 'pending' || newStatus === 'blocked';

      if (isPB && newStatus !== prevStatus) {
        if (!t.statusComments) t.statusComments = [];
        const last = t.statusComments[t.statusComments.length - 1];
        const inFlight = _pendingCommentId === t.id;

        if (wasPB && inFlight && last && !last.comment) {
          // Same comment session — just relabel the unsaved entry,
          // preserving the typed-but-unsaved text via _pendingCommentText.
          last.status = newStatus;
          _pendingCommentText = liveTyped != null ? liveTyped : _pendingCommentText || '';
          // _pendingCommentId stays set
        } else {
          // Fresh session
          t.statusComments.push({ status: newStatus, comment: '', ts: Date.now() });
          _pendingCommentId = t.id;
          _pendingCommentText = '';
        }
      } else if (!isPB) {
        // Leaving pending/blocked — only drop a trailing unsaved entry
        // if this task had an in-flight comment session (otherwise it could
        // be a deliberately-saved empty entry).
        if (_pendingCommentId === t.id && t.statusComments && t.statusComments.length) {
          const last = t.statusComments[t.statusComments.length - 1];
          if (!last.comment && (last.status === 'pending' || last.status === 'blocked')) {
            t.statusComments.pop();
          }
        }
        if (_pendingCommentId === t.id) {
          _pendingCommentId = null;
          _pendingCommentText = '';
        }
      }

      savePlan();
      renderPlan();
      renderCompleted();
    });
  });

  // Accept / skip / edit for status comment
  function saveComment(pid) {
    const t = planTasks.find((t) => t.id === pid);
    if (!t) {
      _pendingCommentId = null;
      _pendingCommentText = '';
      renderPlan();
      return;
    }
    if (!t.statusComments) t.statusComments = [];
    const inp = document.getElementById('pc-inp-' + pid);
    const val = inp ? inp.value.trim() : (_pendingCommentText || '').trim();
    const entry = [...t.statusComments].reverse().find((c) => c.status === t.status);
    if (entry) {
      if (val) {
        entry.comment = val;
      } else {
        // Empty accept behaves as skip — remove the entry so the row
        // collapses to "+ add reason" rather than reopening the input.
        t.statusComments = t.statusComments.filter((c) => c !== entry);
      }
    } else if (val) {
      t.statusComments.push({ status: t.status, comment: val, ts: Date.now() });
    }
    _pendingCommentId = null;
    _pendingCommentText = '';
    savePlan();
    renderPlan();
  }
  qa('.plan-comment-ok').forEach((btn) => {
    btn.addEventListener('click', () => saveComment(btn.dataset.pid));
  });
  qa('.plan-comment-skip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      if (t && t.statusComments && t.statusComments.length) {
        const last = t.statusComments[t.statusComments.length - 1];
        if (!last.comment) t.statusComments.pop();
      }
      _pendingCommentId = null;
      _pendingCommentText = '';
      savePlan();
      renderPlan();
    });
  });
  qa('.plan-comment-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      _pendingCommentId = btn.dataset.pid;
      if (t && t.statusComments) {
        const ac = [...t.statusComments].reverse().find((c) => c.status === t.status);
        _pendingCommentText = ac ? ac.comment || '' : '';
      } else {
        _pendingCommentText = '';
      }
      renderPlan();
    });
  });
  qa('.plan-comment-input').forEach((inp) => {
    // Mirror typed text into the in-flight buffer
    inp.addEventListener('input', () => {
      if (inp.dataset.pid === _pendingCommentId) _pendingCommentText = inp.value;
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveComment(inp.dataset.pid);
      if (e.key === 'Escape') {
        const t = planTasks.find((t) => t.id === inp.dataset.pid);
        if (t && t.statusComments && t.statusComments.length) {
          const last = t.statusComments[t.statusComments.length - 1];
          if (!last.comment) t.statusComments.pop();
        }
        _pendingCommentId = null;
        _pendingCommentText = '';
        savePlan();
        renderPlan();
      }
    });
    // Auto-focus the in-flight input, with cursor at end
    if (inp.dataset.pid === _pendingCommentId) {
      inp.focus();
      const len = inp.value.length;
      try {
        inp.setSelectionRange(len, len);
      } catch (e) {}
    }
  });

  // History expand/collapse
  qa('.plan-comment-history-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      _expandedHistoryId = _expandedHistoryId === btn.dataset.pid ? null : btn.dataset.pid;
      renderPlan();
    });
  });

  // Dismiss handoff note
  qa('.plan-handoff-dismiss').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        const notes = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
        delete notes[btn.dataset.task];
        localStorage.setItem('wl_handoff', JSON.stringify(notes));
      } catch (e) {}
      renderPlan();
    });
  });

  // Checkpoint: toggle open/closed
  qa('.cp-badge').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pid = btn.dataset.pid;
      if (_cpOpenIds.has(pid)) _cpOpenIds.delete(pid);
      else _cpOpenIds.add(pid);
      renderPlan();
      // Auto-focus add input when opening
      if (_cpOpenIds.has(pid)) {
        setTimeout(() => {
          const inp = document.querySelector(`.cp-add-input[data-pid="${pid}"]`);
          if (inp) inp.focus();
        }, 0);
      }
    });
  });

  // Checkpoint: toggle done (three-state: false → 'partial' → true → false)
  qa('.cp-check').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = planTasks.find((t) => t.id === el.dataset.pid);
      if (!t || !t.checkpoints) return;
      const idx = parseInt(el.dataset.cpidx);
      const cur = t.checkpoints[idx].done;
      t.checkpoints[idx].done = cur === false ? 'partial' : cur === 'partial' ? true : false;
      savePlan();
      renderPlan();
    });
  });

  // Checkpoint: toggle done via label click; double-click to edit
  qa('.cp-label').forEach((lbl) => {
    lbl.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = planTasks.find((t) => t.id === lbl.dataset.pid);
      if (!t || !t.checkpoints) return;
      const idx = parseInt(lbl.dataset.cpidx);
      const cur = t.checkpoints[idx].done;
      t.checkpoints[idx].done = cur === false ? 'partial' : cur === 'partial' ? true : false;
      savePlan();
      renderPlan();
    });
    lbl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      _cpEditId = lbl.dataset.pid;
      _cpEditIdx = parseInt(lbl.dataset.cpidx);
      renderPlan();
      setTimeout(() => {
        const inp = document.querySelector(
          '.cp-edit-input[data-pid="' + _cpEditId + '"][data-cpidx="' + _cpEditIdx + '"]'
        );
        if (inp) {
          inp.focus();
          inp.select();
        }
      }, 0);
    });
  });

  // Checkpoint: save/cancel inline edit
  qa('.cp-edit-input').forEach((inp) => {
    const save = () => {
      const val = inp.value.trim();
      const t = planTasks.find((t) => t.id === inp.dataset.pid);
      if (t && t.checkpoints && val) t.checkpoints[parseInt(inp.dataset.cpidx)].text = val;
      _cpEditId = null;
      _cpEditIdx = null;
      savePlan();
      renderPlan();
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
      if (e.key === 'Escape') {
        _cpEditId = null;
        _cpEditIdx = null;
        renderPlan();
      }
    });
    inp.addEventListener('blur', save);
    inp.addEventListener('click', (e) => e.stopPropagation());
  });

  // Checkpoint: delete
  qa('.cp-del-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      if (!t || !t.checkpoints) return;
      t.checkpoints.splice(parseInt(btn.dataset.cpidx), 1);
      savePlan();
      renderPlan();
    });
  });

  // Checkpoint: add on Enter
  qa('.cp-add-input').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const val = inp.value.trim();
      if (!val) return;
      const t = planTasks.find((t) => t.id === inp.dataset.pid);
      if (!t) return;
      if (!Array.isArray(t.checkpoints)) t.checkpoints = [];
      t.checkpoints.push({
        id: 'cp' + Date.now() + Math.random().toString(36).slice(2),
        text: val,
        done: false,
      });
      savePlan();
      renderPlan();
      // Re-focus add input after render
      setTimeout(() => {
        const next = document.querySelector(`.cp-add-input[data-pid="${inp.dataset.pid}"]`);
        if (next) next.focus();
      }, 0);
    });
    inp.addEventListener('click', (e) => e.stopPropagation());
  });

  // Checkpoint: drag-to-reorder
  let _cpDragPid = null,
    _cpDragIdx = null;
  qa('.cp-row').forEach((row) => {
    row.addEventListener('dragstart', (e) => {
      _cpDragPid = row.dataset.pid;
      _cpDragIdx = parseInt(row.dataset.cpidx);
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document
        .querySelectorAll('.cp-row.cp-drag-over')
        .forEach((r) => r.classList.remove('cp-drag-over'));
      row.classList.add('cp-drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('cp-drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('cp-drag-over');
      const targetIdx = parseInt(row.dataset.cpidx);
      if (_cpDragPid !== row.dataset.pid || _cpDragIdx === null || _cpDragIdx === targetIdx) return;
      const t = planTasks.find((t) => t.id === _cpDragPid);
      if (!t || !t.checkpoints) return;
      const moved = t.checkpoints.splice(_cpDragIdx, 1)[0];
      t.checkpoints.splice(targetIdx, 0, moved);
      savePlan();
      renderPlan();
      _cpDragIdx = null;
      _cpDragPid = null;
    });
  });

  // Edit task text
  qa('.plan-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingPlanId = btn.dataset.pid;
      renderPlan();
    });
  });

  const editOk = document.getElementById('planEditOk');
  if (editOk) {
    const saveEdit = () => {
      const inp = document.getElementById('planEditInput');
      const text = inp ? inp.value.trim() : '';
      if (!text) {
        editingPlanId = null;
        renderPlan();
        return;
      }
      const t = planTasks.find((t) => t.id === editOk.dataset.pid);
      if (t) t.text = text;
      editingPlanId = null;
      savePlan();
      renderPlan();
    };
    editOk.addEventListener('click', saveEdit);
    const inp = document.getElementById('planEditInput');
    if (inp) {
      inp.focus();
      inp.select();
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') {
          editingPlanId = null;
          renderPlan();
        }
      });
    }
  }
  const editCancel = document.getElementById('planEditCancel');
  if (editCancel)
    editCancel.addEventListener('click', () => {
      editingPlanId = null;
      renderPlan();
    });

  // Start timer from task
  qa('.plan-log-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      const text = btn.dataset.text;
      const tag = t ? t.tag || 'other' : selectedTag;
      if (activeTimer) stopTimer();
      const entry = {
        id: Date.now() + '',
        text,
        tag,
        ts: safeRoundedStart(),
        date: dk(new Date()),
      };
      entries.push(entry);
      if (t && t.status === 'todo') {
        t.status = 'inprogress';
        if (t.parentId) {
          const parent = planTasks.find((p) => p.id === t.parentId);
          if (parent && parent.status === 'todo') parent.status = 'inprogress';
        }
        savePlan();
        renderPlan();
      }
      viewDate = new Date();
      save();
      startTimer(entry.id);
      render();
    });
  });

  // Delete task (children become orphaned top-level tasks)
  qa('.plan-del-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      planTasks = planTasks.filter((t) => t.id !== btn.dataset.pid);
      savePlan();
      renderPlan();
    });
  });

  // Split into subtasks
  qa('.plan-split-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      splitInputId = splitInputId === btn.dataset.pid ? null : btn.dataset.pid;
      renderPlan();
      if (splitInputId) {
        const inp = document.getElementById('splitInp-' + splitInputId);
        if (inp) inp.focus();
      }
    });
  });
  qa('.plan-split-done').forEach((btn) => {
    btn.addEventListener('click', () => {
      splitInputId = null;
      renderPlan();
    });
  });
  qa('.plan-split-input').forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = inp.value.trim();
        if (!text) return;
        const parentId = inp.closest('.plan-split-row').dataset.parent;
        const parent = planTasks.find((t) => t.id === parentId);
        planTasks.push({
          id: Date.now() + '',
          text,
          status: 'todo',
          date: dk(new Date()),
          tag: parent ? parent.tag : selectedTag,
          parentId,
        });
        savePlan();
        inp.value = '';
        renderPlan();
        // Re-focus the new input after re-render
        const newInp = document.getElementById('splitInp-' + parentId);
        if (newInp) newInp.focus();
      } else if (e.key === 'Escape') {
        splitInputId = null;
        renderPlan();
      }
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

let _emojiPickerPid = null;

/**
 * Opens a floating emoji picker anchored below the given element.
 * Includes a free-text input for custom emoji and a grid of common choices.
 * Calling again for the same task ID closes the picker.
 * @param {string}      pid    - Plan task ID.
 * @param {HTMLElement} anchor - Element to position the picker below.
 */
function openEmojiPicker(pid, anchor) {
  // Remove any existing picker
  const existing = document.getElementById('__emojiPicker');
  if (existing) {
    existing.remove();
    if (_emojiPickerPid === pid) {
      _emojiPickerPid = null;
      return;
    }
  }
  _emojiPickerPid = pid;
  const task = planTasks.find((t) => t.id === pid);
  if (!task) return;

  const picker = document.createElement('div');
  picker.id = '__emojiPicker';
  picker.className = 'emoji-picker';

  const input = document.createElement('input');
  input.className = 'emoji-picker-input';
  input.placeholder = 'type or paste any emoji…';
  input.value = task.emoji || '';
  picker.appendChild(input);

  const grid = document.createElement('div');
  grid.className = 'emoji-picker-grid';
  EMOJI_COMMON.forEach((em) => {
    const b = document.createElement('button');
    b.textContent = em;
    b.type = 'button';
    b.addEventListener('click', () => setTaskEmoji(pid, em));
    grid.appendChild(b);
  });
  picker.appendChild(grid);

  const clear = document.createElement('button');
  clear.className = 'emoji-picker-clear';
  clear.textContent = '✕ remove emoji';
  clear.addEventListener('click', () => setTaskEmoji(pid, null));
  picker.appendChild(clear);

  // Position below anchor
  document.body.appendChild(picker);
  const rect = anchor.getBoundingClientRect();
  const scrollY = window.scrollY || document.documentElement.scrollTop;
  picker.style.top = rect.bottom + scrollY + 4 + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';

  input.focus();
  input.select();
  // Confirm typed emoji on Enter
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = input.value.trim();
      setTaskEmoji(pid, val || null);
    }
    if (e.key === 'Escape') {
      picker.remove();
      _emojiPickerPid = null;
    }
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!picker.contains(ev.target)) {
        picker.remove();
        _emojiPickerPid = null;
        document.removeEventListener('click', close);
      }
    });
  }, 50);
}

/**
 * Saves an emoji to a plan task and closes the picker.
 * Pass null or an empty string to remove the task's emoji.
 * @param {string}      pid   - Plan task ID.
 * @param {string|null} emoji - Emoji character to assign, or null to remove.
 */
function setTaskEmoji(pid, emoji) {
  const task = planTasks.find((t) => t.id === pid);
  if (!task) return;
  if (emoji) task.emoji = emoji;
  else delete task.emoji;
  const p = document.getElementById('__emojiPicker');
  if (p) {
    p.remove();
    _emojiPickerPid = null;
  }
  savePlan();
  renderPlan();
}

/**
 * Reads the plan-input field and adds a new "todo" task to today's plan.
 * Inherits the currently selected tag and that category's billable default.
 * No-ops if the input is empty.
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

document.getElementById('planAddBtn').addEventListener('click', addPlanTask);
document.getElementById('planInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addPlanTask();
});
document.getElementById('planHeader').addEventListener('click', () => {
  planCollapsed = !planCollapsed;
  renderPlan();
});
let upcomingCollapsed = false;
document.getElementById('upcomingHeader').addEventListener('click', () => {
  upcomingCollapsed = !upcomingCollapsed;
  document.getElementById('upcomingSection').classList.toggle('collapsed', upcomingCollapsed);
});
document.getElementById('pendingHeader').addEventListener('click', () => {
  pendingCollapsed = !pendingCollapsed;
  renderPlan();
});
