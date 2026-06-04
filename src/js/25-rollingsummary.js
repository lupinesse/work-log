/**
 * @file 25-rollingsummary.js — Rolling 7-day summary tab inside Today's Flow.
 *
 * Shows per-day rows (date · location · session times · tracked total · top 3 tasks)
 * and a week total. Includes a "Copy" button for standup use.
 *
 * Pure data calculation lives in buildRollingSummary (pure-fns.js) and is
 * unit-tested there. This module is the localStorage + DOM glue around it.
 */

/**
 * Returns the last `n` YYYY-MM-DD date keys ending at (and including) today,
 * ordered most-recent-first.
 * @param {number} [n=7]
 * @returns {string[]}
 */
function rollingDateKeys(n = 7) {
  const keys = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    keys.push(dk(d));
    d.setDate(d.getDate() - 1);
  }
  return keys;
}

/**
 * Reads the SOD timestamp for a date key from localStorage.
 * @param {string} dateKey
 * @returns {number|null}
 */
function summaryGetSodTs(dateKey) {
  return parseInt(localStorage.getItem('wl_sod_' + dateKey) || '0') || null;
}

/**
 * Reads the EOD timestamp for a date key from localStorage.
 * @param {string} dateKey
 * @returns {number|null}
 */
function summaryGetEodTs(dateKey) {
  return parseInt(localStorage.getItem('wl_eod_' + dateKey) || '0') || null;
}

/**
 * Resolves the location emoji for a date key using the stored location map.
 * @param {string} dateKey
 * @returns {string}
 */
function summaryGetLocationEmoji(dateKey) {
  const loc = locationFor(loadLocationMap(), dateKey);
  return WORK_LOCATIONS[loc].emoji;
}

/**
 * Formats a YYYY-MM-DD date key as a short day-of-week + date label.
 * e.g. '2026-06-04' → 'Wed 04 Jun'
 * @param {string} dateKey
 * @returns {string}
 */
function fmtDateLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${DAYS[date.getDay()]} ${String(d).padStart(2, '0')} ${MONTHS[m - 1]}`;
}

/**
 * Builds the plain-text standup block from computed rows and copies it to the
 * clipboard. Shows a brief "Copied!" confirmation on success, or logs a warning
 * on failure.
 * @param {object[]} rows - Output of buildRollingSummary.
 * @param {number} weekTotalMs - Sum of all days' tracked time in ms.
 * @returns {void}
 */
function copySummaryText(rows, weekTotalMs) {
  const locationMap = loadLocationMap();
  const lines = rows
    .filter((r) => r.sodTs || r.totalMs > 0)
    .map((row) => {
      const locLabel = WORK_LOCATIONS[locationFor(locationMap, row.dateKey)].label;
      const sodStr = row.sodTs ? fmtHm(row.sodTs) : '—';
      const eodStr = row.eodTs ? fmtHm(row.eodTs) : '—';
      const totalStr = row.totalMs > 0 ? fmtDur(row.totalMs) : '—';
      let line = `${row.locationEmoji} ${fmtDateLabel(row.dateKey)} ${locLabel} · ${sodStr}–${eodStr} · ${totalStr}`;
      if (row.topTasks.length) {
        const tasks = row.topTasks.map((t) => `${t.text} (${fmtDur(t.totalMs)})`).join(', ');
        line += `\n  ${tasks}`;
      }
      return line;
    });

  if (weekTotalMs > 0) lines.push(`\nWeek total: ${fmtDur(weekTotalMs)}`);

  const text = lines.join('\n');
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const fb = document.getElementById('rsCopyFeedback');
      if (fb) {
        fb.textContent = 'Copied!';
        setTimeout(() => {
          fb.textContent = '';
        }, 2000);
      }
    })
    .catch((err) => {
      wlLog.warn('copySummaryText: clipboard write failed', err);
    });
}

/**
 * Renders the 7-day rolling summary into #tfSummaryPane.
 * No-ops when the pane element is absent (e.g. reduced test DOM).
 * @returns {void}
 */
function renderRollingSummary() {
  const el = document.getElementById('tfSummaryPane');
  if (!el) return;

  const dateKeys = rollingDateKeys(7);
  const rows = buildRollingSummary(dateKeys, {
    entries,
    getDayStartTs: summaryGetSodTs,
    getDayEodTs: summaryGetEodTs,
    getLocationEmoji: summaryGetLocationEmoji,
  });

  const weekTotalMs = rows.reduce((sum, r) => sum + r.totalMs, 0);

  const rowsHtml = rows
    .map((row) => {
      const sodStr = row.sodTs ? fmtHm(row.sodTs) : '—';
      const eodStr = row.eodTs ? fmtHm(row.eodTs) : '—';
      const totalStr = row.totalMs > 0 ? fmtDur(row.totalMs) : '—';
      const hasData = !!(row.sodTs || row.totalMs > 0);

      const tasksHtml = row.topTasks.length
        ? row.topTasks
            .map(
              (t) =>
                `<span class="rs-task">${escHtml(t.text)}<span class="rs-task-dur"> ${fmtDur(t.totalMs)}</span></span>`
            )
            .join('')
        : '<span class="rs-no-tasks">no tracked entries</span>';

      return `<div class="rs-row${hasData ? '' : ' rs-row--empty'}">
        <div class="rs-row-head">
          <span class="rs-emoji" aria-hidden="true">${row.locationEmoji}</span>
          <span class="rs-date">${fmtDateLabel(row.dateKey)}</span>
          <span class="rs-session">${sodStr} – ${eodStr}</span>
          <span class="rs-total">${totalStr}</span>
        </div>
        <div class="rs-tasks" aria-label="Top tasks">${tasksHtml}</div>
      </div>`;
    })
    .join('');

  el.innerHTML = `<div class="rs-wrap">
    <div class="rs-rows">${rowsHtml}</div>
    <div class="rs-week-total">Week total: <strong>${fmtDur(weekTotalMs)}</strong></div>
    <button type="button" class="rs-copy-btn" id="rsCopyBtn">📋 Copy for standup</button>
    <div class="rs-copy-feedback" id="rsCopyFeedback" aria-live="polite"></div>
  </div>`;

  document.getElementById('rsCopyBtn')?.addEventListener('click', () => {
    copySummaryText(rows, weekTotalMs);
  });
}
