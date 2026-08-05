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
  } catch (err) {
    blocks = [];
    wlLog.error('loadBlocks: failed to parse time blocks from localStorage', err);
  }
  // One-time migration: TB_START shifted from 8→7, add 2 slots to all existing blocks
  if (!localStorage.getItem('wl_tb_migrated_7')) {
    blocks = blocks.map((block) => ({ ...block, slot: block.slot + 2 }));
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
    .filter((block) => block.date === dateKey && block.id !== excludeId)
    .forEach((block) => {
      const s = TB_START * 60 + block.slot * 30,
        e = s + block.duration * 30;
      if (newStartMins < e && newEndMins > s) hits.push(block.text);
    });
  // Check against completed log entries
  entries
    .filter((entry) => entry.date === dateKey && entry.tsEnd && entry.tsEnd > entry.ts)
    .forEach((entry) => {
      const s = new Date(entry.ts).getHours() * 60 + new Date(entry.ts).getMinutes();
      const en = new Date(entry.tsEnd).getHours() * 60 + new Date(entry.tsEnd).getMinutes();
      if (newStartMins < en && newEndMins > s) hits.push(entry.text);
    });
  // Deduplicate and format
  const unique = [...new Set(hits)];
  if (!unique.length) return '';
  return unique.map((name) => `"${name}"`).join(', ');
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
  const block = blocks.find((bl) => bl.id === bid);
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
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const v = input.value.trim();
      setBlockEmoji(bid, v || null);
    }
    if (event.key === 'Escape') {
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
  const block = blocks.find((bl) => bl.id === bid);
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

  const pending = blocks.filter(
    (block) => block.date === todayKey && !notifiedBlocks.has(block.id)
  );

  for (const b of pending) {
    const startMins = TB_START * 60 + b.slot * 30;
    const endMins = startMins + b.duration * 30;

    if (b.type === 'meeting') {
      // Auto-start if currently in progress (started but not ended yet)
      if (nowMins >= startMins && nowMins < endMins) {
        notifiedBlocks.add(b.id);
        // Skip if already logged or timer already running for this meeting
        const alreadyLogged = entries.some(
          (entry) =>
            entry.date === todayKey &&
            entry.text.toLowerCase() === b.text.toLowerCase() &&
            !entry.tsEnd // only count open entries — not pre-created completed ones
        );
        const curEntry = activeTimer
          ? entries.find((entry) => entry.id === activeTimer.entryId)
          : null;
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
        const cur = entries.find((entry) => entry.id === activeTimer.entryId);
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
    (match) => match.date === todayKey && match.text.toLowerCase() === b.text.toLowerCase()
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
