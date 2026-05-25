/* ── Pomodoro ── */
const POMO_CX = 100,
  POMO_CY = 100,
  POMO_R = 84;

let pomoDurMins = 5;
let pomoTotal = 300;
let pomoLeft = 300;
let pomoRunning = false;
let pomoInterval = null;

/**
 * Returns the angular gap (in radians) between pomodoro timer segments.
 * Smaller gaps are used for higher segment counts to keep them visually distinct.
 * @param {number} n - Number of segments (minutes).
 * @returns {number} Gap in radians.
 */
function pomoGap(n) {
  return n <= 6 ? 0.04 : n <= 12 ? 0.028 : 0.018;
}

/**
 * Builds an SVG path string for a pie-chart sector (filled segment).
 * @param {number} cx - Centre x coordinate.
 * @param {number} cy - Centre y coordinate.
 * @param {number} r  - Radius.
 * @param {number} a1 - Start angle in radians (0 = 12 o'clock).
 * @param {number} a2 - End angle in radians.
 * @returns {string} SVG path `d` attribute value.
 */
function sectorPath(cx, cy, r, a1, a2) {
  const x1 = cx + r * Math.sin(a1),
    y1 = cy - r * Math.cos(a1);
  const x2 = cx + r * Math.sin(a2),
    y2 = cy - r * Math.cos(a2);
  const large = a2 - a1 > Math.PI ? 1 : 0;
  return `M${cx} ${cy}L${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z`;
}

/**
 * Redraws all pomodoro SVG segments to reflect the current remaining time.
 * Each minute is a sector; filled sectors fade as time elapses.
 */
function drawPomoSegments() {
  const N = pomoDurMins;
  const pct = pomoTotal > 0 ? pomoLeft / pomoTotal : 0;
  const gap = pomoGap(N);
  const svg = document.getElementById('pomoSvg');
  const hole = document.getElementById('pomoHole');
  svg.querySelectorAll('.pomo-seg').forEach((e) => e.remove());

  for (let i = 0; i < N; i++) {
    const a1 = (i / N) * 2 * Math.PI + gap;
    const a2 = ((i + 1) / N) * 2 * Math.PI - gap;

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    bg.setAttribute('class', 'pomo-seg pomo-seg-bg');
    bg.setAttribute('d', sectorPath(POMO_CX, POMO_CY, POMO_R, a1, a2));
    svg.insertBefore(bg, hole);

    const lo = i / N,
      hi = (i + 1) / N;
    const elapsed = 1 - pct;
    const fill = elapsed >= hi ? 0 : elapsed > lo ? 1 - (elapsed - lo) / (hi - lo) : 1;
    if (fill > 0.001) {
      const fillStart = a1 + (a2 - a1) * (1 - fill);
      const fp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      fp.setAttribute('class', 'pomo-seg pomo-seg-fill');
      fp.setAttribute('d', sectorPath(POMO_CX, POMO_CY, POMO_R, fillStart, a2));
      svg.insertBefore(fp, hole);
    }
  }
}

/**
 * Initialises (or re-initialises) the pomodoro timer for the given duration.
 * Clears any running interval, resets state, and highlights the matching
 * duration button.
 * @param {number} mins - Session duration in minutes.
 */
function initPomo(mins) {
  clearInterval(pomoInterval);
  pomoInterval = null;
  pomoDurMins = mins;
  pomoTotal = mins * 60;
  pomoLeft = pomoTotal;
  pomoRunning = false;
  document
    .querySelectorAll('.pomo-dur')
    .forEach((b) => b.classList.toggle('active', +b.dataset.min === mins));
  updatePomoDisplay();
}

/**
 * Starts the pomodoro countdown. Resets to full duration if already at zero.
 * Fires {@link pomoDone} and clears the interval when time runs out.
 */
function startPomo() {
  if (pomoLeft === 0) initPomo(pomoDurMins);
  pomoRunning = true;
  updatePomoDisplay();
  pomoInterval = setInterval(() => {
    pomoLeft--;
    if (pomoLeft <= 0) {
      pomoLeft = 0;
      pomoRunning = false;
      clearInterval(pomoInterval);
      pomoInterval = null;
      pomoDone();
    }
    updatePomoDisplay();
  }, 1000);
}

/** Pauses the pomodoro timer without resetting the remaining time. */
function pausePomo() {
  pomoRunning = false;
  clearInterval(pomoInterval);
  pomoInterval = null;
  updatePomoDisplay();
}

/** Resets the pomodoro timer to the full configured duration without starting it. */
function resetPomo() {
  clearInterval(pomoInterval);
  pomoInterval = null;
  pomoLeft = pomoTotal;
  pomoRunning = false;
  updatePomoDisplay();
}

/**
 * Called when the pomodoro timer reaches zero. Plays the completion beep,
 * briefly animates the time display, and appends a session record to the
 * pomodoro log in localStorage.
 */
function pomoDone() {
  playPomoBeep();
  const t = document.getElementById('pomoTime');
  t.classList.add('done');
  setTimeout(() => t.classList.remove('done'), 2400);
  // Log the session
  const liveEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
  const log = pomoGetLog();
  log.unshift({ ts: Date.now(), mins: pomoDurMins, task: liveEntry ? liveEntry.text : null });
  localStorage.setItem(STORE_POMO_LOG, JSON.stringify(log.slice(0, 100)));
  renderPomoLog();
}

/**
 * Reads and validates the pomodoro session log from localStorage.
 * @returns {Array<{ts: number, mins: number, task: string|null}>} Session log entries.
 */
function pomoGetLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_POMO_LOG) || '[]');
    return Array.isArray(raw) ? raw.filter(validPomoEntry) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Renders the pomodoro session history list inside `#pomoLog`.
 * Shows date/time, duration, and the task that was active during each session.
 */
function renderPomoLog() {
  const log = pomoGetLog();
  const el = document.getElementById('pomoLog');
  if (!log.length) {
    el.innerHTML = '<div class="pomo-log-empty">no sessions yet</div>';
    return;
  }
  el.innerHTML = log
    .map((entry) => {
      const d = new Date(entry.ts);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const dateStr = isToday(d)
        ? `${hh}:${mm}`
        : `${d.toLocaleDateString('en', { month: 'short', day: 'numeric' })} ${hh}:${mm}`;
      const task = entry.task
        ? escHtml(entry.task)
        : '<span style="opacity:0.5">no active task</span>';
      return `<div class="pomo-log-entry">
        <span class="pomo-log-time">${dateStr}</span>
        <span class="pomo-log-dur">${entry.mins} min</span>
        <span class="pomo-log-task">${task}</span>
      </div>`;
    })
    .join('');
}

/**
 * Plays three short 660 Hz beeps spaced 350 ms apart using the Web Audio API
 * to signal pomodoro completion. Silently skips if Web Audio is unavailable.
 */
function playPomoBeep() {
  [0, 350, 700].forEach((delay) =>
    setTimeout(() => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(),
          gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 660;
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } catch (e) {}
    }, delay)
  );
}

/**
 * Refreshes the pomodoro timer display: updates the countdown text, redraws
 * segments, and sets the start/pause button label and status text to reflect
 * the current state (running / paused / done / ready).
 */
function updatePomoDisplay() {
  const mins = Math.floor(pomoLeft / 60),
    secs = pomoLeft % 60;
  document.getElementById('pomoTime').textContent =
    String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  drawPomoSegments();
  const startBtn = document.getElementById('pomoStart');
  const statusEl = document.getElementById('pomoStatus');
  if (pomoLeft === 0) {
    startBtn.textContent = 'start';
    startBtn.classList.remove('running');
    statusEl.textContent = 'done!';
  } else if (pomoRunning) {
    startBtn.textContent = 'pause';
    startBtn.classList.add('running');
    statusEl.textContent = 'focus';
  } else {
    startBtn.textContent = 'start';
    startBtn.classList.remove('running');
    statusEl.textContent = pomoLeft === pomoTotal ? 'ready' : 'paused';
  }
}

document.getElementById('pomoStart').addEventListener('click', () => {
  if (pomoRunning) pausePomo();
  else startPomo();
});
document.getElementById('pomoReset').addEventListener('click', resetPomo);
document.querySelectorAll('.pomo-dur').forEach((btn) => {
  btn.addEventListener('click', () => initPomo(+btn.dataset.min));
});
updatePomoDisplay();

/* ── New day detection ── */
/**
 * Generates a plaintext export of all log entries for the given date and
 * triggers a file download into the user's `timesheets/` folder.
 * Groups entries by task, totals tracked time, and prepends a header with
 * day start/end times and total workday duration.
 * @param {string} dateKey - Date string in YYYY-MM-DD format.
 */
function exportForDate(dateKey) {
  const dayEntries = entries
    .filter((e) => e.date === dateKey)
    .slice()
    .sort((a, b) => a.ts - b.ts);
  if (!dayEntries.length) return;
  const seen = new Set(),
    order = [],
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

  const fmtTsHM = (ts) => {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  const fmtDurMsL = (ms) => {
    const mins = Math.round(ms / 60000),
      h = Math.floor(mins / 60),
      m = mins % 60;
    return h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
  };

  const lines = order.map((key) => {
    const { label, tag, totalMs, hasTime } = grouped[key];
    const timeStr = hasTime ? fmtDurMsL(totalMs) : '--';
    return `${timeStr} - ${label} - ${getCatLabel(tag)}`;
  });

  const dayStartTs = Math.min(...dayEntries.map((e) => e.ts));
  const timedE = dayEntries.filter((e) => e.tsEnd && e.tsEnd > e.ts);
  const dayEndTs = timedE.length ? Math.max(...timedE.map((e) => e.tsEnd)) : null;
  const header = [`Work Log — ${dateKey}`];
  if (dayStartTs) {
    const endStr = dayEndTs ? fmtTsHM(dayEndTs) : '--:--';
    header.push(`Started: ${fmtTsHM(dayStartTs)}  |  Ended: ${endStr}`);
    if (dayEndTs) header.push(`Workday: ${fmtDurMsL(dayEndTs - dayStartTs)}`);
  }
  header.push('---');

  // Add Pomodoro sessions if any exist for this day
  let pomoLog = [];
  try {
    pomoLog = JSON.parse(localStorage.getItem(STORE_POMO_LOG) || '[]');
  } catch (e) {}
  const dayPomos = pomoLog.filter((p) => p.date === dateKey);
  if (dayPomos.length > 0) {
    lines.push('');
    lines.push('Pomodoro Sessions:');
    dayPomos.forEach((p) => {
      lines.push(
        `  ${p.time || '--:--'} - ${p.mins}min session - ${p.notes ? escHtml(p.notes) : 'no notes'}`
      );
    });
  }

  const blob = new Blob([[...header, ...lines].join('\n')], { type: 'text/plain' });
  writeExportFile('timesheets', `work-log-${dateKey}.txt`, blob);
}

/**
 * Formerly showed a "new day" banner prompting the user to export yesterday's log.
 * The banner was removed — end-of-day modal handles exports now.
 * Kept as a no-op stub to avoid removing the call sites.
 */
function checkNewDay() {
  // Banner removed — end-of-day modal handles exports now
}
