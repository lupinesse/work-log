/* ── Start of day ── */

/**
 * Returns the localStorage key used to store today's start-of-day timestamp.
 * @returns {string} Key in the format `wl_sod_YYYY-MM-DD`.
 */
function sodKey() {
  return 'wl_sod_' + dk(new Date());
}
/**
 * Retrieves today's recorded start-of-day timestamp from localStorage.
 * @returns {number|null} Unix timestamp (ms), or null if not yet set.
 */
function getDayStart() {
  return parseInt(localStorage.getItem(sodKey()) || '0') || null;
}

/**
 * Updates the "start the day" button to show the recorded start time (if any)
 * or its default label. Colours the button green once a time is set.
 */
function renderSodBtn() {
  const btn = document.getElementById('sodBtn');
  if (!btn) return;
  const sod = getDayStart();
  if (sod) {
    const d = new Date(sod);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    btn.textContent = `🌅 started ${hh}:${mm}`;
    btn.style.color = '#1D9E75';
    btn.style.borderColor = '#1D9E75';
  } else {
    btn.textContent = '🌅 start the day';
    btn.style.color = '';
    btn.style.borderColor = '';
  }
}

document.getElementById('sodBtn').addEventListener('click', () => {
  const existing = getDayStart();
  if (existing) {
    // Day already started — allow the user to correct the start time.
    const d = new Date(existing);
    const cur =
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const val = prompt(`Started at (HH:MM):`, cur);
    if (!val) return;
    const [h, m] = val.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return;
    const ts = new Date();
    ts.setHours(h, m, 0, 0);
    localStorage.setItem(sodKey(), String(ts.getTime()));
    renderSodBtn();
    renderTimeblock();
  } else {
    // First click of the day — offer a chance to restore from backup before
    // recording start-of-day. The SOD timestamp is written first so it
    // survives the page reload that importBackup() triggers: the backup only
    // overwrites data keys (entries, tasks, …) and leaves wl_sod_* alone.
    const wantRestore = window.confirm(
      'Start of day — restore data from a backup first?\n\n' +
        'OK     → select a backup file to restore, then start the day\n' +
        'Cancel → start the day now without restoring'
    );
    localStorage.setItem(sodKey(), String(Date.now()));
    renderSodBtn();
    renderTimeblock();
    if (wantRestore) {
      // Trigger the hidden file input — the change listener calls importBackup()
      document.getElementById('backupFileInput').click();
    }
  }
});

/* ── End of day button state ── */

/**
 * Returns the localStorage key used to store today's end-of-day timestamp.
 * @returns {string} Key in the format `wl_eod_YYYY-MM-DD`.
 */
function eodKey() {
  return 'wl_eod_' + dk(new Date());
}

/**
 * Retrieves today's recorded end-of-day timestamp from localStorage.
 * @returns {number|null} Unix timestamp (ms), or null if not yet set.
 */
function getEodTs() {
  return parseInt(localStorage.getItem(eodKey()) || '0') || null;
}

/**
 * Updates the "end the day" button to show the recorded end time (if any)
 * or its default label, and dims the button once a time is set.
 */
function renderEodBtn() {
  const btn = document.getElementById('eodBtn');
  if (!btn) return;
  const eod = getEodTs();
  if (eod) {
    const d = new Date(eod);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    btn.textContent = `🌙 ended ${hh}:${mm}`;
    btn.style.opacity = '0.7';
  } else {
    btn.textContent = '🌙 end the day';
    btn.style.opacity = '';
  }
}

/* ── Pomodoro weekly clear ── */

/**
 * Clears the pomodoro log when a new ISO week begins.
 * Compares the stored week key against the current ISO week; if they differ,
 * the log is removed and the new week key is saved.
 */
function checkPomoWeeklyClear() {
  const now = new Date();
  const currentWeekKey = `${now.getFullYear()}-W${String(getISOWeek(now)).padStart(2, '0')}`;
  const storedWeek = localStorage.getItem('wl_pomo_week');
  if (storedWeek && storedWeek !== currentWeekKey) {
    localStorage.removeItem(STORE_POMO_LOG);
  }
  localStorage.setItem('wl_pomo_week', currentWeekKey);
}

/* ── Event listeners ── */

// Backup restore: the hidden file input is triggered from the SOD button flow.
// The change handler calls importBackup() and resets the input so the same
// file can be re-selected if needed (e.g. user cancels and retries).
document.getElementById('backupFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) importBackup(file);
  e.target.value = '';
});

document.getElementById('addBtn').addEventListener('click', () => addEntry(false));
document.getElementById('timerBtn').addEventListener('click', () => addEntry(true));
document.getElementById('captureInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addEntry(false);
});
document.getElementById('timerPause').addEventListener('click', () => {
  if (activeTimer && activeTimer.paused) resumeTimer();
  else pauseTimer();
});
initRapid();
initDailyLog();
initMonthlyLog();
initMigration();
initSprints();
initTrackers();

document.getElementById('prevDay').addEventListener('click', () => {
  viewDate = new Date(viewDate);
  viewDate.setDate(viewDate.getDate() - 1);
  render();
});
document.getElementById('nextDay').addEventListener('click', () => {
  if (isToday(viewDate)) return;
  viewDate = new Date(viewDate);
  viewDate.setDate(viewDate.getDate() + 1);
  render();
});

/* ── Auto-backup ── */

/**
 * Writes a recoverable snapshot of today's log entries to localStorage every
 * 30 minutes.  The snapshot contains both a human-readable plaintext summary
 * and the raw entry/category arrays so data can be recovered after accidental
 * clearing.  No-ops when there are no entries for today.
 *
 * Assumption: 30 minutes is an acceptable data-loss window for a personal work
 * log used in a single browser tab. Browser crashes, accidental page reloads,
 * and mis-clicks on "clear data" are the main risks; all are adequately covered
 * by a 30-minute recovery point. If higher durability is needed, reduce the
 * interval in the setInterval call in 07-lifecycle.js.
 */
function saveSnapshot() {
  const todayKey = dk(new Date());
  const dayEntries = entries
    .filter((e) => e.date === todayKey)
    .slice()
    .sort((a, b) => a.ts - b.ts);
  if (!dayEntries.length) return;
  const order = [],
    grouped = {};
  dayEntries.forEach((e) => {
    const key = e.text.toLowerCase();
    if (!grouped[key]) {
      order.push(key);
      grouped[key] = { label: e.text, tag: e.tag, totalMs: 0, hasTime: false };
    }
    if (e.tsEnd && e.tsEnd > e.ts) {
      grouped[key].totalMs += e.tsEnd - e.ts;
      grouped[key].hasTime = true;
    }
  });
  const lines = order.map((key) => {
    const { label, tag, totalMs, hasTime } = grouped[key];
    let timeStr;
    if (hasTime) {
      const mins = Math.round(totalMs / 60000),
        h = Math.floor(mins / 60),
        m = mins % 60;
      timeStr = h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
    } else {
      timeStr = '--';
    }
    return `${timeStr} - ${label} - ${getCatLabel(tag)}`;
  });
  localStorage.setItem(
    'wl_snapshot',
    JSON.stringify({
      date: todayKey,
      text: lines.join('\n'),
      entries: entries,
      categories: categories,
    })
  );
}

saveSnapshot();
setInterval(saveSnapshot, 30 * 60 * 1000);

// Defer config log one tick so `planTasks` (declared in 10-tasks.js, which is
// concatenated after this file) has been initialised before we read its length.
// The IIFE runs all files synchronously; setTimeout(fn, 0) fires after that
// synchronous block completes, so all let/const declarations are in scope.
setTimeout(() => {
  wlLog.config({
    version: '1.8.2',
    date: dk(new Date()),
    // Persistent state counts (from localStorage after load + migration)
    entries: entries.length,
    categories: categories.length,
    planTasks: planTasks.length,
    blocks: blocks.length,
    // Runtime state
    timer: activeTimer ? 'active' : 'idle',
    snapshot: !!localStorage.getItem('wl_snapshot'),
    // Environment: true when the PS API server responded (weather / calendar live)
    apiServer: !!localStorage.getItem('wl_api_ok'),
  });
}, 0);
