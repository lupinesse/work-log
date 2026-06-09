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
  renderHeroCard();
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
  renderHeroCard();
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
  renderHeroCard();
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
  // Enter the 6-second confirmation panel before clearing activeTimer so
  // heroEnterStopped() can snapshot the entry details.
  if (entry) heroEnterStopped(entry);
  activeTimer = null;
  _lastChimeMinute = null;
  save();
  render();
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
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // canvas blocked (e.g. privacy settings)
    ctx.beginPath();
    ctx.arc(16, 16, 13, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    link.href = canvas.toDataURL();
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
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const chimeFrequencies = [528, 660]; // two soft tones — a gentle rising pair
    chimeFrequencies.forEach((frequency, toneIndex) => {
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const toneStart = audioCtx.currentTime + toneIndex * 0.18;
      gainNode.gain.setValueAtTime(0, toneStart);
      gainNode.gain.linearRampToValueAtTime(0.18, toneStart + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, toneStart + 0.5);
      oscillator.start(toneStart);
      oscillator.stop(toneStart + 0.5);
    });
  } catch (e) {
    wlLog.warn('playChime: Web Audio API unavailable', e.message);
  }
}

/**
 * No-op: `#timerBar` was replaced by the Hero Card whose colour is driven by
 * CSS state-modifier classes (`hero-card--running`, `--paused`, etc.).
 * Kept so existing call-sites in `tickTimer` compile without changes.
 */
function updateTimerBarColor() {
  // Hero card colour is handled entirely by CSS — nothing to do here.
}

/**
 * Updates the SVG arc on the timer circle to reflect elapsed time relative to
 * the hyperfocus threshold. The arc fills 0→100% of the circle circumference
 * (2πr ≈ 150.8 px for r=24) as elapsed time goes from 0 to HYPERFOCUS_MINS.
 * @param {number} elapsedMs - Elapsed time in milliseconds.
 */
function updateTimerArc(elapsedMs) {
  const arc = document.getElementById('tbTickerArc');
  if (!arc) return;
  const circumference = 2 * Math.PI * 24; // r=24 → ≈150.796
  const fraction = Math.min(elapsedMs / (HYPERFOCUS_MINS * 60 * 1000), 1);
  const drawn = fraction * circumference;
  arc.setAttribute('stroke-dasharray', `${drawn.toFixed(2)} ${circumference.toFixed(2)}`);
  // Colour: green (#1D9E75 ≈ hsl 158,69,51) → red (#E74C3C ≈ hsl 5,72,57)
  const t = fraction;
  const hue = Math.round(158 - 153 * t);
  const sat = Math.round(69 + 3 * t);
  const lit = Math.round(51 + 6 * t);
  arc.setAttribute('stroke', `hsl(${hue},${sat}%,${lit}%)`);
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
    // Update hero card clock and header tracking total every tick
    heroUpdateClock();
    updateHeaderTracking();
    // Keep the task title element current for accessibility aria-live region
    const taskEl = document.getElementById('timerTask');
    if (taskEl) taskEl.innerHTML = entry ? jiraTicketHtml(entry.text) : '…';
    updateTimerArc(elapsed);
    updateLiveBlock();
    updateTabAndFavicon();
    const boardLiveClockEl = document.getElementById('boardLiveClock');
    if (boardLiveClockEl) boardLiveClockEl.textContent = fmtElapsed(elapsed);
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
  // #timerBar no longer exists — hero card replaces it.
  // Keep the pause-button label update so existing event listeners remain valid.
  const pauseBtn = document.getElementById('timerPause');
  const hookBtn = document.getElementById('timerHookBtn');
  if (!activeTimer) {
    if (hookBtn) hookBtn.disabled = true;
    return;
  }
  if (pauseBtn) pauseBtn.textContent = activeTimer.paused ? 'resume' : 'pause';
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

/* ── Banner controls (mood dropdown, note input, utility pills) ── */

/**
 * Saves a timestamped note attached to the currently-active timer entry.
 * The note is stored in logNotes (type: 'session-note') and rendered nested
 * under its parent entry in the flow/log views, rather than as a standalone
 * time-tracked entry.
 * No-ops when there is no active timer or the note is empty.
 */
function commitBannerNote() {
  const inp = document.getElementById('tbNoteInput');
  if (!inp) return;
  const note = inp.value.trim();
  if (!note || !activeTimer) return;

  const snTs = Date.now();
  logNotes.push({
    id: snTs + '-sn',
    text: note,
    ts: snTs,
    date: dk(new Date()),
    type: 'session-note',
    entryId: activeTimer.entryId,
  });
  saveLogNotes();
  inp.value = '';
  render();
  renderHeroCard();
}

/**
 * Logs a short well-known activity (break / lunch / meeting) as a new entry
 * while keeping the active timer running. The active timer is NOT stopped so
 * the user can resume without friction.
 * @param {'break'|'lunch'|'meeting'} kind - Activity type.
 */
function logUtilEntry(kind) {
  const labelMap = { break: '☕ Break', lunch: '🥪 Lunch', meeting: '📅 Meeting' };
  const tagMap = { break: 'other', lunch: 'other', meeting: 'meeting' };
  const text = labelMap[kind] || kind;
  const tag = tagMap[kind] || (categories[0] ? categories[0].id : 'other');

  const entry = {
    id: Date.now() + '',
    text,
    tag,
    ts: safeRoundedStart(),
    date: dk(new Date()),
  };
  entries.push(entry);
  save();
  render();
}

/**
 * Handles a mood selection from the banner dropdown. Records a distraction or
 * parked thought as an entry (for distracted/parked moods), triggers the hook
 * panel for 'interesting', and sets focus mode for 'focus'. Closes the panel
 * afterwards.
 * @param {string} mood - One of 'distracted' | 'parked' | 'focus' | 'interesting'.
 * @param {string} icon - Emoji icon for the mood.
 */
function handleMoodSelect(mood, icon) {
  const btnLabel = document.getElementById('tbMoodLabel');
  const btnIcon = document.getElementById('tbMoodIcon');
  if (btnLabel) btnLabel.textContent = mood;
  if (btnIcon) btnIcon.textContent = icon;

  // Close panel
  const panel = document.getElementById('tbMoodPanel');
  const btn = document.getElementById('tbMoodBtn');
  if (panel) panel.style.display = 'none';
  if (btn) btn.setAttribute('aria-expanded', 'false');

  if (mood === 'distracted') {
    // Re-use the existing distract button's handler by clicking it
    const distractBtn = document.getElementById('timerDistract');
    if (distractBtn) distractBtn.click();
  } else if (mood === 'parked') {
    // Show the park capture input
    const pb = document.getElementById('timerParkBtn');
    if (pb) pb.click();
  } else if (mood === 'interesting') {
    const hookBtn = document.getElementById('timerHookBtn');
    if (hookBtn && !hookBtn.disabled) hookBtn.click();
  } else if (mood === 'focus') {
    const emergBtn = document.getElementById('emergencyBtn');
    if (emergBtn) emergBtn.click();
  }
}

/**
 * Binds all interactive controls on the V5 timer banner:
 * mood dropdown, quick-note input, and Break / Lunch / Meeting utility pills.
 * Called once from `07-lifecycle.js` after DOMContentLoaded is guaranteed.
 */
function initBannerControls() {
  // ── Mood dropdown ──
  const moodBtn = document.getElementById('tbMoodBtn');
  const moodPanel = document.getElementById('tbMoodPanel');

  if (moodBtn && moodPanel) {
    moodBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = moodPanel.style.display !== 'none';
      moodPanel.style.display = open ? 'none' : 'block';
      moodBtn.setAttribute('aria-expanded', String(!open));
    });

    moodPanel.querySelectorAll('.tb-mood-item').forEach((item) => {
      item.addEventListener('click', () => {
        handleMoodSelect(item.dataset.mood, item.dataset.icon);
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!moodBtn.contains(e.target) && !moodPanel.contains(e.target)) {
        moodPanel.style.display = 'none';
        moodBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ── Quick-note input ──
  const noteInput = document.getElementById('tbNoteInput');
  if (noteInput) {
    noteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitBannerNote();
      }
      // Prevent Space from triggering the rapid-log overlay
      if (e.code === 'Space') e.stopPropagation();
    });
  }

  // ── Utility pills ──
  const breakBtn = document.getElementById('tbBreakBtn');
  const lunchBtn = document.getElementById('tbLunchBtn');
  const meetingBtn = document.getElementById('tbMeetingBtn');
  if (breakBtn) breakBtn.addEventListener('click', () => logUtilEntry('break'));
  if (lunchBtn) lunchBtn.addEventListener('click', () => logUtilEntry('lunch'));
  if (meetingBtn) meetingBtn.addEventListener('click', () => logUtilEntry('meeting'));
}
