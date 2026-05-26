/* ── Render ── */

/**
 * Full application re-render: updates the date label, timer bar, stat counters,
 * sub-stats, time-log list, chart, quick-pick, plan, completed section, and
 * time-block view. Call whenever persistent state changes.
 */
function render() {
  document.getElementById('dateLabel').textContent = fmtLabel(viewDate);
  document.getElementById('prevDay').disabled = false;
  document.getElementById('nextDay').disabled = isToday(viewDate);

  if (!activeTimer) {
    updateTimerBar();
    updateTimerBtn(false);
  } else {
    updateTimerBar();
    updateTimerBtn(true);
  }

  const todayKey = dk(new Date());
  document.getElementById('statToday').textContent = new Set(
    entries.filter((e) => e.date === todayKey).map((e) => e.text.toLowerCase())
  ).size;
  document.getElementById('statWeek').textContent = (() => {
    const mon2 = new Date();
    mon2.setDate(mon2.getDate() - ((mon2.getDay() + 6) % 7));
    mon2.setHours(0, 0, 0, 0);
    return new Set(entries.filter((e) => new Date(e.ts) >= mon2).map((e) => e.tag || 'other')).size;
  })();
  document.getElementById('statStreak').textContent = calcStreak();

  // Sub-stats
  function fmtMs(ms) {
    const mins = Math.round(ms / 60000),
      h = Math.floor(mins / 60),
      m = mins % 60;
    return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }
  function taskSubHtml(label, ms) {
    const m = label.match(/^([A-Z]+-\d+)([\s:_-]+(.*))?$/s);
    const ticket = m ? m[1] : null;
    const name = m ? (m[3] || '').trim() : label;
    const keyHtml = ticket
      ? `<a class="jira-key-link" href="${JIRA_BASE}/${ticket}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escHtml(ticket)}</a>`
      : null;
    return keyHtml
      ? `${keyHtml}${name ? `<br>${escHtml(name)}` : ''}<br><strong>${fmtMs(ms)}</strong>`
      : `${escHtml(label)}<br><strong>${fmtMs(ms)}</strong>`;
  }

  // Today: task with most tracked time
  const todayTimed = entries.filter((e) => e.date === todayKey && e.tsEnd && e.tsEnd > e.ts);
  const todayByTask = {};
  todayTimed.forEach((e) => {
    const k = e.text.toLowerCase();
    if (!todayByTask[k]) todayByTask[k] = { label: e.text, ms: 0 };
    todayByTask[k].ms += e.tsEnd - e.ts;
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
  const mon = new Date();
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  mon.setHours(0, 0, 0, 0);
  const weekTimed = entries.filter((e) => new Date(e.ts) >= mon && e.tsEnd && e.tsEnd > e.ts);
  const weekByTask = {};
  weekTimed.forEach((e) => {
    const k = e.text.toLowerCase();
    if (!weekByTask[k]) weekByTask[k] = { label: e.text, ms: 0 };
    weekByTask[k].ms += e.tsEnd - e.ts;
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
    const d2 = new Date();
    d2.setDate(d2.getDate() - 1);
    const seen = new Set(entries.map((e) => e.date));
    while (seen.has(dk(d2))) {
      streakDays.push(dk(d2));
      d2.setDate(d2.getDate() - 1);
    }
  }
  const streakSub = document.getElementById('statStreakSub');
  if (streakDays.length > 0) {
    let bestDay = null,
      bestMs = 0;
    streakDays.forEach((dateKey2) => {
      const ms = entries
        .filter((e) => e.date === dateKey2 && e.tsEnd && e.tsEnd > e.ts)
        .reduce((s, e) => s + (e.tsEnd - e.ts), 0);
      if (ms > bestMs) {
        bestMs = ms;
        bestDay = dateKey2;
      }
    });
    if (bestDay && bestMs > 0) {
      const d3 = new Date(bestDay + 'T12:00:00');
      const dayName = isToday(d3)
        ? 'today'
        : d3.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });
      streakSub.innerHTML = `<strong>Longest date tracked</strong><br>${escHtml(dayName)}<br><strong>${fmtMs(bestMs)}</strong>`;
      streakSub.style.display = '';
    } else {
      streakSub.style.display = 'none';
    }
  } else {
    streakSub.style.display = 'none';
  }

  const list = viewEntries();
  const tl = document.getElementById('timeline');

  if (!list.length) {
    tl.innerHTML =
      '<div class="empty-state">' +
      (isToday(viewDate)
        ? 'nothing logged yet.<br>start by typing what you just did above.'
        : 'nothing was logged on this day.') +
      '</div>';
    document.getElementById('chart').innerHTML = '';
    renderQuickPick();
    renderPlan();
    renderCompleted();
    renderTimeblock();
    return;
  }

  const logHeader = `<div class="timelog-header"><span class="chart-title">time log</span></div>`;
  tl.innerHTML =
    logHeader +
    list
      .map((e) => {
        const isTiming = activeTimer && activeTimer.entryId === e.id;
        const isPaused = isTiming && activeTimer.paused;
        const color = getCatColor(e.tag);

        const endLine = isTiming
          ? isPaused
            ? `<span class="etime-end" style="color:#EF9F27;font-size:10px;">paused</span>`
            : `<span class="etime-end" style="color:#5DCAA5;font-size:10px;">timing…</span>`
          : e.tsEnd
            ? `<span class="etime-end">&#8627; ${fmtTime(e.tsEnd)}</span>${durLabel(e.ts, e.tsEnd)}`
            : `<span class="etime-end" style="color:var(--text3);font-style:italic;font-size:10px;">+ end time</span>`;

        const catOpts =
          categories
            .map(
              (c) =>
                `<button class="cat-opt${e.tag === c.id ? ' sel' : ''}" data-id="${e.id}" data-cat="${c.id}" style="${e.tag === c.id ? `background:${c.color};` : ''}color:${e.tag === c.id ? '#fff' : c.color}">${escHtml(c.label)}</button>`
            )
            .join('') + `<button class="cat-cancel" data-id="${e.id}">cancel</button>`;

        const startVal = toTimeInput(e.ts);
        const endVal = e.tsEnd ? toTimeInput(e.tsEnd) : '';

        const billableEmoji = isEntryBillable(e) ? '💰' : '💸';
        return `
        <div class="entry${isTiming ? ' is-timing' : ''}${e.signifier === 'cancelled' ? ' sig-cancelled-row' : ''}" data-id="${e.id}">
          <div class="etime-col">
            <span class="etime-display" data-id="${e.id}">
              <span class="etime-start">${fmtTime(e.ts)}</span>
              ${endLine}
            </span>
            <div class="etime-editor" id="ed-${e.id}">
              <div class="etime-editor-row"><span class="etime-lbl">start</span><input class="etime-input" type="time" id="ts-${e.id}" value="${startVal}" /></div>
              <div class="etime-editor-row"><span class="etime-lbl">end</span><input class="etime-input" type="time" id="te-${e.id}" value="${endVal}" placeholder="--:--" /></div>
              <div class="etime-actions">
                <button class="etime-save" data-id="${e.id}">save</button>
                <button class="etime-cancel" data-id="${e.id}">cancel</button>
              </div>
            </div>
          </div>
          ${sigHtml(e)}
          <span class="edot" style="background:${color};margin-top:6px;"></span>
          <div class="ebody">
            <div class="etext" data-id="${e.id}">${jiraTicketHtml(e.text)}${e._uncategorised ? `<span class="entry-uncategorised" title="No category — tap to assign">○</span>` : ''}</div>
            <button class="etag-btn" data-id="${e.id}">
              <span class="etag-cdot" style="background:${color}"></span>
              ${escHtml(getCatLabel(e.tag))} &#9660;
            </button>
            <div class="cat-picker" id="cp-${e.id}">${catOpts}</div>
          </div>
          <button class="ebill-btn" data-id="${e.id}" title="toggle billable/non-billable" style="cursor:pointer;background:none;border:none;padding:4px 8px;font-size:16px;color:inherit">${billableEmoji}</button>
          <button class="erestart" data-id="${e.id}" title="restart with timer">&#9654;</button>
          <button class="edel" data-id="${e.id}" title="delete">&times;</button>
        </div>`;
      })
      .join('');

  bindSignifierClicks();

  /* time editor */
  tl.querySelectorAll('.etime-display').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      closeAllEditors();
      el.style.display = 'none';
      document.getElementById('ed-' + id).classList.add('open');
    });
  });
  tl.querySelectorAll('.etime-save').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id,
        entry = entries.find((e) => e.id === id);
      if (!entry) return;
      const sv = document.getElementById('ts-' + id).value;
      const ev = document.getElementById('te-' + id).value;
      if (sv) entry.ts = roundToNearest30(applyTime(entry.ts, sv));
      if (ev) entry.tsEnd = roundToNearest30(applyTime(entry.ts, ev));
      else delete entry.tsEnd;
      // If this entry's timer is running, reset startTs to the new entry.ts
      if (activeTimer && activeTimer.entryId === id && sv) {
        activeTimer.startTs = entry.ts;
        activeTimer.accumulatedMs = 0;
        activeTimer.paused = false;
      }
      save();
      render();
    });
  });
  tl.querySelectorAll('.etime-cancel').forEach((btn) =>
    btn.addEventListener('click', () => render())
  );

  /* category picker */
  tl.querySelectorAll('.etag-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const picker = document.getElementById('cp-' + id);
      const isOpen = picker.classList.contains('open');
      document.querySelectorAll('.cat-picker.open').forEach((el) => el.classList.remove('open'));
      if (!isOpen) picker.classList.add('open');
    });
  });
  tl.querySelectorAll('.cat-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = entries.find((e) => e.id === btn.dataset.id);
      if (entry) {
        const key = entry.text.toLowerCase();
        entries.forEach((e) => {
          if (e.text.toLowerCase() === key) e.tag = btn.dataset.cat;
        });
        save();
        render();
      }
    });
  });
  tl.querySelectorAll('.cat-cancel').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('cp-' + btn.dataset.id).classList.remove('open');
    });
  });

  /* billable toggle */
  tl.querySelectorAll('.ebill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = entries.find((e) => e.id === btn.dataset.id);
      if (entry) {
        entry.billable = entry.billable === false ? undefined : false;
        save();
        render();
      }
    });
  });

  /* delete */
  tl.querySelectorAll('.edel').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (activeTimer && activeTimer.entryId === id) {
        clearInterval(timerInterval);
        timerInterval = null;
        activeTimer = null;
        save();
        updateTimerBtn(false);
        document.getElementById('timerBar').style.display = 'none';
      }
      entries = entries.filter((e) => e.id !== id);
      save();
      render();
    });
  });

  /* restart */
  tl.querySelectorAll('.erestart').forEach((btn) => {
    btn.addEventListener('click', () => {
      const src = entries.find((e) => e.id === btn.dataset.id);
      if (!src) return;
      if (activeTimer) stopTimer();
      const newEntry = {
        id: Date.now() + '',
        text: src.text,
        tag: src.tag,
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
  tl.querySelectorAll('.etext').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.querySelector('.etext-input')) return;
      const id = el.dataset.id;
      const entry = entries.find((e) => e.id === id);
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
          entries.forEach((e) => {
            if (e.text.toLowerCase() === origLower) e.text = newText;
          });
          planTasks.forEach((t) => {
            if (t.text.toLowerCase() === origLower) t.text = newText;
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
  renderTimeblock();
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
  const allRecent = [...entries].reverse().filter((e) => {
    const k = e.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Hide tasks whose last-logged date is at or past the current iteration boundary
  const todayKeyQp = dk(new Date());
  const expiredQp = new Set(
    allRecent
      .filter((e) => {
        const expiry = getIterationExpiry(e.date || '');
        return expiry && todayKeyQp >= expiry;
      })
      .map((e) => e.text.toLowerCase())
  );
  const recent = allRecent
    .filter((e) => !qpHidden.has(e.text.toLowerCase()) && !expiredQp.has(e.text.toLowerCase()))
    .slice(0, 16);
  // Hidden count is the intersection of qpHidden with task texts actually present in entries
  const hiddenInUse = allRecent.filter((e) => qpHidden.has(e.text.toLowerCase())).length;

  if (!recent.length && !hiddenInUse) {
    qp.innerHTML = '';
    return;
  }

  const itemsHtml = recent
    .map((e) => {
      return (
        `<button class="qp-item" data-text="${escHtml(e.text)}" data-tag="${e.tag}">` +
        `<span class="qp-item-text">${escHtml(e.text)}</span>` +
        `<span class="qp-remove" data-text="${escHtml(e.text)}" title="remove from recent tasks">&times;</span>` +
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
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.qp-remove')) return;
      document.getElementById('captureInput').value = btn.dataset.text;
      selectedTag = btn.dataset.tag;
      renderTagRow();
      document.getElementById('captureInput').focus();
    });
  });
  // Click ✕ — hide from recent list
  qp.querySelectorAll('.qp-remove').forEach((x) => {
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      qpHidden.add(x.dataset.text.toLowerCase());
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
  // Decorate the active timer's entry with a synthetic tsEnd so its accumulated
  // time appears in the chart in (near) real time — not just after the timer stops.
  // Re-runs naturally on every render; a 15-min interval also forces a refresh.
  const decorated = (list || []).map((e) => {
    if (activeTimer && e.id === activeTimer.entryId && !e.tsEnd) {
      const liveEnd = activeTimer.paused
        ? e.ts + (activeTimer.accumulatedMs || 0)
        : Math.max(Date.now(), activeTimer.startTs || e.ts);
      return Object.assign({}, e, { tsEnd: liveEnd, _live: true });
    }
    return e;
  });
  const timed = decorated.filter((e) => e.tsEnd && e.tsEnd > e.ts);

  const toggleHtml = `<div class="chart-toggle">
      <button class="chart-tog${chartMode === 'task' ? ' active' : ''}" data-mode="task">by task</button>
      <button class="chart-tog${chartMode === 'category' ? ' active' : ''}" data-mode="category">by epic</button>
    </div>`;

  if (!timed.length) {
    el.innerHTML = `<div class="chart-section"><div class="chart-header"><span class="chart-title">time tracked</span>${toggleHtml}</div><div class="chart-empty">add end times to entries to see the chart</div></div>`;
    el.querySelectorAll('.chart-tog').forEach((b) =>
      b.addEventListener('click', () => {
        chartMode = b.dataset.mode;
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
    timed.forEach((e) => {
      const key = e.text.toLowerCase();
      totals[key] = (totals[key] || 0) + Math.max(0, e.tsEnd - e.ts);
      if (!meta[key]) meta[key] = { label: e.text, color: getCatColor(e.tag) };
      if (e._live) liveKeys.add(key);
      tallyBill(key, e);
    });
  } else {
    timed.forEach((e) => {
      const key = e.tag || 'other';
      totals[key] = (totals[key] || 0) + Math.max(0, e.tsEnd - e.ts);
      if (!meta[key]) meta[key] = { label: getCatLabel(key), color: getCatColor(key) };
      if (e._live) liveKeys.add(key);
      tallyBill(key, e);
    });
  }
  // Per-row billable icon: 💰 if all billable, 💸 if all non-billable, ⚖️ if mixed
  function billIcon(key) {
    const c = billCounts[key];
    if (!c) return '';
    if (c.bill && c.nonBill)
      return '<span class="chart-bill" title="mixed billable/non-billable">⚖️</span>';
    if (c.bill) return '<span class="chart-bill" title="billable">💰</span>';
    if (c.nonBill) return '<span class="chart-bill" title="non-billable">💸</span>';
    return '';
  }

  const sorted = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const maxMs = totals[sorted[0]];
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

  const rows = sorted
    .map((key) => {
      const ms = totals[key],
        pct = Math.round((ms / maxMs) * 100);
      const mins = Math.round(ms / 60000),
        h = Math.floor(mins / 60),
        m = mins % 60;
      const dur = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
      const { label, color } = meta[key];
      const live = liveKeys.has(key) ? ' chart-row-live' : '';
      const liveDot = liveKeys.has(key)
        ? '<span class="chart-live-dot" title="currently being tracked">●</span>'
        : '';
      return `<div class="chart-row${live}">
        <span class="chart-label" title="${escHtml(label)}">${liveDot}${escHtml(label)}</span>
        <div class="chart-track"><div class="chart-bar" style="width:${pct}%;background:${color}"></div></div>
        ${billIcon(key)}
        <span class="chart-dur">${dur}</span>
      </div>`;
    })
    .join('');

  const tm2 = Math.round(grandTotal / 60000),
    th2 = Math.floor(tm2 / 60),
    tm3 = tm2 % 60;
  const totalDur = th2 > 0 ? (tm3 > 0 ? `${th2}h ${tm3}m` : `${th2}h`) : `${tm3}m`;
  const billMs = timed.filter((e) => isEntryBillable(e)).reduce((s, e) => s + (e.tsEnd - e.ts), 0);
  const nonBillMs = timed.reduce((s, e) => s + (e.tsEnd - e.ts), 0) - billMs;
  const fmtMs = (ms) => {
    const m = Math.round(ms / 60000),
      h = Math.floor(m / 60),
      r = m % 60;
    return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
  };
  const title = chartMode === 'task' ? 'time by task' : 'time by epic';
  el.innerHTML = `<div class="chart-section"><div class="chart-header"><span class="chart-title">${title}</span>${toggleHtml}</div>${rows}<div class="chart-total">total tracked: <span>${totalDur}</span></div>${billMs > 0 || nonBillMs > 0 ? `<div class="chart-total">💰 billable: <span>${fmtMs(billMs)}</span></div><div class="chart-total">💸 non-billable: <span>${fmtMs(nonBillMs)}</span></div>` : ''}</div>`;
  el.querySelectorAll('.chart-tog').forEach((b) =>
    b.addEventListener('click', () => {
      chartMode = b.dataset.mode;
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
