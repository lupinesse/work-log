/* ── Timeblock ── */
/**
 * localStorage key for the time-block array.
 * @type {string}
 */
const STORE_BLOCKS = 'wl_blocks_v1';
// Assumption: a standard workday starts no earlier than 07:00 and ends no later
// than 21:00. Tasks scheduled outside this window are rare enough that they do
// not need to appear in the visual grid. If the assumption changes, update
// TB_START / TB_END here — slots and pixel heights are derived automatically.
const TB_START = 7; // 07:00
const TB_END = 21; // 21:00
const TB_SLOTS = (TB_END - TB_START) * 2; // 28 half-hour slots
const TB_SLOT_H = 36; // px per slot

let tbDragSource = null; // 'grid' | 'plan'
let tbDragId = null; // block id when dragging from grid
const notifiedBlocks = new Set();

/**
 * Loads time blocks from localStorage into `blocks`, filtering invalid entries.
 * Drops are reported via wlLog.warn so data-quality issues are visible in DevTools.
 * Applies a one-time migration to shift existing block slots by +2 when the
 * time-block grid start time changed from 08:00 to 07:00.
 */
function loadBlocks() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_BLOCKS) || '[]');
    const all = Array.isArray(raw) ? raw : [];
    blocks = all.filter(validBlock);
    if (blocks.length < all.length)
      wlLog.warn(`loadBlocks: dropped ${all.length - blocks.length} invalid block record(s)`, {
        total: all.length,
        kept: blocks.length,
      });
  } catch (e) {
    blocks = [];
    wlLog.error('loadBlocks: failed to parse time blocks from localStorage', e);
  }
  // One-time migration: TB_START shifted from 8→7, add 2 slots to all existing blocks
  if (!localStorage.getItem('wl_tb_migrated_7')) {
    blocks = blocks.map((b) => ({ ...b, slot: b.slot + 2 }));
    saveBlocks();
    localStorage.setItem('wl_tb_migrated_7', '1');
  }
}
/** Persists the current `blocks` array to localStorage. */
function saveBlocks() {
  localStorage.setItem(STORE_BLOCKS, JSON.stringify(blocks));
}

/**
 * Converts a 0-based half-hour slot index to an "HH:MM" label.
 * Slot 0 = `TB_START:00`, slot 2 = `TB_START+1:00`, etc.
 * @param {number} slot - 0-based slot index.
 * @returns {string} "HH:MM" formatted time string.
 */
function slotToTime(slot) {
  const total = TB_START * 60 + slot * 30;
  return (
    String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
  );
}
/**
 * Converts a time value to a 0-based slot index relative to `TB_START`.
 * Accepts either an "HH:MM" string or two separate (hours, minutes) arguments.
 * @param {string|number} hhmm - "HH:MM" string, or hours when `m2` is provided.
 * @param {number}        [m2] - Minutes (only when `hhmm` is a number).
 * @returns {number} 0-based slot index.
 */
function timeToSlot(hhmm, m2) {
  // Accept either "HH:MM" string or (hours, minutes) numbers
  const h = m2 !== undefined ? hhmm : parseInt(hhmm.split(':')[0]);
  const m = m2 !== undefined ? m2 : parseInt(hhmm.split(':')[1]);
  return (h - TB_START) * 2 + Math.round(m / 30);
}

/**
 * Renders the full time-block grid for the currently viewed date: time labels,
 * grid rows, planned blocks (with drag-to-move), live timer block, a "now" line,
 * and the plan-task drag targets. Also handles drag-and-drop wiring for
 * moving existing blocks and dropping tasks from the plan list.
 */
function renderTimeblock() {
  const dateKey = dk(viewDate);
  const liveEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;

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
      .filter((b) => b.date === dateKey && b.type === 'meeting')
      .map((b) => b.text.toLowerCase())
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
    (e) =>
      e.date === dateKey &&
      e.id !== liveId &&
      !meetingNames.has(e.text.replace(/^📅\s*/, '').toLowerCase()) &&
      !meetingNames.has(e.text.toLowerCase()) &&
      (e.tsEnd || isToday(viewDate))
  );
  mergeAutoEntries(dayAutoEntries).forEach((e) => {
    const endTs = e._mergedEnd || (isToday(viewDate) ? Date.now() : null);
    if (!endTs) return;
    const el = autoBlockEl(e.text, e.tag, e.ts, endTs, false);
    if (el) grid.appendChild(el);
  });

  // Live timer block — skip if the active timer is a meeting block (it will pulse instead)
  if (liveId) {
    const le = entries.find((e) => e.id === liveId);
    const isMeetingBlock =
      le &&
      blocks.some(
        (b) =>
          b.date === dateKey &&
          b.type === 'meeting' &&
          b.text.toLowerCase() === le.text.toLowerCase()
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
  const dayBlocks = blocks.filter((b) => b.date === dateKey);
  const tbLiveEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
  dayBlocks.forEach((b) => {
    const cat = getCat(b.tag || 'other');
    const el = document.createElement('div');
    const isDone = planTasks.some(
      (t) =>
        t.date === dateKey && t.text.toLowerCase() === b.text.toLowerCase() && t.status === 'done'
    );
    const cleanLiveText = tbLiveEntry ? tbLiveEntry.text.replace(/^📅\s*/, '').toLowerCase() : '';
    const isMeetingBlock =
      tbLiveEntry &&
      b.type === 'meeting' &&
      (b.text.toLowerCase() === cleanLiveText ||
        b.text.toLowerCase() === tbLiveEntry.text.toLowerCase());
    el.className = 'tb-block plan' + (isDone ? ' task-done' : '') + (isMeetingBlock ? ' live' : '');
    el.dataset.bid = b.id;
    el.draggable = true;
    el.style.top = b.slot * TB_SLOT_H + 1 + 'px';
    el.style.height = b.duration * TB_SLOT_H - 3 + 'px';
    el.style.background = cat.color + '18';
    el.style.borderLeftColor = cat.color;
    el.style.color = cat.color;

    const icon = b.type === 'meeting' ? '📅 ' : '';
    const emojiPrefix = b.emoji ? escHtml(b.emoji) + ' ' : '';
    const dur = b.duration * 30;
    const h = Math.floor(dur / 60),
      m = dur % 60;
    const durStr = h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
    el.innerHTML =
      `<div class="tb-block-name">${emojiPrefix}${icon}${escHtml(b.text)}</div>` +
      (b.duration > 1 ? `<div class="tb-block-sub">${escHtml(cat.label)} · ${durStr}</div>` : '') +
      (b.type !== 'meeting'
        ? `<button class="tb-block-start" data-bid="${b.id}" draggable="false">▶ start</button>`
        : '') +
      `<button class="tb-block-emoji${b.emoji ? ' has-emoji' : ''}" data-bid="${b.id}" title="add emoji" draggable="false">${b.emoji ? escHtml(b.emoji) : '✦'}</button>` +
      `<button class="tb-block-del" data-bid="${b.id}" draggable="false">&times;</button>`;

    el.addEventListener('dragstart', (e) => {
      tbDragSource = 'grid';
      tbDragId = b.id;
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      tbDragSource = null;
      tbDragId = null;
    });
    el.querySelector('.tb-block-del').addEventListener('click', (ev) => {
      ev.stopPropagation();
      blocks = blocks.filter((bl) => bl.id !== b.id);
      saveBlocks();
      renderTimeblock();
    });
    const startBtn = el.querySelector('.tb-block-start');
    if (startBtn)
      startBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        tbStartBlock(b.id);
      });
    el.querySelector('.tb-block-emoji').addEventListener('click', (ev) => {
      ev.stopPropagation();
      openBlockEmojiPicker(b.id, ev.currentTarget);
    });
    grid.appendChild(el);
  });

  // Untracked time — show faint label on past slots with no coverage
  if (isToday(viewDate) || !isToday(viewDate)) {
    // show on any viewed date
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
      .filter((e) => e.date === dateKey && e.tsEnd)
      .forEach((e) => {
        const startSlot = timeToSlot(new Date(e.ts).getHours(), new Date(e.ts).getMinutes());
        // If tsEnd is exactly on a 30-min boundary (e.g. 09:30:00), back off 1 minute
        // so we don't accidentally mark the NEXT slot as covered
        const endD = new Date(e.tsEnd);
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
      .filter((b) => b.date === dateKey)
      .forEach((b) => {
        for (let s = b.slot; s < Math.min(TB_SLOTS, b.slot + b.duration); s++) coveredSlots.add(s);
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
  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = grid.getBoundingClientRect();
    const slot = Math.max(
      0,
      Math.min(TB_SLOTS - 1, Math.floor((e.clientY - rect.top) / TB_SLOT_H))
    );
    grid.querySelectorAll('.tb-slot.drag-over').forEach((s) => s.classList.remove('drag-over'));
    const slotEl = grid.querySelector(`[data-slot="${slot}"]`);
    if (slotEl) slotEl.classList.add('drag-over');
    grid._dragSlot = slot;
  });
  grid.addEventListener('dragleave', (e) => {
    if (!grid.contains(e.relatedTarget))
      grid.querySelectorAll('.tb-slot.drag-over').forEach((s) => s.classList.remove('drag-over'));
  });
  grid.addEventListener('drop', (e) => {
    e.preventDefault();
    grid.querySelectorAll('.tb-slot.drag-over').forEach((s) => s.classList.remove('drag-over'));
    const target = grid._dragSlot;

    if (tbDragSource === 'grid' && tbDragId) {
      const b = blocks.find((bl) => bl.id === tbDragId);
      if (b) {
        const newSlot = Math.min(target, TB_SLOTS - b.duration);
        const newStart = TB_START * 60 + newSlot * 30;
        const newEnd = newStart + b.duration * 30;
        const hits = tbOverlaps(newStart, newEnd, dateKey, b.id);
        if (hits.length && !confirm(`This overlaps with ${hits}.\n\nMove here anyway?`)) {
          tbDragSource = null;
          tbDragId = null;
          return;
        }
        b.slot = newSlot;
        saveBlocks();
        renderTimeblock();
      }
    }
    tbDragSource = null;
    tbDragId = null;
  });
}

/**
 * Returns a comma-separated string of task names that overlap a proposed time
 * range, checking both planned blocks and logged time entries. Returns an
 * empty string if there are no overlaps.
 * @param {number} newStartMins - Proposed start time in minutes from midnight.
 * @param {number} newEndMins   - Proposed end time in minutes from midnight.
 * @param {string} dateKey      - Date string in YYYY-MM-DD format.
 * @param {string} [excludeId]  - Block ID to exclude from the check (when moving).
 * @returns {string} Overlapping task names, or '' if none.
 */
function tbOverlaps(newStartMins, newEndMins, dateKey, excludeId) {
  const hits = [];
  // Check against manual planned blocks
  blocks
    .filter((b) => b.date === dateKey && b.id !== excludeId)
    .forEach((b) => {
      const s = TB_START * 60 + b.slot * 30,
        e = s + b.duration * 30;
      if (newStartMins < e && newEndMins > s) hits.push(b.text);
    });
  // Check against completed log entries
  entries
    .filter((e) => e.date === dateKey && e.tsEnd && e.tsEnd > e.ts)
    .forEach((e) => {
      const s = new Date(e.ts).getHours() * 60 + new Date(e.ts).getMinutes();
      const en = new Date(e.tsEnd).getHours() * 60 + new Date(e.tsEnd).getMinutes();
      if (newStartMins < en && newEndMins > s) hits.push(e.text);
    });
  // Deduplicate and format
  const unique = [...new Set(hits)];
  if (!unique.length) return '';
  return unique.map((t) => `"${t}"`).join(', ');
}

/**
 * Opens a floating emoji picker anchored below `anchor` for a time block.
 * Identical behaviour to `openEmojiPicker` but operates on `blocks` instead
 * of `planTasks`. Calling again for the same block ID closes the picker.
 * @param {string}      bid    - Block ID.
 * @param {HTMLElement} anchor - Element to position the picker below.
 */
function openBlockEmojiPicker(bid, anchor) {
  const existing = document.getElementById('__emojiPicker');
  if (existing) {
    existing.remove();
    if (_emojiPickerPid === bid) {
      _emojiPickerPid = null;
      return;
    }
  }
  _emojiPickerPid = bid;
  const block = blocks.find((b) => b.id === bid);
  if (!block) return;

  const picker = document.createElement('div');
  picker.id = '__emojiPicker';
  picker.className = 'emoji-picker';

  const input = document.createElement('input');
  input.className = 'emoji-picker-input';
  input.placeholder = 'type or paste any emoji…';
  input.value = block.emoji || '';
  picker.appendChild(input);

  const grid = document.createElement('div');
  grid.className = 'emoji-picker-grid';
  EMOJI_COMMON.forEach((em) => {
    const b = document.createElement('button');
    b.textContent = em;
    b.type = 'button';
    b.addEventListener('click', () => setBlockEmoji(bid, em));
    grid.appendChild(b);
  });
  picker.appendChild(grid);

  const clear = document.createElement('button');
  clear.className = 'emoji-picker-clear';
  clear.textContent = '✕ remove emoji';
  clear.addEventListener('click', () => setBlockEmoji(bid, null));
  picker.appendChild(clear);

  document.body.appendChild(picker);
  const rect = anchor.getBoundingClientRect();
  const scrollY = window.scrollY || document.documentElement.scrollTop;
  picker.style.top = rect.bottom + scrollY + 4 + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';

  input.focus();
  input.select();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = input.value.trim();
      setBlockEmoji(bid, v || null);
    }
    if (e.key === 'Escape') {
      picker.remove();
      _emojiPickerPid = null;
    }
  });
  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!picker.contains(ev.target)) {
        picker.remove();
        _emojiPickerPid = null;
        document.removeEventListener('click', close);
      }
    });
  }, 50);
}

/**
 * Saves an emoji to a time block and closes the picker.
 * Pass null or an empty string to remove the block's emoji.
 * @param {string}      bid   - Block ID.
 * @param {string|null} emoji - Emoji character to assign, or null to remove.
 */
function setBlockEmoji(bid, emoji) {
  const block = blocks.find((b) => b.id === bid);
  if (!block) return;
  if (emoji) block.emoji = emoji;
  else delete block.emoji;
  const p = document.getElementById('__emojiPicker');
  if (p) {
    p.remove();
    _emojiPickerPid = null;
  }
  saveBlocks();
  renderTimeblock();
}

/**
 * Checks all of today's time blocks and acts on ones that have just become active:
 * - Meeting blocks: auto-starts a log entry and timer at the scheduled start time.
 * - Task blocks: prompts the user to switch/start within a 3-minute window.
 * Each block is only acted on once (tracked in `notifiedBlocks`).
 * No-ops when not viewing today.
 */
function checkBlockNotifications() {
  if (!isToday(viewDate)) return;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const todayKey = dk(new Date());

  const pending = blocks.filter((b) => b.date === todayKey && !notifiedBlocks.has(b.id));

  for (const b of pending) {
    const startMins = TB_START * 60 + b.slot * 30;
    const endMins = startMins + b.duration * 30;

    if (b.type === 'meeting') {
      // Auto-start if currently in progress (started but not ended yet)
      if (nowMins >= startMins && nowMins < endMins) {
        notifiedBlocks.add(b.id);
        // Skip if already logged or timer already running for this meeting
        const alreadyLogged = entries.some(
          (e) => e.date === todayKey && e.text.toLowerCase() === b.text.toLowerCase() && !e.tsEnd // only count open entries — not pre-created completed ones
        );
        const curEntry = activeTimer ? entries.find((e) => e.id === activeTimer.entryId) : null;
        const alreadyActive = curEntry && curEntry.text.toLowerCase() === b.text.toLowerCase();
        if (!alreadyLogged && !alreadyActive) {
          // Use the meeting's scheduled start time, not now
          const d = new Date();
          const scheduledTs = new Date(
            d.getFullYear(),
            d.getMonth(),
            d.getDate(),
            Math.floor((TB_START * 60 + b.slot * 30) / 60),
            (TB_START * 60 + b.slot * 30) % 60,
            0
          ).getTime();
          tbStartBlock(b.id, scheduledTs);
        }
      }
    } else {
      // Task blocks — prompt within 3-minute window after start
      if (nowMins < startMins || nowMins >= startMins + 3) continue;
      notifiedBlocks.add(b.id);
      if (activeTimer) {
        const cur = entries.find((e) => e.id === activeTimer.entryId);
        const curName = cur ? cur.text : 'current task';
        const sw = confirm(`⏰ Time for: "${b.text}"\n\nSwitch from "${curName}"?`);
        if (sw) {
          tbStartBlock(b.id);
        } else {
          blocks = blocks.filter((bl) => bl.id !== b.id);
          saveBlocks();
          renderTimeblock();
        }
      } else {
        const go = confirm(`⏰ Time for: "${b.text}"\n\nStart timer?`);
        if (go) {
          tbStartBlock(b.id);
        } else {
          blocks = blocks.filter((bl) => bl.id !== b.id);
          saveBlocks();
          renderTimeblock();
        }
      }
      break;
    }
  }
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

/**
 * Starts a timer for the given time block: creates (or promotes) the matching
 * plan task to "in progress", stops any running timer, creates a new log entry,
 * and starts the tick interval. Uses `overrideTs` as the entry start time so
 * elapsed time is counted from the scheduled start, not wall-clock now.
 * @param {string} blockId       - ID of the time block to start.
 * @param {number} [overrideTs]  - Optional explicit start timestamp (ms). Defaults to `safeRoundedStart()`.
 */
function tbStartBlock(blockId, overrideTs) {
  const b = blocks.find((bl) => bl.id === blockId);
  if (!b) return;
  const todayKey = dk(new Date());
  let task = planTasks.find(
    (t) => t.date === todayKey && t.text.toLowerCase() === b.text.toLowerCase()
  );
  if (!task) {
    task = {
      id: Date.now() + '',
      text: b.text,
      status: 'inprogress',
      tag: b.tag || 'other',
      date: todayKey,
    };
    planTasks.push(task);
  } else if (task.status !== 'done') {
    task.status = 'inprogress';
  }
  savePlan();
  if (activeTimer) stopTimer();
  const ts = overrideTs || safeRoundedStart();
  const entry = {
    id: Date.now() + 1 + '',
    text: b.text,
    tag: b.tag || 'other',
    ts,
    date: todayKey,
  };
  entries.push(entry);
  // Set timer startTs so elapsed = time since scheduled start, not since now
  viewDate = new Date();
  save();
  activeTimer = { entryId: entry.id, startTs: ts, accumulatedMs: 0, paused: false };
  save();
  tickTimer();
  timerInterval = setInterval(tickTimer, 1000);
  updateTimerBar();
  updateTimerBtn(true);
  render();
}

/**
 * Applies data migrations and status patches to today's plan tasks after
 * carry-over:
 * - Stamps `billable: true` on tasks/categories that predate the feature.
 * - Stamps `completedAt` on done tasks missing a timestamp.
 * - Promotes today's task status to match the most recent past version when
 *   that version was pending/blocked/upcoming or in-progress.
 */
function patchCarriedTasks() {
  const todayKey = dk(new Date());
  const todayTasks = planTasks.filter((t) => t.date === todayKey);
  const pastTasks = planTasks.filter((t) => t.date < todayKey);

  // Migration: stamp billable on tasks and categories that predate the feature.
  // Assumption: the app was originally developed for billable contract work, so
  // any task or category without an explicit flag is assumed billable to avoid
  // retroactively understating tracked hours.
  planTasks.forEach((t) => {
    if (t.billable === undefined) t.billable = true;
  });
  categories.forEach((c) => {
    if (c.billable === undefined) c.billable = true;
  });

  // Migration: stamp completedAt on any done task missing it
  let changed = false;
  planTasks.forEach((t) => {
    if (t.status === 'done' && !t.completedAt) {
      t.completedAt = new Date((t.date || todayKey) + 'T00:00:00').getTime();
      changed = true;
    }
  });

  if (!todayTasks.length || !pastTasks.length) {
    if (changed) savePlan();
    return;
  }

  todayTasks.forEach((todayTask) => {
    const prev = pastTasks
      .filter((t) => t.text.toLowerCase() === todayTask.text.toLowerCase())
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!prev) return;

    // If the most recent past version was pending/blocked, carry that status forward
    // regardless of what intermediate copies were (fixes: marked upcoming on Friday
    // but Saturday/Sunday copies were already todo)
    if (
      (prev.status === 'pending' || prev.status === 'blocked' || prev.status === 'upcoming') &&
      (todayTask.status === 'todo' || todayTask.status === 'inprogress')
    ) {
      todayTask.status = prev.status;
      if (prev.statusComments && prev.statusComments.length && !todayTask.statusComments) {
        todayTask.statusComments = prev.statusComments.map((c) => ({ ...c }));
      }
      changed = true;
    }

    // Only promote todo→inprogress if the most recent past version was inprogress
    if (todayTask.status === 'todo' && prev.status === 'inprogress') {
      todayTask.status = 'inprogress';
      changed = true;
    }
  });

  if (changed) savePlan();
}

/**
 * Carries unfinished plan tasks from past days into today — runs once per day
 * (guarded by a localStorage flag). Deduplicates by text, preserving the most
 * recent past status and status-comment history. Checkpoints are carried forward
 * with `done` reset to false for a fresh day.
 * @returns {number|undefined} Number of tasks newly carried, or undefined if
 *   carry has already run today.
 */
function autoCarryTasks() {
  const todayKey = dk(new Date());
  const carryKey = 'wl_carried_' + todayKey;
  if (localStorage.getItem(carryKey)) return;
  // 'upcoming' tasks are intentionally scheduled for a future date by the user
  // and should never be auto-carried — they will appear naturally on their target date.
  // 'done' tasks are complete and need no carry.
  const unfinished = planTasks.filter(
    (t) => t.date < todayKey && t.status !== 'done' && t.status !== 'upcoming'
  );
  if (!unfinished.length) {
    localStorage.setItem(carryKey, '1');
    return;
  }

  // Deduplicate by text — keep only the MOST RECENT past version of each task.
  // Without this, an older 'inprogress' copy could be carried instead of a newer 'pending' one.
  const latestByText = {};
  unfinished.forEach((t) => {
    const key = t.text.toLowerCase();
    if (!latestByText[key] || t.date > latestByText[key].date) {
      latestByText[key] = t;
    }
  });
  const toCarry = Object.values(latestByText);

  // First pass: create new tasks, build old-id → new-id map
  const idMap = {};
  let carried = 0;
  toCarry.forEach((t) => {
    const exists = planTasks.some(
      (e) => e.date === todayKey && e.text.toLowerCase() === t.text.toLowerCase()
    );
    if (!exists) {
      const newId = 'c' + Date.now() + Math.random().toString(36).slice(2);
      idMap[t.id] = newId;
      planTasks.push({
        id: newId,
        text: t.text,
        tag: t.tag,
        status: t.status, // preserve inprogress/todo/pending/blocked
        ...(t.statusComments && t.statusComments.length
          ? { statusComments: t.statusComments.map((c) => ({ ...c })) }
          : {}),
        // Carry checkpoints forward — reset done state for a fresh day
        ...(t.checkpoints && t.checkpoints.length
          ? { checkpoints: t.checkpoints.map((c) => ({ ...c, done: false })) }
          : {}),
        date: todayKey,
      });
      carried++;
    }
  });

  if (carried > 0) savePlan();
  localStorage.setItem(carryKey, '1');
  return carried;
}

let completedCollapsed = readCollapseState('completedSection', true);

// ── Iteration expiry dates (stored in localStorage, seeded on first load) ──
const STORE_EXPIRY = 'wl_expiry_dates';
const EXPIRY_SEED = [
  // PI 26-1
  '2026-01-31',
  '2026-02-14',
  '2026-02-28',
  '2026-03-14',
  '2026-03-28',
  // PI 26-2
  '2026-04-11',
  '2026-04-25',
  '2026-05-09',
  '2026-05-23',
  '2026-06-06',
  // PI 26-3
  '2026-06-20',
  '2026-07-04',
  '2026-07-18',
  '2026-08-01',
  '2026-08-15',
  '2026-08-29',
  // PI 26-4
  '2026-09-12',
  '2026-09-26',
  '2026-10-10',
  '2026-10-24',
  '2026-11-07',
  // PI 26-5
  '2026-11-21',
  '2026-12-05',
  '2026-12-19',
  '2027-01-02',
  '2027-01-16',
];

let _expiryDates = null; // cached; invalidated when user saves changes

/**
 * Loads iteration expiry dates from localStorage into `_expiryDates`.
 * Seeds localStorage with `EXPIRY_SEED` on first run.
 */
function loadExpiryDates() {
  try {
    const raw = localStorage.getItem(STORE_EXPIRY);
    if (raw) {
      _expiryDates = JSON.parse(raw)
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();
      return;
    }
  } catch (e) {
    wlLog.warn('loadExpiryDates: failed to parse stored expiry dates — using defaults', e);
  }
  // Seed localStorage with defaults on first load
  _expiryDates = [...EXPIRY_SEED];
  localStorage.setItem(STORE_EXPIRY, JSON.stringify(_expiryDates));
}

/**
 * Returns the first iteration expiry date that is strictly later than
 * `completedDay`, or null if none is configured beyond that date.
 * @param {string} completedDay - Completion date in "YYYY-MM-DD" format.
 * @returns {string|null} The next expiry date, or null.
 */
function getIterationExpiry(completedDay) {
  if (!_expiryDates) loadExpiryDates();
  return _expiryDates.find((d) => d > completedDay) || null;
}

/**
 * Opens the iteration-expiry editor modal, pre-filling the textarea with the
 * current expiry dates (one per line).
 */
function openExpiryModal() {
  if (!_expiryDates) loadExpiryDates();
  document.getElementById('expiryTextarea').value = _expiryDates.join('\n');
  document.getElementById('expiryFeedback').textContent = '';
  document.getElementById('expiryOverlay').classList.add('show');
  document.getElementById('expiryTextarea').focus();
}

/**
 * Reads the expiry-date textarea, validates each line against YYYY-MM-DD format,
 * deduplicates and sorts the valid dates, persists them to localStorage, and closes
 * the modal. Invalid lines are surfaced in the feedback element but not saved.
 */
function saveExpiryDates() {
  const raw = document.getElementById('expiryTextarea').value;
  const dates = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l));
  const invalid = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\d{4}-\d{2}-\d{2}$/.test(l));
  if (invalid.length) {
    const fb = document.getElementById('expiryFeedback');
    fb.style.color = '#f17070';
    fb.textContent = `Invalid lines (ignored): ${invalid.join(', ')}`;
  }
  _expiryDates = [...new Set(dates)].sort();
  localStorage.setItem(STORE_EXPIRY, JSON.stringify(_expiryDates));
  document.getElementById('expiryOverlay').classList.remove('show');
  renderCompleted();
}

/**
 * Renders the completed-tasks section for the currently viewed date.
 * Shows tasks that were completed on or before the view date and whose
 * iteration expiry date has not yet passed. Deduplicates by task text,
 * keeping only the most recently completed version. Hides the section when
 * there are no matching tasks.
 */
function renderCompleted() {
  const viewKey = dk(viewDate);
  const viewTs = new Date(viewKey + 'T12:00:00').getTime();
  // Tasks that are actively inprogress/todo on the current view date
  const activeTodayTexts = new Set(
    planTasks
      .filter((t) => t.date === viewKey && t.status !== 'done')
      .map((t) => t.text.toLowerCase())
  );
  const done = planTasks
    .filter((t) => {
      if (t.status !== 'done') return false;
      // Don't show completed tasks that have a live version on this date
      if (activeTodayTexts.has(t.text.toLowerCase())) return false;
      const completedTs = t.completedAt || new Date((t.date || viewKey) + 'T23:59:00').getTime();
      const completedDay = dk(new Date(completedTs));
      const expiryDay = getIterationExpiry(completedDay);
      // Show from completion day until (but not including) the iteration expiry date.
      // If beyond last known iteration, keep visible indefinitely.
      if (!expiryDay) return viewKey >= completedDay;
      return viewKey >= completedDay && viewKey < expiryDay;
    })
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  // Deduplicate by text — keep only the most recently completed version of each task
  const seen = new Set();
  const deduped = done.filter((t) => {
    const key = t.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sec = document.getElementById('completedSection');
  sec.style.display = deduped.length ? '' : 'none';
  if (!deduped.length) {
    // Clear stale items from prior renders so DOM matches the data
    document.getElementById('completedBody').innerHTML = '';
    document.getElementById('completedCount').textContent = '0';
    return;
  }

  document.getElementById('completedCount').textContent = `${deduped.length} completed`;
  sec.classList.toggle('collapsed', completedCollapsed);

  document.getElementById('completedBody').innerHTML = deduped
    .map((t) => {
      const cat = getCat(t.tag || 'other');
      let whenStr = 'date unknown';
      if (t.completedAt) {
        const d = new Date(t.completedAt);
        const mo = d.toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' });
        const hh = d.getHours(),
          mm = d.getMinutes();
        const isSentinel = (hh === 0 && mm === 0) || (hh === 23 && mm === 59);
        whenStr = isSentinel
          ? `completed ${mo}`
          : `completed ${mo} at ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      } else if (t.date) {
        const d = new Date(t.date + 'T12:00:00');
        whenStr = `completed ${d.toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}`;
      }
      return `<div class="completed-item">
        <span class="plan-status done-st" style="pointer-events:none;flex-shrink:0;font-size:10px;padding:1px 7px">Done</span>
        <span class="completed-dot" style="background:${safeCssColor(cat.color)}"></span>
        <span class="completed-text">${t.emoji ? escHtml(t.emoji) + ' ' : ''}${jiraTicketHtml(t.text)}</span>
        <span class="completed-when">${whenStr}</span>
      </div>`;
    })
    .join('');
}

document.getElementById('completedHeader').addEventListener('click', () => {
  completedCollapsed = !completedCollapsed;
  writeCollapseState('completedSection', completedCollapsed);
  renderCompleted();
});
// Delegated bill-btn handler — covers plan, pending, completed sections
document.addEventListener(
  'click',
  (e) => {
    const btn = e.target.closest('.bill-btn');
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.pid) {
      const t = planTasks.find((t) => t.id === btn.dataset.pid);
      if (!t) return;
      t.billable = t.billable === false ? true : false;
      savePlan();
      renderPlan();
      renderCompleted();
    } else if (btn.dataset.etext) {
      // Log entry — save billable directly on the entry, and sync to matching planTasks
      const entry = entries.find((e) => e.id === btn.dataset.eid);
      if (!entry) return;
      const newBill =
        entry.billable === false || entry.billable === undefined
          ? !(getCat(entry.tag || 'other').billable !== false)
          : false;
      // Determine toggle: if currently billable → make non-billable, and vice versa
      const curBill =
        entry.billable !== undefined
          ? entry.billable
          : getCat(entry.tag || 'other').billable !== false;
      entry.billable = !curBill;
      // Also update matching planTasks so plan rows stay in sync
      const key = entry.text.toLowerCase().trim();
      planTasks
        .filter((t) => t.text.toLowerCase().trim() === key)
        .forEach((t) => (t.billable = entry.billable));
      save();
      savePlan();
      render();
    }
  },
  true
);

// Delegated prio-btn handler — cycles priority normal → high → low → normal
document.addEventListener(
  'click',
  (e) => {
    const btn = e.target.closest('.prio-btn');
    if (!btn || !btn.dataset.pid) return;
    e.stopPropagation();
    const t = planTasks.find((t) => t.id === btn.dataset.pid);
    if (!t) return;
    const cur = t.priority || 0;
    const next = cur === 0 ? 1 : cur === 1 ? -1 : 0;
    if (next === 0) delete t.priority;
    else t.priority = next;
    savePlan();
    renderPlan();
  },
  true
);
