// ── 18-dailylog.js — Daily Log feed builder + note input ──

/**
 * Builds a chronologically sorted array of feed items for the Log view.
 * Merges time entries, log notes, and task status comments for the given day.
 * Entry items include `entryId` so the Today's Flow renderers can look up the
 * underlying entry object for live-timer state.
 * @param {string} dateKey - YYYY-MM-DD date string.
 * @returns {Array<{ts: number, type: string, entryId: (string|undefined), color: string, text: string, sub: string}>}
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
