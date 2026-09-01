/* ── Render — timeline entry list: build, bind, and its small helpers ── */
// Split out of 04-render.js (QA finding: module size, flagged five
// consecutive weekly reviews). renderTimelineSection() reproduces render()'s
// old two branches (empty-state vs. entry list) exactly, including the
// early return for the empty case — nothing runs after this call in
// render() either way, so the behaviour is unchanged.

/**
 * Binds click/Enter handlers for the ad-hoc inline log row (`#tlAdHocBtn` /
 * `#tlAdHocInput`). Called from renderTimelineSection() on both the
 * empty-state branch and the normal entry-list branch, since #timeline's
 * innerHTML — and the row inside it — is fully replaced on every render()
 * call. Both branches must call this, or the row exists in the DOM but
 * silently does nothing.
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
 * Builds and mounts the #timeline entry list (or its empty state) plus the
 * ad-hoc log row, then binds every entry-row event handler and renders the
 * sections that depend on the timeline. Mirrors render()'s old two branches:
 * an empty list bails out early after rendering its own sub-components,
 * exactly as before.
 * @param {Array<Object>} list - viewEntries() result for the currently viewed date.
 * @returns {void}
 */
function renderTimelineSection(list) {
  const timelineEl = document.getElementById('timeline');

  // Ad-hoc inline log row — shown only when viewing today, pinned at the bottom
  const adHocRow = isToday(viewDate)
    ? `<div class="tl-adhoc-row">
         <input class="tl-adhoc-input" id="tlAdHocInput"
                aria-label="Log an entry directly in the time log"
                placeholder="log something…" autocomplete="off"/>
         <button class="tl-adhoc-btn" id="tlAdHocBtn" aria-label="Log entry">+ log</button>
       </div>`
    : '';

  // Empty state: render sub-components (plan, timeblock) and bail out early
  if (!list.length) {
    timelineEl.innerHTML =
      '<div class="empty-state">' +
      (isToday(viewDate)
        ? 'nothing logged yet — type something below.'
        : 'nothing was logged on this day.') +
      '</div>' +
      adHocRow;
    bindAdHocRow();
    const chartEl = document.getElementById('chart');
    if (chartEl) chartEl.innerHTML = '';
    renderQuickPick();
    renderPlan();
    renderPlanReviewReminder();
    renderCompleted();
    renderTodayFlow();
    renderTrackers();
    return;
  }
  // Build entry row HTML — one <div class="entry"> per log entry; ad-hoc row pinned at bottom
  timelineEl.innerHTML =
    list
      .map((entry) => {
        const isTiming = activeTimer && activeTimer.entryId === entry.id;
        const isPaused = isTiming && activeTimer.paused;
        const color = getCatColor(entry.tag);

        const endLine = isTiming
          ? isPaused
            ? `<span class="etime-end" style="color:#EF9F27;font-size:10px;">paused</span>`
            : `<span class="etime-end" style="color:#5DCAA5;font-size:10px;">timing…</span>`
          : entry.tsEnd
            ? `<span class="etime-end">&#8627; ${fmtTime(entry.tsEnd)}</span>${durLabel(entry.ts, entry.tsEnd)}`
            : `<span class="etime-end" style="color:var(--text3);font-style:italic;font-size:10px;">+ end time</span>`;

        const catOpts = buildEntryCatPickerHtml(entry, pickableCategories(categories, entry.tag));

        const startVal = toTimeInput(entry.ts);
        const endVal = entry.tsEnd ? toTimeInput(entry.tsEnd) : '';

        const billableEmoji = isEntryBillable(entry) ? '💰' : '💸';
        return `
        <div class="entry${isTiming ? ' is-timing' : ''}${entry.signifier === 'cancelled' ? ' sig-cancelled-row' : ''}" data-id="${entry.id}">
          <div class="etime-col">
            <span class="etime-display" data-id="${entry.id}">
              <span class="etime-start">${fmtTime(entry.ts)}</span>
              ${endLine}
            </span>
            <div class="etime-editor" id="ed-${entry.id}">
              <div class="etime-editor-row"><span class="etime-lbl">start</span><input class="etime-input" type="time" id="ts-${entry.id}" value="${startVal}" /></div>
              <div class="etime-editor-row"><span class="etime-lbl">end</span><input class="etime-input" type="time" id="te-${entry.id}" value="${endVal}" placeholder="--:--" /></div>
              <div class="etime-actions">
                <button class="etime-save" data-id="${entry.id}">save</button>
                <button class="etime-cancel" data-id="${entry.id}">cancel</button>
              </div>
            </div>
          </div>
          ${sigHtml(entry)}
          <span class="edot" style="background:${color};margin-top:6px;"></span>
          <div class="ebody">
            <div class="etext" data-id="${entry.id}">${jiraTicketHtml(entry.text)}${entry._uncategorised ? `<span class="entry-uncategorised" title="No category — tap to assign">○</span>` : ''}</div>
            <button class="etag-btn" data-id="${entry.id}">
              <span class="etag-cdot" style="background:${color}"></span>
              ${escHtml(getCatLabel(entry.tag))} &#9660;
            </button>
            <div class="cat-picker" id="cp-${entry.id}">${catOpts}</div>
            ${buildEntryMetaHtml(entry, _entryMetaEditId === entry.id)}
          </div>
          <button class="ebill-btn" data-id="${entry.id}" title="toggle billable/internal" style="cursor:pointer;background:none;border:none;padding:4px 8px;font-size:16px;color:inherit">${billableEmoji}</button>
          <button class="erestart" data-id="${entry.id}" title="restart with timer">&#9654;</button>
          <button class="edel" data-id="${entry.id}" title="delete">&times;</button>
        </div>`;
      })
      .join('') + adHocRow;

  bindAdHocRow();
  bindSignifierClicks();
  bindEntryMetaEvents(timelineEl);
  bindTimelineEntryEvents(timelineEl);

  renderQuickPick();
  renderChart(list);
  renderPlan();
  renderPlanReviewReminder();
  renderCompleted();
  renderTodayFlow();
  renderTrackers();
}

/**
 * Binds every per-entry event handler in the timeline: the time editor, the
 * category picker (including its inline "+ new epic" creator), the billable
 * toggle, delete, restart, and inline text rename. Called once per
 * renderTimelineSection() call on the non-empty branch, since #timeline's
 * innerHTML is fully replaced on every render() call.
 * @param {HTMLElement} timelineEl - The #timeline element.
 * @returns {void}
 */
function bindTimelineEntryEvents(timelineEl) {
  /* time editor */
  timelineEl.querySelectorAll('.etime-display').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      closeAllEditors();
      el.style.display = 'none';
      document.getElementById('ed-' + id).classList.add('open');
    });
  });
  timelineEl.querySelectorAll('.etime-save').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id,
        entry = entries.find((logEntry) => logEntry.id === id);
      if (!entry) return;
      const newStartTime = document.getElementById('ts-' + id).value;
      const newEndTime = document.getElementById('te-' + id).value;
      if (newStartTime) entry.ts = roundToNearest30(applyTime(entry.ts, newStartTime));
      if (newEndTime) entry.tsEnd = roundToNearest30(applyTime(entry.ts, newEndTime));
      else delete entry.tsEnd;
      // If this entry's timer is running, reset startTs to the new entry.ts
      if (activeTimer && activeTimer.entryId === id && newStartTime) {
        activeTimer.startTs = entry.ts;
        activeTimer.accumulatedMs = 0;
        activeTimer.paused = false;
      }
      save();
      render();
    });
  });
  timelineEl
    .querySelectorAll('.etime-cancel')
    .forEach((btn) => btn.addEventListener('click', () => render()));

  /* category picker */
  timelineEl.querySelectorAll('.etag-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const picker = document.getElementById('cp-' + id);
      const isOpen = picker.classList.contains('open');
      document.querySelectorAll('.cat-picker.open').forEach((el) => el.classList.remove('open'));
      if (!isOpen) picker.classList.add('open');
    });
  });
  timelineEl.querySelectorAll('.cat-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = entries.find((logEntry) => logEntry.id === btn.dataset.id);
      if (entry) {
        const taskText = entry.text.toLowerCase();
        entries.forEach((sameEntry) => {
          if (sameEntry.text.toLowerCase() === taskText) sameEntry.tag = btn.dataset.cat;
        });
        save();
        render();
      }
    });
  });
  timelineEl.querySelectorAll('.cat-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('cp-' + btn.dataset.id).classList.remove('open');
    });
  });

  /* + new epic inside entry category picker */
  timelineEl.querySelectorAll('.pcat-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.style.display = 'none';
      const form = document.getElementById('ecaf-' + btn.dataset.id);
      form.classList.add('open');
      form.querySelector('.pcat-add-input').focus();
    });
  });
  timelineEl.querySelectorAll('.pcat-add-ok').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = document.getElementById('ecaf-' + btn.dataset.id);
      const input = form.querySelector('.pcat-add-input');
      if (!input.value.trim()) {
        input.focus();
        return;
      }
      const category = createCategory(input.value);
      if (!category) {
        input.style.borderColor = '#C62828';
        input.focus();
        return;
      }
      const entry = entries.find((logEntry) => logEntry.id === btn.dataset.id);
      if (entry) {
        const taskText = entry.text.toLowerCase();
        entries.forEach((sameEntry) => {
          if (sameEntry.text.toLowerCase() === taskText) sameEntry.tag = category.id;
        });
      }
      save();
      renderTagRow();
      render();
    });
  });
  timelineEl.querySelectorAll('.pcat-add-input').forEach((inp) => {
    inp.addEventListener('keydown', (event) => {
      if (event.key === 'Enter')
        inp.closest('.pcat-add-form').querySelector('.pcat-add-ok').click();
      if (event.key === 'Escape')
        inp.closest('.pcat-add-form').querySelector('.pcat-add-cancel2').click();
    });
  });
  timelineEl.querySelectorAll('.pcat-add-cancel2').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = document.getElementById('ecaf-' + btn.dataset.id);
      form.classList.remove('open');
      const addBtn = form.closest('.pcat-add-row').querySelector('.pcat-add-btn');
      if (addBtn) addBtn.style.display = '';
    });
  });

  /* billable toggle */
  timelineEl.querySelectorAll('.ebill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = entries.find((logEntry) => logEntry.id === btn.dataset.id);
      if (entry) {
        entry.billable = entry.billable === false ? undefined : false;
        save();
        render();
      }
    });
  });

  /* delete */
  timelineEl.querySelectorAll('.edel').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (activeTimer && activeTimer.entryId === id) {
        clearInterval(timerInterval);
        timerInterval = null;
        activeTimer = null;
        save();
        updateTimerBtn(false);
      }
      entries = entries.filter((entry) => entry.id !== id);
      save();
      render();
    });
  });

  /* restart */
  timelineEl.querySelectorAll('.erestart').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sourceEntry = entries.find((entry) => entry.id === btn.dataset.id);
      if (!sourceEntry) return;
      if (activeTimer) stopTimer();
      const newEntry = createRestartedEntry(sourceEntry.text, sourceEntry.tag);
      entries.push(newEntry);
      viewDate = new Date();
      save();
      startTimer(newEntry.id);
      render();
    });
  });

  /* rename entry text (propagates to all entries + plan tasks with same text) */
  timelineEl.querySelectorAll('.etext').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.querySelector('.etext-input')) return;
      const id = el.dataset.id;
      const entry = entries.find((logEntry) => logEntry.id === id);
      if (!entry) return;
      const origText = entry.text;
      const input = document.createElement('input');
      input.className = 'etext-input';
      input.value = origText;
      el.innerHTML = '';
      el.appendChild(input);
      input.focus();
      input.select();
      let saved = false;
      const doSave = () => {
        if (saved) return;
        saved = true;
        const newText = input.value.trim();
        if (newText && newText !== origText) {
          const origLower = origText.toLowerCase();
          entries.forEach((sameEntry) => {
            if (sameEntry.text.toLowerCase() === origLower) sameEntry.text = newText;
          });
          planTasks.forEach((task) => {
            if (task.text.toLowerCase() === origLower) task.text = newText;
          });
          save();
          savePlan();
        }
        render();
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          doSave();
        }
        if (ev.key === 'Escape') {
          saved = true;
          render();
        }
      });
      input.addEventListener('blur', doSave);
    });
  });
}

/**
 * Time-tracking bar chart for the currently viewed day. Permanently inert:
 * the standalone `#chart` element was removed when the bar chart was folded
 * into Today's Flow (see CLAUDE.md's June 2026 architecture note) and never
 * re-added, so `document.getElementById('chart')` always returns null and
 * this returns immediately. Kept as a no-op rather than removed outright —
 * render() and the timer tick in 03-timer.js both still call it
 * unconditionally on every render, and re-adding `#chart` (should the
 * standalone chart ever come back) would only need work here, not at every
 * call site.
 * @param {Array<Object>} _list - The array of log entries that would be charted (unused — see above).
 * @returns {void}
 */
function renderChart(_list) {
  const el = document.getElementById('chart');
  if (!el) return;
}

/* ── Helpers ── */

/** Closes every open inline time-editor panel and restores the display spans. */
function closeAllEditors() {
  document.querySelectorAll('.etime-editor.open').forEach((el) => el.classList.remove('open'));
  document.querySelectorAll('.etime-display').forEach((el) => (el.style.display = ''));
}
/**
 * Converts a Unix timestamp (ms) to an HH:MM string suitable for an
 * `<input type="time">` value.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @returns {string} Local time formatted as "HH:MM".
 */
function toTimeInput(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
/**
 * Replaces the hours/minutes of a base timestamp with values parsed from a
 * "HH:MM" string, returning the resulting timestamp in milliseconds.
 * @param {number} baseTsMs - Base Unix timestamp (ms) that supplies the date.
 * @param {string} timeStr  - Time string in "HH:MM" format.
 * @returns {number} New Unix timestamp (ms) with the updated time.
 */
function applyTime(baseTsMs, timeStr) {
  const d = new Date(baseTsMs),
    [hh, mm] = timeStr.split(':').map(Number);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}
/**
 * Builds an HTML `<span class="etime-dur">` containing the human-readable
 * duration between two timestamps.  Returns an empty string if the duration
 * is zero or negative.
 * @param {number} tsStart - Start Unix timestamp (ms).
 * @param {number} tsEnd   - End Unix timestamp (ms).
 * @returns {string} HTML string, or '' if duration ≤ 0.
 */
function durLabel(tsStart, tsEnd) {
  const mins = Math.round((tsEnd - tsStart) / 60000);
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60),
    m = mins % 60;
  return `<span class="etime-dur">${h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`}</span>`;
}
