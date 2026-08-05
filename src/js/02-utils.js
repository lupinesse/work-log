/* ── Epic helpers ── */
// safeCssColor() and escHtml() are defined in 00-pure-fns.js.

/**
 * Returns the category object for `id`, falling back to 'other' if not found.
 * The returned colour is always sanitised through safeCssColor.
 * @param {string} id - Category ID.
 * @returns {{ id: string, label: string, color: string }}
 */
function getCat(id) {
  const cat =
    categories.find((category) => category.id === id) ||
    categories.find((category) => category.id === 'other');
  if (!cat) return { id: 'other', label: 'other', color: '#888780' };
  return { ...cat, color: safeCssColor(cat.color) };
}
function getCatColor(id) {
  return getCat(id).color;
}
function getCatLabel(id) {
  return getCat(id).label;
}

let editingCatId = null;
let addingNewCat = false;
/** Controls whether the epic manage row (rename/delete/add) is expanded. */
let catManageOpen = false;

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
        <button class="cat-manage-btn" id="catBillBtn">${selCat.billable === false ? '💸 internal' : '💰 billable'}</button>`;
  }

  // The manage row is open when explicitly toggled, or when an inline edit is active.
  const manageRowOpen = catManageOpen || !!editingCatId || addingNewCat;

  row.innerHTML = `
      <div class="cat-dropdown-row">
        <label class="cat-color-swatch cat-dot-preview" id="catDotPreview" title="click to change colour" style="background:${safeCssColor(selCat.color)}">
          <input type="color" id="catQuickColorPick" value="${safeCssColor(selCat.color)}" style="opacity:0;position:absolute;width:0;height:0;pointer-events:none" />
        </label>
        <select class="cat-select" id="catSelect">
        ${[...categories]
          .sort((catA, catB) => catA.label.localeCompare(catB.label))
          .map(
            (cat) =>
              `<option value="${cat.id}"${cat.id === selectedTag ? ' selected' : ''}>${escHtml(cat.label)}</option>`
          )
          .join('')}
        </select>
        <button class="cat-settings-btn${manageRowOpen ? ' open' : ''}"
                id="catSettingsBtn"
                title="Manage epic (rename, delete, add)"
                aria-label="Manage epic settings"
                aria-expanded="${manageRowOpen}">⚙</button>
      </div>
      <div class="cat-manage-row${manageRowOpen ? ' open' : ''}" id="catManageRow">${manageHtml}</div>`;

  // Select change
  document.getElementById('catSelect').addEventListener('change', (event) => {
    selectedTag = event.target.value;
    editingCatId = null;
    addingNewCat = false;
    renderTagRow();
  });

  // Settings toggle — opens/closes the manage row (disabled while an inline edit is active)
  document.getElementById('catSettingsBtn')?.addEventListener('click', () => {
    if (editingCatId || addingNewCat) return;
    catManageOpen = !catManageOpen;
    renderTagRow();
  });

  // Quick colour picker — click the dot to change colour immediately
  const quickColorPick = document.getElementById('catQuickColorPick');
  if (quickColorPick) {
    quickColorPick.addEventListener('input', () => {
      const dot = document.getElementById('catDotPreview');
      if (dot) dot.style.background = safeCssColor(quickColorPick.value);
    });
    quickColorPick.addEventListener('change', () => {
      const cat = categories.find((category) => category.id === selectedTag);
      if (cat) {
        cat.color = safeCssColor(quickColorPick.value);
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
      if (
        categories.find(
          (category) => category.id !== id && category.label.toLowerCase() === label.toLowerCase()
        )
      ) {
        input.style.borderColor = '#C62828';
        input.focus();
        return;
      }
      const cat = categories.find((category) => category.id === id);
      if (cat) cat.label = label;
      editingCatId = null;
      catManageOpen = false;
      save();
      renderTagRow();
      render();
      renderTimeblock();
      renderCompleted();
    };
    editOk.addEventListener('click', saveEdit);
    const editInput = document.getElementById('catEditInput');
    if (editInput) {
      editInput.focus();
      editInput.select();
      editInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') saveEdit();
        if (event.key === 'Escape') {
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
      catManageOpen = false;
      renderTagRow();
    });

  // Delete
  const delBtn = document.getElementById('catDelBtn');
  if (delBtn)
    delBtn.addEventListener('click', () => {
      categories = categories.filter((cat) => cat.id !== selectedTag);
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
      planTasks.forEach((task) => {
        if (task.tag === selectedTag) task.billable = cat.billable;
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
      if (categories.find((cat) => cat.label.toLowerCase() === label.toLowerCase())) {
        input.style.borderColor = '#C62828';
        input.focus();
        return;
      }
      const color = nextDistinctColor();
      const id = 'cat_' + Date.now();
      categories.push({ id, label, color });
      selectedTag = id;
      addingNewCat = false;
      catManageOpen = false;
      document.getElementById('captureInput').value = '';
      save();
      renderTagRow();
      render();
    };
    newOk.addEventListener('click', saveNew);
    const newCatInput = document.getElementById('catNewInput');
    if (newCatInput) {
      newCatInput.focus();
      newCatInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') saveNew();
        if (event.key === 'Escape') {
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
      catManageOpen = false;
      renderTagRow();
    });
}

/* ── Utility ── */
// dk(), fmtTime(), fmtElapsed(), roundToNearest30(), safeCssColor(), escHtml()
// are defined in 00-pure-fns.js (concatenated earlier) so they are in scope here.

/**
 * Returns true if `d` falls on today's calendar date (UTC).
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
 * Rounds `ts` to the nearest 30-minute mark only when `entry` is billable.
 * Non-billable entries keep their exact timestamps for accurate reporting.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @param {object|null} entry - Work-log entry; if null, always rounds.
 * @returns {number} Timestamp, conditionally rounded.
 */
function roundToNearest30IfBillable(ts, entry) {
  // Assumption: non-billable entries keep exact timestamps for accurate time reporting.
  // Billable entries are rounded because clients are invoiced in 30-minute increments.
  // Changing this requires updating the export format in 05-entries.js and DATA.md.
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
    .filter((entry) => entry.date === todayKey && entry.tsEnd)
    .reduce((max, entry) => Math.max(max, entry.tsEnd), 0);
  return Math.max(ts, lastEnd);
}

/**
 * Returns entries for the currently viewed date, sorted newest-first.
 * @returns {Array<object>}
 */
function viewEntries() {
  return entries
    .filter((entry) => entry.date === dk(viewDate))
    .slice()
    .reverse();
}
/**
 * Counts consecutive days with at least one logged entry, looking backwards from yesterday.
 * Today is excluded so the streak only increments once the day has been completed.
 * @returns {number}
 */
function calcStreak() {
  const days = new Set(entries.map((entry) => entry.date));
  let streak = 0;
  const d = new Date();
  d.setDate(d.getDate() - 1); // Start from yesterday, not today
  while (days.has(dk(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
// escHtml() is defined in 00-pure-fns.js.
