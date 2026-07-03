/* ── Timeblock — grid rendering ── */
// Split out of 11-timeblock.js (QA finding: module size). Contains the full
// renderTimeblock() loop — time labels, slot grid, auto blocks merged from log
// entries, manual planned blocks, untracked-time labels and the now-line —
// plus all grid drag-and-drop wiring and the module-global drag state it
// exclusively owns. positionNowLine() lives here because it is
// render-positioning logic called by renderTimeblock() and 09-clock-weather.js.
//
// Load order: this file must keep its 11 prefix so it concatenates before
// 12a-changelog.js, whose top-level bootstrap calls renderTimeblock() and
// therefore needs the top-level drag state declared here already evaluated.

let tbDragSource = null; // 'grid' | 'plan'
let tbDragId = null; // block id when dragging from grid

/**
 * Renders the full time-block grid for the currently viewed date: time labels,
 * grid rows, planned blocks (with drag-to-move), live timer block, a "now" line,
 * and the plan-task drag targets. Also handles drag-and-drop wiring for
 * moving existing blocks and dropping tasks from the plan list.
 */
function renderTimeblock() {
  const dateKey = dk(viewDate);
  const liveEntry = activeTimer ? entries.find((entry) => entry.id === activeTimer.entryId) : null;

  // Time labels
  const timesEl = document.getElementById('tbTimes');
  timesEl.innerHTML = '';
  for (let i = 0; i <= TB_SLOTS; i++) {
    const d = document.createElement('div');
    d.className = 'tb-time-lbl' + (i === TB_SLOTS ? ' end' : '');
    d.textContent = slotToTime(i);
    timesEl.appendChild(d);
  }

  // Build grid slots
  const grid = document.getElementById('tbGrid');
  grid.innerHTML = '';
  for (let i = 0; i < TB_SLOTS; i++) {
    const s = document.createElement('div');
    s.className = 'tb-slot' + (i % 2 === 1 ? ' half' : '');
    s.dataset.slot = i;
    grid.appendChild(s);
  }

  // ── Auto blocks from log entries (render first = below manual blocks) ──
  const liveId = activeTimer ? activeTimer.entryId : null;
  const tbStart = TB_START * 60,
    tbEnd = TB_END * 60;

  function minsFromTs(ts) {
    const d = new Date(ts);
    return d.getHours() * 60 + d.getMinutes();
  }
  function autoBlockEl(text, tag, startTs, endTs, isLive) {
    const cat = getCat(tag || 'other');
    const startMins = minsFromTs(startTs);
    const endMins = minsFromTs(endTs);
    if (startMins >= tbEnd || endMins <= tbStart) return null;
    const cStart = Math.max(startMins, tbStart);
    const cEnd = Math.min(endMins, tbEnd);
    const topPx = ((cStart - tbStart) / 30) * TB_SLOT_H;
    const hPx = Math.max(TB_SLOT_H * 0.5, ((cEnd - cStart) / 30) * TB_SLOT_H);
    const dur = Math.round((endTs - startTs) / 60000);
    const h = Math.floor(dur / 60),
      m = dur % 60;
    const durStr = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
    const el = document.createElement('div');
    el.className = 'tb-block auto' + (isLive ? ' live' : '');
    if (isLive) el.id = 'tb-live-block';
    el.style.top = topPx + 'px';
    el.style.height = hPx + 'px';
    el.style.background = cat.color + '28';
    el.style.borderLeftColor = cat.color;
    el.style.color = cat.color;
    const icon = isLive ? '▶ ' : '● ';
    el.innerHTML =
      `<div class="tb-block-name">${icon}${escHtml(text)}</div>` +
      `<div class="tb-block-sub" id="${isLive ? 'tb-live-sub' : ''}">${escHtml(cat.label)} · ${durStr}</div>`;
    return el;
  }

  const meetingNames = new Set(
    blocks
      .filter((block) => block.date === dateKey && block.type === 'meeting')
      .map((block) => block.text.toLowerCase())
  );

  // Merge same-task entries with < 30 min gap into a single visual block
  function mergeAutoEntries(rawEntries) {
    const sorted = [...rawEntries].sort((a, b) => a.ts - b.ts);
    const merged = [];
    for (const e of sorted) {
      const prev = merged[merged.length - 1];
      const prevEnd = prev ? prev._mergedEnd || prev.ts : 0;
      if (
        prev &&
        prev.text.toLowerCase() === e.text.toLowerCase() &&
        e.ts - prevEnd <= 30 * 60 * 1000
      ) {
        prev._mergedEnd = Math.max(prevEnd, e.tsEnd || e.ts);
        prev.tag = prev.tag || e.tag;
      } else {
        merged.push({ ...e, _mergedEnd: e.tsEnd || e.ts });
      }
    }
    return merged;
  }

  const dayAutoEntries = entries.filter(
    (entry) =>
      entry.date === dateKey &&
      entry.id !== liveId &&
      !meetingNames.has(entry.text.replace(/^📅\s*/, '').toLowerCase()) &&
      !meetingNames.has(entry.text.toLowerCase()) &&
      (entry.tsEnd || isToday(viewDate))
  );
  mergeAutoEntries(dayAutoEntries).forEach((entry) => {
    const endTs = entry._mergedEnd || (isToday(viewDate) ? Date.now() : null);
    if (!endTs) return;
    const el = autoBlockEl(entry.text, entry.tag, entry.ts, endTs, false);
    if (el) grid.appendChild(el);
  });

  // Live timer block — skip if the active timer is a meeting block (it will pulse instead)
  if (liveId) {
    const le = entries.find((entry) => entry.id === liveId);
    const isMeetingBlock =
      le &&
      blocks.some(
        (block) =>
          block.date === dateKey &&
          block.type === 'meeting' &&
          block.text.toLowerCase() === le.text.toLowerCase()
      );
    if (le && le.date === dateKey && !isMeetingBlock) {
      const fakeEnd = activeTimer.paused
        ? le.ts + (activeTimer.accumulatedMs || 0) // paused: stop at pause point
        : Math.max(Date.now(), le.ts + 60000); // running: extend to now
      const el = autoBlockEl(le.text, le.tag, le.ts, fakeEnd, true);
      if (el) grid.appendChild(el);
    }
  }

  // ── Manual planned blocks (render last = on top, dashed border) ──
  const dayBlocks = blocks.filter((block) => block.date === dateKey);
  const tbLiveEntry = activeTimer ? entries.find((entry) => entry.id === activeTimer.entryId) : null;
  dayBlocks.forEach((block) => {
    const cat = getCat(block.tag || 'other');
    const el = document.createElement('div');
    const isDone = planTasks.some(
      (task) =>
        task.date === dateKey && task.text.toLowerCase() === block.text.toLowerCase() && task.status === 'done'
    );
    const cleanLiveText = tbLiveEntry ? tbLiveEntry.text.replace(/^📅\s*/, '').toLowerCase() : '';
    const isMeetingBlock =
      tbLiveEntry &&
      b.type === 'meeting' &&
      (b.text.toLowerCase() === cleanLiveText ||
        b.text.toLowerCase() === tbLiveEntry.text.toLowerCase());
    el.className = 'tb-block plan' + (isDone ? ' task-done' : '') + (isMeetingBlock ? ' live' : '');
    el.dataset.bid = block.id;
    el.draggable = true;
    el.style.top = block.slot * TB_SLOT_H + 1 + 'px';
    el.style.height = block.duration * TB_SLOT_H - 3 + 'px';
    el.style.background = cat.color + '18';
    el.style.borderLeftColor = cat.color;
    el.style.color = cat.color;

    const icon = block.type === 'meeting' ? '📅 ' : '';
    const emojiPrefix = block.emoji ? escHtml(block.emoji) + ' ' : '';
    const dur = block.duration * 30;
    const h = Math.floor(dur / 60),
      m = dur % 60;
    const durStr = h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
    el.innerHTML =
      `<div class="tb-block-name">${emojiPrefix}${icon}${escHtml(block.text)}</div>` +
      (block.duration > 1 ? `<div class="tb-block-sub">${escHtml(cat.label)} · ${durStr}</div>` : '') +
      (block.type !== 'meeting'
        ? `<button class="tb-block-start" data-bid="${block.id}" draggable="false">▶ start</button>`
        : '') +
      `<button class="tb-block-emoji${block.emoji ? ' has-emoji' : ''}" data-bid="${block.id}" title="add emoji" draggable="false">${block.emoji ? escHtml(block.emoji) : '✦'}</button>` +
      `<button class="tb-block-del" data-bid="${block.id}" draggable="false">&times;</button>`;

    el.addEventListener('dragstart', (event) => {
      tbDragSource = 'grid';
      tbDragId = block.id;
      event.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      tbDragSource = null;
      tbDragId = null;
    });
    el.querySelector('.tb-block-del').addEventListener('click', (event) => {
      event.stopPropagation();
      blocks = blocks.filter((otherBlock) => otherBlock.id !== block.id);
      saveBlocks();
      renderTimeblock();
    });
    const startBtn = el.querySelector('.tb-block-start');
    if (startBtn)
      startBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        tbStartBlock(block.id);
      });
    el.querySelector('.tb-block-emoji').addEventListener('click', (event) => {
      event.stopPropagation();
      openBlockEmojiPicker(block.id, event.currentTarget);
    });
    grid.appendChild(el);
  });

  // Untracked time — show faint label on past slots with no coverage (any viewed date)
  const nowMins = isToday(viewDate)
    ? new Date().getHours() * 60 + new Date().getMinutes()
    : TB_END * 60; // for past days, all slots are "past"

  // Use start-of-day as floor — slots before work started aren't "untracked"
  const sodTs = isToday(viewDate) ? getDayStart() : null;
  const sodMins = sodTs
    ? new Date(sodTs).getHours() * 60 + new Date(sodTs).getMinutes()
    : TB_START * 60; // no start set — use grid start as default

  // Build a set of 30-min slots that have coverage (from entries or planned blocks)
  const coveredSlots = new Set();
  entries
    .filter((entry) => entry.date === dateKey && entry.tsEnd)
    .forEach((entry) => {
      const startSlot = timeToSlot(new Date(entry.ts).getHours(), new Date(entry.ts).getMinutes());
      // If tsEnd is exactly on a 30-min boundary (e.g. 09:30:00), back off 1 minute
      // so we don't accidentally mark the NEXT slot as covered
      const endD = new Date(entry.tsEnd);
      const onBoundary = endD.getMinutes() % 30 === 0 && endD.getSeconds() === 0;
      // timeToSlot uses Math.round(m/30), so backing off 1 min (→29) still rounds to slot+1.
      // Instead compute endSlot directly: if on a boundary, the entry ends AT that boundary,
      // meaning the boundary's slot is NOT covered — use the slot before it.
      const endSlot = onBoundary
        ? timeToSlot(endD.getHours(), endD.getMinutes()) - 1
        : timeToSlot(endD.getHours(), endD.getMinutes());
      for (let s = Math.max(0, startSlot); s < Math.min(TB_SLOTS, endSlot + 1); s++)
        coveredSlots.add(s);
    });
  if (activeTimer && liveEntry && liveEntry.date === dateKey) {
    const startSlot = timeToSlot(
      new Date(liveEntry.ts).getHours(),
      new Date(liveEntry.ts).getMinutes()
    );
    if (activeTimer.paused) {
      // Paused: only cover slots up to the pause point
      const pauseEnd = new Date(liveEntry.ts + (activeTimer.accumulatedMs || 0));
      const endSlot = timeToSlot(pauseEnd.getHours(), pauseEnd.getMinutes());
      for (let s = Math.max(0, startSlot); s < Math.min(TB_SLOTS, endSlot + 1); s++)
        coveredSlots.add(s);
    } else {
      for (let s = Math.max(0, startSlot); s < TB_SLOTS; s++) coveredSlots.add(s);
    }
  }
  blocks
    .filter((block) => block.date === dateKey)
    .forEach((block) => {
      for (let s = block.slot; s < Math.min(TB_SLOTS, block.slot + block.duration); s++) coveredSlots.add(s);
    });

  for (let slot = 0; slot < TB_SLOTS; slot++) {
    const slotStartMins = TB_START * 60 + slot * 30;
    if (slotStartMins < sodMins) continue; // before work started — not untracked
    const isPast = slotStartMins < nowMins; // slot has started (not necessarily fully elapsed)
    if (!isPast || coveredSlots.has(slot)) continue;
    const untracked = document.createElement('div');
    untracked.className = 'tb-untracked';
    untracked.style.top = slot * TB_SLOT_H + 1 + 'px';
    untracked.style.height = TB_SLOT_H - 2 + 'px';
    untracked.textContent = 'untracked';
    grid.appendChild(untracked);
  }

  // Current time indicator (today only)
  if (isToday(viewDate)) {
    const nowLine = document.createElement('div');
    nowLine.className = 'tb-now-line';
    nowLine.id = 'tbNowLine';
    grid.appendChild(nowLine);
    positionNowLine();
  }

  // Grid-level drag/drop (works even when blocks overlap slots)
  grid._dragSlot = 0;
  grid.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = grid.getBoundingClientRect();
    const slot = Math.max(
      0,
      Math.min(TB_SLOTS - 1, Math.floor((event.clientY - rect.top) / TB_SLOT_H))
    );
    grid.querySelectorAll('.tb-slot.drag-over').forEach((slotEl) => slotEl.classList.remove('drag-over'));
    const slotEl = grid.querySelector(`[data-slot="${slot}"]`);
    if (slotEl) slotEl.classList.add('drag-over');
    grid._dragSlot = slot;
  });
  grid.addEventListener('dragleave', (event) => {
    if (!grid.contains(event.relatedTarget))
      grid.querySelectorAll('.tb-slot.drag-over').forEach((slotEl) => slotEl.classList.remove('drag-over'));
  });
  grid.addEventListener('drop', (event) => {
    event.preventDefault();
    grid.querySelectorAll('.tb-slot.drag-over').forEach((slotEl) => slotEl.classList.remove('drag-over'));
    const target = grid._dragSlot;

    if (tbDragSource === 'grid' && tbDragId) {
      const draggedBlock = blocks.find((block) => block.id === tbDragId);
      if (draggedBlock) {
        const newSlot = Math.min(target, TB_SLOTS - draggedBlock.duration);
        const newStart = TB_START * 60 + newSlot * 30;
        const newEnd = newStart + draggedBlock.duration * 30;
        const hits = tbOverlaps(newStart, newEnd, dateKey, draggedBlock.id);
        if (hits.length && !confirm(`This overlaps with ${hits}.\n\nMove here anyway?`)) {
          tbDragSource = null;
          tbDragId = null;
          return;
        }
        draggedBlock.slot = newSlot;
        saveBlocks();
        renderTimeblock();
      }
    }
    tbDragSource = null;
    tbDragId = null;
  });
}

/**
 * Positions the "now" indicator line in the time-block grid to reflect the
 * current time. Hides the line when outside the grid's time range
 * (`TB_START`–`TB_END`).
 */
function positionNowLine() {
  const el = document.getElementById('tbNowLine');
  if (!el) return;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const tbStartMins = TB_START * 60,
    tbEndMins = TB_END * 60;
  if (mins < tbStartMins || mins > tbEndMins) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.style.top = ((mins - tbStartMins) / 30) * TB_SLOT_H + 'px';
}
