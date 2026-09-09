/* ── Calendar (Outlook COM via local server) ── */

// CAL_ACCOUNT_LABELS is defined in 00-config.js
let _calMeetingsCache = null;

/** localStorage key prefix for the meetings a user has hidden on a given day. */
const HIDDEN_MEETINGS_PREFIX = 'wl_hidden_meetings_';

/**
 * Reads the occurrence keys of the meetings hidden for one day.
 * @param {string} dayKey - Day key from `dk()`, e.g. '2026-09-01'.
 * @returns {string[]} Stored keys, or an empty array if none are stored.
 */
function readHiddenMeetingKeys(dayKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(HIDDEN_MEETINGS_PREFIX + dayKey) || '[]');
    if (Array.isArray(stored)) return stored;
    wlLog.warn('readHiddenMeetingKeys: stored value is not an array — ignoring it', stored);
    return [];
  } catch (err) {
    wlLog.warn('readHiddenMeetingKeys: stored value is not valid JSON — ignoring it', err);
    return [];
  }
}

/**
 * Hides one meeting for the rest of the day.
 *
 * Stores the occurrence key rather than the subject, so hiding one instance of a
 * recurring meeting leaves that day's other instances on the strip.
 *
 * @param {string} dayKey - Day key from `dk()`.
 * @param {{subject: string, start: string}} meeting - The meeting to hide.
 * @returns {void}
 */
function hideMeetingForDay(dayKey, meeting) {
  const key = calendarMeetingKey(meeting);
  const keys = readHiddenMeetingKeys(dayKey);
  if (keys.includes(key)) return;
  keys.push(key);
  localStorage.setItem(HIDDEN_MEETINGS_PREFIX + dayKey, JSON.stringify(keys));
}

/**
 * Drops the meetings the user has hidden today.
 * @param {Array<Object>} meetings - Validated meetings from the calendar API.
 * @returns {Array<Object>} The meetings still to be shown.
 */
function visibleMeetings(meetings) {
  const hidden = readHiddenMeetingKeys(dk(new Date()));
  return meetings.filter((meeting) => !isMeetingHidden(meeting, hidden));
}

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

  // Populate the collapsed-state next-meeting summary
  const nextInfoEl = document.getElementById('calNextInfo');
  if (nextInfoEl) {
    const nextMeeting = meetings.find((ev) => new Date(ev.end) > now);
    if (nextMeeting) {
      const start = new Date(nextMeeting.start);
      const timeStr = fmtTime(start);
      const maxLen = 28;
      const subject = nextMeeting.subject || '';
      const title = subject.length > maxLen ? subject.slice(0, maxLen) + '…' : subject;
      nextInfoEl.textContent = `${timeStr} · ${title}`;
    } else {
      nextInfoEl.textContent = '';
    }
  }

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
  el.querySelectorAll('.cal-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const meeting = meetings[parseInt(btn.dataset.meetingIdx, 10)];
      if (!meeting) return;
      hideMeetingForDay(todayKey, meeting);
      // Show it as struck through until the next render drops it entirely
      btn.closest('.cal-meeting').style.opacity = '0.5';
      btn.closest('.cal-meeting').style.textDecoration = 'line-through';
      btn.disabled = true;
      btn.textContent = '✓';
    });
  });

  section.style.display = '';
  // Restore stored collapse state the first time the section is shown.
  // The flag prevents re-applying on subsequent re-renders.
  if (!section._collapseRestored) {
    section._collapseRestored = true;
    section.classList.toggle('collapsed', readCollapseState('calSection', false));
  }

  // Collapsible header
  const hdr = document.getElementById('calHeader');
  if (hdr && !hdr._calBound) {
    hdr._calBound = true;
    hdr.addEventListener('click', () => {
      section.classList.toggle('collapsed');
      writeCollapseState('calSection', section.classList.contains('collapsed'));
    });
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
    if (!Array.isArray(data)) {
      wlLog.warn('fetchAndRenderCalendar: response is not an array — skipping render', data);
      return;
    }
    // Normalise first: an untitled Outlook appointment arrives with no subject,
    // which the validator would reject even though its times are perfectly good.
    const meetings = data.map(normalizeCalendarMeeting);
    const invalidMeetings = meetings.filter((m) => !validCalendarMeeting(m));
    if (invalidMeetings.length) {
      wlLog.warn(
        `fetchAndRenderCalendar: dropped ${invalidMeetings.length} malformed meeting(s)`,
        invalidMeetings
      );
    }
    const validMeetings = meetings.filter(validCalendarMeeting);
    _calMeetingsCache = validMeetings;
    renderCalStrip(visibleMeetings(validMeetings));
  } catch (err) {
    console.warn('[wl] Calendar unavailable:', err.message);
    const el = document.getElementById('calMeetings');
    if (el)
      el.innerHTML = `<div class="cal-empty" title="${escHtml(err.message)}">📅 Calendar unavailable — restart server with Outlook open</div>`;
    const sec = document.getElementById('calSection');
    if (sec) sec.style.display = '';
  }
}

// Fetch from server every 10 minutes; re-render from cache every minute
// so past/now/upcoming states update without hammering the server
fetchAndRenderCalendar();
setInterval(fetchAndRenderCalendar, 10 * 60 * 1000);
setInterval(() => {
  if (!_calMeetingsCache) return;
  const filteredData = visibleMeetings(_calMeetingsCache);
  renderCalStrip(filteredData);
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
    calendarMeetingKey,
    isMeetingHidden,
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
    setFlowView,
    getFlowView,
    renderTodayFlow,
    initTodayFlow,
    findLargestGap,
    // Pomodoro — exposed for smoke tests
    initPomo,
    startPomo,
    pausePomo,
    pomoAddTime,
    pomoTapOut,
    // Header tracking — exposed for smoke tests
    updateHeaderTracking,
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
