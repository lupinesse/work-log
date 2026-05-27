/* ── Entry add ── */

/**
 * Creates a new log entry from the capture input's current value.
 * Optionally starts the timer on the new entry (`withTimer = true`), in which
 * case any running timer is stopped first and the matching plan task is
 * auto-promoted to "in progress".
 * @param {boolean} withTimer - If true, start the timer on the new entry.
 */
function addEntry(withTimer) {
  const inp = document.getElementById('captureInput');
  const text = inp.value.trim();
  if (!text) {
    inp.focus();
    return;
  }
  if (withTimer && activeTimer) stopTimer();
  const entry = {
    id: Date.now() + '',
    text,
    tag: selectedTag,
    ts: safeRoundedStart(),
    date: dk(new Date()),
  };
  entries.push(entry);
  inp.value = '';
  viewDate = new Date();
  save();
  if (withTimer) {
    // Auto In progress on matching plan task
    const todayKey = dk(new Date());
    const task = planTasks.find(
      (t) => t.date === todayKey && t.text.toLowerCase() === text.toLowerCase()
    );
    if (task && task.status === 'todo') {
      task.status = 'inprogress';
      savePlan();
    }
    startTimer(entry.id);
  }
  render();
  inp.focus();
}

/* ── Export ── */

/**
 * Determines whether a log entry is billable, using a three-tier lookup:
 * 1. The entry's own `billable` flag (if explicitly set).
 * 2. The matching plan task's `billable` flag.
 * 3. The category default.
 *
 * Assumption: entries and tasks where `billable` is `undefined` are treated as
 * billable by default. This preserves backward compatibility with data created
 * before the billable flag was introduced — older entries must not silently
 * disappear from billing reports after an upgrade.
 * If the default should change to non-billable, a migration of existing
 * localStorage data is required (see DATA.md § wl_entries).
 *
 * @param {Object} e - Log entry object.
 * @returns {boolean} True if the entry should be counted as billable.
 */
function isEntryBillable(e) {
  if (e.signifier === 'cancelled') return false;
  if (e.billable !== undefined) return e.billable;
  const t = planTasks.find((t) => t.text.toLowerCase().trim() === e.text.toLowerCase().trim());
  // `!== false` (not `=== true`) — undefined means billable (see Assumption above).
  if (t) return t.billable !== false;
  // Same `!== false` convention for categories — undefined → billable.
  return getCat(e.tag || 'other').billable !== false;
}

/**
 * Exports the currently viewed day's log as a plaintext file.
 * Groups entries by category and task, includes a header with day start/end
 * times and tracked time totals, and appends a pasteable billable summary.
 * Writes to the user's chosen save folder via the File System Access API,
 * or falls back to a browser download.
 */
function exportTxt() {
  const dayEntries = viewEntries().slice().reverse();
  if (!dayEntries.length) return;

  const dateStr = dk(viewDate);
  const isViewingToday = dateStr === dk(new Date());

  // Day start/end
  let dayStartTs = isViewingToday ? getDayStart() : null;
  if (!dayStartTs && dayEntries.length) dayStartTs = Math.min(...dayEntries.map((e) => e.ts));
  const timedEntries = dayEntries.filter(
    (e) => e.tsEnd && e.tsEnd > e.ts && e.signifier !== 'cancelled'
  );
  let dayEndTs = timedEntries.length ? Math.max(...timedEntries.map((e) => e.tsEnd)) : null;
  // Factor in the active timer's effective end so "Ended:" reflects live work
  if (activeTimer && isViewingToday) {
    const timerEntry = dayEntries.find((e) => e.id === activeTimer.entryId);
    if (timerEntry) {
      const liveEnd = activeTimer.paused
        ? timerEntry.ts + (activeTimer.accumulatedMs || 0) // paused → start + accumulated
        : Math.max(Date.now(), activeTimer.startTs || timerEntry.ts); // running → now (or startTs if test setup is ahead of wall clock)
      dayEndTs = dayEndTs ? Math.max(dayEndTs, liveEnd) : liveEnd;
    }
  }

  const fmtTsHM = (ts) => {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  const fmtDurMs = (ms) => {
    const mins = Math.round(ms / 60000),
      h = Math.floor(mins / 60),
      m = mins % 60;
    return h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
  };

  // Group by category, then by task (preserving first-seen order)
  const catOrder = [];
  const catGrouped = {};
  dayEntries.forEach((e) => {
    const catKey = e.tag || 'other';
    const taskKey = e.text.toLowerCase();
    if (!catGrouped[catKey]) {
      catOrder.push(catKey);
      catGrouped[catKey] = { totalMs: 0, tasks: {}, taskOrder: [] };
    }
    if (!catGrouped[catKey].tasks[taskKey]) {
      catGrouped[catKey].taskOrder.push(taskKey);
      catGrouped[catKey].tasks[taskKey] = { label: e.text, totalMs: 0, hasTime: false };
    }
    if (e.tsEnd && e.tsEnd > e.ts) {
      const ms = e.tsEnd - e.ts;
      catGrouped[catKey].totalMs += ms;
      catGrouped[catKey].tasks[taskKey].totalMs += ms;
      catGrouped[catKey].tasks[taskKey].hasTime = true;
    }
  });

  const lines = [];
  catOrder.forEach((catKey) => {
    const { totalMs, tasks, taskOrder } = catGrouped[catKey];
    const catTimeStr = totalMs > 0 ? fmtDurMs(totalMs) : '--';
    lines.push(`${catTimeStr} - ${getCatLabel(catKey)}`);
    taskOrder.forEach((taskKey) => {
      const { label, totalMs: tMs, hasTime } = tasks[taskKey];
      const taskTimeStr = hasTime ? fmtDurMs(tMs) : '--';
      lines.push(`    ${taskTimeStr} - ${label}`);
    });
  });

  // Billable / non-billable breakdown
  const totalTrackedMs = timedEntries.reduce((s, e) => s + (e.tsEnd - e.ts), 0);
  const billableMs = timedEntries
    .filter((e) => isEntryBillable(e))
    .reduce((s, e) => s + (e.tsEnd - e.ts), 0);
  const nonBillableMs = totalTrackedMs - billableMs;

  const header = [`Work Log — ${dateStr}`];
  if (dayStartTs) {
    const startStr = fmtTsHM(dayStartTs);
    const endStr = dayEndTs ? fmtTsHM(dayEndTs) : '--:--';
    header.push(`Started: ${startStr}  |  Ended: ${endStr}`);
    if (dayEndTs) header.push(`Workday: ${fmtDurMs(dayEndTs - dayStartTs)}`);
  }
  if (totalTrackedMs > 0) {
    header.push(
      `Total tracked: ${fmtDurMs(totalTrackedMs)}  |  💰 Billable: ${fmtDurMs(billableMs)}  |  💸 Non-billable: ${fmtDurMs(nonBillableMs)}`
    );
  }
  header.push('---');

  // Pasteable billable summary — last line of the file
  // Format: "Category (task1, task2), uncategorised-task"
  const stripJira = (t) => t.replace(/^[A-Z][A-Z0-9]*-\d+[:\s]\s*/, '').trim();
  const billableTimed = timedEntries.filter((e) => isEntryBillable(e));
  // Merge same-task entries that are separated by ≤30 minutes into a single block.
  // Rationale: 30 min is the billing rounding unit — splitting a task at a gap
  // shorter than one slot would produce two entries that each round to the same
  // half-hour anyway, while making the billable summary harder to read.
  const mergeForExport = (arr) => {
    const sorted = [...arr].sort((a, b) => a.ts - b.ts);
    const out = [];
    for (const e of sorted) {
      const prev = out[out.length - 1];
      if (
        prev &&
        prev.text.toLowerCase() === e.text.toLowerCase() &&
        e.ts - (prev._end || prev.ts) <= 30 * 60000
      )
        prev._end = Math.max(prev._end || prev.ts, e.tsEnd || e.ts);
      else out.push({ ...e, _end: e.tsEnd || e.ts });
    }
    return out;
  };
  const billableMerged = mergeForExport(billableTimed);
  // Group by category, preserve order of first appearance
  const summaryOrder = [];
  const summaryGroups = {};
  const summaryUngrouped = [];
  billableMerged.forEach((e) => {
    const taskName = stripJira(e.text);
    if (!e.tag || e.tag === 'other') {
      if (!summaryUngrouped.includes(taskName)) summaryUngrouped.push(taskName);
    } else {
      const catLabel = getCatLabel(e.tag);
      if (!summaryGroups[e.tag]) {
        summaryOrder.push(e.tag);
        summaryGroups[e.tag] = { label: catLabel, tasks: [] };
      }
      if (!summaryGroups[e.tag].tasks.includes(taskName)) summaryGroups[e.tag].tasks.push(taskName);
    }
  });
  const summaryParts = [
    ...summaryOrder.map((k) => `${summaryGroups[k].label} (${summaryGroups[k].tasks.join(', ')})`),
    ...summaryUngrouped,
  ];
  const summaryLine = summaryParts.length ? summaryParts.join(', ') : '';

  const blob = new Blob(
    [[...header, ...lines, ...(summaryLine ? ['---', summaryLine] : [])].join('\n')],
    { type: 'text/plain' }
  );
  const filename = `work-log-${dateStr}.txt`;
  writeExportFile('timesheets', filename, blob);
}

/**
 * Exports a full JSON backup of all application state: entries, categories,
 * plan tasks, time blocks, pomodoro log, dev log, distractions, and hidden
 * quick-pick items. Triggers a file download or writes to the save folder.
 */
function exportBackup() {
  const backup = {
    version: '1',
    exported: new Date().toISOString(),
    entries,
    categories,
    planTasks,
    blocks,
    pomoLog: (() => {
      try {
        return JSON.parse(localStorage.getItem(STORE_POMO_LOG) || '[]');
      } catch (e) {
        return [];
      }
    })(),
    devLog: (() => {
      try {
        return JSON.parse(localStorage.getItem(STORE_DEV_LOG) || '[]');
      } catch (e) {
        return [];
      }
    })(),
    distractions: (() => {
      try {
        return JSON.parse(localStorage.getItem(STORE_DISTRACTIONS) || '[]');
      } catch (e) {
        return [];
      }
    })(),
    qpHidden: [...qpHidden],
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const filename = `work-log-backup-${dk(new Date())}.json`;
  writeExportFile('JSON backups', filename, blob);
}

/**
 * Restores application state from a JSON backup file previously created by
 * {@link exportBackup}. Reads the file, validates its structure via
 * {@link validateBackupFile}, asks the user to confirm, writes all arrays to
 * their localStorage keys, then reloads the page so state is re-initialised
 * cleanly from the restored data.
 *
 * Assumption: import is a full replace, not a merge. All data currently in the
 * affected localStorage keys is overwritten after the user confirms. If
 * selective-date merging is ever needed, add a merge mode option here and update
 * the confirmation dialog accordingly.
 *
 * @param {File} file - The .json backup file selected by the user.
 * @returns {Promise<void>}
 */
async function importBackup(file) {
  let text;
  try {
    text = await file.text();
  } catch (e) {
    wlLog.warn('importBackup: failed to read file', e);
    alert('Could not read the file. Please try again.');
    return;
  }

  let backup;
  try {
    backup = JSON.parse(text);
  } catch (e) {
    wlLog.warn('importBackup: file is not valid JSON', e);
    alert('The selected file is not valid JSON. Please choose a work-log backup file.');
    return;
  }

  const { valid, error } = validateBackupFile(backup);
  if (!valid) {
    alert(error);
    return;
  }

  const entryCount = backup.entries.length;
  const dates = backup.entries
    .map((e) => e.date)
    .filter(Boolean)
    .sort();
  const dateRange =
    dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'no dated entries';
  const exportedAt = backup.exported ? new Date(backup.exported).toLocaleString() : 'unknown date';

  const confirmed = window.confirm(
    `Restore backup from ${exportedAt}?\n\n` +
      `${entryCount} entries (${dateRange})\n` +
      `${backup.categories.length} categories\n` +
      `${backup.planTasks.length} tasks\n\n` +
      `⚠️  This will replace your current data. The page will reload after import.`
  );
  if (!confirmed) return;

  try {
    // Write primary arrays — always present (validated above)
    localStorage.setItem(STORE_ENTRIES, JSON.stringify(backup.entries));
    localStorage.setItem(STORE_CATS, JSON.stringify(backup.categories));
    // STORE_PLAN is defined in 10-tasks.js; safe to reference at call-time
    localStorage.setItem(STORE_PLAN, JSON.stringify(backup.planTasks));

    // Write optional arrays — only if present in the backup
    // STORE_BLOCKS is defined in 11-timeblock.js
    if (Array.isArray(backup.blocks)) {
      localStorage.setItem(STORE_BLOCKS, JSON.stringify(backup.blocks));
    }
    if (Array.isArray(backup.pomoLog)) {
      localStorage.setItem(STORE_POMO_LOG, JSON.stringify(backup.pomoLog));
    }
    // STORE_DEV_LOG is defined in 12a-changelog.js
    if (Array.isArray(backup.devLog)) {
      localStorage.setItem(STORE_DEV_LOG, JSON.stringify(backup.devLog));
    }
    // STORE_DISTRACTIONS is defined in 12-misc.js
    if (Array.isArray(backup.distractions)) {
      localStorage.setItem(STORE_DISTRACTIONS, JSON.stringify(backup.distractions));
    }
    if (Array.isArray(backup.qpHidden)) {
      localStorage.setItem(STORE_QP_HIDDEN, JSON.stringify(backup.qpHidden));
    }

    wlLog.info(
      `importBackup: restored ${entryCount} entries, ` +
        `${backup.categories.length} categories, ` +
        `${backup.planTasks.length} tasks ` +
        `from backup exported ${backup.exported ?? 'unknown'}`
    );
    location.reload();
  } catch (e) {
    wlLog.warn('importBackup: failed to write to localStorage', e);
    alert(
      'Import failed — could not write to localStorage. Your existing data has not been changed.'
    );
  }
}

/* ── File System Access API ── */
let _cachedDirHandle = null;

/**
 * Opens (or creates) the IndexedDB database used to persist the FSA directory handle.
 * @returns {Promise<IDBDatabase>} Resolves with the opened database instance.
 */
function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('wl_fs_v1', 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore('handles');
    req.onsuccess = (e) => res(e.target.result);
    req.onerror = () => rej(req.error);
  });
}

/**
 * Retrieves the previously granted File System Access directory handle from
 * IndexedDB (with an in-memory cache).
 * @returns {Promise<FileSystemDirectoryHandle|null>} The handle, or null if none saved.
 */
async function getSavedDir() {
  if (_cachedDirHandle) return _cachedDirHandle;
  try {
    const db = await openIDB();
    return new Promise((res) => {
      const tx = db.transaction('handles', 'readonly');
      const get = tx.objectStore('handles').get('saveDir');
      get.onsuccess = () => {
        _cachedDirHandle = get.result || null;
        res(_cachedDirHandle);
      };
      get.onerror = () => res(null);
    });
  } catch (e) {
    return null;
  }
}

/**
 * Persists a File System Access directory handle to IndexedDB for reuse
 * across sessions, and updates the in-memory cache.
 * @param {FileSystemDirectoryHandle} handle - The directory handle to store.
 * @returns {Promise<void>}
 */
async function storeDirHandle(handle) {
  _cachedDirHandle = handle;
  try {
    const db = await openIDB();
    return new Promise((res) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'saveDir');
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch (e) {
    wlLog.warn('saveDirHandle: failed to persist FSA handle to IndexedDB', e);
    // Future exports will fall back to browser downloads — data is not lost
  }
}

/**
 * Clears the persisted FSA directory handle from both IndexedDB and the
 * in-memory cache so future exports fall back to browser downloads.
 * @returns {Promise<void>}
 */
async function clearDirHandle() {
  _cachedDirHandle = null;
  try {
    const db = await openIDB();
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete('saveDir');
  } catch (e) {
    wlLog.warn('clearDirHandle: failed to remove FSA handle from IndexedDB', e);
    // In-memory cache is already cleared — future exports will fall back to browser downloads
  }
}

/**
 * Writes a Blob to `subfolder/filename` inside the user's chosen FSA directory.
 * Creates the subfolder if it does not exist. Falls back to a browser `<a>`
 * download if the FSA handle is missing or permission is not granted.
 * @param {string} subfolder - Name of the subfolder to write into.
 * @param {string} filename  - Name of the file to create or overwrite.
 * @param {Blob}   blob      - File content.
 * @returns {Promise<void>}
 */
async function writeExportFile(subfolder, filename, blob) {
  const dir = await getSavedDir();
  if (dir) {
    try {
      const perm = await dir.queryPermission({ mode: 'readwrite' });
      const granted =
        perm === 'granted'
          ? true
          : (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
      if (granted) {
        const subDir = await dir.getDirectoryHandle(subfolder, { create: true });
        const fh = await subDir.getFileHandle(filename, { create: true });
        const writable = await fh.createWritable();
        await writable.write(blob);
        await writable.close();
        renderFolderStatus();
        return;
      }
    } catch (e) {
      console.warn('[wl] FSA write failed, falling back to download:', e);
    }
  }
  // Fallback: browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Prompts the user to select a save folder via the File System Access API
 * and persists the resulting directory handle. Shows a fallback alert in
 * browsers that do not support the API.
 * @returns {Promise<void>}
 */
async function pickSaveFolder() {
  if (!window.showDirectoryPicker) {
    alert(
      "Your browser doesn't support the File System Access API.\nUse Chrome or Edge for automatic subfolder saving.\nFiles will download normally for now."
    );
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await storeDirHandle(handle);
    renderFolderStatus();
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

/**
 * Updates the `#folderStatus` element to show the currently selected save
 * folder name (green) or a "pick save folder" prompt (default colour).
 */
function renderFolderStatus() {
  const el = document.getElementById('folderStatus');
  if (!el) return;
  getSavedDir().then((dir) => {
    if (dir) {
      el.textContent = `📁 ${dir.name}`;
      el.title =
        'Timesheets → ' +
        dir.name +
        '/timesheets/\nJSON backups → ' +
        dir.name +
        '/JSON backups/\nClick to change';
      el.style.color = '#1D9E75';
    } else {
      el.textContent = 'pick save folder';
      el.title =
        'Choose where exports are saved (creates timesheets/ and JSON backups/ subfolders)';
      el.style.color = '';
    }
  });
}
