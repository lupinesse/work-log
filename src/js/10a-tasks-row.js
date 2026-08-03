/* ── Today's tasks — per-row card HTML (split out of 10a-tasks-render.js) ──
   Per-task row/card builders for the kanban board. Module-level state vars
   (editingPlanId, _noteOpenIds, _cpOpenIds, …) live in 10-tasks.js; callers
   (renderPlan, renderBoardDoneHistory) live in 10a-tasks-render.js. */

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
 * Builds the note toggle button HTML for a task row.
 * Visually distinct when the task already has a note.
 * @param {{ id: string, note: (string|undefined) }} t - The plan task.
 * @returns {string} HTML button element.
 */
function noteBtnHtml(t) {
  const has = !!(t.note && t.note.trim());
  return `<button class="plan-note-btn${has ? ' plan-note-btn--has' : ''}" data-pid="${t.id}" title="${has ? 'edit note' : 'add note'}" aria-label="${has ? 'edit note' : 'add note'}">📝</button>`;
}

/**
 * Builds the inline note display / edit area for a task row.
 * Renders a read-only line when the task has a note and the area is closed;
 * renders a textarea with save/remove/cancel when open.
 * @param {{ id: string, note: (string|undefined) }} t - The plan task.
 * @returns {string} HTML string, or '' when no note and area is closed.
 */
function noteAreaHtml(t) {
  const isOpen = _noteOpenIds.has(t.id);
  const hasNote = !!(t.note && t.note.trim());
  if (!isOpen && !hasNote) return '';
  if (!isOpen) {
    return `<button class="plan-note-display" data-pid="${t.id}" title="click to edit note">📝 ${escHtml(t.note)}</button>`;
  }
  return `<div class="plan-note-area">
      <textarea class="plan-note-input" data-pid="${t.id}" rows="2" aria-label="note for task" placeholder="add a note…">${escHtml(t.note || '')}</textarea>
      <div class="plan-note-btns">
        <button class="plan-note-save" data-pid="${t.id}">save</button>
        ${hasNote ? `<button class="plan-note-del" data-pid="${t.id}">remove</button>` : ''}
        <button class="plan-note-cancel" data-pid="${t.id}">cancel</button>
      </div>
    </div>`;
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
  const title = t.billable === false ? 'mark billable' : 'mark internal';
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
          `<button class="cat-opt${t.tag === c.id ? ' sel' : ''}" data-pid="${t.id}" data-cat="${c.id}" style="${t.tag === c.id ? `background:${safeCssColor(c.color)};color:#fff;border-color:transparent` : `color:${safeCssColor(c.color)}`}">${escHtml(c.label)}</button>`
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
          <span class="plan-cat-dot" style="background:${safeCssColor(cat.color)}"></span>
          <span class="plan-cat-name" style="color:${safeCssColor(cat.color)}">${escHtml(cat.label)}</span>
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
    } catch (err) {
      wlLog.warn('renderRow: failed to parse wl_handoff from localStorage', err);
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
  // Checkmark prefix appears as soon as one step is ticked; fraction K/N is
  // always shown so the user can see total even when all are complete.
  const cpBadgeLabel =
    cpTotal === 0 ? '+ steps' : cpDone > 0 ? `✓ ${cpDone}/${cpTotal}` : `${cpDone}/${cpTotal}`;

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
    return `<div class="plan-item plan-pb-item${isLive ? ' active-timer' : ''}" data-pid="${t.id}" data-dtxt="${escHtml(t.text)}" data-dtag="${tag}" data-status="${status}">
        <select class="plan-status ${status}" data-pid="${t.id}">${statusOpts(status)}</select>
        ${billBtnHtml(t, status)}
        <div class="plan-left">
          <div class="plan-top">
            <span class="plan-text">${taskNameHtml}${pbCommentBubble ? '&thinsp;' + pbCommentBubble : ''}<button class="${cpBadgeClass}" data-pid="${t.id}" title="${cpOpen ? 'collapse steps' : 'expand steps'}">${cpBadgeLabel}</button>${prioBtnHtml(t)}${notionBtnHtml(t)}${noteBtnHtml(t)}</span>
          </div>
          ${handoffNoteHtml}
          ${cpAreaHtml}
          ${commentRowHtml}
          ${noteAreaHtml(t)}
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

  return `<div class="plan-item${status === 'done' ? ' done' : ''}${status === 'inprogress' && !isLive ? ' inprogress' : ''}${isLive ? ' active-timer' : ''}${indent}" data-pid="${t.id}" data-dtxt="${escHtml(t.text)}" data-dtag="${tag}" data-status="${status}">
      ${childPrefix}<select class="plan-status ${status === 'done' ? 'done-st' : status}" data-pid="${t.id}">${statusOpts(status)}</select>
      ${billBtnHtml(t, status)}
      <div class="plan-left">
        <div class="plan-top">
          <span class="plan-text">${taskNameHtml}${!isChild ? `<button class="${cpBadgeClass}" data-pid="${t.id}" title="${cpOpen ? 'collapse steps' : 'expand steps'}">${cpBadgeLabel}</button>` : ''}${prioBtnHtml(t)}${notionBtnHtml(t)}</span>
        </div>
        ${handoffNoteHtml}
        ${!isChild ? cpAreaHtml : ''}
        ${commentRowHtml}
        ${noteAreaHtml(t)}
        ${isChild ? '' : catLineHtml}
      </div>
      <div class="plan-actions">
        ${childBadge}
        ${status !== 'done' && !isChild ? `<button class="plan-split-btn" data-pid="${t.id}" title="split into subtasks">⊕</button>` : ''}
        <button class="plan-log-btn" data-pid="${t.id}" data-text="${escHtml(t.text)}">▸ track</button>
        ${noteBtnHtml(t)}
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
