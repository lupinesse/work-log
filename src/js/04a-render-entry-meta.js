/* ── Render — entry proof-link/note editor and category picker ── */
// Split out of 04-render.js (QA finding: module size, flagged five
// consecutive weekly reviews). Everything here builds or wires per-entry
// widgets that render() embeds into each timeline row; none of it touches
// render()'s own control flow.

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
