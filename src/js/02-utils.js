/* ── Epic helpers ── */
/**
 * Returns `c` if it is a safe CSS colour (hex or hsl()), otherwise returns a neutral fallback.
 * Prevents malformed user-supplied colour values from breaking layout or injecting CSS.
 * @param {string} c
 * @returns {string} A safe CSS colour string.
 */
function safeCssColor(c) {
  // Allow hex (#rgb, #rrggbb, #rrggbbaa) and hsl() only — block anything else
  return /^(#[0-9a-fA-F]{3,8}|hsl\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*\))$/.test(String(c))
    ? c
    : '#888780';
}

/**
 * Returns the category object for `id`, falling back to 'other' if not found.
 * The returned colour is always sanitised through safeCssColor.
 * @param {string} id - Category ID.
 * @returns {{ id: string, label: string, color: string }}
 */
function getCat(id) {
  const cat = categories.find((c) => c.id === id) || categories.find((c) => c.id === 'other');
  if (!cat) return { id: 'other', label: 'other', color: '#888780' };
  return { ...cat, color: safeCssColor(cat.color) };
}
function getCatColor(id) {
  return getCat(id).color;
}
function getCatLabel(id) {
  return getCat(id).label;
}

function addCategory() {
  const name = prompt('New epic name:');
  if (!name || !name.trim()) return;
  const label = name.trim();
  if (categories.find((c) => c.label.toLowerCase() === label.toLowerCase())) {
    alert('An epic with that name already exists.');
    return;
  }
  const color = nextDistinctColor();
  const id = 'cat_' + Date.now();
  categories.push({ id, label, color });
  selectedTag = id;
  save();
  renderTagRow();
}

let editingCatId = null;
let addingNewCat = false;

function renderTagRow() {
  const row = document.getElementById('tagRow');
  const selCat = getCat(selectedTag);

  // Build manage row content based on state
  let manageHtml;
  if (editingCatId) {
    const c = getCat(editingCatId);
    manageHtml = `<div class="cat-inline-edit">
        <input class="cat-inline-input" id="catEditInput" value="${escHtml(c.label)}" data-id="${editingCatId}" />
        <button class="cat-inline-ok" id="catEditOk" data-id="${editingCatId}">&#10003;</button>
        <button class="cat-inline-cancel" id="catEditCancel">&#10005;</button>
      </div>`;
  } else if (addingNewCat) {
    manageHtml = `<div class="cat-inline-edit">
        <input class="cat-inline-input" id="catNewInput" placeholder="new epic name" style="flex:1" />
        <button class="cat-inline-ok" id="catNewOk">&#10003;</button>
        <button class="cat-inline-cancel" id="catNewCancel">&#10005;</button>
      </div>`;
  } else {
    manageHtml = `
        <button class="cat-manage-btn" id="catRenBtn">&#9998; rename</button>
        <button class="cat-manage-btn danger" id="catDelBtn">&#215; delete</button>
        <button class="cat-manage-btn add" id="catAddBtn">+ add epic</button>
        <button class="cat-manage-btn" id="catBillBtn">${selCat.billable === false ? '💸 non-billable' : '💰 billable'}</button>`;
  }

  row.innerHTML = `
      <div class="cat-dropdown-row">
        <label class="cat-color-swatch cat-dot-preview" id="catDotPreview" title="click to change colour" style="background:${selCat.color}">
          <input type="color" id="catQuickColorPick" value="${selCat.color}" style="opacity:0;position:absolute;width:0;height:0;pointer-events:none" />
        </label>
        <select class="cat-select" id="catSelect">
        ${[...categories]
          .sort((a, b) => a.label.localeCompare(b.label))
          .map(
            (c) =>
              `<option value="${c.id}"${c.id === selectedTag ? ' selected' : ''}>${escHtml(c.label)}</option>`
          )
          .join('')}
        </select>
      </div>
      <div class="cat-manage-row" id="catManageRow">${manageHtml}</div>`;

  // Select change
  document.getElementById('catSelect').addEventListener('change', (e) => {
    selectedTag = e.target.value;
    editingCatId = null;
    addingNewCat = false;
    renderTagRow();
  });

  // Quick colour picker — click the dot to change colour immediately
  const quickColorPick = document.getElementById('catQuickColorPick');
  if (quickColorPick) {
    quickColorPick.addEventListener('input', () => {
      const dot = document.getElementById('catDotPreview');
      if (dot) dot.style.background = quickColorPick.value;
    });
    quickColorPick.addEventListener('change', () => {
      const cat = categories.find((c) => c.id === selectedTag);
      if (cat) {
        cat.color = quickColorPick.value;
        save();
        renderTagRow();
        render();
        renderTimeblock();
        renderCompleted();
      }
    });
  }

  // Rename: open
  const renBtn = document.getElementById('catRenBtn');
  if (renBtn)
    renBtn.addEventListener('click', () => {
      editingCatId = selectedTag;
      addingNewCat = false;
      renderTagRow();
    });

  // Rename: save
  const editOk = document.getElementById('catEditOk');
  if (editOk) {
    const saveEdit = () => {
      const input = document.getElementById('catEditInput');
      const label = input ? input.value.trim() : '';
      const id = editOk.dataset.id;
      if (!label) {
        editingCatId = null;
        renderTagRow();
        return;
      }
      if (categories.find((c) => c.id !== id && c.label.toLowerCase() === label.toLowerCase())) {
        input.style.borderColor = '#C62828';
        input.focus();
        return;
      }
      const cat = categories.find((c) => c.id === id);
      if (cat) cat.label = label;
      editingCatId = null;
      save();
      renderTagRow();
      render();
      renderTimeblock();
      renderCompleted();
    };
    editOk.addEventListener('click', saveEdit);
    const inp = document.getElementById('catEditInput');
    if (inp) {
      inp.focus();
      inp.select();
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') {
          editingCatId = null;
          renderTagRow();
        }
      });
    }
  }

  // Rename: cancel
  const editCancel = document.getElementById('catEditCancel');
  if (editCancel)
    editCancel.addEventListener('click', () => {
      editingCatId = null;
      renderTagRow();
    });

  // Delete
  const delBtn = document.getElementById('catDelBtn');
  if (delBtn)
    delBtn.addEventListener('click', () => {
      categories = categories.filter((c) => c.id !== selectedTag);
      selectedTag = 'work';
      save();
      renderTagRow();
      render();
    });

  // Add: open
  const addBtn = document.getElementById('catAddBtn');
  if (addBtn)
    addBtn.addEventListener('click', () => {
      addingNewCat = true;
      editingCatId = null;
      renderTagRow();
    });
  const billBtn = document.getElementById('catBillBtn');
  if (billBtn)
    billBtn.addEventListener('click', () => {
      const cat = getCat(selectedTag);
      cat.billable = cat.billable === false;
      // Retroactively update all tasks with this category
      planTasks.forEach((t) => {
        if (t.tag === selectedTag) t.billable = cat.billable;
      });
      save();
      savePlan();
      renderTagRow();
      renderPlan();
      renderCompleted();
    });

  // Add: save
  const newOk = document.getElementById('catNewOk');
  if (newOk) {
    const saveNew = () => {
      const input = document.getElementById('catNewInput');
      const label = input ? input.value.trim() : '';
      if (!label) {
        addingNewCat = false;
        renderTagRow();
        return;
      }
      if (categories.find((c) => c.label.toLowerCase() === label.toLowerCase())) {
        input.style.borderColor = '#C62828';
        input.focus();
        return;
      }
      const color = nextDistinctColor();
      const id = 'cat_' + Date.now();
      categories.push({ id, label, color });
      selectedTag = id;
      addingNewCat = false;
      document.getElementById('captureInput').value = '';
      save();
      renderTagRow();
      render();
    };
    newOk.addEventListener('click', saveNew);
    const ni = document.getElementById('catNewInput');
    if (ni) {
      ni.focus();
      ni.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveNew();
        if (e.key === 'Escape') {
          addingNewCat = false;
          renderTagRow();
        }
      });
    }
  }

  // Add: cancel
  const newCancel = document.getElementById('catNewCancel');
  if (newCancel)
    newCancel.addEventListener('click', () => {
      addingNewCat = false;
      renderTagRow();
    });
}

/* ── Utility ── */

/**
 * Formats a Date as YYYY-MM-DD using local time. Used as the canonical day key throughout.
 * @param {Date} d
 * @returns {string} e.g. '2026-05-25'
 */
function dk(d) {
  return d.toISOString().slice(0, 10);
}
/**
 * Returns true if `d` falls on today's calendar date (local time).
 * @param {Date} d
 * @returns {boolean}
 */
function isToday(d) {
  return dk(d) === dk(new Date());
}
/**
 * Returns a human-readable day label: 'today', 'yesterday', or a short locale date string.
 * @param {Date} d
 * @returns {string}
 */
function fmtLabel(d) {
  if (isToday(d)) return 'today';
  const diffMs = new Date(dk(new Date())) - new Date(dk(d));
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays === 1) return 'yesterday';
  return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
}
/**
 * Formats a Unix timestamp as HH:MM in 24-hour local time.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @returns {string} e.g. '09:30'
 */
function fmtTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
/**
 * Formats a duration in milliseconds as a compact time string.
 * @param {number} ms - Duration in milliseconds.
 * @returns {string} 'MM:SS' for durations under an hour; 'HH:MM:SS' otherwise.
 */
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600),
    mm = Math.floor((s % 3600) / 60),
    ss = s % 60;
  if (hh > 0)
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
/**
 * Rounds a duration up to the nearest 30-minute slot, with a minimum of 30 min.
 * Used for billing time estimates.
 * @param {number} ms - Duration in milliseconds.
 * @returns {number} Duration rounded up to nearest 30-min slot, in milliseconds.
 */
function roundUp30(ms) {
  const SLOT = 30 * 60 * 1000;
  return Math.max(SLOT, Math.ceil(ms / SLOT) * SLOT);
}

/**
 * Rounds a timestamp to the nearest 30-minute clock mark.
 * 0–15 min into a block rounds down; 16–45 rounds to the next half-hour; 46–59 rounds up.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @returns {number} Rounded Unix timestamp in milliseconds.
 */
function roundToNearest30(ts) {
  const d = new Date(ts);
  const m = d.getMinutes();
  const blockStart = Math.floor(m / 30) * 30; // 0 or 30
  const withinBlock = m - blockStart; // 0–29
  const roundedMins = withinBlock <= 15 ? blockStart : blockStart + 30;
  const result = new Date(d);
  result.setSeconds(0, 0);
  result.setMinutes(roundedMins % 60);
  if (roundedMins >= 60) result.setHours(d.getHours() + 1);
  return result.getTime();
}

/**
 * Rounds `ts` to the nearest 30-minute mark only when `entry` is billable.
 * Non-billable entries keep their exact timestamps for accurate reporting.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @param {object|null} entry - Work-log entry; if null, always rounds.
 * @returns {number} Timestamp, conditionally rounded.
 */
function roundToNearest30IfBillable(ts, entry) {
  // If entry is provided, check if it's billable
  // Only round billable tasks; non-billable tasks keep exact time
  if (entry && !isEntryBillable(entry)) return ts;
  return roundToNearest30(ts);
}

/**
 * Returns a rounded start timestamp that does not overlap any existing entry for today.
 * Prevents new entries from appearing to start before a prior entry's end time.
 * @returns {number} Unix timestamp in milliseconds.
 */
function safeRoundedStart() {
  const ts = roundToNearest30(Date.now());
  const todayKey = dk(new Date());
  const lastEnd = entries
    .filter((e) => e.date === todayKey && e.tsEnd)
    .reduce((max, e) => Math.max(max, e.tsEnd), 0);
  return Math.max(ts, lastEnd);
}

/**
 * Returns entries for the currently viewed date, sorted newest-first.
 * @returns {Array<object>}
 */
function viewEntries() {
  return entries
    .filter((e) => e.date === dk(viewDate))
    .slice()
    .reverse();
}
/**
 * Counts entries logged since the start of the current ISO week (Monday 00:00 local).
 * @returns {number}
 */
function weekCount() {
  const now = new Date(),
    mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  mon.setHours(0, 0, 0, 0);
  return entries.filter((e) => new Date(e.ts) >= mon).length;
}
/**
 * Counts consecutive days with at least one logged entry, looking backwards from yesterday.
 * Today is excluded so the streak only increments once the day has been completed.
 * @returns {number}
 */
function calcStreak() {
  const days = new Set(entries.map((e) => e.date));
  let streak = 0,
    d = new Date();
  d.setDate(d.getDate() - 1); // Start from yesterday, not today
  while (days.has(dk(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
/**
 * Escapes a string for safe insertion as HTML text content.
 * @param {string} s
 * @returns {string}
 */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
