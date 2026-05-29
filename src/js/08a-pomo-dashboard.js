// ── 08a-pomo-dashboard.js — Pomodoro 4-column card: sparkline + ribbon ──
//
// This module runs after 08-pomodoro.js in the concatenated build.
// It reads `pomoGetLog()` and the shared `entries`/`activeTimer` globals
// defined in earlier modules.  All DOM interactions are guarded by
// `getElementById` null-checks so the module is inert when elements are
// absent (e.g. during unit tests that mount a partial DOM).

const POMO_SPARKLINE_DAYS = 28;
const POMO_RIBBON_DOT_COUNT = 5;

/**
 * Returns the number of completed pomodoro sessions on the given date.
 * @param {Array<{ts:number,mins:number,task:string|null}>} log - Session log.
 * @param {string} dateKey - Date in YYYY-MM-DD format.
 * @returns {number}
 */
function pomoSessionsOnDate(log, dateKey) {
  return log.filter((e) => dk(new Date(e.ts)) === dateKey).length;
}

/**
 * Builds an array of POMO_SPARKLINE_DAYS date strings ending today,
 * oldest first.
 * @returns {string[]} Array of YYYY-MM-DD strings.
 */
function pomoBuildDateRange() {
  return Array.from({ length: POMO_SPARKLINE_DAYS }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (POMO_SPARKLINE_DAYS - 1 - i));
    return dk(d);
  });
}

/**
 * Reads the --pomo-spark-fill and --pomo-spark-empty CSS variables for the
 * active colour scheme.  Falls back to hardcoded values when CSS vars are
 * unavailable (e.g. headless test environments).
 * @returns {{ fill: string, empty: string }}
 */
function pomoSparkColours() {
  const style = getComputedStyle(document.documentElement);
  return {
    fill: style.getPropertyValue('--pomo-spark-fill').trim() || '#c62828',
    empty: style.getPropertyValue('--pomo-spark-empty').trim() || '#e8edf4',
  };
}

/**
 * Draws a 28-day focus density bar chart on the `#pomoSparkline` canvas.
 * Each bar represents one calendar day; bar height is proportional to the
 * number of completed pomodoro sessions on that day.
 * No-op when the canvas element is absent or the 2D context is unavailable.
 */
function renderPomoSparkline() {
  const canvas = document.getElementById('pomoSparkline');
  if (!canvas || !canvas.getContext) return;

  const log = pomoGetLog();
  const days = pomoBuildDateRange();
  const counts = days.map((d) => pomoSessionsOnDate(log, d));
  const maxCount = Math.max(...counts, 1); // guard against all-zero

  const dpr = window.devicePixelRatio || 1;

  // Read live layout width so the drawing stays sharp if the column ever changes.
  // Fall back to 170 in headless environments where getBoundingClientRect returns 0.
  const cssW = canvas.getBoundingClientRect().width || 170;
  const cssH = 72; // matches .pomo-sparkline-canvas { height: 72px } in _pomo.scss
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const { fill, empty } = pomoSparkColours();
  const barUnit = cssW / POMO_SPARKLINE_DAYS;

  // 72 % bar width, 28 % gap between bars
  const barW = barUnit * 0.72;
  const maxBarH = cssH - 6; // 6 px bottom margin for breathing room

  counts.forEach((count, i) => {
    const x = i * barUnit;
    const barH = count > 0 ? Math.max(3, (count / maxCount) * maxBarH) : 2;
    const y = cssH - barH - 3;

    ctx.fillStyle = count > 0 ? fill : empty;

    // roundRect is baseline-available since March 2023; fall back to fillRect
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 2);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, barW, barH);
    }
  });
}

/**
 * Renders the ribbon footer below the 4-column grid:
 *  - `#pomoRibbonDots`: last-5-session dot sequence (● filled, · empty slot)
 *  - `#pomoRibbonPill`: "Peak Focus" pill when today matches the all-time high,
 *    otherwise "N sessions today", hidden when no sessions today
 *  - `#pomoRibbonLink`: "View all N sessions ↓" button that scrolls `#pomoLog`
 *
 * Each element is individually guarded — no-op when absent from the DOM.
 */
function renderPomoRibbon() {
  const log = pomoGetLog();
  const dotsEl = document.getElementById('pomoRibbonDots');
  const pillEl = document.getElementById('pomoRibbonPill');
  const linkEl = document.getElementById('pomoRibbonLink');

  if (dotsEl) {
    const slice = log.slice(0, POMO_RIBBON_DOT_COUNT);
    dotsEl.innerHTML = Array.from({ length: POMO_RIBBON_DOT_COUNT }, (_, i) => {
      if (i < slice.length) {
        const session = slice[i];
        const taskPart = session.task ? ` — ${escHtml(session.task)}` : '';
        const label = `${session.mins} min session${taskPart}`;
        return `<span class="pomo-rdot pomo-rdot-filled" title="${label}" aria-hidden="true">●</span>`;
      }
      return `<span class="pomo-rdot pomo-rdot-empty" aria-hidden="true">·</span>`;
    }).join('');
  }

  if (pillEl) {
    const today = dk(new Date());

    // Tally sessions per calendar day across the full log
    const perDay = {};
    log.forEach((e) => {
      const d = dk(new Date(e.ts));
      perDay[d] = (perDay[d] || 0) + 1;
    });

    const todayCount = perDay[today] || 0;
    const peakCount = Object.values(perDay).reduce((a, b) => Math.max(a, b), 0);

    if (todayCount > 0 && todayCount >= peakCount) {
      pillEl.textContent = `🔥 Peak Focus — ${todayCount} session${todayCount > 1 ? 's' : ''}`;
    } else if (todayCount > 0) {
      pillEl.textContent = `${todayCount} session${todayCount > 1 ? 's' : ''} today`;
    } else {
      pillEl.textContent = '';
    }
  }

  if (linkEl) {
    const total = log.length;
    linkEl.textContent = total > 0 ? `View all ${total} sessions ↓` : 'No sessions yet';
    linkEl.onclick = () => {
      document.getElementById('pomoLog')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
  }
}

/**
 * Updates `#pomoTaskLabel` (composer column) with the text of the currently
 * running timer entry.  Clears the label when no timer is active.
 */
function updatePomoTaskLabel() {
  const el = document.getElementById('pomoTaskLabel');
  if (!el) return;
  const liveEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
  el.textContent = liveEntry ? liveEntry.text : '';
}

/**
 * Full Pomodoro dashboard refresh: redraws the 28-day sparkline, ribbon
 * footer, and composer task label.
 * Called on module load and after every session completion.
 */
function refreshPomoDashboard() {
  renderPomoSparkline();
  renderPomoRibbon();
  updatePomoTaskLabel();
}

// Run once on initial load — all earlier modules are concatenated by now
refreshPomoDashboard();
