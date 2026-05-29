/* ── Distraction tracking ── */
const STORE_DISTRACTIONS = 'wl_distractions_v1';
function loadDistractions() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_DISTRACTIONS) || '[]');
    return Array.isArray(raw) ? raw.filter((d) => d && typeof d.ts === 'number') : [];
  } catch (e) {
    return [];
  }
}
function saveDistraction(note) {
  const entry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
  const d = {
    ts: Date.now(),
    date: dk(new Date()),
    task: entry ? entry.text : null,
    note: note || null,
  };
  const all = loadDistractions();
  all.push(d);
  localStorage.setItem(STORE_DISTRACTIONS, JSON.stringify(all));
  renderDistractionCount();
}
function renderDistractionCount() {
  const el = document.getElementById('distractionSection');
  if (!el) return;
  const today = dk(new Date());
  const all = loadDistractions().filter((d) => d.date === today);
  if (!all.length) {
    el.innerHTML = '';
    return;
  }
  const rows = all
    .map((d) => {
      const t = new Date(d.ts);
      const hh = String(t.getHours()).padStart(2, '0');
      const mm = String(t.getMinutes()).padStart(2, '0');
      const task = d.task
        ? `<span style="color:var(--text3);font-size:11px"> — ${escHtml(d.task)}</span>`
        : '';
      const note = d.note ? `<span style="color:var(--text2)"> "${escHtml(d.note)}"</span>` : '';
      return `<div style="font-size:12px;padding:3px 0;border-bottom:0.5px solid var(--border)">${hh}:${mm}${task}${note}</div>`;
    })
    .join('');
  el.innerHTML = `
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text3);margin-bottom:6px">
        😵 ${all.length} distraction${all.length === 1 ? '' : 's'} today
      </div>
      ${rows}`;
}

document.getElementById('timerDistract').addEventListener('click', () => {
  // Pause the timer if running
  if (activeTimer && !activeTimer.paused) pauseTimer();
  // Optional note — short prompt, easily dismissable
  const note = prompt('What pulled you away? (optional — press Enter to skip)');
  if (note === null) {
    // Cancelled — resume timer without logging
    if (activeTimer && activeTimer.paused) pauseTimer();
    return;
  }
  saveDistraction(note.trim() || null);
  // Timer stays paused — user resumes manually
  renderDistractionCount();
});

/* ── Parked thoughts ── */
const STORE_PARKED = 'wl_parked_v1';
let parkedThoughts = [];

function saveParked() {
  localStorage.setItem(STORE_PARKED, JSON.stringify(parkedThoughts));
}
function loadParked() {
  try {
    parkedThoughts = JSON.parse(localStorage.getItem(STORE_PARKED) || '[]');
  } catch (e) {
    parkedThoughts = [];
  }
}
function renderParked() {
  const open = parkedThoughts.filter((p) => !p.done);
  const section = document.getElementById('parkSection');
  const list = document.getElementById('parkList');
  const badge = document.getElementById('parkBadge');
  if (!section || !list) return;
  if (open.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  if (badge) badge.textContent = open.length;
  list.innerHTML = open
    .map(
      (p) => `
      <div class="parked-item" data-id="${p.id}">
        <div class="parked-item-text">
          ${escHtml(p.text)}
          ${p.fromTask ? `<span class="parked-from">while working on: ${escHtml(p.fromTask)}</span>` : ''}
        </div>
        <button class="parked-promote" data-id="${p.id}">→ task</button>
        <button class="parked-dismiss" data-id="${p.id}" title="dismiss">✓</button>
      </div>`
    )
    .join('');
  list.querySelectorAll('.parked-promote').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = parkedThoughts.find((x) => x.id === btn.dataset.id);
      if (!p) return;
      const todayKey = dk(new Date());
      planTasks.push({
        id: Date.now() + '',
        text: p.text,
        status: 'todo',
        date: todayKey,
        tag: selectedTag,
      });
      savePlan();
      p.done = true;
      saveParked();
      renderParked();
      renderPlan();
    });
  });
  list.querySelectorAll('.parked-dismiss').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = parkedThoughts.find((x) => x.id === btn.dataset.id);
      if (p) {
        p.done = true;
        saveParked();
        renderParked();
      }
    });
  });
}

// Park button in timer bar
(() => {
  const btn = document.getElementById('timerParkBtn');
  const inp = document.getElementById('parkCapture');
  if (!btn || !inp) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const showing = inp.classList.contains('show');
    inp.classList.toggle('show', !showing);
    btn.classList.toggle('active', !showing);
    if (!showing) {
      inp.focus();
    } else {
      inp.value = '';
    }
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = inp.value.trim();
      if (!text) {
        inp.classList.remove('show');
        btn.classList.remove('active');
        return;
      }
      const liveEntry = activeTimer ? entries.find((en) => en.id === activeTimer.entryId) : null;
      parkedThoughts.push({
        id: Date.now() + '',
        text,
        ts: Date.now(),
        fromTask: liveEntry ? liveEntry.text : null,
        done: false,
      });
      saveParked();
      renderParked();
      inp.value = '';
      inp.classList.remove('show');
      btn.classList.remove('active');
    } else if (e.key === 'Escape') {
      inp.value = '';
      inp.classList.remove('show');
      btn.classList.remove('active');
    }
  });
})();

/* ── IDKW (I don't know what to do) ── */
(() => {
  const btn = document.getElementById('idkwBtn');
  if (!btn) return;
  let idkwTimer = null;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const todayKey = dk(new Date());
    const candidates = planTasks.filter(
      (t) => t.date === todayKey && t.status === 'todo' && !t.parentId
    );
    if (!candidates.length) return;
    document
      .querySelectorAll('.idkw-highlight')
      .forEach((el) => el.classList.remove('idkw-highlight'));
    clearTimeout(idkwTimer);
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const row = document.querySelector(`.plan-row[data-id="${pick.id}"]`);
    if (row) {
      row.classList.add('idkw-highlight');
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      idkwTimer = setTimeout(() => row.classList.remove('idkw-highlight'), 8000);
    }
  });
})();

/* ── Make-it-interesting hook (Feature 1) ── */
const STORE_HOOKS = 'wl_hooks';
function getHook(taskText) {
  try {
    const map = JSON.parse(localStorage.getItem(STORE_HOOKS) || '{}');
    return map[taskText.toLowerCase()] || null;
  } catch (e) {
    return null;
  }
}
function saveHook(taskText, hook) {
  try {
    const map = JSON.parse(localStorage.getItem(STORE_HOOKS) || '{}');
    if (hook === null) {
      delete map[taskText.toLowerCase()];
    } else {
      map[taskText.toLowerCase()] = hook;
    }
    localStorage.setItem(STORE_HOOKS, JSON.stringify(map));
  } catch (e) {
    wlLog.warn('saveHook: failed to persist task hook to localStorage', e);
  }
}

(() => {
  const btn = document.getElementById('timerHookBtn');
  const panel = document.getElementById('timerHookPanel');
  const content = document.getElementById('timerHookContent');
  const closeBtn = document.getElementById('timerHookClose');
  if (!btn || !panel || !content || !closeBtn) return;

  function getPromptForTask(taskText) {
    return `Task: "${taskText}"

Provide two short, actionable suggestions to make this task more engaging.

Requirements:
- No preamble, no headers, no numbering, no markdown formatting
- Plain text only
- First suggestion: a genuine curiosity angle or interesting adjacent perspective
- Second suggestion: a way to add time pressure or stakes without real consequences
- Each suggestion: 1-2 sentences max
- Separate them with a blank line`;
  }

  function closePanel() {
    panel.style.display = 'none';
  }
  function showHook(hookText) {
    content.textContent = hookText;
    panel.style.display = 'block';
  }
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch((e) => console.warn('Clipboard failed:', e));
  }

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!activeTimer) return;
    const entry = entries.find((en) => en.id === activeTimer.entryId);
    if (!entry) return;
    const taskText = entry.text.trim();
    const cached = getHook(taskText);
    if (cached) {
      showHook(cached);
      return;
    }

    content.textContent = 'thinking...';
    panel.style.display = 'block';
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system:
            'You help ADHD users make boring tasks engaging. Provide brief, practical suggestions with no numbering, labels, or preamble. Format: suggestion 1 on first line, blank line, suggestion 2 on third line. Plain text only, no markdown.',
          messages: [{ role: 'user', content: getPromptForTask(taskText) }],
        }),
      });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      const hookText = data.content?.[0]?.text || '';
      if (!hookText) throw new Error('No content in response');
      saveHook(taskText, hookText);
      showHook(hookText);
    } catch (err) {
      copyToClipboard(getPromptForTask(taskText));
      content.textContent =
        'AI unavailable — prompt copied to clipboard. (Set AnthropicApiKey in config.local.ps1)';
      panel.style.display = 'block';
    }
  });

  closeBtn.addEventListener('click', closePanel);

  const regenBtn = document.getElementById('timerHookRegen');
  if (regenBtn) {
    regenBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!activeTimer) return;
      const entry = entries.find((en) => en.id === activeTimer.entryId);
      if (!entry) return;
      saveHook(entry.text.trim(), null);
      btn.click();
    });
  }
})();

/* ── Accessibility utilities ── */

// Make a div[role="button"] respond to Enter/Space like a real button.
function a11yHeaderKeydown(el) {
  if (!el) return;
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  });
}

// Wire keyboard nav to all collapsible section headers that have role="button".
// planHeader is excluded: it contains a nested <button> (idkwBtn), so the outer
// div must not also carry role="button" or keyboard events would be ambiguous.
[
  'calHeader',
  'upcomingHeader',
  'pendingHeader',
  'completedHeader',
  'jiraHeader',
  'notionLinksHeader',
].forEach((id) => {
  a11yHeaderKeydown(document.getElementById(id));
});

// Sync aria-expanded on toggling section headers.
// Each section header's click listener was set up in other modules; we patch
// aria-expanded by observing classList changes on the section wrappers.
// planHeader is excluded: it has no widget role (it contains a nested <button>
// so role="button" would be invalid), and aria-expanded is not allowed on a
// generic div — see also the keyboard-nav exclusion note above.
(function syncAriaExpanded() {
  const pairs = [
    { sectionId: 'analyticsSection', headerId: 'analyticsHeader' },
    { sectionId: 'calSection', headerId: 'calHeader' },
    { sectionId: 'upcomingSection', headerId: 'upcomingHeader' },
    { sectionId: 'pendingSection', headerId: 'pendingHeader' },
    { sectionId: 'completedSection', headerId: 'completedHeader' },
    { sectionId: 'jiraSection', headerId: 'jiraHeader' },
    { sectionId: 'notionLinksSection', headerId: 'notionLinksHeader' },
    { sectionId: 'pomoSection', headerId: 'pomoHeader' },
  ];
  pairs.forEach(({ sectionId, headerId }) => {
    const section = document.getElementById(sectionId);
    const header = document.getElementById(headerId);
    if (!section || !header) return;
    // Set initial value from class list
    header.setAttribute('aria-expanded', String(!section.classList.contains('collapsed')));
    // Observe future class mutations
    new MutationObserver(() => {
      header.setAttribute('aria-expanded', String(!section.classList.contains('collapsed')));
    }).observe(section, { attributes: true, attributeFilter: ['class'] });
  });
})();

// Focus management for modal dialogs.
// Saves the element that had focus when a modal opens, restores it on close.
(function modalFocusManagement() {
  let _eodTrigger = null;
  let _expiryTrigger = null;

  // EOD modal
  const eodBtn = document.getElementById('eodBtn');
  const eodClose = document.getElementById('eodClose');
  const eodOverlay = document.getElementById('eodOverlay');

  if (eodBtn && eodOverlay) {
    eodBtn.addEventListener('click', () => {
      _eodTrigger = document.activeElement;
      setTimeout(() => {
        const first = eodOverlay.querySelector('button, [tabindex]:not([tabindex="-1"])');
        if (first) first.focus();
      }, 50);
    });

    function restoreEodFocus() {
      if (_eodTrigger) {
        _eodTrigger.focus();
        _eodTrigger = null;
      }
    }
    if (eodClose) eodClose.addEventListener('click', restoreEodFocus);
    eodOverlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        eodOverlay.classList.remove('show');
        restoreEodFocus();
      }
    });
  }

  // Expiry modal
  const expiryBtn = document.getElementById('expiryBtn');
  const expiryCancel = document.getElementById('expiryCancel');
  const expirySave = document.getElementById('expirySave');
  const expiryOverlay = document.getElementById('expiryOverlay');

  if (expiryBtn && expiryOverlay) {
    expiryBtn.addEventListener('click', () => {
      _expiryTrigger = document.activeElement;
    });

    function restoreExpiryFocus() {
      if (_expiryTrigger) {
        _expiryTrigger.focus();
        _expiryTrigger = null;
      }
    }
    if (expiryCancel) expiryCancel.addEventListener('click', restoreExpiryFocus);
    if (expirySave) expirySave.addEventListener('click', restoreExpiryFocus);
  }
})();
