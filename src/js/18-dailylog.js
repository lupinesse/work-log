// ── 18-dailylog.js — Daily Log unified feed ──

let _dlActive = false;

/**
 * Builds a chronologically sorted array of feed items for the Daily Log view.
 * Merges time entries, log notes, and task status comments for the given day.
 * @param {string} dateKey - YYYY-MM-DD date string.
 * @returns {Array<{ts: number, type: string, color: string, text: string, sub: string}>}
 */
function buildDailyLogItems(dateKey) {
  const items = [];

  entries
    .filter((e) => e.date === dateKey)
    .forEach((e) => {
      const cat = getCat(e.tag);
      items.push({
        ts: e.ts,
        type: 'entry',
        entryId: e.id,
        color: cat.color,
        text: escHtml(e.text),
        sub: `${escHtml(cat.label)} · ${e.tsEnd ? fmtDur(e.tsEnd - e.ts) : 'ongoing'} · ${sigSymbol(e)}`,
      });
    });

  logNotes
    .filter((n) => n.date === dateKey)
    .forEach((n) => {
      items.push({
        ts: n.ts,
        type: 'note',
        color: 'var(--bg3)',
        text: `<em>${escHtml(n.text)}</em>`,
        sub: 'Note',
      });
    });

  planTasks
    .filter((t) => t.date === dateKey && Array.isArray(t.statusComments))
    .forEach((t) => {
      t.statusComments.forEach((c) => {
        if (dk(new Date(c.ts)) === dateKey) {
          items.push({
            ts: c.ts,
            type: 'task',
            color: '#ef9f27',
            text: `<span class="tl-task-name">${escHtml(t.text)}</span> — ${escHtml(c.text)}`,
            sub: 'Task update',
          });
        }
      });
    });

  return items.sort((a, b) => a.ts - b.ts);
}

/** Renders the Daily Log feed for the currently viewed date. */
function renderDailyLog() {
  const el = document.getElementById('dailyLogFeed');
  if (!el) return;

  const dateKey = dk(viewDate);
  const items = buildDailyLogItems(dateKey);

  if (!items.length) {
    wlLog.info('renderDailyLog: empty feed', { dateKey });
    el.innerHTML = `<div class="tl-empty">No entries or notes for this day yet.</div>`;
  } else {
    wlLog.info('renderDailyLog: rendering feed', { dateKey, itemCount: items.length });
    el.innerHTML = items
      .map((item, i) => {
        const time = new Date(item.ts);
        const hh = String(time.getHours()).padStart(2, '0');
        const mm = String(time.getMinutes()).padStart(2, '0');
        return `
        <div class="tl-row">
          <span class="tl-time">${hh}:${mm}</span>
          <div class="tl-dot-col">
            <div class="tl-dot" style="background:${item.color}"></div>
            ${i < items.length - 1 ? '<div class="tl-line"></div>' : ''}
          </div>
          <div class="tl-body">
            <div class="tl-text">${item.text}</div>
            <div class="tl-sub">${item.sub}</div>
          </div>
        </div>`;
      })
      .join('');
  }

  const noteRow = document.getElementById('dailyLogNoteRow');
  if (noteRow) noteRow.style.display = isToday(viewDate) ? '' : 'none';

  document.getElementById('dailyLogNoteBtn')?.addEventListener('click', addLogNote);
  document.getElementById('dailyLogNoteInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addLogNote();
  });
}

/** Reads the note input, appends a note to logNotes, persists, and re-renders. */
function addLogNote() {
  const inp = document.getElementById('dailyLogNoteInput');
  const text = inp ? inp.value.trim() : '';
  if (!text) {
    wlLog.info('addLogNote: rejected — empty input');
    return;
  }
  logNotes.push({ id: Date.now() + '', text, ts: Date.now(), date: dk(new Date()), type: 'note' });
  saveLogNotes();
  if (inp) inp.value = '';
  wlLog.info('addLogNote: note saved', { length: text.length });
  renderTodayFlow();
}

/** Registers the tab-click delegation listener. Called once on DOMContentLoaded. */
function initDailyLog() {
  // Buttons live inside tl.innerHTML (rebuilt on every render) — use delegation
  document.addEventListener('click', (e) => {
    if (e.target.id !== 'tabDailyLog') return;
    _dlActive = !_dlActive;
    const section = document.getElementById('dailyLogSection');
    if (section) section.style.display = _dlActive ? '' : 'none';
    if (_dlActive) renderDailyLog();
    render();
  });
}
