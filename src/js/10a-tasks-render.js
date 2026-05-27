/* ── Today's tasks — rendering ── */

/**
 * Builds the <option> list for a task's status <select>.
 * @param {string} cur - The task's current status value.
 * @returns {string} HTML option elements.
 */
function statusOpts(cur) {
  return ['todo', 'inprogress', 'upcoming', 'pending', 'blocked', 'done']
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
}

/**
 * Builds the priority toggle button HTML for a task row.
 * Click cycles: normal (0) → high (1) → low (-1) → normal.
 * @param {{ id: string, priority: (number|undefined) }} t - The plan task.
 * @returns {string} HTML button element.
 */
function prioBtnHtml(t) {
  const p = t.priority || 0;
  const icon = p === 1 ? '⭐' : p === -1 ? '⬇' : '☆';
  const cls = p === 1 ? ' prio-high' : p === -1 ? ' prio-low' : '';
  const next = p === 0 ? 'high' : p === 1 ? 'low' : 'normal';
  return `<button class="prio-btn${cls}" data-pid="${t.id}" title="priority: ${p === 1 ? 'high' : p === -1 ? 'low' : 'normal'} — click for ${next}">${icon}</button>`;
}

/**
 * Builds the Notion send/link button HTML for a task row.
 * Shows a link icon if already sent; send icon otherwise.
 * @param {{ id: string, notionUrl: (string|undefined) }} t - The plan task.
 * @returns {string} HTML button element.
 */
function notionBtnHtml(t) {
  if (t.notionUrl) {
    return `<button class="notion-task-btn notion-sent" data-pid="${t.id}" title="open in Notion: ${escHtml(t.notionUrl)}">🔗</button>`;
  }
  return `<button class="notion-task-btn" data-pid="${t.id}" title="send to Notion second brain">📋</button>`;
}

/**
 * Builds the billable toggle button HTML for a task row.
 * Returns empty string for pending/blocked/upcoming tasks where billing is irrelevant.
 * @param {{ id: string, billable: (boolean|undefined) }} t - The plan task.
 * @param {string} status - The task's current status.
 * @returns {string} HTML button element, or ''.
 */
function billBtnHtml(t, status) {
  // Hidden (not rendered) for pending/blocked/upcoming; the t.billable value
  // is preserved on the task object and reappears when status returns to active.
  if (status === 'pending' || status === 'blocked' || status === 'upcoming') return '';
  const icon = t.billable === false ? '💸' : '💰';
  const title = t.billable === false ? 'mark billable' : 'mark non-billable';
  return `<button class="bill-btn bill-btn-left" data-pid="${t.id}" title="${title}">${icon}</button>`;
}

/**
 * Builds the HTML string for a single plan task row.
 * Handles two layout branches: pending/blocked (compact) and normal (full).
 * Reads module-level state variables for edit mode, checkpoint open state,
 * and pending comment state so re-renders are always consistent.
 * @param {Object} t - The plan task object to render.
 * @returns {string} HTML string for one `.plan-item` element (and optional split row).
 */
function renderRow(t) {
  const viewKey = dk(viewDate);
  const liveEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
  const liveText = liveEntry ? liveEntry.text.toLowerCase() : null;

  const status = t.status || 'todo';
  const tag = t.tag || 'other';
  const cat = getCat(tag);
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
      (t.statusComments ? [...t.statusComments].reverse().find((c) => c.status === status) : null);
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
    } catch (e) {
      // Silently skip — handoff note is display-only; a parse failure just hides it
    }
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
        <button class="plan-log-btn" data-pid="${t.id}" data-text="${escHtml(t.text)}">▸ track</button>
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

/**
 * Re-renders the entire plan UI for the currently viewed date: main task list,
 * pending/blocked section, upcoming section, all associated controls (status
 * dropdowns, checkpoints, billable buttons, Notion/emoji buttons), and section
 * headers with counts. Also renders the completed-tasks section.
 *
 * Design trade-off: full DOM re-render on every state change rather than
 * targeted updates. Acceptable for a personal tool where the task list is small
 * (typically < 20 items) and the simplicity of "always consistent" outweighs
 * the cost of targeted diffing. If list size grows, consider partial updates.
 */
function renderPlan() {
  /* ── 1. Filter and count tasks for the current view date ── */
  const viewKey = dk(viewDate);
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

  /* ── 2. Section header visibility and counts ── */
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

  /* ── 3. List DOM references and empty state ── */
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

  /* ── 4. Sort tasks and write HTML to DOM ── */
  const mainSorted = flatSort(mainTasks);
  const pendingSorted = flatSort(pendingTasks);
  const upcomingSorted = flatSort(upcomingTasks);
  if (mainTasks.length) mainListEl.innerHTML = mainSorted.map(renderRow).join('');
  pendingListEl.innerHTML = pendingSorted.map(renderRow).join('');
  upcomingListEl.innerHTML = upcomingSorted.map(renderRow).join('');

  /* ── 5. Bind event handlers ── */
  bindPlanEvents([mainListEl, pendingListEl, upcomingListEl]);

  if (isToday(viewDate)) renderTrackRecent();
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
