/* ── Render ── */

// Entry whose proof-link/note editor is currently open (`entry.id`), or null
// when none is open. Survives render() since the editor panel's open/closed
// state can't live in the DOM — render() rebuilds #timeline's innerHTML from
// `entries` on every call, same as `_flowNoteEditId` in 11-timeflow.js.
let _entryMetaEditId = null;

/**
 * Builds the proof-link / note indicator and inline editor for a log entry.
 * Read-only state shows a 🔗 and/or 📝 indicator (title = full value) plus a
 * toggle button; editing state additionally shows the link/note inputs. Both
 * fields are optional and independent — either can be filled in on its own.
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
  return `<div class="emeta">
      ${indicators}${toggle}
      <div class="emeta-editor open" id="em-${entry.id}">
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
 * Binds open/save/clear/cancel events for each entry's proof-link/note
 * editor. Re-attached after every render() call since #timeline's innerHTML
 * is fully replaced each time, same pattern as the other entry-row bindings
 * in render() (time editor, category picker, billable toggle).
 * @param {HTMLElement} timelineEl - The #timeline element.
 */
function bindEntryMetaEvents(timelineEl) {
  timelineEl.querySelectorAll('.emeta-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      _entryMetaEditId = _entryMetaEditId === id ? null : id;
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
      render();
    });
  });
  timelineEl.querySelectorAll('.emeta-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      _entryMetaEditId = null;
      render();
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
 * Full application re-render: updates the date label, timer bar, stat counters,
 * sub-stats, time-log list, chart, quick-pick, plan, completed section, and
 * time-block view. Call whenever persistent state changes.
 *
 * Design trade-off: full DOM re-render on every change rather than targeted
 * updates. Keeps state reasoning simple for a single-user personal tool where
 * the entry list is small (typically < 50 items per day). If performance becomes
 * a concern, the innermost `timelineEl.querySelectorAll` event-binding loop is the first
 * candidate for optimisation (see phase 6 below).
 */
function render() {
  /* ── 0. Hero Card state ── */
  renderHeroCard();

  /* ── 1. Date header and navigation ── */
  document.getElementById('dateLabel').textContent = fmtLabel(viewDate);
  document.getElementById('prevDay').disabled = false;
  document.getElementById('nextDay').disabled = isToday(viewDate);
  renderLocation();
  // Session chip + end-the-day button track the day in view, so refresh them
  // whenever the date changes.
  renderSodBtn();
  renderEodBtn();
  renderEodReminder();

  /* ── 2. Timer bar ── */
  if (!activeTimer) {
    updateTimerBar();
    updateTimerBtn(false);
  } else {
    updateTimerBar();
    updateTimerBtn(true);
  }

  /* ── 3. Header stat tiles (distinct tasks today / epics this week / streak) ── */
  const todayKey = dk(new Date());
  document.getElementById('statToday').textContent = new Set(
    entries.filter((entry) => entry.date === todayKey).map((entry) => entry.text.toLowerCase())
  ).size;
  document.getElementById('statWeek').textContent = (() => {
    const weekStart = mondayOfWeek();
    return new Set(
      entries.filter((entry) => entry.ts >= weekStart).map((entry) => entry.tag || 'other')
    ).size;
  })();
  document.getElementById('statStreak').textContent = calcStreak();

  // Collapsed summary: mirrors the three values into a single header line so
  // the section communicates its data without needing to be opened.
  document.getElementById('analyticsSummary').textContent = [
    `${document.getElementById('statToday').textContent} tasks today`,
    `${document.getElementById('statWeek').textContent} epics this week`,
    `${document.getElementById('statStreak').textContent}-day streak`,
  ].join(' · ');

  /* ── 4. Sub-stat tiles (most-tracked task today / this week / best streak day) ── */
  // taskSubHtml wraps fmtDur (defined in 00-pure-fns.js) with Jira-ticket-link logic.
  // Emits structured divs so each line gets its own color token (link, title, value).
  function taskSubHtml(label, ms) {
    const { ticket, name } = parseJiraLabel(label);
    const keyHtml = ticket
      ? `<a class="jira-key-link" href="${JIRA_BASE}/${ticket}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escHtml(ticket)}</a>`
      : null;
    return keyHtml
      ? `${keyHtml}${name ? `<div class="stat-sub-title">${escHtml(name)}</div>` : ''}<div class="stat-sub-value">${fmtDur(ms)}</div>`
      : `<div class="stat-sub-title">${escHtml(label)}</div><div class="stat-sub-value">${fmtDur(ms)}</div>`;
  }

  // Today: task with most tracked time
  const todayTimed = entries.filter(
    (entry) => entry.date === todayKey && entry.tsEnd && entry.tsEnd > entry.ts
  );
  const todayByTask = {};
  todayTimed.forEach((entry) => {
    const taskKey = entry.text.toLowerCase();
    if (!todayByTask[taskKey]) todayByTask[taskKey] = { label: entry.text, ms: 0 };
    todayByTask[taskKey].ms += entry.tsEnd - entry.ts;
  });
  const topTask = Object.values(todayByTask).sort((a, b) => b.ms - a.ms)[0];
  const todaySub = document.getElementById('statTodaySub');
  if (topTask) {
    todaySub.innerHTML = taskSubHtml(topTask.label, topTask.ms);
    todaySub.style.display = '';
  } else {
    todaySub.style.display = 'none';
  }

  // This week: task with most tracked time
  const thisWeekStart = new Date();
  thisWeekStart.setDate(thisWeekStart.getDate() - ((thisWeekStart.getDay() + 6) % 7));
  thisWeekStart.setHours(0, 0, 0, 0);
  const weekTimed = entries.filter(
    (entry) => new Date(entry.ts) >= thisWeekStart && entry.tsEnd && entry.tsEnd > entry.ts
  );
  const weekByTask = {};
  weekTimed.forEach((entry) => {
    const taskKey = entry.text.toLowerCase();
    if (!weekByTask[taskKey]) weekByTask[taskKey] = { label: entry.text, ms: 0 };
    weekByTask[taskKey].ms += entry.tsEnd - entry.ts;
  });
  const topWeekTask = Object.values(weekByTask).sort((a, b) => b.ms - a.ms)[0];
  const weekSub = document.getElementById('statWeekSub');
  if (topWeekTask) {
    weekSub.innerHTML = taskSubHtml(topWeekTask.label, topWeekTask.ms);
    weekSub.style.display = '';
  } else {
    weekSub.style.display = 'none';
  }

  // Streak: day with longest tracked time
  const streakDays = [];
  {
    const streakCursor = new Date();
    streakCursor.setDate(streakCursor.getDate() - 1);
    const daysWithEntries = new Set(entries.map((entry) => entry.date));
    while (daysWithEntries.has(dk(streakCursor))) {
      streakDays.push(dk(streakCursor));
      streakCursor.setDate(streakCursor.getDate() - 1);
    }
  }
  const streakSub = document.getElementById('statStreakSub');
  if (streakDays.length > 0) {
    let bestDay = null,
      bestMs = 0;
    streakDays.forEach((dateKey2) => {
      const ms = entries
        .filter((entry) => entry.date === dateKey2 && entry.tsEnd && entry.tsEnd > entry.ts)
        .reduce((sum, entry) => sum + (entry.tsEnd - entry.ts), 0);
      if (ms > bestMs) {
        bestMs = ms;
        bestDay = dateKey2;
      }
    });
    if (bestDay && bestMs > 0) {
      const bestStreakDay = new Date(bestDay + 'T12:00:00');
      const dayName = isToday(bestStreakDay)
        ? 'today'
        : bestStreakDay.toLocaleDateString('en', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          });
      streakSub.innerHTML = `<div class="stat-sub-title">Longest date tracked</div><div class="stat-sub-title">${escHtml(dayName)}</div><div class="stat-sub-value">${fmtDur(bestMs)}</div>`;
      streakSub.style.display = '';
    } else {
      streakSub.style.display = 'none';
    }
  } else {
    streakSub.style.display = 'none';
  }

  /* ── 5. Timeline ── */
  const list = viewEntries();
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

        const catOpts =
          categories
            .map(
              (cat) =>
                `<button class="cat-opt${entry.tag === cat.id ? ' sel' : ''}" data-id="${entry.id}" data-cat="${cat.id}" style="${entry.tag === cat.id ? `background:${safeCssColor(cat.color)};` : ''}color:${entry.tag === cat.id ? '#fff' : safeCssColor(cat.color)}">${escHtml(cat.label)}</button>`
            )
            .join('') + `<button class="cat-cancel" data-id="${entry.id}">cancel</button>`;

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

  /* ── 6. Event binding (time editor, category picker, billable, delete, restart, rename) ── */

  bindAdHocRow();
  bindSignifierClicks();
  bindEntryMetaEvents(timelineEl);

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
      const newEntry = {
        id: Date.now() + '',
        text: sourceEntry.text,
        tag: sourceEntry.tag,
        ts: safeRoundedStart(),
        date: dk(new Date()),
      };
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

  renderQuickPick();
  renderChart(list);
  renderPlan();
  renderPlanReviewReminder();
  renderCompleted();
  renderTodayFlow();
  renderTrackers();
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
