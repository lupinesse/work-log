// ── 11c-timeflow-header.js — Today's Flow: day strip, gap reminder, section header ──
//
// Split out of 11-timeflow.js: the "summary chrome" rendered above the active
// view pane — day-overview strip, untracked-gap banner, and the section
// header with tracked/billable totals and the view segmented control. Pure
// read-and-render helpers over `entries`/`activeTimer`; none mutate state.

/**
 * Converts a minutes-from-midnight value to a percentage across the strip range.
 * Clamped to [0, 100].
 * @param {number} mins
 * @returns {number}
 */
function stripPct(mins) {
  return Math.max(
    0,
    Math.min(100, ((mins - TF_STRIP_START) / (TF_STRIP_END - TF_STRIP_START)) * 100)
  );
}

/**
 * Converts a Unix timestamp (ms) to minutes-from-midnight in local time.
 * @param {number} ts
 * @returns {number}
 */
function tsToMins(ts) {
  const date = new Date(ts);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Formats a Unix timestamp (ms) as `HH:MM` in local time.
 * @param {number} ts
 * @returns {string}
 */
function fmtHm(ts) {
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Returns the effective tracked duration (ms) of an active-timer entry,
 * honouring pause state — matches the formula used by renderFlowHeader so
 * the strip bar and Flow-view duration freeze while paused.
 * @param {object} entry
 * @returns {number} 0 if no timer is active for this entry.
 */
function activeTimerDurationMs(entry) {
  if (!activeTimer || activeTimer.entryId !== entry.id) return 0;
  if (activeTimer.paused) return activeTimer.accumulatedMs || 0;
  return Math.max(0, Date.now() - (activeTimer.startTs || entry.ts));
}

/**
 * Renders the compact day-overview strip: hour-tick labels, entry footprints,
 * and (today only) a live "now" cursor.
 * @param {string} dateKey - YYYY-MM-DD.
 */
function renderDayStrip(dateKey) {
  const el = document.getElementById('tfDayStrip');
  if (!el) return;

  // Capture wall-clock time once so the live bar and now-cursor stay consistent
  const nowMins = tsToMins(Date.now());

  // Hour-tick labels at two-hour intervals
  const ticks = [7, 9, 11, 13, 15, 17, 19, 21]
    .map(
      (hour) =>
        `<span class="tf-tick" style="left:${stripPct(hour * 60)}%">${String(hour).padStart(2, '0')}</span>`
    )
    .join('');

  // Completed entry footprints — skip entries entirely outside the strip
  // (right === left after clamping) to avoid phantom slivers at the edges.
  const bars = entries
    .filter((entry) => entry.date === dateKey && entry.tsEnd && entry.signifier !== 'cancelled')
    .map((entry) => {
      const cat = getCat(entry.tag);
      const left = stripPct(Math.max(TF_STRIP_START, tsToMins(entry.ts)));
      const right = stripPct(Math.min(TF_STRIP_END, tsToMins(entry.tsEnd)));
      if (right <= left) return '';
      return `<div class="tf-bar" style="left:${left}%;width:${Math.max(0.5, right - left)}%;background:${safeCssColor(cat.color)}"></div>`;
    })
    .join('');

  // Live timer footprint — endpoint freezes at pause so the bar doesn't keep
  // growing while the user is paused (matches renderFlowHeader's totals math).
  let liveBar = '';
  if (activeTimer && isToday(viewDate)) {
    const liveEntry = entries.find((entry) => entry.id === activeTimer.entryId);
    if (liveEntry && liveEntry.date === dateKey) {
      const liveEndMins = tsToMins(liveEntry.ts + activeTimerDurationMs(liveEntry));
      const left = stripPct(Math.max(TF_STRIP_START, tsToMins(liveEntry.ts)));
      const right = stripPct(Math.min(TF_STRIP_END, liveEndMins));
      if (right > left) {
        const cat = getCat(liveEntry.tag);
        liveBar = `<div class="tf-bar tf-bar-live" style="left:${left}%;width:${right - left}%;background:${safeCssColor(cat.color)}"></div>`;
      }
    }
  }

  // Now cursor (today only)
  let nowCursor = '';
  if (isToday(viewDate) && nowMins >= TF_STRIP_START && nowMins <= TF_STRIP_END) {
    nowCursor = `<div class="tf-now-cursor" style="left:${stripPct(nowMins)}%"></div>`;
  }

  el.innerHTML = `<div class="tf-strip-ticks">${ticks}</div><div class="tf-strip-bar">${bars}${liveBar}${nowCursor}</div>`;
}

// ─────────────────────────── gap reminder ───────────────────────────

/**
 * Finds the largest untracked gap (≥ 15 min) today, including gaps between
 * consecutive completed entries AND the trailing gap from the most recent
 * entry's end to now (which is often the most actionable). Returns null for
 * past days — only actionable today.
 * @param {string} dateKey - YYYY-MM-DD.
 * @returns {{startTs: number, endTs: number, gapMin: number}|null}
 */
function findLargestGap(dateKey) {
  if (!isToday(viewDate)) return null;
  const timed = entries
    .filter((entry) => entry.date === dateKey && entry.tsEnd && entry.signifier !== 'cancelled')
    .sort((a, b) => a.ts - b.ts);

  let largest = null;

  // Internal gaps between consecutive completed entries
  for (let i = 0; i < timed.length - 1; i++) {
    const gapMin = Math.floor((timed[i + 1].ts - timed[i].tsEnd) / 60000);
    if (gapMin >= 15 && (!largest || gapMin > largest.gapMin)) {
      largest = { startTs: timed[i].tsEnd, endTs: timed[i + 1].ts, gapMin };
    }
  }

  // Trailing gap: last entry's end → now (or EOD if the day has been ended).
  // Suppressed while a live timer is running, since the user is actively
  // tracking and the gap will close itself.
  if (timed.length && !activeTimer) {
    const last = timed[timed.length - 1];
    const eodTs = getEodTs();
    const ceiling = eodTs || Date.now();
    const trailingMin = Math.floor((ceiling - last.tsEnd) / 60000);
    if (trailingMin >= 15 && (!largest || trailingMin > largest.gapMin)) {
      largest = { startTs: last.tsEnd, endTs: ceiling, gapMin: trailingMin };
    }
  }

  return largest;
}

/**
 * Renders or hides the gap-reminder banner.
 * @param {string} dateKey
 */
function renderGapReminder(dateKey) {
  const el = document.getElementById('tfGapReminder');
  if (!el) return;
  const gap = findLargestGap(dateKey);
  if (!gap) {
    el.style.display = 'none';
    return;
  }
  const hours = Math.floor(gap.gapMin / 60);
  const mins = gap.gapMin % 60;
  let dur;
  if (hours > 0) dur = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  else dur = `${mins}m`;
  el.style.display = '';
  el.innerHTML = `<span class="tf-gap-text">${fmtHm(gap.startTs)} – ${fmtHm(gap.endTs)} · ${dur} untracked between blocks</span><button type="button" class="tf-gap-btn" id="tfGapLogBtn">＋ log it</button>`;
}

// ─────────────────────────── section header ───────────────────────────

/**
 * Renders the section header: icon, title, tracked/billable totals, and
 * the Flow / Log / Blocks segmented control.
 * @param {string} dateKey
 * @param {'flow'|'log'|'blocks'} activeView
 */
function renderFlowHeader(dateKey, activeView) {
  const el = document.getElementById('tfHeader');
  if (!el) return;

  const dayEntries = entries.filter(
    (entry) => entry.date === dateKey && entry.tsEnd && entry.signifier !== 'cancelled'
  );
  let totalMs = dayEntries.reduce((sum, e) => sum + (e.tsEnd - e.ts), 0);
  let billMs = dayEntries
    .filter((entry) => isEntryBillable(entry))
    .reduce((sum, e) => sum + (e.tsEnd - e.ts), 0);

  // Include live timer duration so both totals update while tracking
  if (activeTimer && isToday(viewDate)) {
    const liveEntry = entries.find((entry) => entry.id === activeTimer.entryId);
    if (liveEntry && liveEntry.date === dateKey && !liveEntry.tsEnd) {
      const liveMs = activeTimerDurationMs(liveEntry);
      totalMs += liveMs;
      if (isEntryBillable(liveEntry)) billMs += liveMs;
    }
  }

  const totalsHtml =
    totalMs > 0
      ? `<span class="tf-totals">${fmtDur(totalMs)} tracked${billMs > 0 ? ` · <span class="tf-bill">${fmtDur(billMs)} billable</span>` : ''}</span>`
      : '';

  // Segmented control uses ARIA `tablist`/`tab` so screen readers announce the
  // mutually-exclusive selection correctly and link each tab to its pane.
  // Roving tabindex: only the active tab is in the tab order; arrows move within.
  const segHtml = TF_VIEWS.map((view) => {
    const isActive = view === activeView;
    return `<button type="button" role="tab" class="tf-seg-btn${isActive ? ' active' : ''}" data-view="${view}" id="tfTab-${view}" aria-selected="${isActive}" aria-controls="${TF_PANE_IDS[view]}" tabindex="${isActive ? '0' : '-1'}">${TF_VIEW_LABELS[view]}</button>`;
  }).join('');

  el.innerHTML = `<span class="section-icon tf-icon" aria-hidden="true">${ICON_ACTIVITY}</span><span class="tf-title">TODAY'S FLOW</span>${totalsHtml}<div class="tf-seg" id="tfSeg" role="tablist" aria-label="Select view">${segHtml}</div>`;
}
