/* ── Timer ── */

/**
 * Returns the total elapsed milliseconds for the active timer.
 * Accounts for accumulated time from previous pause/resume cycles.
 * Returns 0 if no timer is active.
 * @returns {number} Elapsed time in milliseconds.
 */
function getElapsedMs() {
  if (!activeTimer) return 0;
  const acc = activeTimer.accumulatedMs || 0;
  return activeTimer.paused ? acc : acc + (Date.now() - activeTimer.startTs);
}
/**
 * Starts (or restarts) the timer for the given entry.
 * Clears any existing interval, resets the chime state, and begins a 1-second
 * tick. Persists state and updates the UI immediately.
 * @param {string} entryId - ID of the log entry to time.
 */
function startTimer(entryId) {
  if (timerInterval) clearInterval(timerInterval);
  _lastChimeMinute = null;
  activeTimer = { entryId, startTs: Date.now(), accumulatedMs: 0, paused: false };
  save();
  timerInterval = setInterval(tickTimer, 1000); // set up BEFORE first tick so it always runs
  tickTimer();
  updateTimerBar();
  updateTimerBtn(true);
}
/**
 * Pauses the running timer, accumulating elapsed time so it can be resumed.
 * No-ops if no timer is active or it is already paused.
 */
function pauseTimer() {
  if (!activeTimer || activeTimer.paused) return;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  activeTimer.accumulatedMs = getElapsedMs();
  activeTimer.paused = true;
  activeTimer.startTs = null;
  save();
  updateTimerBar();
  updateTabAndFavicon();
}
/**
 * Resumes a paused timer from where it left off.
 * No-ops if no timer is active or it is not paused.
 */
function resumeTimer() {
  if (!activeTimer || !activeTimer.paused) return;
  activeTimer.paused = false;
  activeTimer.startTs = Date.now();
  save();
  timerInterval = setInterval(tickTimer, 1000);
  tickTimer();
  updateTimerBar();
}
/**
 * Stops the active timer, stamps the log entry with an end time (rounded to
 * the nearest 30 min for billable entries), clears `activeTimer`, and
 * triggers a full render. Resets the timer bar colour and closes the park
 * capture input if open. No-ops if no timer is active.
 */
function stopTimer() {
  if (!activeTimer) return;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  const entry = entries.find((e) => e.id === activeTimer.entryId);
  if (entry) entry.tsEnd = roundToNearest30IfBillable(entry.ts + getElapsedMs(), entry);
  activeTimer = null;
  _lastChimeMinute = null;
  save();
  render();
  const bar = document.getElementById('timerBar');
  if (bar) {
    bar.style.background = '';
    bar.style.borderColor = '';
  }
  const pulse = document.querySelector('.timer-pulse');
  if (pulse) pulse.style.background = '';
  // Close park capture if open
  const pc = document.getElementById('parkCapture');
  const pb = document.getElementById('timerParkBtn');
  if (pc) {
    pc.classList.remove('show');
    pc.value = '';
  }
  if (pb) pb.classList.remove('active');
  updateTabAndFavicon();
}
/**
 * Updates the live time-block element in the time-block view to reflect the
 * current elapsed time of the active timer. No-ops if the live block element
 * or the active timer's entry cannot be found.
 */
function updateLiveBlock() {
  const el = document.getElementById('tb-live-block');
  if (!el || !activeTimer) return;
  const entry = entries.find((e) => e.id === activeTimer.entryId);
  if (!entry) return;
  const tbStartMins = TB_START * 60,
    tbEndMins = TB_END * 60;
  const startMins = new Date(entry.ts).getHours() * 60 + new Date(entry.ts).getMinutes();
  const cStart = Math.max(startMins, tbStartMins);
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const endMins = Math.min(Math.max(nowMins, cStart + 1), tbEndMins);
  const hPx = Math.max(TB_SLOT_H * 0.5, ((endMins - cStart) / 30) * TB_SLOT_H);
  el.style.height = hPx + 'px';
  const sub = document.getElementById('tb-live-sub');
  if (sub) {
    const cat = getCat(entry.tag || 'other');
    const elapsedMins = Math.round(getElapsedMs() / 60000);
    const h = Math.floor(elapsedMins / 60),
      m = elapsedMins % 60;
    sub.textContent = cat.label + ' · ' + (h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`);
  }
}

// Favicon — drawn on a 32×32 canvas as a colored dot
const HYPERFOCUS_MINS = 90;
let _faviconState = null; // track last state to avoid redundant redraws

/**
 * Updates the browser favicon to a coloured dot reflecting the timer state.
 * Skips redundant redraws by tracking the last rendered state.
 * @param {'active'|'paused'|'hyperfocus'|'idle'} state - Current timer state.
 */
function setFavicon(state) {
  if (state === _faviconState) return;
  _faviconState = state;
  const colors = { active: '#1D9E75', paused: '#EF9F27', hyperfocus: '#E74C3C', idle: null };
  const color = colors[state];
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (!color) {
    link.href = '';
    return;
  }
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    if (!ctx) return; // canvas blocked (e.g. privacy settings)
    ctx.beginPath();
    ctx.arc(16, 16, 13, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    link.href = c.toDataURL();
  } catch (e) {} // silently skip favicon if canvas unavailable
}

/**
 * Synchronises the browser tab title and favicon with the current timer state.
 * Adds a ▶/⏸/🔴 prefix and shows the elapsed time and task name in the title.
 * Switches to hyperfocus state (red) after {@link HYPERFOCUS_MINS} minutes for
 * non-meeting tasks.
 */
function updateTabAndFavicon() {
  if (!activeTimer) {
    document.title = 'Work Log';
    setFavicon('idle');
    return;
  }
  const entry = entries.find((e) => e.id === activeTimer.entryId);
  const taskText = entry ? entry.text : '…';
  const elapsedMs = getElapsedMs();
  const elapsed = fmtElapsed(elapsedMs);
  const isMeeting = entry && entry.text.startsWith('📅');
  const isHyperfocus = !isMeeting && elapsedMs > HYPERFOCUS_MINS * 60 * 1000;

  if (activeTimer.paused) {
    document.title = `⏸ ${elapsed} — ${taskText}`;
    setFavicon('paused');
  } else if (isHyperfocus) {
    document.title = `🔴 ${elapsed} — ${taskText}`;
    setFavicon('hyperfocus');
  } else {
    document.title = `▶ ${elapsed} — ${taskText}`;
    setFavicon('active');
  }
}

/**
 * Computes the timer-bar accent colour, interpolating from green to red as
 * elapsed time approaches {@link HYPERFOCUS_MINS}.
 * Returns `null` when the timer is paused so CSS handles the paused state.
 * Colour shift: green (#1D9E75 = hsl 158,69,51) → red (#E74C3C = hsl 5,72,57).
 * @param {number}  elapsedMs - Elapsed time in milliseconds.
 * @param {boolean} paused    - Whether the timer is currently paused.
 * @returns {string|null} An HSL colour string, or null when paused.
 */
function timerBarColor(elapsedMs, paused) {
  if (paused) return null; // let CSS paused class handle it
  const t = Math.min(elapsedMs / (HYPERFOCUS_MINS * 60 * 1000), 1); // 0→1
  const hue = Math.round(158 - 153 * t); // 158 (green) → 5 (red)
  const sat = Math.round(69 + 3 * t); // 69% → 72%
  const lit = Math.round(51 + 6 * t); // 51% → 57%
  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

// Chime system
let CHIME_INTERVALS_MINS = [30]; // default, overridden by selector
let _lastChimeMinute = null;

function loadChimeSetting() {
  const saved = parseInt(localStorage.getItem('wl_chime_mins') || '30');
  CHIME_INTERVALS_MINS = saved > 0 ? [saved] : [];
  const sel = document.getElementById('chimeIntervalSel');
  if (sel) sel.value = String(saved);
}

document.getElementById('chimeIntervalSel').addEventListener('change', function () {
  const val = parseInt(this.value);
  CHIME_INTERVALS_MINS = val > 0 ? [val] : [];
  localStorage.setItem('wl_chime_mins', String(val));
  _lastChimeMinute = null; // reset so next interval fires fresh
});

/**
 * Fires an audible chime if the elapsed time has crossed a configured interval
 * boundary since the last chime. No-ops when the timer is paused.
 * @param {number} elapsedMs - Elapsed time in milliseconds.
 */
function checkChime(elapsedMs) {
  if (!activeTimer || activeTimer.paused) return;
  const elapsedMins = Math.floor(elapsedMs / 60000);
  if (elapsedMins === _lastChimeMinute) return;
  if (CHIME_INTERVALS_MINS.some((n) => elapsedMins > 0 && elapsedMins % n === 0)) {
    _lastChimeMinute = elapsedMins;
    playChime();
  }
}

/**
 * Plays two soft sine-wave tones (528 Hz then 660 Hz) using the Web Audio API
 * to signal an elapsed-time milestone. Silently skips if Web Audio is
 * unavailable (e.g. browser privacy settings).
 */
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const freq = [528, 660]; // two soft tones
    freq.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = f;
      const start = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      osc.start(start);
      osc.stop(start + 0.5);
    });
  } catch (e) {
    // Silently skip — Web Audio API may be unavailable (e.g. browser policy, no audio hardware)
  }
}

/**
 * Applies or clears the dynamic colour on the timer bar and pulse indicator.
 * When paused, removes inline styles so the CSS `.paused` class takes over.
 * When running, sets background and border to the hue computed by
 * {@link timerBarColor}.
 */
function updateTimerBarColor() {
  const bar = document.getElementById('timerBar');
  if (!bar || !activeTimer) return;
  if (activeTimer.paused) {
    // Let CSS handle paused state — remove inline styles
    bar.style.background = '';
    bar.style.borderColor = '';
    const pulse = bar.querySelector('.timer-pulse');
    if (pulse) pulse.style.background = '';
    return;
  }
  const color = timerBarColor(getElapsedMs(), false);
  // Derive a darker background from the same hue
  const t = Math.min(getElapsedMs() / (HYPERFOCUS_MINS * 60 * 1000), 1);
  const hue = Math.round(158 - 153 * t);
  bar.style.background = `hsl(${hue}, 60%, 8%)`;
  bar.style.borderColor = color;
  const pulse = bar.querySelector('.timer-pulse');
  if (pulse) pulse.style.background = color;
}

/**
 * Called every second by the timer interval. Updates the timer bar text,
 * the live time-block element, the tab title/favicon, the bar colour, and
 * checks whether a chime should fire. Also refreshes the focus-mode overlay
 * when it is open. Errors are caught and logged so a single bad tick cannot
 * stop the interval.
 */
function tickTimer() {
  try {
    if (!activeTimer) return;
    const entry = entries.find((e) => e.id === activeTimer.entryId);
    const elapsed = getElapsedMs();
    document.getElementById('timerBar').style.display = 'flex';
    document.getElementById('timerTask').textContent = entry ? entry.text : '…';
    document.getElementById('timerElapsed').textContent = fmtElapsed(elapsed);
    updateLiveBlock();
    updateTabAndFavicon();
    updateTimerBarColor();
    checkChime(elapsed);
    if (emergencyMode) {
      const emergEl = document.getElementById('emergencyTask');
      if (emergEl) emergEl.textContent = entry ? entry.text : '—';
      renderEmergencyCps();
    }
  } catch (e) {
    console.error('[wl] tickTimer error:', e);
  }
}
/**
 * Shows or hides the timer bar and updates the pause/resume button label.
 * Also enables or disables the "make it interesting" hook button.
 */
function updateTimerBar() {
  const bar = document.getElementById('timerBar');
  const pauseBtn = document.getElementById('timerPause');
  const hookBtn = document.getElementById('timerHookBtn');
  if (!activeTimer) {
    bar.style.display = 'none';
    if (hookBtn) hookBtn.disabled = true;
    return;
  }
  bar.style.display = 'flex';
  bar.classList.toggle('paused', activeTimer.paused);
  pauseBtn.textContent = activeTimer.paused ? 'resume' : 'pause';
  if (hookBtn) hookBtn.disabled = false;
}
/**
 * Updates the main start-timer button's label and disabled state.
 * @param {boolean} running - True if a timer is currently active.
 */
function updateTimerBtn(running) {
  const btn = document.getElementById('timerBtn');
  btn.disabled = running;
  btn.textContent = running ? '▶ timing…' : '▶ start';
}
/**
 * Called at startup to reconnect the tick interval when the app is reloaded
 * with an active timer persisted in localStorage. If the entry the timer was
 * tracking no longer exists the timer is cleared. No-ops if no timer is active.
 */
function resumeTimerIfActive() {
  if (!activeTimer) return;
  if (!entries.find((e) => e.id === activeTimer.entryId)) {
    if (
      entries.length > 0 ||
      !localStorage.getItem(STORE_ENTRIES) ||
      localStorage.getItem(STORE_ENTRIES) === '[]'
    ) {
      activeTimer = null;
      save();
    }
    return;
  }
  if (!activeTimer.paused) timerInterval = setInterval(tickTimer, 1000);
  tickTimer();
  updateTimerBar();
  updateTimerBtn(true);
}

// Refresh the "time by task" chart every 15 minutes while a timer runs so the
// active task's accumulated time appears in (near) real time. renderChart()
// decorates the active timer's entry with a synthetic tsEnd (= now or
// ts+accumulated for paused) so the bar grows without modifying stored data.
const CHART_REFRESH_MS = 15 * 60 * 1000;
setInterval(() => {
  if (!activeTimer) return;
  try {
    renderChart(viewEntries());
  } catch (e) {
    /* renderChart may not be ready on very first tick */
  }
}, CHART_REFRESH_MS);
