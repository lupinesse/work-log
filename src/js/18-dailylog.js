// ── 18-dailylog.js — Daily Log feed builder + note input ──

/**
 * Builds a chronologically sorted array of feed items for the Log view.
 * Merges time entries, log notes, and task status comments for the given day.
 *
 * Item types:
 *  - `'entry'`        — a time-tracked entry; includes `entryId`.
 *  - `'note'`         — a freeform log note; text is wrapped in `<em>`.
 *  - `'session-note'` — a note attached to a running/completed entry;
 *                       includes `parentEntryId`. Renderers nest these
 *                       inside their parent entry row rather than as
 *                       standalone timeline rows.
 *  - `'task'`         — a plan-task status comment.
 *
 * @param {string} dateKey - YYYY-MM-DD date string.
 * @returns {Array<{ts: number, type: string, entryId: (string|undefined), parentEntryId: (string|undefined), color: string, text: string, sub: string}>}
 */
function buildDailyLogItems(dateKey) {
  const items = [];

  entries
    .filter((entry) => entry.date === dateKey)
    .forEach((entry) => {
      const cat = getCat(entry.tag);
      items.push({
        ts: entry.ts,
        type: 'entry',
        entryId: entry.id,
        color: cat.color,
        text: escHtml(entry.text),
        sub: `${escHtml(cat.label)} · ${entry.tsEnd ? fmtDur(entry.tsEnd - entry.ts) : 'ongoing'} · ${sigSymbol(entry)}`,
      });
    });

  logNotes
    .filter((note) => note.date === dateKey)
    .forEach((note) => {
      if (note.type === 'session-note') {
        // Session-notes render nested under their parent entry, not as standalone rows.
        items.push({
          ts: note.ts,
          type: 'session-note',
          parentEntryId: note.entryId,
          color: 'var(--bg3)',
          text: escHtml(note.text),
          sub: '',
        });
      } else {
        items.push({
          ts: note.ts,
          type: 'note',
          color: 'var(--bg3)',
          text: `<em>${escHtml(note.text)}</em>`,
          sub: 'Note',
        });
      }
    });

  planTasks
    .filter((task) => task.date === dateKey && Array.isArray(task.statusComments))
    .forEach((task) => {
      task.statusComments.forEach((comment) => {
        if (dk(new Date(comment.ts)) === dateKey) {
          items.push({
            ts: comment.ts,
            type: 'task',
            taskId: task.id,
            color: '#ef9f27',
            text: `<span class="tl-task-name">${escHtml(task.text)}</span>${comment.comment ? ` — ${escHtml(comment.comment)}` : ''}`,
            sub: 'Task update',
          });
        }
      });
    });

  return items.sort((itemA, itemB) => itemA.ts - itemB.ts);
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
