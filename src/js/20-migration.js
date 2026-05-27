// ── 20-migration.js — Monthly Migration close-out flow ──

let _migItems = [];
let _migIdx = 0;

/**
 * Returns the migration completion record (map of YYYY-MM → boolean).
 * @returns {Object}
 */
function getMigrationRecord() {
  try {
    return JSON.parse(localStorage.getItem(STORE_MIGRATION) || '{}');
  } catch (e) {
    return {};
  }
}

/**
 * Persists the migration completion record to localStorage.
 * @param {Object} rec - Map of YYYY-MM → boolean.
 */
function saveMigrationRecord(rec) {
  localStorage.setItem(STORE_MIGRATION, JSON.stringify(rec));
}

/**
 * Opens the migration modal and populates it with open (unresolved) tasks
 * for the current month.  Alerts if there is nothing to migrate.
 */
function openMigration() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;

  _migItems = planTasks.filter(
    (t) => t.date.startsWith(prefix) && t.status !== 'done' && !t._migrated
  );
  _migIdx = 0;

  if (!_migItems.length) {
    alert('No open tasks to migrate — month is already clean!');
    return;
  }

  const overlay = document.getElementById('migrationOverlay');
  if (!overlay) return;

  document.getElementById('migrationTitle').textContent =
    new Date(y, m, 1).toLocaleString('default', { month: 'long', year: 'numeric' }) + ' close-out';
  overlay.style.display = 'flex';
  renderMigrationStep();
}

/** Closes the migration overlay. */
function closeMigration() {
  const overlay = document.getElementById('migrationOverlay');
  if (overlay) overlay.style.display = 'none';
}

/**
 * Renders the current migration step (or the "done" screen when all resolved).
 */
function renderMigrationStep() {
  const total = _migItems.length;
  const counter = document.getElementById('migrationCounter');
  const prog = document.getElementById('migrationProgress');
  const body = document.getElementById('migrationBody');
  if (!body) return;

  if (counter) counter.textContent = `${_migIdx} / ${total} resolved`;
  if (prog) prog.style.width = `${(_migIdx / total) * 100}%`;

  if (_migIdx >= total) {
    body.innerHTML = `
      <div class="mig-done">
        <div class="mig-done-icon">✓</div>
        <div class="mig-done-title">Month closed</div>
        <div class="mig-done-sub">${total} item${total === 1 ? '' : 's'} resolved</div>
      </div>`;
    return;
  }

  const item = _migItems[_migIdx];
  const cat = getCat(item.tag);
  body.innerHTML = `
    <div class="mig-item">
      <div class="mig-item-header">
        <span class="mig-dot" style="background:${cat.color}"></span>
        <span class="mig-item-text">${escHtml(item.text)}</span>
      </div>
      <div class="mig-item-date">Added ${item.date}</div>
    </div>
    <div class="mig-actions">
      <button class="mig-btn mig-carry"    id="migCarry">→ Carry forward</button>
      <button class="mig-btn mig-schedule" id="migSchedule">📅 Schedule</button>
      <button class="mig-btn mig-drop"     id="migDrop">✗ Drop</button>
    </div>
    <div id="migDateRow" style="display:none;gap:8px;margin-top:8px;align-items:center">
      <input type="date" class="capture-input" id="migDatePicker"
             style="flex:1" />
      <button class="add-btn" id="migDateConfirm">Confirm date</button>
    </div>`;

  document.getElementById('migCarry').addEventListener('click', () => {
    carryMigTask(_migItems[_migIdx]);
    _migIdx++;
    renderMigrationStep();
  });
  document.getElementById('migSchedule').addEventListener('click', () => {
    const row = document.getElementById('migDateRow');
    if (row) row.style.display = 'flex';
  });
  document.getElementById('migDateConfirm').addEventListener('click', () => {
    const d = document.getElementById('migDatePicker').value;
    if (!d) return;
    scheduleMigTask(_migItems[_migIdx], d);
    _migIdx++;
    renderMigrationStep();
  });
  document.getElementById('migDrop').addEventListener('click', () => {
    dropMigTask(_migItems[_migIdx]);
    _migIdx++;
    renderMigrationStep();
  });
}

/**
 * Duplicates the task into next month (first day) and marks original as migrated.
 * @param {Object} task
 */
function carryMigTask(task) {
  const nextMonth = new Date();
  nextMonth.setDate(1);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const targetDate = dk(nextMonth);
  const newTask = {
    ...task,
    id: Date.now() + Math.random().toString(36).slice(2),
    date: targetDate,
    _migrated: false,
  };
  task._migrated = true;
  planTasks.push(newTask);
  savePlan();
}

/**
 * Reschedules the task to the given date and marks it as migrated.
 * @param {Object} task
 * @param {string} dateStr - YYYY-MM-DD
 */
function scheduleMigTask(task, dateStr) {
  task.date = dateStr;
  task._migrated = true;
  savePlan();
}

/**
 * Archives (drops) the task by marking it done and migrated.
 * @param {Object} task
 */
function dropMigTask(task) {
  task._migrated = true;
  task.status = 'done';
  task.completedAt = Date.now();
  savePlan();
}

/**
 * Initialises the migration overlay: wires close button and optionally shows
 * a last-day-of-month banner once per month.
 */
function initMigration() {
  document.getElementById('migrationClose')?.addEventListener('click', closeMigration);

  // Auto-prompt on last day of month (once per month)
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const isLastDay = now.getDate() === lastDay;
  const rec = getMigrationRecord();
  const monthKey = dk(now).slice(0, 7); // YYYY-MM

  if (isLastDay && !rec[monthKey]) {
    setTimeout(() => {
      const banner = document.createElement('div');
      banner.className = 'mig-banner';
      banner.id = 'migBanner';
      banner.innerHTML = `📋 Last day of the month — <button id="migBannerBtn">run Migration</button> to close out open tasks.`;
      document.body.prepend(banner);
      document.getElementById('migBannerBtn')?.addEventListener('click', () => {
        banner.remove();
        rec[monthKey] = true;
        saveMigrationRecord(rec);
        openMigration();
      });
    }, 2000);
  }
}
