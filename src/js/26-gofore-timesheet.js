/* ── Gofore timesheet submission (End of Day) ── */
// The browser cannot call timesheet.gofore.com (CORS + Microsoft SSO), so the
// entry goes to the local PowerShell server's /api/gofore-timesheet, which runs
// scripts/gofore-timesheet.mjs against a saved browser session.

/** Status-line suffix per submission route the server reports. */
const TIMESHEET_ROUTE_NOTE = {
  chrome: ' (via Claude in Chrome)',
  playwright: ' (via Playwright fallback)',
};

/**
 * Returns the given day's entries that have a positive tracked duration and
 * are not cancelled — the same filter the plaintext export uses.
 * @param {string} dateKey - Day to read, `YYYY-MM-DD`.
 * @returns {Array<Object>} Timed entries for that day.
 */
function timedEntriesForDay(dateKey) {
  return getEntries().filter(
    (entry) =>
      entry.date === dateKey &&
      entry.tsEnd &&
      entry.tsEnd > entry.ts &&
      entry.signifier !== 'cancelled'
  );
}

/**
 * Shows a status message under the timesheet form.
 * @param {string} message - Text to display.
 * @param {boolean} [isError] - Adds the error modifier class when true.
 */
function setTimesheetStatus(message, isError = false) {
  const statusEl = document.getElementById('eodTimesheetStatus');
  statusEl.textContent = message;
  statusEl.classList.toggle('eod-timesheet__status--error', isError);
}

/**
 * Fills the End of Day timesheet form with today's draft entry. With nothing
 * tracked the form is disabled rather than submitting an empty day.
 * @param {string} dateKey - Day being ended, `YYYY-MM-DD`.
 */
function renderEodTimesheet(dateKey) {
  const payload = buildTimesheetDayPayload(dateKey, timedEntriesForDay(dateKey), getCatLabel);
  const hoursEl = document.getElementById('eodTimesheetHours');
  const descEl = document.getElementById('eodTimesheetDesc');
  const submitBtn = document.getElementById('eodTimesheetSubmit');
  const copyBtn = document.getElementById('eodTimesheetCopy');
  hoursEl.value = payload ? String(payload.hours) : '';
  descEl.value = payload ? payload.description : '';
  hoursEl.dataset.date = dateKey;
  submitBtn.hidden = !GOFORE_SUBMIT_ENABLED;
  [hoursEl, descEl, submitBtn, copyBtn].forEach((el) => (el.disabled = !payload));
  setTimesheetStatus(payload ? '' : 'Nothing tracked today — no timesheet entry to draft.');
  wlLog.info(
    `renderEodTimesheet: ${payload ? `draft ${payload.hours}h for ${dateKey}` : 'no tracked time, form disabled'}`
  );
}

/**
 * Copies the description as currently edited in the form to the clipboard, so
 * it can be pasted into the timesheet by hand.
 * @returns {Promise<void>} Resolves once the status message is set.
 */
async function copyEodTimesheetDescription() {
  try {
    await navigator.clipboard.writeText(document.getElementById('eodTimesheetDesc').value);
    setTimesheetStatus('✅ Description copied');
  } catch (err) {
    wlLog.warn('copyEodTimesheetDescription: clipboard write failed', err);
    setTimesheetStatus('⚠ Could not copy — select the text and copy it manually', true);
  }
}

/**
 * Posts the (possibly edited) entry to the local server and reports the
 * outcome. An expired SSO session gets its own message with the fix.
 * @returns {Promise<void>} Resolves once the status message is set.
 */
async function submitEodTimesheet() {
  const hoursEl = document.getElementById('eodTimesheetHours');
  const submitBtn = document.getElementById('eodTimesheetSubmit');
  const body = {
    date: hoursEl.dataset.date,
    hours: Number(hoursEl.value),
    description: document.getElementById('eodTimesheetDesc').value.trim(),
  };
  const problem = findTimesheetEntryProblem(body);
  if (problem) {
    setTimesheetStatus(`⚠ ${problem}`, true);
    return;
  }
  submitBtn.disabled = true;
  setTimesheetStatus('⏳ Submitting…');
  try {
    const res = await fetch('/api/gofore-timesheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const route = TIMESHEET_ROUTE_NOTE[data.method] || '';
      setTimesheetStatus(`✅ Timesheet entry saved for ${body.date}${route}`);
      return;
    }
    wlLog.warn('submitEodTimesheet: server rejected the entry', res.status, data);
    setTimesheetStatus(`⚠ ${data.error || `Server returned ${res.status}`}`, true);
  } catch (err) {
    wlLog.warn('submitEodTimesheet: request failed', err);
    setTimesheetStatus('⚠ Could not reach the local server — is start-server.ps1 running?', true);
  } finally {
    submitBtn.disabled = false;
  }
}

document.getElementById('eodTimesheetSubmit').addEventListener('click', submitEodTimesheet);
document.getElementById('eodTimesheetCopy').addEventListener('click', copyEodTimesheetDescription);
