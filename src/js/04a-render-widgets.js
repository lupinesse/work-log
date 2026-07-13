/* ── Render: secondary panels (quick-pick, chart) ── */

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
  el.innerHTML = `<div class="chart-section"><div class="chart-header"><span class="chart-title">${title}</span>${toggleHtml}</div><div class="chart-body">${rows}<div class="chart-total">total tracked: <span>${totalDur}</span></div>${billMs > 0 || nonBillMs > 0 ? `<div class="chart-total">💰 billable: <span>${fmtDur(billMs)}</span></div><div class="chart-total">💸 non-billable: <span>${fmtDur(nonBillMs)}</span></div>` : ''}</div></div>`;
  el.querySelectorAll('.chart-tog').forEach((btn) =>
    btn.addEventListener('click', () => {
      chartMode = btn.dataset.mode;
      renderChart(list);
    })
  );
}
