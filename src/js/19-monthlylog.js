// ── 19-monthlylog.js — Monthly Log heatmap + task inventory ──

let _mlYear = new Date().getFullYear();
let _mlMonth = new Date().getMonth(); // 0-indexed
let _mlActive = false;

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
 * @param {HTMLElement} calEl - The `#mlCalendar` container.
 * @param {number} year - Full year to render.
 * @param {number} month - Month index, 0-based.
 * @returns {void}
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

  // Cell click → navigate to that day and close the monthly log
  calEl.querySelectorAll('.ml-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      viewDate = new Date(cell.dataset.date + 'T12:00:00');
      document.getElementById('monthlyLogSection').style.display = 'none';
      _mlActive = false;
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
 * Renders the time-totals summary panel: total logged, billable, top category.
 * Writes its full HTML to `sumEl`. No event binding.
 * @param {HTMLElement} sumEl - The `#mlSummary` container.
 * @param {string} monthPrefix - Date prefix `YYYY-MM` used to filter entries.
 * @returns {void}
 */
function renderMonthlySummary(sumEl, monthPrefix) {
  const monthEntries = entries.filter(
    (e) => e.date.startsWith(monthPrefix) && e.tsEnd && e.signifier !== 'cancelled'
  );
  const totalMs = monthEntries.reduce((s, e) => s + (e.tsEnd - e.ts), 0);
  const billableMs = monthEntries
    .filter((e) => isEntryBillable(e))
    .reduce((s, e) => s + (e.tsEnd - e.ts), 0);

  const tagTotals = {};
  monthEntries.forEach((e) => {
    tagTotals[e.tag] = (tagTotals[e.tag] || 0) + (e.tsEnd - e.ts);
  });
  const topTagEntry = Object.entries(tagTotals).sort((a, b) => b[1] - a[1])[0];

  sumEl.innerHTML = `
    <div class="ml-sum-title">Summary</div>
    <div class="ml-sum-row"><span>Total logged</span><span>${fmtDur(totalMs)}</span></div>
    <div class="ml-sum-row"><span>Billable</span><span class="ml-sum-blue">${fmtDur(billableMs)}</span></div>
    ${topTagEntry ? `<div class="ml-sum-row"><span>Top category</span><span>${escHtml(getCatLabel(topTagEntry[0]))}</span></div>` : ''}`;
}

/**
 * Renders the task-inventory panel: open / done / migrated counts plus
 * a "Run Migration" button. Writes its full HTML to `taskEl` and binds
 * the button to `openMigration()` if that helper is loaded.
 * @param {HTMLElement} taskEl - The `#mlTasks` container.
 * @param {string} monthPrefix - Date prefix `YYYY-MM` used to filter plan tasks.
 * @returns {void}
 */
function renderMonthlyTasks(taskEl, monthPrefix) {
  const monthTasks = planTasks.filter((t) => t.date.startsWith(monthPrefix));
  const open = monthTasks.filter((t) => t.status !== 'done').length;
  const done = monthTasks.filter((t) => t.status === 'done').length;
  const migrated = monthTasks.filter((t) => t.signifier === 'migrated' || t._migrated).length;

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
 * Uses event delegation on `document` to handle clicks on the tab button
 * (which is rebuilt by render() and cannot be bound directly). Toggles the
 * section visibility and syncs the heatmap to the currently viewed month.
 * Called once on DOMContentLoaded.
 * @returns {void}
 */
function initMonthlyLog() {
  // Button lives inside tl.innerHTML (rebuilt on every render) — use delegation
  document.addEventListener('click', (e) => {
    if (e.target.id !== 'tabMonthlyLog') return;
    _mlActive = !_mlActive;
    const section = document.getElementById('monthlyLogSection');
    if (section) section.style.display = _mlActive ? '' : 'none';
    if (_mlActive) {
      // Sync to viewed month when opening
      _mlYear = viewDate.getFullYear();
      _mlMonth = viewDate.getMonth();
      renderMonthlyLog();
    }
    render();
  });
}
