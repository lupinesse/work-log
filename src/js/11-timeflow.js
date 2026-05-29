// ── 11-timeflow.js — Today's Flow unified section (Flow / Log / Blocks views) ──

const STORE_FLOW_VIEW = 'wl_flow_view';

/** 07:00 in minutes from midnight — left edge of the day-overview strip. */
const TF_STRIP_START = 7 * 60;
/** 21:00 in minutes from midnight — right edge of the day-overview strip. */
const TF_STRIP_END = 21 * 60;

/** Display labels for the segmented control. Static so we avoid recomputing on every render. */
const TF_VIEW_LABELS = { flow: 'Flow', log: 'Log', blocks: 'Blocks' };

/** Maps each view to the DOM id of the pane that hosts it. */
const TF_PANE_IDS = { flow: 'tfFlowPane', log: 'tfLogPane', blocks: 'tfBlocksPane' };

// ─────────────────────────── view preference ───────────────────────────

/**
 * Returns the persisted view preference, defaulting to 'flow'.
 * @returns {'flow'|'log'|'blocks'}
 */
function getFlowView() {
  const v = localStorage.getItem(STORE_FLOW_VIEW);
  return v === 'log' || v === 'blocks' ? v : 'flow';
}

/**
 * Persists the active view selection.
 * @param {'flow'|'log'|'blocks'} view
 */
function setFlowView(view) {
  localStorage.setItem(STORE_FLOW_VIEW, view);
}

// ─────────────────────────── day-overview strip ───────────────────────────

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
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Formats a Unix timestamp (ms) as `HH:MM` in local time.
 * @param {number} ts
 * @returns {string}
 */
function fmtHm(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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
      (h) =>
        `<span class="tf-tick" style="left:${stripPct(h * 60)}%">${String(h).padStart(2, '0')}</span>`
    )
    .join('');

  // Completed entry footprints
  const bars = entries
    .filter((e) => e.date === dateKey && e.tsEnd && e.signifier !== 'cancelled')
    .map((e) => {
      const cat = getCat(e.tag);
      const left = stripPct(Math.max(TF_STRIP_START, tsToMins(e.ts)));
      const right = stripPct(Math.min(TF_STRIP_END, tsToMins(e.tsEnd)));
      return `<div class="tf-bar" style="left:${left}%;width:${Math.max(0.5, right - left)}%;background:${cat.color}"></div>`;
    })
    .join('');

  // Live timer footprint
  let liveBar = '';
  if (activeTimer && isToday(viewDate)) {
    const le = entries.find((e) => e.id === activeTimer.entryId);
    if (le && le.date === dateKey) {
      const left = stripPct(Math.max(TF_STRIP_START, tsToMins(le.ts)));
      const right = stripPct(Math.min(TF_STRIP_END, nowMins));
      if (right > left) {
        const cat = getCat(le.tag);
        liveBar = `<div class="tf-bar tf-bar-live" style="left:${left}%;width:${right - left}%;background:${cat.color}"></div>`;
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
 * Finds the largest untracked gap (≥ 15 min) between consecutive completed
 * entries for the given day. Returns null for past days — only actionable today.
 * @param {string} dateKey - YYYY-MM-DD.
 * @returns {{startTs: number, endTs: number, gapMin: number}|null}
 */
function findLargestGap(dateKey) {
  if (!isToday(viewDate)) return null;
  const timed = entries
    .filter((e) => e.date === dateKey && e.tsEnd && e.signifier !== 'cancelled')
    .sort((a, b) => a.ts - b.ts);

  let largest = null;
  for (let i = 0; i < timed.length - 1; i++) {
    const gapMin = Math.floor((timed[i + 1].ts - timed[i].tsEnd) / 60000);
    if (gapMin >= 15 && (!largest || gapMin > largest.gapMin)) {
      largest = { startTs: timed[i].tsEnd, endTs: timed[i + 1].ts, gapMin };
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
  const h = Math.floor(gap.gapMin / 60),
    m = gap.gapMin % 60;
  const dur = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  el.style.display = '';
  el.innerHTML = `<span class="tf-gap-text">${fmtHm(gap.startTs)} – ${fmtHm(gap.endTs)} · ${dur} untracked between blocks</span><button type="button" class="tf-gap-btn" id="tfGapLogBtn">＋ log it</button>`;
  document.getElementById('tfGapLogBtn')?.addEventListener('click', () => {
    const inp = document.getElementById('captureInput');
    if (inp) inp.focus();
  });
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
    (e) => e.date === dateKey && e.tsEnd && e.signifier !== 'cancelled'
  );
  let totalMs = dayEntries.reduce((sum, e) => sum + (e.tsEnd - e.ts), 0);
  const billMs = dayEntries
    .filter((e) => isEntryBillable(e))
    .reduce((sum, e) => sum + (e.tsEnd - e.ts), 0);

  // Include live timer duration so totals update while tracking
  if (activeTimer && isToday(viewDate)) {
    const le = entries.find((e) => e.id === activeTimer.entryId);
    if (le && le.date === dateKey && !le.tsEnd) {
      totalMs += activeTimer.paused
        ? activeTimer.accumulatedMs || 0
        : Math.max(0, Date.now() - (activeTimer.startTs || le.ts));
    }
  }

  const totalsHtml =
    totalMs > 0
      ? `<span class="tf-totals">${fmtDur(totalMs)} tracked${billMs > 0 ? ` · <span class="tf-bill">${fmtDur(billMs)} billable</span>` : ''}</span>`
      : '';

  // Segmented control uses ARIA `tablist`/`tab` so screen readers announce the
  // mutually-exclusive selection correctly and link each tab to its pane.
  const segHtml = ['flow', 'log', 'blocks']
    .map((v) => {
      const isActive = v === activeView;
      return `<button type="button" role="tab" class="tf-seg-btn${isActive ? ' active' : ''}" data-view="${v}" id="tfTab-${v}" aria-selected="${isActive}" aria-controls="${TF_PANE_IDS[v]}" tabindex="${isActive ? '0' : '-1'}">${TF_VIEW_LABELS[v]}</button>`;
    })
    .join('');

  el.innerHTML = `<span class="tf-icon" aria-hidden="true">⏱</span><span class="tf-title">TODAY'S FLOW</span>${totalsHtml}<div class="tf-seg" id="tfSeg" role="tablist" aria-label="Select view">${segHtml}</div>`;

  bindSegmentListeners();
}

/**
 * Wires click handlers on the segmented-control tabs. Called after every
 * renderFlowHeader() because the buttons are recreated by innerHTML — kept
 * separate so renderFlowHeader stays single-purpose (markup only).
 */
function bindSegmentListeners() {
  document
    .getElementById('tfSeg')
    ?.querySelectorAll('.tf-seg-btn')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        setFlowView(btn.dataset.view);
        renderTodayFlow();
      });
    });
}

// ─────────────────────────── Flow view ───────────────────────────

/**
 * Renders the Flow view: a vertical list where each entry's accent strip height
 * is proportional to its duration (height = max(64, 0.6 × minutes) px), giving
 * longer tasks more visual weight.
 * @param {string} dateKey
 */
function renderFlowView(dateKey) {
  const el = document.getElementById('tfFlowPane');
  if (!el) return;

  const items = buildDailyLogItems(dateKey);
  if (!items.length) {
    el.innerHTML = `<div class="tf-empty">No entries for ${isToday(viewDate) ? 'today' : 'this day'} yet.</div>`;
    return;
  }

  el.innerHTML = items
    .map((item) => {
      const time = new Date(item.ts);
      const hh = String(time.getHours()).padStart(2, '0');
      const mm = String(time.getMinutes()).padStart(2, '0');

      // Look up the underlying entry object for entry-type items
      const entryObj =
        item.type === 'entry' && item.entryId ? entries.find((e) => e.id === item.entryId) : null;

      let durationMin = 0;
      let isLive = false;
      if (entryObj) {
        const endTs =
          entryObj.tsEnd ||
          (activeTimer && activeTimer.entryId === entryObj.id ? Date.now() : null);
        if (endTs) durationMin = Math.max(1, Math.round((endTs - entryObj.ts) / 60000));
        isLive = !!(activeTimer && activeTimer.entryId === entryObj.id);
      }

      // Strip height scales with duration; non-entry items (notes, tasks) get a fixed height
      const stripH = item.type === 'entry' ? Math.max(64, Math.round(0.6 * durationMin)) : 40;

      return `
        <div class="tf-flow-row${isLive ? ' live' : ''}">
          <div class="tf-flow-time">
            <span class="tf-flow-hm">${hh}:${mm}</span>
            ${durationMin > 0 ? `<span class="tf-flow-dur">${fmtDur(durationMin * 60000)}</span>` : ''}
          </div>
          <div class="tf-flow-strip" style="height:${stripH}px;background:${item.color}">
            ${isLive ? '<span class="tf-flow-pulse" aria-hidden="true"></span>' : ''}
          </div>
          <div class="tf-flow-body" style="min-height:${stripH}px">
            <div class="tf-flow-text">${item.text}</div>
            <div class="tf-flow-sub">${item.sub}</div>
          </div>
        </div>`;
    })
    .join('');
}

// ─────────────────────────── Log view ───────────────────────────

/**
 * Renders the Log view: a compact timeline with a vertical rail and circle markers.
 * Notes input is shown for today only.
 * @param {string} dateKey
 */
function renderLogView(dateKey) {
  const feedEl = document.getElementById('tfLogFeed');
  if (!feedEl) return;

  const items = buildDailyLogItems(dateKey);
  if (!items.length) {
    feedEl.innerHTML = `<div class="tf-empty">No entries for ${isToday(viewDate) ? 'today' : 'this day'} yet.</div>`;
  } else {
    feedEl.innerHTML = items
      .map((item, i) => {
        const time = new Date(item.ts);
        const hh = String(time.getHours()).padStart(2, '0');
        const mm = String(time.getMinutes()).padStart(2, '0');
        const isLive = item.type === 'entry' && activeTimer && item.entryId === activeTimer.entryId;

        const dot = isLive
          ? `<span class="tf-log-dot live" aria-hidden="true"></span>`
          : `<span class="tf-log-dot" style="border-color:${item.color}" aria-hidden="true"></span>`;

        return `
          <div class="tf-log-row">
            <div class="tf-log-time"><span class="tf-log-hm">${hh}:${mm}</span></div>
            <div class="tf-log-dot-col">
              ${dot}
              ${i < items.length - 1 ? '<div class="tf-log-line"></div>' : ''}
            </div>
            <div class="tf-log-body">
              <div class="tf-log-text">${item.text}</div>
              <div class="tf-log-sub">${item.sub}</div>
            </div>
          </div>`;
      })
      .join('');
  }

  const noteRow = document.getElementById('dailyLogNoteRow');
  if (noteRow) noteRow.style.display = isToday(viewDate) ? '' : 'none';
}

// ─────────────────────────── main render ───────────────────────────

/**
 * Renders the Today's Flow section: header, day-overview strip, gap reminder,
 * and the active view pane (Flow / Log / Blocks).
 * Called from render() on every state change and when the view toggle fires.
 */
function renderTodayFlow() {
  const dateKey = dk(viewDate);
  const activeView = getFlowView();

  renderFlowHeader(dateKey, activeView);
  renderDayStrip(dateKey);
  renderGapReminder(dateKey);

  Object.entries(TF_PANE_IDS).forEach(([view, id]) => {
    const pane = document.getElementById(id);
    if (pane) pane.style.display = view === activeView ? '' : 'none';
  });

  if (activeView === 'flow') renderFlowView(dateKey);
  else if (activeView === 'log') renderLogView(dateKey);
  else renderTimeblock(); // blocks: delegate to existing timeblock renderer
}

/**
 * Binds the static log-note input listeners exactly once on DOMContentLoaded.
 * These elements (`#dailyLogNoteBtn`, `#dailyLogNoteInput`) live in static HTML
 * and are never recreated, so attaching here avoids the listener accumulation
 * that occurred when binding happened inside renderLogView().
 */
function initTodayFlow() {
  document.getElementById('dailyLogNoteBtn')?.addEventListener('click', addLogNote);
  document.getElementById('dailyLogNoteInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addLogNote();
  });
}
