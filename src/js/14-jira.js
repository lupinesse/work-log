/* ── Jira CSV importer ── */

/**
 * Self-contained IIFE that sets up the Jira CSV importer:
 * drop-zone, file picker, CSV parsing, category auto-matching, task
 * de-duplication, grouped selection UI, and bulk import into today's plan.
 */
(function initJiraImporter() {
  const JIRA_SMAP = {
    'in progress': 'inprogress',
    'in-progress': 'inprogress',
    open: 'todo',
    'to do': 'todo',
    todo: 'todo',
    backlog: 'todo',
    new: 'todo',
    'in review': 'inprogress',
    review: 'inprogress',
    testing: 'inprogress',
    blocked: 'blocked',
    impediment: 'blocked',
    pending: 'pending',
    'on hold': 'pending',
    waiting: 'pending',
    done: 'done',
    closed: 'done',
    resolved: 'done',
    "won't do": 'done',
  };
  const JIRA_STATUS_LABEL = {
    todo: 'open',
    inprogress: 'in progress',
    pending: 'pending',
    blocked: 'blocked',
    done: 'done',
  };
  const AUTO_COLORS = [
    '#5DCAA5',
    '#378ADD',
    '#D85A30',
    '#7F77DD',
    '#BA7517',
    '#D4537E',
    '#639922',
    '#185FA5',
    '#993556',
    '#0F6E56',
  ];

  let jiraTasks = [],
    jiraSelected = new Set(),
    jiraCatMap = {};

  /**
   * Maps a raw Jira status string to the internal status token.
   * @param {string} s - Raw Jira status (e.g. "In Progress", "Won't Do").
   * @returns {'todo'|'inprogress'|'pending'|'blocked'|'done'}
   */
  function jiraMapStatus(s) {
    return JIRA_SMAP[(s || '').toLowerCase().trim()] || 'todo';
  }

  /**
   * Returns a Set of lowercased task texts already in today's plan.
   * Used to detect duplicates before import.
   * @returns {Set<string>}
   */
  function jiraGetExistingToday() {
    const today = dk(new Date());
    return new Set(
      planTasks.filter((t) => t.date === today).map((t) => t.text.toLowerCase().trim())
    );
  }

  /**
   * Returns true if the task ("KEY: Summary") already exists in today's plan.
   * @param {{key: string, summary: string}} t - Parsed Jira task.
   * @returns {boolean}
   */
  function jiraIsDup(t) {
    return jiraGetExistingToday().has(`${t.key}: ${t.summary}`.toLowerCase().trim());
  }

  /**
   * Finds an existing category that matches the given Jira parent key or label.
   * Prefers exact ticket-key-prefix matches over label matches to prevent
   * ambiguous substring hits (e.g. "UAT" matching "Pre-UAT").
   * @param {string|null} parentKey - Parent epic key (e.g. "AITO-123").
   * @param {string}      label     - Parent epic label text.
   * @returns {Object|null} Matching category object, or null if none found.
   */
  function jiraMatchCat(parentKey, label) {
    // Match by ticket key prefix first — most reliable, prevents "UAT" matching "Pre-UAT"
    if (parentKey) {
      const byKey = categories.find(
        (c) => c.label.startsWith(parentKey + ':') || c.label === parentKey
      );
      if (byKey) return byKey;
    }
    // Fall back to exact label match only — no fuzzy substring matching
    const lower = label.toLowerCase().trim();
    return categories.find((c) => c.label.toLowerCase().trim() === lower) || null;
  }

  /**
   * Brings archived epics back into the pickers when an import actually lands
   * tasks on them — an imported ticket is proof the epic is in use again, and
   * leaving it archived would tag the new task to an epic the user cannot see
   * or select. Called from the import handler rather than from jiraMatchCat so
   * that merely previewing a CSV never mutates persisted state.
   * @param {Array<{id: string}>} mappedCats - Category objects the import mapped tickets onto.
   * @returns {number} How many epics were un-archived.
   */
  function unarchiveImportedCats(mappedCats) {
    let restored = 0;
    mappedCats.forEach((mapped) => {
      const cat = categories.find((c) => c.id === mapped.id);
      if (!cat || !cat.archived) return;
      delete cat.archived;
      restored++;
      wlLog.info('jiraImport: un-archived epic matched by import', {
        catId: cat.id,
        label: cat.label,
      });
    });
    return restored;
  }

  /**
   * Builds `jiraCatMap` — a lookup from "parentKey|parentSummary" to a category
   * object (existing or newly generated). New categories get unique auto-colours
   * not already used by existing ones.
   * @param {Array<Object>} tasks - Parsed Jira task list.
   */
  function jiraBuildCatMap(tasks) {
    jiraCatMap = {};
    const usedColors = new Set(categories.map((c) => c.color));
    let ci = 0;
    const seen = new Set();
    tasks
      .filter((t) => t.parentKey || t.parentSummary)
      .forEach((t) => {
        const mapKey = (t.parentKey || '') + '|' + (t.parentSummary || '');
        if (seen.has(mapKey)) return;
        seen.add(mapKey);
        const label =
          t.parentKey && t.parentSummary
            ? `${t.parentKey}: ${t.parentSummary.trim()}`
            : (t.parentSummary || t.parentKey || '').trim();
        if (!label) return;
        const existing = jiraMatchCat(t.parentKey, label);
        if (existing) {
          jiraCatMap[mapKey] = { ...existing, isNew: false };
        } else {
          const color =
            AUTO_COLORS.find((c) => !usedColors.has(c)) || AUTO_COLORS[ci % AUTO_COLORS.length];
          ci++;
          usedColors.add(color);
          jiraCatMap[mapKey] = {
            id: 'epic_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            label,
            color,
            isNew: true,
          };
        }
      });
  }

  /**
   * Returns the resolved category object for a Jira task using `jiraCatMap`.
   * @param {{parentKey: string|null, parentSummary: string|null}} t - Parsed task.
   * @returns {Object|null} Category object, or null if the task has no parent.
   */
  function jiraGetCat(t) {
    return jiraCatMap[(t.parentKey || '') + '|' + (t.parentSummary || '')] || null;
  }

  /**
   * Updates the importer count line showing total issues, selected count, and
   * how many are already in today's tasks.
   */
  function jiraUpdateCount() {
    const sel = [...jiraSelected].length;
    const dups = jiraTasks.filter((t) => jiraIsDup(t)).length;
    let txt = `${jiraTasks.length} issue${jiraTasks.length !== 1 ? 's' : ''} · ${sel} selected`;
    if (dups) txt += ` · ${dups} already in today's tasks`;
    document.getElementById('jiraCount').textContent = txt;
  }

  /**
   * Renders the grouped task list in the importer UI. Tasks are grouped by
   * category; duplicates are shown with a disabled checkbox and an "already added"
   * badge. Calls {@link jiraUpdateCount} to refresh the summary line.
   */
  function jiraRenderTasks() {
    jiraUpdateCount();
    const container = document.getElementById('jiraTaskRows');
    container.style.display = '';

    // Group tasks by their category key, preserving first-seen order
    const groups = [];
    const groupIndex = {};
    jiraTasks.forEach((t, i) => {
      const cat = jiraGetCat(t);
      const key = cat ? cat.id : '__none__';
      if (!(key in groupIndex)) {
        groupIndex[key] = groups.length;
        groups.push({ cat, tasks: [] });
      }
      groups[groupIndex[key]].tasks.push({ t, i });
    });

    container.innerHTML = groups
      .map(({ cat, tasks }) => {
        const catDot = cat
          ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${safeCssColor(cat.color)};flex-shrink:0;margin-right:6px;vertical-align:-1px"></span>`
          : '';
        const catName = cat ? escHtml(cat.label) : 'no category';
        const allDup = tasks.every(({ t }) => jiraIsDup(t));
        const newBadge =
          cat && cat.isNew
            ? `<span class="jira-badge jira-badge-new" style="margin-left:6px">new category</span>`
            : '';
        const header = `<div style="display:flex;align-items:center;padding:6px 10px 4px;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-top:6px">
          ${catDot}<span>${catName}</span>${newBadge}
          ${allDup ? `<span class="jira-badge jira-badge-dup" style="margin-left:6px">all added</span>` : ''}
        </div>`;

        const rows = tasks
          .map(({ t, i }) => {
            const mapped = jiraMapStatus(t.status);
            const isDone = mapped === 'done';
            const isDup = jiraIsDup(t);
            const slabel = JIRA_STATUS_LABEL[mapped] || t.status;
            const statusBadge = isDup
              ? `<span class="jira-badge jira-badge-dup">already added</span>`
              : `<span class="jira-badge jira-badge-status-${mapped}">${escHtml(slabel)}</span>`;
            const rowClass = ['jira-task-row', isDup ? 'dup' : '', isDone && !isDup ? 'done' : '']
              .filter(Boolean)
              .join(' ');
            return `<label class="${rowClass}">
            <input type="checkbox" ${jiraSelected.has(i) ? 'checked' : ''} ${isDup ? 'disabled' : ''} data-ji="${i}"
              style="flex-shrink:0" onchange="window.__jiraToggle(${i},this.checked)">
            <span class="jira-task-key">${escHtml(t.key)}</span>
            <span class="jira-task-title">${escHtml(t.summary)}</span>
            ${statusBadge}
          </label>`;
          })
          .join('');

        return header + rows;
      })
      .join('');

    document.getElementById('jiraSelRow').style.display = '';
  }

  /**
   * Minimal RFC-4180 CSV parser with no external dependencies.
   * Returns an array of objects keyed by the first-row headers.
   * @param {string} text - Raw CSV file content.
   * @returns {Array<Object>} Parsed rows; empty array if fewer than 2 rows.
   */
  function parseCSV(text) {
    // Minimal RFC-4180 CSV parser — no external dependency
    const rows = [];
    let field = '',
      row = [],
      inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i],
        next = text[i + 1];
      if (inQ) {
        if (ch === '"' && next === '"') {
          field += '"';
          i++;
        } else if (ch === '"') {
          inQ = false;
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQ = true;
        } else if (ch === ',') {
          row.push(field);
          field = '';
        } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
          if (ch === '\r') i++;
          row.push(field);
          field = '';
          rows.push(row);
          row = [];
        } else {
          field += ch;
        }
      }
    }
    if (row.length || field) {
      row.push(field);
      rows.push(row);
    }
    if (rows.length < 2) return [];
    const headers = rows[0];
    return rows
      .slice(1)
      .filter((r) => r.some((f) => f.trim()))
      .map((r) => {
        const o = {};
        headers.forEach((h, i) => {
          o[h.trim()] = (r[i] || '').trim();
        });
        return o;
      });
  }

  /**
   * Parses a Jira CSV export string, builds the category map, pre-selects
   * non-done non-duplicate tasks, and renders the importer UI.
   * @param {string} text - Raw CSV content from the dropped/selected file.
   */
  function jiraParseAndRender(text) {
    let rows;
    try {
      rows = parseCSV(text);
    } catch (err) {
      setJiraMsg('Could not parse CSV: ' + err.message, false);
      return;
    }
    if (!rows.length) {
      setJiraMsg('CSV is empty or could not be parsed.', false);
      return;
    }
    const invalidRows = rows.filter((r) => !validJiraCsvRow(r));
    if (invalidRows.length) {
      wlLog.warn(
        `jiraParseAndRender: ${invalidRows.length} row(s) missing required columns (Issue key / Summary) — check delimiter`,
        invalidRows
      );
    }
    jiraTasks = rows.filter(validJiraCsvRow).map((r) => ({
      key: (r['Issue key'] || r['Key'] || r['Issue Key'] || '').trim(),
      summary: (r['Summary'] || r['summary'] || '').trim(),
      status: (r['Status'] || r['status'] || '').trim(),
      parentKey: (r['Parent key'] || r['Parent Key'] || '').trim() || null,
      parentSummary:
        (r['Parent summary'] || r['Parent Summary'] || r['Epic Name'] || '').trim() || null,
    }));

    if (!jiraTasks.length) {
      setJiraMsg('No tasks found — expected columns: Issue key, Summary, Status.', false);
      return;
    }
    // Pre-select: skip done and duplicates
    jiraSelected = new Set(
      jiraTasks
        .map((_, i) => i)
        .filter((i) => {
          const t = jiraTasks[i];
          return jiraMapStatus(t.status) !== 'done' && !jiraIsDup(t);
        })
    );
    jiraBuildCatMap(jiraTasks);
    jiraRenderTasks();
    setJiraMsg('', false);
  }

  /**
   * Displays a status/error message in the `#jiraMsg` element.
   * @param {string}  msg - Message text (empty string to clear).
   * @param {boolean} ok  - If true, styles the message as a success; otherwise as an error.
   */
  function setJiraMsg(msg, ok) {
    const el = document.getElementById('jiraMsg');
    el.textContent = msg;
    el.className = 'jira-msg' + (ok ? ' ok' : '');
  }

  /**
   * Reads the given File as UTF-8 text and passes the result to
   * {@link jiraParseAndRender}. No-ops if `f` is falsy.
   * @param {File|null} f - The CSV file to load.
   */
  function jiraHandleFile(f) {
    if (!f) return;
    document.getElementById('jiraMsg').textContent = '';
    document.getElementById('jiraImportBtn').disabled = false;
    const reader = new FileReader();
    reader.onload = (e) => jiraParseAndRender(e.target.result);
    reader.readAsText(f, 'UTF-8');
  }

  // Exposed globally for inline onchange handlers
  window.__jiraToggle = (i, on) => {
    on ? jiraSelected.add(i) : jiraSelected.delete(i);
    jiraUpdateCount();
  };

  // Drop zone
  const drop = document.getElementById('jiraDrop');
  drop.addEventListener('click', () => document.getElementById('jiraFileIn').click());
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) jiraHandleFile(f);
  });
  document
    .getElementById('jiraFileIn')
    .addEventListener('change', (e) => jiraHandleFile(e.target.files[0]));

  // Restore stored collapse state (HTML default is collapsed).
  document
    .getElementById('jiraSection')
    .classList.toggle('collapsed', readCollapseState('jiraSection', true));

  // Toggle collapse
  document.getElementById('jiraHeader').addEventListener('click', () => {
    const section = document.getElementById('jiraSection');
    section.classList.toggle('collapsed');
    writeCollapseState('jiraSection', section.classList.contains('collapsed'));
  });

  // Select all / none
  document.getElementById('jiraSelAll').addEventListener('click', () => {
    jiraTasks.forEach((t, i) => {
      if (!jiraIsDup(t)) jiraSelected.add(i);
    });
    document
      .querySelectorAll('#jiraTaskRows input[type=checkbox]:not([disabled])')
      .forEach((cb) => (cb.checked = true));
    jiraUpdateCount();
  });
  document.getElementById('jiraSelNone').addEventListener('click', () => {
    jiraSelected.clear();
    document
      .querySelectorAll('#jiraTaskRows input[type=checkbox]:not([disabled])')
      .forEach((cb) => (cb.checked = false));
    jiraUpdateCount();
  });

  // Import
  document.getElementById('jiraImportBtn').addEventListener('click', () => {
    if (!jiraSelected.size) {
      setJiraMsg('Nothing selected.', false);
      return;
    }
    const today = dk(new Date());
    const existing = new Set(
      planTasks.filter((p) => p.date === today).map((p) => p.text.toLowerCase().trim())
    );

    // Create any new categories
    Object.values(jiraCatMap).forEach((cat) => {
      if (cat.isNew && !categories.find((c) => c.id === cat.id)) {
        categories.push({ id: cat.id, label: cat.label, color: cat.color });
      }
    });

    let added = 0,
      skipped = 0;
    // Epics that actually receive a task, so archived ones can be revived below
    const importedCats = [];
    // Import in category-group order (same order as displayed)
    const grouped = [];
    const seen = {};
    jiraTasks.forEach((t, i) => {
      if (!jiraSelected.has(i)) return;
      const cat = jiraGetCat(t);
      const key = cat ? cat.id : '__none__';
      if (!(key in seen)) {
        seen[key] = grouped.length;
        grouped.push([]);
      }
      grouped[seen[key]].push({ t, i });
    });
    grouped.forEach((group) =>
      group.forEach(({ t }) => {
        const text = `${t.key}: ${t.summary}`;
        if (existing.has(text.toLowerCase().trim())) {
          skipped++;
          return;
        }
        const cat = jiraGetCat(t);
        planTasks.push({
          id: 'jira_' + Date.now() + '_' + Math.random().toString(36).slice(2),
          text,
          status: jiraMapStatus(t.status),
          tag: cat ? cat.id : 'other',
          date: today,
        });
        if (cat) importedCats.push(cat);
        existing.add(text.toLowerCase().trim());
        added++;
      })
    );

    // An epic that just received a task is in use again, archived or not
    unarchiveImportedCats(importedCats);

    save();
    savePlan();
    render();
    renderPlan();

    // Refresh duplicate markers in the list
    jiraRenderTasks();

    if (added) {
      setJiraMsg(
        `✓ ${added} task${added !== 1 ? 's' : ''} added${skipped ? ` · ${skipped} skipped` : ''}`,
        true
      );
      document.getElementById('jiraImportBtn').disabled = true;
    } else {
      setJiraMsg('All selected tasks already exist for today.', false);
    }
  });
})();
