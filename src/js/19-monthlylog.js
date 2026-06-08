// ── 19-monthlylog.js — Monthly Log heatmap + task inventory ──

// var (not let): 11-timeflow.js loads before this module and reads these at runtime;
// let would cause a temporal dead zone ReferenceError.
var _mlYear = new Date().getFullYear(); // eslint-disable-line no-var
var _mlMonth = new Date().getMonth(); // eslint-disable-line no-var -- 0-indexed
var _mlActive = false; // eslint-disable-line no-var

/**
 * Returns the number of days in a given month.
 * @param {number} y - Full year (e.g. 2026).
 * @param {number} m - Month index, 0-based (0 = January).
 * @returns {number} Day count (28–31).
 */
function mlDaysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

/**
 * Sums tracked milliseconds for all non-cancelled entries on a given day.
 * @param {string} dateKey
 * @returns {number} Total hours (as a float).
 */
function mlHoursForDay(dateKey) {
  return (
    entries
      .filter((e) => e.date === dateKey && e.signifier !== 'cancelled' && e.tsEnd)
      .reduce((sum, e) => sum + (e.tsEnd - e.ts), 0) / 3600000
  );
}

/**
 * Maps a logged-hours value to a CSS colour for the heatmap grid.
 * Thresholds: 0h → bg3 (empty), <2h → faint blue, <5h → mid blue,
 * <7h → strong blue, ≥7h → solid blue.
 * @param {number} hours - Total logged hours for a single day.
 * @returns {string} A CSS colour value (variable or rgba/hex string).
 */
function mlHeatColor(hours) {
  if (!hours) return 'var(--bg3)';
  if (hours < 2) return 'rgba(24,95,165,0.15)';
  if (hours < 5) return 'rgba(24,95,165,0.40)';
  if (hours < 7) return 'rgba(24,95,165,0.70)';
  return '#185fa5';
}

/**
 * Renders the heatmap calendar grid: navigation header, day labels, day cells,
 * and the colour legend. Binds cell-click (navigate to that day) and prev/next
 * month buttons. Writes its full HTML to `calEl`.
 *
 * Implicit dependency: the prev/next handlers mutate module-level `_mlYear` /
 * `_mlMonth` and then call `renderMonthlyLog()` to re-render the whole view.
 * Both globals must therefore be in scope when this function is called.
 *
 * @param {HTMLElement} calEl - The `#mlCalendar` container.
 * @param {number} year - Full year to render.
 * @param {number} month - Month index, 0-based.
 * @returns {void}
 * @see renderMonthlyLog
 */
function renderMonthlyCalendar(calEl, year, month) {
  const days = mlDaysInMonth(year, month);
  const firstDow = new Date(year, month, 1).getDay(); // 0 = Sun
  const offset = (firstDow + 6) % 7; // shift to Mon-start

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthName = new Date(year, month, 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });

  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const emptyCells = Array(offset).fill('<div></div>').join('');
  const dayCells = Array.from({ length: days }, (_, i) => {
    const d = i + 1;
    const dateKey = `${monthPrefix}-${String(d).padStart(2, '0')}`;
    const hrs = mlHoursForDay(dateKey);
    const refl = typeof getReflectionForDate === 'function' ? getReflectionForDate(dateKey) : null;
    const reflDot = refl
      ? `<div class="ml-refl-dot" title="Focus: ${refl.focus}/5 · Energy: ${refl.energy}/5"></div>`
      : '';
    return `<div class="ml-cell" data-date="${dateKey}"
                  title="${d} — ${hrs.toFixed(1)}h"
                  style="background:${mlHeatColor(hrs)};position:relative">${reflDot}</div>`;
  }).join('');

  calEl.innerHTML = `
    <div class="ml-nav">
      <button class="ml-nav-btn" id="mlPrev">←</button>
      <span class="ml-month-title">${monthName}</span>
      <button class="ml-nav-btn" id="mlNext">→</button>
    </div>
    <div class="ml-grid">
      ${dayLabels.map((d) => `<div class="ml-day-lbl">${d}</div>`).join('')}
      ${emptyCells}
      ${dayCells}
    </div>
    <div class="ml-legend">
      ${[
        [0, '0h'],
        [2, '2h'],
        [5, '5h'],
        [7, '7h+'],
      ]
        .map(
          ([v, l]) =>
            `<div class="ml-legend-item">
              <div class="ml-legend-swatch" style="background:${mlHeatColor(v + 0.1)}"></div>
              <span>${l}</span>
            </div>`
        )
        .join('')}
    </div>`;

  // Cell click → navigate to that day and switch to the Log view
  calEl.querySelectorAll('.ml-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      wlLog.info('monthlyLog: cell clicked, navigating', { dateKey: cell.dataset.date });
      viewDate = new Date(cell.dataset.date + 'T12:00:00');
      _mlActive = false;
      setFlowView('log');
      render();
    });
  });

  // Month navigation — module-level _mlYear / _mlMonth advance, then re-render.
  document.getElementById('mlPrev')?.addEventListener('click', () => {
    _mlMonth--;
    if (_mlMonth < 0) {
      _mlMonth = 11;
      _mlYear--;
    }
    renderMonthlyLog();
  });
  document.getElementById('mlNext')?.addEventListener('click', () => {
    _mlMonth++;
    if (_mlMonth > 11) {
      _mlMonth = 0;
      _mlYear++;
    }
    renderMonthlyLog();
  });
}

/**
 * Computes monthly summary statistics from a flat entries array. Pure: takes
 * its own data dependency, no DOM, no module globals. Excludes entries with
 * no `tsEnd` (still running) or `signifier === 'cancelled'`.
 * @param {Array<Object>} allEntries - The full entries array to filter.
 * @param {string} monthPrefix - Date prefix `YYYY-MM` used to select entries.
 * @param {function(Object): boolean} isBillable - Predicate identifying
 *   billable entries; the caller supplies the project's `isEntryBillable`.
 * @returns {{ totalMs: number, billableMs: number, topTag: (string|null) }}
 */
function calcMonthSummaryStats(allEntries, monthPrefix, isBillable) {
  const monthEntries = allEntries.filter(
    (e) => e.date.startsWith(monthPrefix) && e.tsEnd && e.signifier !== 'cancelled'
  );
  const totalMs = monthEntries.reduce((s, e) => s + (e.tsEnd - e.ts), 0);
  const billableMs = monthEntries.filter(isBillable).reduce((s, e) => s + (e.tsEnd - e.ts), 0);

  const tagTotals = {};
  monthEntries.forEach((e) => {
    tagTotals[e.tag] = (tagTotals[e.tag] || 0) + (e.tsEnd - e.ts);
  });
  const topTagEntry = Object.entries(tagTotals).sort((a, b) => b[1] - a[1])[0];

  return {
    totalMs,
    billableMs,
    topTag: topTagEntry ? topTagEntry[0] : null,
  };
}

/**
 * Computes open / done / migrated task counts for a given month. Pure.
 * `_migrated` (programmatic) and `signifier === 'migrated'` (BuJo marker)
 * both count toward the migrated total.
 * @param {Array<Object>} allTasks - The full plan-tasks array.
 * @param {string} monthPrefix - Date prefix `YYYY-MM` used to select tasks.
 * @returns {{ open: number, done: number, migrated: number }}
 */
function calcMonthTaskCounts(allTasks, monthPrefix) {
  const monthTasks = allTasks.filter((t) => t.date.startsWith(monthPrefix));
  return {
    open: monthTasks.filter((t) => t.status !== 'done').length,
    done: monthTasks.filter((t) => t.status === 'done').length,
    migrated: monthTasks.filter((t) => t.signifier === 'migrated' || t._migrated).length,
  };
}

/**
 * Renders the time-totals summary panel: total logged, billable, top category.
 * Writes its full HTML to `sumEl`. No event binding. Early-returns if `sumEl`
 * is absent so a partial DOM doesn't throw on innerHTML assignment.
 * @param {HTMLElement} sumEl - The `#mlSummary` container.
 * @param {string} monthPrefix - Date prefix `YYYY-MM` used to filter entries.
 * @returns {void}
 */
function renderMonthlySummary(sumEl, monthPrefix) {
  if (!sumEl) return;
  const { totalMs, billableMs, topTag } = calcMonthSummaryStats(
    entries,
    monthPrefix,
    isEntryBillable
  );

  sumEl.innerHTML = `
    <div class="ml-sum-title">Summary</div>
    <div class="ml-sum-row"><span>Total logged</span><span>${fmtDur(totalMs)}</span></div>
    <div class="ml-sum-row"><span>Billable</span><span class="ml-sum-blue">${fmtDur(billableMs)}</span></div>
    ${topTag ? `<div class="ml-sum-row"><span>Top category</span><span>${escHtml(getCatLabel(topTag))}</span></div>` : ''}`;
}

/**
 * Renders the task-inventory panel: open / done / migrated counts plus
 * a "Run Migration" button. Writes its full HTML to `taskEl` and binds
 * the button to `openMigration()` if that helper is loaded. Early-returns
 * if `taskEl` is absent so a partial DOM doesn't throw on innerHTML.
 * @param {HTMLElement} taskEl - The `#mlTasks` container.
 * @param {string} monthPrefix - Date prefix `YYYY-MM` used to filter plan tasks.
 * @returns {void}
 */
function renderMonthlyTasks(taskEl, monthPrefix) {
  if (!taskEl) return;
  const { open, done, migrated } = calcMonthTaskCounts(planTasks, monthPrefix);

  taskEl.innerHTML = `
    <div class="ml-sum-title">Task inventory</div>
    <div class="ml-sum-row"><span>Open</span><span class="ml-sum-amber">${open}</span></div>
    <div class="ml-sum-row"><span>Done</span><span class="ml-sum-green">${done}</span></div>
    <div class="ml-sum-row"><span>Migrated</span><span class="ml-sum-muted">${migrated}</span></div>
    <button class="add-btn ml-migrate-btn" id="mlRunMigration">→ Run Migration</button>`;

  document.getElementById('mlRunMigration')?.addEventListener('click', () => {
    if (typeof openMigration === 'function') openMigration();
  });
}

/**
 * Orchestrates the Monthly Log view: resolves DOM targets and delegates
 * each panel to a single-purpose renderer.
 * @returns {void}
 */
function renderMonthlyLog() {
  const calEl = document.getElementById('mlCalendar');
  const sumEl = document.getElementById('mlSummary');
  const taskEl = document.getElementById('mlTasks');
  if (!calEl) return;

  const monthPrefix = `${_mlYear}-${String(_mlMonth + 1).padStart(2, '0')}`;

  renderMonthlyCalendar(calEl, _mlYear, _mlMonth);
  renderMonthlySummary(sumEl, monthPrefix);
  renderMonthlyTasks(taskEl, monthPrefix);
}

/**
 * Bootstraps the Monthly Log feature.
 * The Monthly Log is now the "Month" tab in Today's Flow; its visibility and
 * rendering are driven by renderTodayFlow(). Month sync happens in initTodayFlow()
 * when the Month tab is clicked. This function is kept as a no-op so the call
 * site in 07-lifecycle.js does not need to change.
 * @returns {void}
 */
function initMonthlyLog() {
  // no-op: see initTodayFlow() in 11-timeflow.js
}
