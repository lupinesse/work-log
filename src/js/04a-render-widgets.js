/* ── Render — timeline-entry widgets (split out of 04-render.js) ──
   Proof-link/note editor, category picker, ad-hoc log row, recent-tasks
   quick-pick bar, and the time chart. render() (04-render.js) calls into
   these. Module-level state (_entryMetaEditId, _pendingNoteConfirm) lives
   here since it's only read/written by these widget functions and by
   createRestartedEntry (05-entries.js) / the gap-report accept flow
   (12c-gapreport.js). */

// Entry whose proof-link/note editor is currently open (`entry.id`), or null
// when none is open. Survives render() since the editor panel's open/closed
// state can't live in the DOM — render() rebuilds #timeline's innerHTML from
// `entries` on every call, same as `_flowNoteEditId` in 11-timeflow.js.
let _entryMetaEditId = null;

// Pending "same note as last time?" confirmation for a just-restarted entry
// (see createRestartedEntry in 05-entries.js): `{ id, note }` for the entry
// awaiting a yes/no answer, or null when nothing is pending. Cleared by any
// meta-editor action (save/clear/cancel/yes/no) so it never resurfaces on a
// later, unrelated edit of the same entry.
let _pendingNoteConfirm = null;

/**
 * Builds the proof-link / note indicator and inline editor for a log entry.
 * Read-only state shows a 🔗 and/or 📝 indicator (title = full value) plus a
 * toggle button; editing state additionally shows the link/note inputs. Both
 * fields are optional and independent — either can be filled in on its own.
 * When this entry has a pending restart confirmation (`_pendingNoteConfirm`,
 * set by createRestartedEntry in 05-entries.js), the editor also shows a
 * "same note as last time?" banner above the inputs.
 * @param {{ id: string, link: (string|undefined), note: (string|undefined) }} entry - The log entry.
 * @param {boolean} isEditing - Whether this entry's link/note panel is open.
 * @returns {string} HTML string.
 */
function buildEntryMetaHtml(entry, isEditing) {
  const hasLink = !!(entry.link && entry.link.trim());
  const hasNote = !!(entry.note && entry.note.trim());
  const linkIndicator = hasLink
    ? /^https?:\/\//i.test(entry.link.trim())
      ? `<a class="emeta-ind emeta-link-view" href="${escHtml(entry.link.trim())}" target="_blank" rel="noopener" title="${escHtml(entry.link)}" onclick="event.stopPropagation()">🔗</a>`
      : `<span class="emeta-ind" title="${escHtml(entry.link)}">🔗</span>`
    : '';
  const noteIndicator = hasNote
    ? `<span class="emeta-ind" title="${escHtml(entry.note)}">📝</span>`
    : '';
  // Indicators render as siblings of the toggle button, not inside it — an
  // <a> nested in a <button> is invalid HTML and the anchor's own click
  // handler would be unreachable behind the button's.
  const indicators =
    linkIndicator || noteIndicator
      ? `<span class="emeta-inds">${linkIndicator}${noteIndicator}</span>`
      : '';
  const label = hasLink || hasNote ? 'edit proof link / note' : 'add proof link / note';
  const toggle = `<button class="emeta-btn" data-id="${entry.id}" title="${label}" aria-label="${label}">${hasLink || hasNote ? '✎' : '📎'}</button>`;
  if (!isEditing) return `<div class="emeta">${indicators}${toggle}</div>`;
  const pendingNote =
    _pendingNoteConfirm && _pendingNoteConfirm.id === entry.id ? _pendingNoteConfirm.note : '';
  const restartConfirmHtml = pendingNote
    ? `<div class="emeta-restart-confirm">
        <div class="emeta-restart-q">Same note as last time?</div>
        <div class="emeta-restart-prev">"${escHtml(pendingNote)}"</div>
        <div class="emeta-restart-actions">
          <button class="emeta-restart-yes" data-id="${entry.id}">Yes, keep it</button>
          <button class="emeta-restart-no" data-id="${entry.id}">No, clear</button>
        </div>
      </div>`
    : '';
  return `<div class="emeta">
      ${indicators}${toggle}
      <div class="emeta-editor open" id="em-${entry.id}">
        ${restartConfirmHtml}
        <label class="emeta-lbl" for="emli-${entry.id}">proof link</label>
        <input class="emeta-link-input" type="text" id="emli-${entry.id}" data-id="${entry.id}"
               value="${escHtml(entry.link || '')}"
               placeholder="Confluence page id, Zephyr key, filename…" />
        <label class="emeta-lbl" for="emno-${entry.id}">note</label>
        <textarea class="emeta-note-input" id="emno-${entry.id}" data-id="${entry.id}" rows="2"
                  placeholder="what did you do?">${escHtml(entry.note || '')}</textarea>
        <div class="emeta-actions">
          <button class="emeta-save" data-id="${entry.id}">save</button>
          ${hasLink || hasNote ? `<button class="emeta-del" data-id="${entry.id}">clear</button>` : ''}
          <button class="emeta-cancel" data-id="${entry.id}">cancel</button>
        </div>
      </div>
    </div>`;
}

/**
 * Builds the category picker contents for a single log entry: one button
 * per existing category, a cancel button, and an inline "+ new epic"
 * creator so a brand-new epic can be added without leaving the entry —
 * mirrors the board's task-card picker (catOpts in 10a-tasks-row.js's
 * renderRow), which previously was the only place epics could be created.
 * @param {{ id: string, tag: (string|undefined) }} entry - The log entry.
 * @param {Array<{id: string, label: string, color: string}>} categoryList - Available categories.
 * @returns {string} HTML string for the picker's contents.
 */
function buildEntryCatPickerHtml(entry, categoryList) {
  const catOpts = categoryList
    .map(
      (cat) =>
        `<button class="cat-opt${entry.tag === cat.id ? ' sel' : ''}" data-id="${entry.id}" data-cat="${cat.id}" style="${entry.tag === cat.id ? `background:${safeCssColor(cat.color)};` : ''}color:${entry.tag === cat.id ? '#fff' : safeCssColor(cat.color)}">${escHtml(cat.label)}</button>`
    )
    .join('');
  return (
    catOpts +
    `<button class="cat-cancel" data-id="${entry.id}">cancel</button>` +
    `<div class="pcat-add-row">` +
    `<button class="pcat-add-btn" data-id="${entry.id}">+ new epic</button>` +
    `<div class="pcat-add-form" id="ecaf-${entry.id}">` +
    `<input class="pcat-add-input" placeholder="name…" aria-label="new epic name" />` +
    `<button class="pcat-add-ok" data-id="${entry.id}" aria-label="save">&#10003;</button>` +
    `<button class="pcat-add-cancel2" data-id="${entry.id}" aria-label="cancel">&#10005;</button>` +
    `</div></div>`
  );
}

/**
 * Binds open/save/clear/cancel events for each entry's proof-link/note
 * editor, plus the yes/no handlers for its restart note-confirmation banner
 * (see createRestartedEntry in 05-entries.js). Re-attached after every
 * render() call since #timeline's innerHTML is fully replaced each time,
 * same pattern as the other entry-row bindings in render() (time editor,
 * category picker, billable toggle).
 * @param {HTMLElement} timelineEl - The #timeline element.
 */
function bindEntryMetaEvents(timelineEl) {
  timelineEl.querySelectorAll('.emeta-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      _entryMetaEditId = _entryMetaEditId === id ? null : id;
      _pendingNoteConfirm = null;
      render();
      if (_entryMetaEditId === id) {
        setTimeout(() => document.getElementById('emli-' + id)?.focus(), 0);
      }
    });
  });
  timelineEl.querySelectorAll('.emeta-save').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const entry = entries.find((logEntry) => logEntry.id === id);
      if (entry) {
        const linkVal = document.getElementById('emli-' + id).value.trim();
        const noteVal = document.getElementById('emno-' + id).value.trim();
        if (linkVal) entry.link = linkVal;
        else delete entry.link;
        if (noteVal) entry.note = noteVal;
        else delete entry.note;
        save();
      }
      _entryMetaEditId = null;
      _pendingNoteConfirm = null;
      render();
    });
  });
  timelineEl.querySelectorAll('.emeta-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const entry = entries.find((logEntry) => logEntry.id === id);
      if (entry) {
        delete entry.link;
        delete entry.note;
        save();
      }
      _entryMetaEditId = null;
      _pendingNoteConfirm = null;
      render();
    });
  });
  timelineEl.querySelectorAll('.emeta-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      _entryMetaEditId = null;
      _pendingNoteConfirm = null;
      render();
    });
  });
  /* restart note-confirmation: "same note as last time?" */
  timelineEl.querySelectorAll('.emeta-restart-yes').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const entry = entries.find((logEntry) => logEntry.id === id);
      if (entry && _pendingNoteConfirm && _pendingNoteConfirm.id === id) {
        entry.note = _pendingNoteConfirm.note;
        save();
      }
      _pendingNoteConfirm = null;
      render();
      setTimeout(() => document.getElementById('emno-' + id)?.focus(), 0);
    });
  });
  timelineEl.querySelectorAll('.emeta-restart-no').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      _pendingNoteConfirm = null;
      render();
      setTimeout(() => document.getElementById('emno-' + id)?.focus(), 0);
    });
  });
}

/**
 * Binds click/Enter handlers for the ad-hoc inline log row (`#tlAdHocBtn` /
 * `#tlAdHocInput`). Called from render() on both the empty-state branch and
 * the normal entry-list branch, since #timeline's innerHTML — and the row
 * inside it — is fully replaced on every render() call. Both branches must
 * call this, or the row exists in the DOM but silently does nothing.
 * @returns {void}
 */
function bindAdHocRow() {
  const adHocBtn = document.getElementById('tlAdHocBtn');
  const adHocInput = document.getElementById('tlAdHocInput');
  if (!adHocBtn || !adHocInput) return;
  const commitAdHoc = () => {
    const text = adHocInput.value.trim();
    if (!text) {
      adHocInput.focus();
      return;
    }
    const entry = {
      id: Date.now() + '',
      text,
      tag: selectedTag || (categories[0] ? categories[0].id : 'other'),
      ts: safeRoundedStart(),
      date: dk(new Date()),
    };
    entries.push(entry);
    save();
    render();
  };
  adHocBtn.addEventListener('click', commitAdHoc);
  adHocInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commitAdHoc();
  });
  // Prevent Space from opening the rapid-log overlay while typing here
  adHocInput.addEventListener('keydown', (event) => {
    if (event.code === 'Space') event.stopPropagation();
  });
}

/**
 * Renders the "recent tasks" quick-pick bar below the capture input.
 * Deduplicates entries by text, hides manually-dismissed tasks and tasks past
 * their iteration expiry, and caps the list at 16 items.
 */
function renderQuickPick() {
  const qp = document.getElementById('quickPick');
  const seen = new Set();
  // Build deduplicated recent list, then filter out hidden ones
  const allRecent = [...entries].reverse().filter((entry) => {
    const k = entry.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Hide tasks whose last-logged date is at or past the current iteration boundary
  const todayKeyQp = dk(new Date());
  const expiredQp = new Set(
    allRecent
      .filter((entry) => {
        const expiry = getIterationExpiry(entry.date || '');
        return expiry && todayKeyQp >= expiry;
      })
      .map((entry) => entry.text.toLowerCase())
  );
  const recent = allRecent
    .filter(
      (entry) => !qpHidden.has(entry.text.toLowerCase()) && !expiredQp.has(entry.text.toLowerCase())
    )
    .slice(0, 16);
  // Hidden count is the intersection of qpHidden with task texts actually present in entries
  const hiddenInUse = allRecent.filter((entry) => qpHidden.has(entry.text.toLowerCase())).length;

  if (!recent.length && !hiddenInUse) {
    qp.innerHTML = '';
    return;
  }

  const itemsHtml = recent
    .map((entry) => {
      return (
        `<button class="qp-item" data-text="${escHtml(entry.text)}" data-tag="${entry.tag}">` +
        `<span class="qp-item-text">${escHtml(entry.text)}</span>` +
        `<span class="qp-remove" data-text="${escHtml(entry.text)}" title="remove from recent tasks">&times;</span>` +
        `</button>`
      );
    })
    .join('');
  const restoreHtml = hiddenInUse
    ? `<button class="qp-restore" id="qpRestore" title="show all hidden tasks again">restore ${hiddenInUse} hidden</button>`
    : '';

  qp.innerHTML = `<div class="qp-wrap"><div class="qp-label">recent tasks</div><div class="qp-list">${itemsHtml}${restoreHtml}</div></div>`;

  // Click pill body — fill capture input (only if click wasn't on the ✕)
  qp.querySelectorAll('.qp-item').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      if (event.target.closest('.qp-remove')) return;
      document.getElementById('captureInput').value = btn.dataset.text;
      selectedTag = btn.dataset.tag;
      renderTagRow();
      document.getElementById('captureInput').focus();
    });
  });
  // Click ✕ — hide from recent list
  qp.querySelectorAll('.qp-remove').forEach((removeBtn) => {
    removeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      qpHidden.add(removeBtn.dataset.text.toLowerCase());
      saveQpHidden();
      renderQuickPick();
    });
  });
  // Restore all hidden
  const restoreBtn = document.getElementById('qpRestore');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      qpHidden.clear();
      saveQpHidden();
      renderQuickPick();
    });
  }
}

/**
 * Renders the time-tracking bar chart for the currently viewed day.
 * Decorates the active timer's entry with a synthetic `tsEnd` so live time
 * appears in real-time. Respects `chartMode` ('task' | 'category').
 * @param {Array<Object>} list - The array of log entries to chart.
 */
function renderChart(list) {
  const el = document.getElementById('chart');
  if (!el) return;
  // Decorate the active timer's entry with a synthetic tsEnd so its accumulated
  // time appears in the chart in (near) real time — not just after the timer stops.
  // Re-runs naturally on every render; a 15-min interval also forces a refresh.
  const decorated = (list || []).map((entry) => {
    if (activeTimer && entry.id === activeTimer.entryId && !entry.tsEnd) {
      const liveEnd = activeTimer.paused
        ? entry.ts + (activeTimer.accumulatedMs || 0)
        : Math.max(Date.now(), activeTimer.startTs || entry.ts);
      return Object.assign({}, entry, { tsEnd: liveEnd, _live: true });
    }
    return entry;
  });
  const timed = decorated.filter((entry) => entry.tsEnd && entry.tsEnd > entry.ts);

  const toggleHtml = `<div class="chart-toggle">
      <button class="chart-tog${chartMode === 'task' ? ' active' : ''}" data-mode="task">by task</button>
      <button class="chart-tog${chartMode === 'category' ? ' active' : ''}" data-mode="category">by epic</button>
    </div>`;

  if (!timed.length) {
    el.innerHTML = `<div class="chart-section"><div class="chart-header"><span class="chart-title">time tracked</span>${toggleHtml}</div><div class="chart-body"><div class="chart-empty">add end times to entries to see the chart</div></div></div>`;
    el.querySelectorAll('.chart-tog').forEach((btn) =>
      btn.addEventListener('click', () => {
        chartMode = btn.dataset.mode;
        renderChart(list);
      })
    );
    return;
  }

  const totals = {},
    meta = {},
    liveKeys = new Set(),
    billCounts = {};
  function tallyBill(key, e) {
    if (!billCounts[key]) billCounts[key] = { bill: 0, nonBill: 0 };
    if (isEntryBillable(e)) billCounts[key].bill++;
    else billCounts[key].nonBill++;
  }
  if (chartMode === 'task') {
    timed.forEach((entry) => {
      const key = entry.text.toLowerCase();
      totals[key] = (totals[key] || 0) + Math.max(0, entry.tsEnd - entry.ts);
      if (!meta[key]) meta[key] = { label: entry.text, color: getCatColor(entry.tag) };
      if (entry._live) liveKeys.add(key);
      tallyBill(key, entry);
    });
  } else {
    timed.forEach((entry) => {
      const key = entry.tag || 'other';
      totals[key] = (totals[key] || 0) + Math.max(0, entry.tsEnd - entry.ts);
      if (!meta[key]) meta[key] = { label: getCatLabel(key), color: getCatColor(key) };
      if (entry._live) liveKeys.add(key);
      tallyBill(key, entry);
    });
  }
  // Per-row billable icon: 💰 if all billable, 💸 if all non-billable, ⚖️ if mixed
  function billIcon(key) {
    const c = billCounts[key];
    if (!c) return '';
    if (c.bill && c.nonBill)
      return '<span class="chart-bill" title="mixed billable/internal">⚖️</span>';
    if (c.bill) return '<span class="chart-bill" title="billable">💰</span>';
    if (c.nonBill) return '<span class="chart-bill" title="internal">💸</span>';
    return '';
  }

  const sorted = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const maxMs = totals[sorted[0]];
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

  const rows = sorted
    .map((key) => {
      const ms = totals[key],
        pct = Math.round((ms / maxMs) * 100);
      const dur = fmtDur(ms);
      const { label, color } = meta[key];
      const live = liveKeys.has(key) ? ' chart-row-live' : '';
      const liveDot = liveKeys.has(key)
        ? '<span class="chart-live-dot" title="currently being tracked">●</span>'
        : '';
      return `<div class="chart-row${live}">
        <span class="chart-label" title="${escHtml(label)}">${liveDot}${escHtml(label)}</span>
        <div class="chart-track"><div class="chart-bar" style="width:${pct}%;background:${safeCssColor(color)}"></div></div>
        ${billIcon(key)}
        <span class="chart-dur">${dur}</span>
      </div>`;
    })
    .join('');

  const totalDur = fmtDur(grandTotal);
  const billMs = timed
    .filter((entry) => isEntryBillable(entry))
    .reduce((sum, entry) => sum + (entry.tsEnd - entry.ts), 0);
  const nonBillMs = timed.reduce((sum, entry) => sum + (entry.tsEnd - entry.ts), 0) - billMs;
  const title = chartMode === 'task' ? 'time by task' : 'time by epic';
  el.innerHTML = `<div class="chart-section"><div class="chart-header"><span class="chart-title">${title}</span>${toggleHtml}</div><div class="chart-body">${rows}<div class="chart-total">total tracked: <span>${totalDur}</span></div>${billMs > 0 || nonBillMs > 0 ? `<div class="chart-total">💰 billable: <span>${fmtDur(billMs)}</span></div><div class="chart-total">💸 internal: <span>${fmtDur(nonBillMs)}</span></div>` : ''}</div></div>`;
  el.querySelectorAll('.chart-tog').forEach((btn) =>
    btn.addEventListener('click', () => {
      chartMode = btn.dataset.mode;
      renderChart(list);
    })
  );
}
