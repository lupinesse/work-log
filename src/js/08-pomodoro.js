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
  svg.querySelectorAll('.pomo-seg').forEach((seg) => seg.remove());

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
    .forEach((btn) => btn.classList.toggle('active', +btn.dataset.min === mins));
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
  const liveEntry = activeTimer ? entries.find((entry) => entry.id === activeTimer.entryId) : null;
  const log = pomoGetLog();
  log.unshift({ ts: Date.now(), mins: pomoDurMins, task: liveEntry ? liveEntry.text : null });
  localStorage.setItem(STORE_POMO_LOG, JSON.stringify(log.slice(0, 100)));
  renderPomoLog();
  if (typeof refreshPomoDashboard === 'function') refreshPomoDashboard();
  if (typeof notifyPomodoroEnd === 'function') notifyPomodoroEnd();
}

/**
 * Reads and validates the pomodoro session log from localStorage.
 * Invalid records are dropped and reported via wlLog.warn.
 * @returns {Array<{ts: number, mins: number, task: string|null}>} Session log entries.
 */
function pomoGetLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_POMO_LOG) || '[]');
    const all = Array.isArray(raw) ? raw : [];
    const valid = all.filter(validPomoEntry);
    if (valid.length < all.length)
      wlLog.warn(`pomoGetLog: dropped ${all.length - valid.length} invalid pomodoro record(s)`, {
        total: all.length,
        kept: valid.length,
      });
    return valid;
  } catch (err) {
    wlLog.error('pomoGetLog: failed to parse pomodoro log', err);
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
      } catch (err) {
        // Silently skip — Web Audio API may be unavailable (browser policy, no hardware)
      }
    }, delay)
  );
}

/**
 * Returns a progress-aware affirmation string based on elapsed time.
 * Default parameters let callers pass explicit values (useful for testing).
 * @param {number} [total] - Total session seconds; defaults to pomoTotal.
 * @param {number} [left] - Remaining seconds; defaults to pomoLeft.
 * @returns {string} Short motivational phrase.
 */
function pomoAffirmation(total = pomoTotal, left = pomoLeft) {
  if (total === 0) return '';
  const pct = Math.round(((total - left) / total) * 100);
  if (pct < 25) return `${pct}% in · stay with it`;
  if (pct < 50) return `${pct}% in · you're in the zone`;
  if (pct < 75) return `${pct}% in · keep going`;
  return `${pct}% in · almost there!`;
}

/**
 * Refreshes the pomodoro timer display: updates the countdown text, redraws
 * segments, sets the state-modifier class on the pomo-body, and updates
 * button labels and status text to reflect the current state.
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
    if (statusEl) statusEl.textContent = 'done!';
  } else if (pomoRunning) {
    startBtn.textContent = 'pause';
    startBtn.classList.add('running');
    if (statusEl) statusEl.textContent = 'focus';
  } else {
    startBtn.textContent = 'start';
    startBtn.classList.remove('running');
    if (statusEl) statusEl.textContent = pomoLeft === pomoTotal ? 'ready' : 'paused';
  }

  const bodyEl = document.getElementById('pomoBody');
  if (bodyEl) {
    const state = pomoRunning ? 'running' : pomoLeft === 0 ? 'done' : 'idle';
    bodyEl.classList.remove('pomo--running', 'pomo--done', 'pomo--idle');
    bodyEl.classList.add(`pomo--${state}`);
  }

  const affEl = document.getElementById('pomoAffirmation');
  if (affEl) affEl.textContent = pomoRunning ? pomoAffirmation() : '';

  if (pomoRunning) {
    setPomoFavicon();
  } else {
    const _pomoFaviconEl = document.querySelector("link[rel~='icon'][data-pomo]");
    if (_pomoFaviconEl) _pomoFaviconEl.remove();
  }

  if (typeof updatePomoTaskLabel === 'function') updatePomoTaskLabel();
}

/**
 * Redraws the browser favicon as a depleting wedge mirroring the remaining
 * pomodoro time. Silently skips when the canvas API is unavailable.
 */
function setPomoFavicon() {
  let link = document.querySelector("link[rel~='icon'][data-pomo]");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.setAttribute('data-pomo', '1');
    document.head.appendChild(link);
  }
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const cx = 16,
      cy = 16,
      r = 14;

    const cs = getComputedStyle(document.documentElement);
    const colEmpty = cs.getPropertyValue('--pomo-spark-empty').trim() || '#e8edf4';
    const colFill = cs.getPropertyValue('--pomo-spark-fill').trim() || '#c62828';
    const colBg = cs.getPropertyValue('--bg').trim() || '#ffffff';

    // Background ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fillStyle = colEmpty;
    ctx.fill();

    // Wedge — remaining fraction, clockwise from 12 o'clock
    const pct = pomoTotal > 0 ? pomoLeft / pomoTotal : 0;
    if (pct > 0) {
      const start = -Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + pct * 2 * Math.PI);
      ctx.closePath();
      ctx.fillStyle = colFill;
      ctx.fill();
    }

    // Centre hole
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.52, 0, 2 * Math.PI);
    ctx.fillStyle = colBg;
    ctx.fill();

    link.href = c.toDataURL('image/png');
  } catch (err) {} // silently skip if canvas blocked by browser policy
}

/**
 * Adds 120 seconds to the current running session without resetting segments.
 * No-op if the timer is not running.
 */
function pomoAddTime() {
  if (!pomoRunning) return;
  pomoLeft += 120;
  pomoTotal += 120;
  updatePomoDisplay();
}

/**
 * Ends the session early, logs a partial session, and transitions to done state.
 * Records the elapsed minutes (minimum 1) so the session appears in the log.
 */
function pomoTapOut() {
  clearInterval(pomoInterval);
  pomoInterval = null;
  pomoRunning = false;
  const partialMins = Math.max(1, Math.ceil((pomoTotal - pomoLeft) / 60));
  pomoLeft = 0;
  const liveEntry = activeTimer ? entries.find((entry) => entry.id === activeTimer.entryId) : null;
  const log = pomoGetLog();
  log.unshift({ ts: Date.now(), mins: partialMins, task: liveEntry ? liveEntry.text : null });
  localStorage.setItem(STORE_POMO_LOG, JSON.stringify(log.slice(0, 100)));
  renderPomoLog();
  if (typeof refreshPomoDashboard === 'function') refreshPomoDashboard();
  updatePomoDisplay();
}

document.getElementById('pomoStart').addEventListener('click', () => {
  if (pomoRunning) pausePomo();
  else startPomo();
});
document.getElementById('pomoReset').addEventListener('click', resetPomo);
document.querySelectorAll('.pomo-dur').forEach((btn) => {
  btn.addEventListener('click', () => initPomo(+btn.dataset.min));
});

const _pomoPlus2 = document.getElementById('pomoPlus2');
if (_pomoPlus2) _pomoPlus2.addEventListener('click', pomoAddTime);

const _pomoTapOut = document.getElementById('pomoTapOut');
if (_pomoTapOut) _pomoTapOut.addEventListener('click', pomoTapOut);

const _pomoAnother5 = document.getElementById('pomoAnother5');
if (_pomoAnother5)
  _pomoAnother5.addEventListener('click', () => {
    initPomo(5);
    startPomo();
  });

const _pomoBreather = document.getElementById('pomoBreather');
if (_pomoBreather)
  _pomoBreather.addEventListener('click', () => {
    initPomo(1);
    startPomo();
  });

const _pomoDismiss = document.getElementById('pomoDismiss');
if (_pomoDismiss) _pomoDismiss.addEventListener('click', () => initPomo(pomoDurMins));

updatePomoDisplay();

/* ── New day detection ── */

/**
 * Formerly showed a "new day" banner prompting the user to export yesterday's log.
 * The banner was removed — end-of-day modal handles exports now.
 * Kept as a no-op stub to avoid removing the call sites.
 */
function checkNewDay() {
  // Banner removed — end-of-day modal handles exports now
}
