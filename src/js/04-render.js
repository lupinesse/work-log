/* ── Render ── */

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
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    return new Set(
      entries
        .filter((entry) => new Date(entry.ts) >= weekStart)
        .map((entry) => entry.tag || 'other')
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
    const chartEl = document.getElementById('chart');
    if (chartEl) chartEl.innerHTML = '';
    renderQuickPick();
    renderPlan();
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
          </div>
          <button class="ebill-btn" data-id="${entry.id}" title="toggle billable/non-billable" style="cursor:pointer;background:none;border:none;padding:4px 8px;font-size:16px;color:inherit">${billableEmoji}</button>
          <button class="erestart" data-id="${entry.id}" title="restart with timer">&#9654;</button>
          <button class="edel" data-id="${entry.id}" title="delete">&times;</button>
        </div>`;
      })
      .join('') + adHocRow;

  /* ── 6. Event binding (time editor, category picker, billable, delete, restart, rename) ── */

  /* Ad-hoc log row */
  const adHocBtn = document.getElementById('tlAdHocBtn');
  const adHocInput = document.getElementById('tlAdHocInput');
  if (adHocBtn && adHocInput) {
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

  bindSignifierClicks();

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
  renderCompleted();
  renderTodayFlow();
  renderTrackers();
}
