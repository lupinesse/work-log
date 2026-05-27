/* ── Calendar (Outlook COM via local server) ── */

// CAL_ACCOUNT_LABELS is defined in 00-config.js
let _calMeetingsCache = null;

/**
 * Resolves a human-readable account label for an Outlook calendar account.
 * The PowerShell server sends the raw `DisplayName` which may be an email
 * address, a display name, or free-form company text. Tries three strategies
 * in order: exact match, email domain extraction, and substring match.
 * @param {string|null} account - Raw Outlook account identifier.
 * @returns {string|null} Display label (e.g. "LähiTapiola"), or null if unknown.
 */
function calAccountLabel(account) {
  if (!account) return null;
  const raw = String(account);
  const lower = raw.toLowerCase();

  // 1. Exact match (case-insensitive)
  for (const key of Object.keys(CAL_ACCOUNT_LABELS)) {
    if (key.toLowerCase() === lower) return CAL_ACCOUNT_LABELS[key];
  }
  // 2. Email-style: extract second-level domain (e.g. "x@gofore.com" → "gofore")
  const emailMatch = lower.match(/@([^.@\s]+)\./);
  if (emailMatch && CAL_ACCOUNT_LABELS[emailMatch[1]]) return CAL_ACCOUNT_LABELS[emailMatch[1]];
  // 3. Substring match (e.g. "Gofore Mailbox" contains "gofore")
  for (const key of Object.keys(CAL_ACCOUNT_LABELS)) {
    if (lower.includes(key.toLowerCase())) return CAL_ACCOUNT_LABELS[key];
  }
  return null;
}

/**
 * Renders the calendar meetings strip for today.
 * Sorts meetings by start time, marks past meetings grey/italic, pulses
 * ongoing meetings, and provides ▶ start and ✕ hide buttons per meeting.
 * @param {Array<Object>} meetings - Array of meeting objects from the PS server.
 */
function renderCalStrip(meetings) {
  const section = document.getElementById('calSection');
  const el = document.getElementById('calMeetings');
  const countEl = document.getElementById('calCount');
  if (!section || !el) return;
  // Sort by start time regardless of calendar source
  if (Array.isArray(meetings))
    meetings = [...meetings].sort((a, b) => new Date(a.start) - new Date(b.start));

  if (!meetings || meetings.length === 0) {
    section.style.display = '';
    el.innerHTML = '<div class="cal-empty">No meetings today</div>';
    if (countEl) countEl.textContent = '';
    return;
  }

  const now = new Date();
  const fmtTime = (d) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const upcoming = meetings.filter((ev) => new Date(ev.end) > now).length;
  if (countEl) countEl.textContent = upcoming ? `${upcoming} upcoming` : '';

  el.innerHTML = meetings
    .map((ev, idx) => {
      const start = new Date(ev.start);
      const end = new Date(ev.end);
      const isPast = end < now;
      const isNow = start <= now && end > now;
      const cls = isNow ? 'now' : isPast ? 'past' : '';
      const dur = `<span class="cal-meeting-dur">${fmtDur(end - start)}</span>`;
      const join = ev.joinUrl
        ? `<a class="cal-meeting-join" href="${escHtml(ev.joinUrl)}" target="_blank" rel="noopener">Join</a>`
        : '';
      const label = calAccountLabel(ev.account);
      const acct = label ? `<span class="cal-account-label">[${escHtml(label)}]</span>` : '';
      const taskBtn = `<button class="cal-task-btn" data-subject="${escHtml(ev.subject)}">▶ start</button>`;
      const deleteBtn = `<button class="cal-delete-btn" data-meeting-idx="${idx}" title="Hide this meeting">✕</button>`;
      return `<div class="cal-meeting ${cls}">
        <span class="cal-meeting-time">${fmtTime(start)}</span>
        <span class="cal-meeting-title">${escHtml(ev.subject)}</span>
        ${acct} ${dur} ${join} ${taskBtn} ${deleteBtn}
      </div>`;
    })
    .join('');

  // Wire up "▶ start" buttons
  el.querySelectorAll('.cal-task-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const subject = btn.dataset.subject;
      const todayKey = dk(new Date());
      // Meetings always default to the "meeting" category. Try the default id first,
      // then any category whose label matches; fall back to selectedTag if absent.
      const meetingCat =
        categories.find((c) => c.id === 'meeting') ||
        categories.find((c) => (c.label || '').toLowerCase() === 'meeting') ||
        null;
      const meetingTag = meetingCat ? meetingCat.id : selectedTag;
      const exists = planTasks.find(
        (t) => t.date === todayKey && t.text.toLowerCase() === subject.toLowerCase()
      );
      if (!exists) {
        planTasks.push({
          id: Date.now() + '',
          text: subject,
          status: 'todo',
          date: todayKey,
          tag: meetingTag,
        });
        savePlan();
      }
      if (activeTimer) stopTimer();
      const entry = {
        id: Date.now() + '',
        text: subject,
        tag: meetingTag,
        ts: safeRoundedStart(),
        date: todayKey,
      };
      entries.push(entry);
      const task = planTasks.find(
        (t) => t.date === todayKey && t.text.toLowerCase() === subject.toLowerCase()
      );
      if (task && task.status === 'todo') {
        task.status = 'inprogress';
        savePlan();
      }
      viewDate = new Date();
      save();
      startTimer(entry.id);
      render();
    });
  });

  // Wire up delete buttons
  const todayKey = dk(new Date());
  const hiddenMeetings = (() => {
    try {
      return JSON.parse(localStorage.getItem('wl_hidden_meetings_' + todayKey) || '[]');
    } catch (e) {
      return [];
    }
  })();

  el.querySelectorAll('.cal-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.meetingIdx);
      const meeting = meetings[idx];
      if (meeting) {
        // Add to hidden list
        if (!hiddenMeetings.includes(meeting.subject)) {
          hiddenMeetings.push(meeting.subject);
          localStorage.setItem('wl_hidden_meetings_' + todayKey, JSON.stringify(hiddenMeetings));
        }
        // Remove from display
        btn.closest('.cal-meeting').style.opacity = '0.5';
        btn.closest('.cal-meeting').style.textDecoration = 'line-through';
        btn.disabled = true;
        btn.textContent = '✓';
      }
    });
  });

  section.style.display = '';

  // Collapsible header
  const hdr = document.getElementById('calHeader');
  if (hdr && !hdr._calBound) {
    hdr._calBound = true;
    hdr.addEventListener('click', () => section.classList.toggle('collapsed'));
  }
}

/**
 * Fetches today's meetings from the local PowerShell proxy (`/api/calendar`),
 * caches the result, filters out user-hidden meetings, and calls
 * {@link renderCalStrip}. Logs a warning and shows a fallback message on error.
 * @returns {Promise<void>}
 */
async function fetchAndRenderCalendar() {
  try {
    const res = await fetch('/api/calendar');
    if (!res.ok) throw new Error(`Server ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    _calMeetingsCache = data;

    // Filter out hidden meetings for today
    const todayKey = dk(new Date());
    const hiddenMeetings = (() => {
      try {
        return JSON.parse(localStorage.getItem('wl_hidden_meetings_' + todayKey) || '[]');
      } catch (e) {
        return [];
      }
    })();
    const filteredData = data.filter((m) => !hiddenMeetings.includes(m.subject));

    renderCalStrip(filteredData);
  } catch (err) {
    console.warn('[wl] Calendar unavailable:', err.message);
    const el = document.getElementById('calMeetings');
    if (el)
      el.innerHTML = `<div class="cal-empty" title="${escHtml(err.message)}">📅 Calendar unavailable — restart server with Outlook open</div>`;
    const sec = document.getElementById('calSection');
    if (sec) sec.style.display = '';
  }
}

// ── Transition bridge (Feature 3) ──
const STORE_SEEN_ENDED = 'wl_seen_ended_v1';

/**
 * Returns the set of meeting keys (`subject|start`) that have already triggered
 * a bridge banner in this session, loaded from localStorage.
 * @returns {Set<string>}
 */
function getSeenEnded() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORE_SEEN_ENDED) || '[]'));
  } catch (e) {
    return new Set();
  }
}
/**
 * Persists the set of seen-ended meeting keys to localStorage.
 * @param {Set<string>} s - Updated set to persist.
 */
function setSeenEnded(s) {
  localStorage.setItem(STORE_SEEN_ENDED, JSON.stringify([...s]));
}

/**
 * Returns a stable string key for a meeting used to deduplicate bridge banners.
 * @param {{subject: string, start: string}} m - Meeting object.
 * @returns {string}
 */
function getMeetingKey(m) {
  return `${m.subject}|${m.start}`;
}

let bannerQueue = [];
let bannerShowing = false;

/**
 * Shows the post-meeting bridge banner for the given meeting.
 * Queues the meeting if another banner is already visible.
 * @param {{subject: string, start: string, end: string}} meeting - The ended meeting.
 */
function showBridgeBanner(meeting) {
  if (bannerShowing) {
    bannerQueue.push(meeting);
    return;
  }
  bannerShowing = true;
  const banner = document.getElementById('newdayBanner');
  const msg = document.getElementById('newdayMsg');
  const expanded = document.getElementById('newdayExpanded');
  const bridgeBtn = document.getElementById('newdayBridgeBtn');
  const dismissBtn = document.getElementById('newdayDismiss');
  if (!banner || !msg) {
    bannerShowing = false;
    return;
  }

  msg.textContent = `Just finished "${meeting.subject || '(untitled)'}" — build a bridge to your next thing?`;
  expanded.innerHTML = '';
  expanded.style.display = 'none';
  banner.classList.add('show');

  const onDismiss = () => {
    banner.classList.remove('show');
    bannerShowing = false;
    if (bannerQueue.length) showBridgeBanner(bannerQueue.shift());
  };
  dismissBtn.onclick = onDismiss;
  bridgeBtn.onclick = async (e) => {
    e.stopPropagation();
    await buildBridge(meeting, expanded, bridgeBtn, onDismiss);
  };
}

/**
 * Determines the next task to transition to and delegates to {@link fetchBridge}.
 * If multiple tasks are in-flight the user picks from a list; a single in-progress
 * task is auto-selected; the only remaining task is auto-selected.
 * @param {{subject: string}} meeting  - The meeting that just ended.
 * @param {HTMLElement} expandedEl     - Container for the bridge content.
 * @param {HTMLElement} bridgeBtn      - "Build bridge" button (disabled during fetch).
 * @param {Function}    onDismiss      - Callback to dismiss the banner.
 * @returns {Promise<void>}
 */
async function buildBridge(meeting, expandedEl, bridgeBtn, onDismiss) {
  const todayKey = dk(new Date());
  const notDone = planTasks.filter((t) => t.date === todayKey && t.status !== 'done');
  const inProgress = notDone.filter((t) => t.status === 'inprogress');

  let nextTask = null;
  if (inProgress.length) {
    nextTask = inProgress[0];
  } else if (notDone.length === 1) {
    nextTask = notDone[0];
  } else if (notDone.length > 1) {
    expandedEl.innerHTML = '<div style="font-size:11px;margin-bottom:6px">Pick next task:</div>';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    notDone.forEach((t) => {
      const b = document.createElement('button');
      b.style.cssText =
        'font-size:11px;padding:4px 8px;background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--radius);cursor:pointer;text-align:left;color:var(--text2)';
      b.textContent = t.text;
      b.onclick = async () => {
        list.style.display = 'none';
        await fetchBridge(meeting, t, expandedEl, bridgeBtn, onDismiss);
      };
      list.appendChild(b);
    });
    expandedEl.appendChild(list);
    expandedEl.style.display = 'block';
    return;
  }

  if (!nextTask) {
    expandedEl.textContent = 'No next task found for today.';
    expandedEl.style.display = 'block';
    return;
  }
  await fetchBridge(meeting, nextTask, expandedEl, bridgeBtn, onDismiss);
}

/**
 * Calls the Claude API via `/api/ai` to generate 3 concrete physical steps for
 * transitioning from the ended meeting to the next task. Displays the result in
 * `expandedEl`; falls back to copying the prompt to the clipboard on API error.
 * @param {{subject: string}} meeting  - The meeting that just ended.
 * @param {{text: string}}    task     - The next plan task to transition to.
 * @param {HTMLElement} expandedEl     - Container for the bridge content.
 * @param {HTMLElement} bridgeBtn      - "Build bridge" button (disabled during fetch).
 * @param {Function}    onDismiss      - Callback to dismiss the banner.
 * @returns {Promise<void>}
 */
async function fetchBridge(meeting, task, expandedEl, bridgeBtn, onDismiss) {
  const meetingSubject = meeting.subject || '(untitled)';
  const taskText = task.text || '(untitled)';
  const prompt = `Meeting just finished: "${meetingSubject}"\nNext task to start: "${taskText}"\n\nProvide exactly 3 concrete physical steps to transition from this meeting to starting the task. Each step specific and actionable. Total time: ~3 min. No preamble, no numbering, no labels, plain text only.`;

  expandedEl.innerHTML = '<div style="font-size:11px;color:var(--text3)">thinking…</div>';
  expandedEl.style.display = 'block';
  bridgeBtn.disabled = true;

  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system:
          'You help ADHD users switch between tasks smoothly. Reply with exactly 3 concrete physical steps, no preamble, no numbering, no labels. Plain text separated by line breaks.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    const bridgeText = data.content?.[0]?.text || '';
    if (!bridgeText) throw new Error('No content in response');
    expandedEl.textContent = bridgeText;
  } catch (err) {
    navigator.clipboard.writeText(prompt).catch(() => {});
    expandedEl.innerHTML =
      '<span style="color:var(--red,#e74c3c)">AI unavailable — prompt copied to clipboard. (Set AnthropicApiKey in config.local.ps1)</span>';
  }
  bridgeBtn.disabled = false;
}

// Fetch from server every 10 minutes; re-render from cache every minute
// so past/now/upcoming states update without hammering the server
fetchAndRenderCalendar();
setInterval(fetchAndRenderCalendar, 10 * 60 * 1000);
setInterval(() => {
  if (!_calMeetingsCache) return;
  const todayKey = dk(new Date());
  const hiddenMeetings = (() => {
    try {
      return JSON.parse(localStorage.getItem('wl_hidden_meetings_' + todayKey) || '[]');
    } catch (e) {
      return [];
    }
  })();
  const filteredData = _calMeetingsCache.filter((m) => !hiddenMeetings.includes(m.subject));
  renderCalStrip(filteredData);

  // Detect newly-ended meetings and offer a bridge
  const seen = getSeenEnded();
  const now = new Date();
  filteredData.forEach((m) => {
    const key = getMeetingKey(m);
    const endTime = new Date(m.end);
    if (endTime > now || seen.has(key)) return;
    seen.add(key);
    const nextTooSoon = filteredData.some((other) => {
      const diff = (new Date(other.start) - endTime) / 60000;
      return diff > 0 && diff < 10;
    });
    if (!nextTooSoon) showBridgeBanner(m);
  });
  setSeenEnded(seen);
}, 60 * 1000);

loadParked();
renderParked();

// Test harness — only active when ?test=1 in URL
if (new URLSearchParams(window.location.search).get('test') === '1') {
  window.__wl = {
    roundToNearest30,
    dk,
    getISOWeek,
    totalISOWeeks,
    entries,
    categories,
    planTasks,
    blocks,
    activeTimer: () => activeTimer,
    load,
    save,
    savePlan,
    loadPlan,
    loadParked,
    autoCarryTasks,
    patchCarriedTasks,
    render,
    renderPlan,
    renderCompleted,
    renderCalStrip,
    renderParked,
    openEodModal,
    parkedThoughts,
    startTimer,
    stopTimer,
    pauseTimer,
    getCat,
    escHtml,
    renderDistractionCount,
    getIterationExpiry,
    loadExpiryDates,
    exportTxt,
    exportBackup,
    importBackup,
    validateBackupFile,
    getHook,
    saveHook,
    _showBridgeBanner: showBridgeBanner,
    getState: () => ({ entries, categories, planTasks, blocks, activeTimer, logNotes, trackers }),
    cycleSignifier,
    isEntryBillable,
    addLogNote,
    openReflection,
    getReflectionForDate,
    openSprintSetup,
    getSprintLog: () => sprintLog,
    renderTrackers,
    trackerDayStatus,
    saveTrackers,
    getTrackers: () => trackers,
    renderMonthlyLog,
    mlHoursForDay,
    openMigration,
    getMigrationRecord,
  };
  // Live viewDate getter/setter so tests can change the view date
  // and renderCompleted re-runs automatically
  Object.defineProperty(window.__wl, 'viewDate', {
    get: () => viewDate,
    set: (v) => {
      viewDate = v instanceof Date ? v : new Date(v);
      renderCompleted();
    },
    enumerable: true,
    configurable: true,
  });
}
