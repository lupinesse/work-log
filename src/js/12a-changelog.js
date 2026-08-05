/* ── Dev changelog ── */

/**
 * Merges the hardcoded {@link DEV_CHANGES} array into the persisted dev log in
 * localStorage, adding only entries whose `id` is not already stored.
 * Maintains chronological sort order by `id`.
 */
function mergeDevLog() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_DEV_LOG) || '[]');
    const storedIds = new Set(stored.map((change) => change.id));
    const newEntries = DEV_CHANGES.filter((change) => !storedIds.has(change.id));
    if (newEntries.length) {
      const merged = [...stored, ...newEntries].sort((a, b) => a.id.localeCompare(b.id));
      localStorage.setItem(STORE_DEV_LOG, JSON.stringify(merged));
    }
  } catch (err) {
    wlLog.warn('mergeDevChanges: failed to merge dev changelog entries', err);
  }
}

/**
 * Opens the end-of-day modal: auto-exports the time log and JSON backup, saves
 * the EOD timestamp, populates handoff notes for unfinished tasks, renders today's
 * dev changelog entries, and lists the test areas to review.
 */
function openEodModal() {
  const todayKey = dk(new Date());
  const d = new Date();
  const dateStr = d.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });

  // Auto-export
  exportTxt();
  exportBackup();
  localStorage.setItem('wl_last_export', todayKey);
  // Save EOD timestamp against today — ending the day is always a "now" action,
  // independent of which day is currently in view.
  const today = new Date();
  if (!getEodTs(today)) localStorage.setItem(eodKey(today), String(Date.now()));
  renderEodBtn();
  renderEodReminder();
  // Note: portable deploy is triggered by the "Done — close" button, NOT here,
  // so the JSON + .txt have time to flush to disk before the build script reads them.
  document.getElementById('eodExportStatus').innerHTML =
    `<div class="eod-exported">✅ Time log (.txt) and backup (.json) exported automatically</div>`;

  document.getElementById('eodSubtitle').textContent = dateStr;

  // Notes for tomorrow — only tasks that were actually worked on today
  const workedToday = new Set(
    entries
      .filter((entry) => entry.date === todayKey)
      .map((entry) => entry.text.toLowerCase().trim())
  );
  const unfinishedTasks = planTasks.filter(
    (task) =>
      task.date === todayKey &&
      task.status !== 'done' &&
      workedToday.has(task.text.toLowerCase().trim())
  );
  let handoffNotes = {};
  try {
    handoffNotes = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
  } catch (err) {
    // Silently fall back to empty object — existing notes are unavailable but EOD modal still works
    wlLog.warn('openEodModal: failed to parse wl_handoff', err);
  }
  const taskNotesEl = document.getElementById('eodTaskNotes');
  if (unfinishedTasks.length) {
    const statusLabel = {
      todo: 'to do',
      inprogress: 'in progress',
      pending: 'pending',
      blocked: 'blocked',
    };
    taskNotesEl.innerHTML = unfinishedTasks
      .map(
        (task) =>
          `<div class="eod-task-note-row">
          <span class="eod-task-note-label" title="${escHtml(task.text)}">${task.emoji ? escHtml(task.emoji) + ' ' : ''}${escHtml(task.text)}</span>
          <span class="eod-task-note-status ${task.status || 'todo'}">${statusLabel[task.status || 'todo'] || task.status}</span>
          <input class="eod-task-note-input" data-task="${escHtml(task.text.toLowerCase().trim())}"
            value="${escHtml(handoffNotes[task.text.toLowerCase().trim()] || '')}"
            placeholder="where to continue…" />
        </div>`
      )
      .join('');
  } else {
    taskNotesEl.innerHTML = `<div class="eod-empty">no tasks worked on today — or all done 🎉</div>`;
  }

  // Today's dev changes
  let allLog = [];
  try {
    allLog = JSON.parse(localStorage.getItem(STORE_DEV_LOG) || '[]');
  } catch (err) {
    wlLog.warn('openEodModal: failed to parse dev changelog from localStorage', err);
  }
  const todayChanges = allLog.filter((change) => change.date === todayKey);
  const changesEl = document.getElementById('eodChanges');
  if (todayChanges.length) {
    changesEl.innerHTML = todayChanges
      .map(
        (change) =>
          `<div class="eod-change">
          <span class="eod-change-desc">${escHtml(change.desc)}</span>
          <span class="eod-change-areas">${change.areas.length ? 'Test ' + change.areas.join(', ') : '—'}</span>
        </div>`
      )
      .join('');
  } else {
    changesEl.innerHTML = `<div class="eod-empty">No code changes logged today</div>`;
  }

  // Affected test areas (deduplicated)
  const affectedAreas = [...new Set(todayChanges.flatMap((change) => change.areas))].sort(
    (a, b) => a - b
  );
  const areasEl = document.getElementById('eodTestAreas');
  if (affectedAreas.length) {
    areasEl.innerHTML = affectedAreas
      .map(
        (areaNum) =>
          `<div class="eod-test-area">
          <span class="eod-test-num">#${areaNum}</span>
          <span>${escHtml(TEST_AREA_NAMES[areaNum] || 'Unknown')}</span>
        </div>`
      )
      .join('');
  } else {
    areasEl.innerHTML = `<div class="eod-empty">No test areas flagged for review</div>`;
  }

  // Copy to clipboard
  document.getElementById('eodCopyBtn').onclick = () => {
    const lines = [
      `End of day: ${dateStr}`,
      '',
      'Changes implemented:',
      ...todayChanges.map(
        (change) =>
          `  - ${change.desc}${change.areas.length ? ' (Test ' + change.areas.join(', ') + ')' : ''}`
      ),
      '',
      'Test areas to review:',
      ...affectedAreas.map((areaNum) => `  - Test ${areaNum}: ${TEST_AREA_NAMES[areaNum]}`),
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      const btn = document.getElementById('eodCopyBtn');
      btn.textContent = '✅ Copied!';
      setTimeout(() => (btn.textContent = '📋 copy to clipboard'), 2000);
    });
  };

  document.getElementById('eodOverlay').classList.add('show');
}

document.getElementById('eodBtn').addEventListener('click', () => {
  const ready = confirm(
    '📎 Before closing the day:\n\n' +
      "Have you shared work-log.html with Claude to log today's changes?\n\n" +
      'OK — yes, changes are logged, continue\n' +
      'Cancel — not yet, go back'
  );
  if (ready) openEodModal();
});
/**
 * Reads all handoff-note inputs in the EOD modal and persists their values to
 * the `wl_handoff` localStorage key. Empty values are removed from the map.
 */
function saveEodHandoffNotes() {
  try {
    const notes = JSON.parse(localStorage.getItem('wl_handoff') || '{}');
    document.querySelectorAll('.eod-task-note-input').forEach((inp) => {
      const key = inp.dataset.task;
      const val = inp.value.trim();
      if (val) notes[key] = val;
      else delete notes[key];
    });
    localStorage.setItem('wl_handoff', JSON.stringify(notes));
  } catch (err) {
    wlLog.warn('saveEodHandoffNotes: failed to persist handoff notes to localStorage', err);
  }
}
document.getElementById('expiryBtn').addEventListener('click', openExpiryModal);
document.getElementById('expirySave').addEventListener('click', saveExpiryDates);
document.getElementById('expiryCancel').addEventListener('click', () => {
  document.getElementById('expiryOverlay').classList.remove('show');
});
document.getElementById('expiryOverlay').addEventListener('click', (event) => {
  if (event.target === document.getElementById('expiryOverlay'))
    document.getElementById('expiryOverlay').classList.remove('show');
});
document.getElementById('expiryTextarea').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.stopPropagation();
  } // allow newlines
  if (event.key === 'Escape') document.getElementById('expiryOverlay').classList.remove('show');
});

document.getElementById('eodClose').addEventListener('click', () => {
  saveEodHandoffNotes();
  // Trigger portable deploy now — the export ran when the modal opened, so the
  // file system has had a few seconds to flush JSON + .txt to OneDrive before
  // the build script reads them.
  triggerPortableDeploy();
  document.getElementById('eodOverlay').classList.remove('show');
  renderPlan();
  openReflection();
});

/**
 * Fire-and-forget portable deploy: calls `POST /api/portable-deploy` to trigger
 * the PowerShell build script, then displays a transient top-right toast with the
 * result (success, failure, or server unreachable). Never throws.
 */
function triggerPortableDeploy() {
  const toast = document.createElement('div');
  toast.className = 'wl-toast wl-toast-info';
  toast.textContent = '⏳ Deploying portable build…';
  document.body.appendChild(toast);

  const setToast = (cls, text, lifetimeMs = 5000) => {
    toast.className = 'wl-toast ' + cls;
    toast.textContent = text;
    setTimeout(() => toast.remove(), lifetimeMs);
  };

  (async () => {
    let res;
    try {
      res = await fetch('/api/portable-deploy', { method: 'POST' });
    } catch (err) {
      setToast('wl-toast-err', '⚠ Portable deploy skipped: PS server unreachable');
      return;
    }
    const bodyText = await res.text().catch(() => '');
    let data = null;
    if (bodyText) {
      try {
        data = JSON.parse(bodyText);
      } catch {}
    }

    if (res.status === 404) {
      setToast(
        'wl-toast-err',
        '⚠ Portable deploy unavailable: restart PS server (.\\launch.bat) to pick up updated start-server.ps1'
      );
      return;
    }
    if (res.status === 503) {
      setToast('wl-toast-err', '⚠ Portable deploy skipped: PS server not running');
      return;
    }
    if (res.ok && data && data.ok) {
      const s = (data.durationMs / 1000).toFixed(1);
      setToast('wl-toast-ok', `📦 Portable deployed in ${s}s`, 4000);
      return;
    }
    const msg =
      data && (data.error || data.output)
        ? String(data.error || data.output).slice(0, 200)
        : bodyText
          ? bodyText.slice(0, 200)
          : `HTTP ${res.status} empty body`;
    setToast('wl-toast-err', `⚠ Portable deploy failed: ${msg}`, 8000);
  })();
}
document.getElementById('eodOverlay').addEventListener('click', (event) => {
  if (event.target === document.getElementById('eodOverlay')) {
    saveEodHandoffNotes();
    document.getElementById('eodOverlay').classList.remove('show');
    renderPlan();
  }
});
