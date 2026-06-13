/* ── Text export ── */

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
  const timedEntries = dayEntries.filter(
    (entry) => entry.tsEnd && entry.tsEnd > entry.ts && entry.signifier !== 'cancelled'
  );

  const { dayStartTs, dayEndTs } = computeDayBounds(dayEntries, timedEntries, {
    isViewingToday,
    dayStart: isViewingToday ? getDayStart() : null,
    activeTimer,
    now: Date.now(),
  });

  const fmtTsHM = (ts) => {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };

  // Body: tracked time grouped by category, then task (first-seen order)
  const { catOrder, catGrouped } = groupEntriesByCategory(dayEntries);
  const lines = formatGroupedLines(catOrder, catGrouped, fmtDurLong, getCatLabel);

  // Billable / non-billable breakdown
  const totalTrackedMs = timedEntries.reduce((sum, entry) => sum + (entry.tsEnd - entry.ts), 0);
  const billableTimed = timedEntries.filter((entry) => isEntryBillable(entry));
  const billableMs = billableTimed.reduce((sum, entry) => sum + (entry.tsEnd - entry.ts), 0);
  const nonBillableMs = totalTrackedMs - billableMs;

  const header = [`Work Log — ${dateStr}`];
  if (dayStartTs) {
    const startStr = fmtTsHM(dayStartTs);
    const endStr = dayEndTs ? fmtTsHM(dayEndTs) : '--:--';
    header.push(`Started: ${startStr}  |  Ended: ${endStr}`);
    if (dayEndTs) header.push(`Workday: ${fmtDurLong(dayEndTs - dayStartTs)}`);
  }
  if (totalTrackedMs > 0) {
    header.push(
      `Total tracked: ${fmtDurLong(totalTrackedMs)}  |  💰 Billable: ${fmtDurLong(billableMs)}  |  💸 Non-billable: ${fmtDurLong(nonBillableMs)}`
    );
  }
  header.push('---');

  // Pasteable billable summary — last line of the file.
  // Merge same-task entries separated by ≤30 min, then group by category.
  const billableMerged = mergeAdjacentEntries(billableTimed);
  const summaryParts = buildBillableSummaryParts(billableMerged, getCatLabel);
  const summaryLine = summaryParts.length ? summaryParts.join(', ') : '';

  const blob = new Blob(
    [[...header, ...lines, ...(summaryLine ? ['---', summaryLine] : [])].join('\n')],
    { type: 'text/plain' }
  );
  const filename = `work-log-${dateStr}.txt`;
  writeExportFile('timesheets', filename, blob);
}

/* ── JSON backup / restore / merge ── */

/**
 * Reads and parses an optional JSON-array log from localStorage for inclusion
 * in a backup. If the stored value is present but not valid JSON, the failure
 * is logged via {@link wlLog} (so the data loss is diagnosable rather than
 * silent) and an empty array is returned so the rest of the backup still
 * succeeds. Absent keys legitimately yield an empty array.
 * @param {string} storeKey - The localStorage key to read.
 * @param {string} label    - Human-readable log name for the warning message.
 * @returns {Array} The parsed array, or `[]` if absent or unparseable.
 */
function readOptionalLogForBackup(storeKey, label) {
  try {
    return JSON.parse(localStorage.getItem(storeKey) || '[]');
  } catch (err) {
    wlLog.warn(
      `exportBackup: ${label} in localStorage is not valid JSON — backing up an empty array for it; the corrupt data is excluded from this backup`,
      e
    );
    return [];
  }
}

/** How many days of entries to include in each backup file. */
const BACKUP_RETENTION_DAYS = 21;

/**
 * Exports a JSON backup of recent application state: entries from the last
 * {@link BACKUP_RETENTION_DAYS} days, plus categories, plan tasks, time
 * blocks, pomodoro log, dev log, distractions, and hidden quick-pick items.
 * Older entries are excluded to keep the file size stable; they remain in
 * earlier backup files.
 * Triggers a file download or writes to the save folder.
 */
function exportBackup() {
  const { kept: recentEntries, dropped } = applyBackupRetention(
    entries,
    BACKUP_RETENTION_DAYS,
    Date.now()
  );
  if (dropped > 0) {
    wlLog.info(
      `exportBackup: excluded ${dropped} entr${dropped === 1 ? 'y' : 'ies'} older than ${BACKUP_RETENTION_DAYS} days`
    );
  }
  const backup = {
    version: '1',
    exported: new Date().toISOString(),
    retentionDays: BACKUP_RETENTION_DAYS,
    entries: recentEntries,
    categories,
    planTasks,
    blocks,
    pomoLog: readOptionalLogForBackup(STORE_POMO_LOG, 'pomoLog'),
    devLog: readOptionalLogForBackup(STORE_DEV_LOG, 'devLog'),
    distractions: readOptionalLogForBackup(STORE_DISTRACTIONS, 'distractions'),
    qpHidden: [...qpHidden],
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const filename = `work-log-backup-${BACKUP_RETENTION_DAYS}d-${dk(new Date())}.json`;
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
  } catch (err) {
    wlLog.warn('importBackup: failed to read file', err);
    alert('Could not read the file. Please try again.');
    return;
  }

  let backup;
  try {
    backup = JSON.parse(text);
  } catch (err) {
    wlLog.warn('importBackup: file is not valid JSON', err);
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
    .map((entry) => entry.date)
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
    // STORE_DEV_LOG is defined in 12b-changelog-data.js
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
  } catch (err) {
    wlLog.warn('importBackup: failed to write to localStorage', err);
    alert(
      'Import failed — could not write to localStorage. Your existing data has not been changed.'
    );
  }
}

/**
 * Merges entries from a JSON backup file into the current data set without
 * replacing any existing records. Only entries whose `id` is not already
 * present in localStorage are added. Categories, tasks, and all other backup
 * fields are ignored — this is an entries-only operation.
 *
 * Intended for the "worked on another machine" case: the backup from the
 * remote session contains new entries that are absent from the local store.
 *
 * @param {File} file - The .json backup file selected by the user.
 * @returns {Promise<void>}
 */
async function mergeBackupEntries(file) {
  let text;
  try {
    text = await file.text();
  } catch (err) {
    wlLog.warn('mergeBackupEntries: failed to read file', err);
    alert('Could not read the file. Please try again.');
    return;
  }

  let backup;
  try {
    backup = JSON.parse(text);
  } catch (err) {
    wlLog.warn('mergeBackupEntries: file is not valid JSON', err);
    alert('The selected file is not valid JSON. Please choose a work-log backup file.');
    return;
  }

  const { valid, error } = validateBackupFile(backup);
  if (!valid) {
    alert(error);
    return;
  }

  const incoming = filterNewBackupEntries(entries, backup.entries, validEntry);

  if (!incoming.length) {
    alert('No new entries found — all entries in this backup already exist in your current data.');
    return;
  }

  const dates = [...new Set(incoming.map((e) => e.date).filter(Boolean))].sort();
  const exportedAt = backup.exported ? new Date(backup.exported).toLocaleString() : 'unknown date';

  const confirmed = window.confirm(
    `Merge ${incoming.length} new entr${incoming.length === 1 ? 'y' : 'ies'} from backup?\n\n` +
      `Backup exported: ${exportedAt}\n` +
      `Dates: ${dates.join(', ')}\n\n` +
      'Your existing entries will not be changed. The page will reload after merging.'
  );
  if (!confirmed) return;

  try {
    const merged = [...entries, ...incoming];
    localStorage.setItem(STORE_ENTRIES, JSON.stringify(merged));
    wlLog.info(
      `mergeBackupEntries: merged ${incoming.length} new entries ` +
        `(dates: ${dates.join(', ')}) from backup exported ${backup.exported ?? 'unknown'}`
    );
    location.reload();
  } catch (err) {
    wlLog.warn('mergeBackupEntries: failed to write to localStorage', err);
    alert(
      'Merge failed — could not write to localStorage. Your existing data has not been changed.'
    );
  }
}
