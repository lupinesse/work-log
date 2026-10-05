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
    setBlocks(all.filter(validBlock));
    if (getBlocks().length < all.length)
      wlLog.warn(`loadBlocks: dropped ${all.length - getBlocks().length} invalid block record(s)`, {
        total: all.length,
        kept: getBlocks().length,
      });
  } catch (err) {
    setBlocks([]);
    wlLog.error('loadBlocks: failed to parse time blocks from localStorage', err);
  }
  // One-time migration: TB_START shifted from 8→7, add 2 slots to all existing blocks
  if (!localStorage.getItem('wl_tb_migrated_7')) {
    setBlocks(getBlocks().map((block) => ({ ...block, slot: block.slot + 2 })));
    saveBlocks();
    localStorage.setItem('wl_tb_migrated_7', '1');
  }
}
/** Persists the current `blocks` array to localStorage. */
function saveBlocks() {
  localStorage.setItem(STORE_BLOCKS, JSON.stringify(getBlocks()));
}

/**
 * Removes one time block, persists the remaining blocks and redraws the grid.
 * Shared by the block's delete button and the start prompt's "no" branches so
 * all three drop a block the same way.
 * @param {string} blockId - ID of the block to remove.
 * @returns {void}
 */
function removeBlockById(blockId) {
  setBlocks(getBlocks().filter((block) => block.id !== blockId));
  saveBlocks();
  renderTimeblock();
}

/**
 * Keeps a block inside the day grid: one of `duration` slots can start no
 * earlier than slot 0 and no later than `TB_SLOTS - duration`.
 * @param {number} slot - Requested start slot.
 * @param {number} duration - Block length in half-hour slots.
 * @returns {number} The nearest valid start slot.
 */
function clampBlockSlot(slot, duration) {
  return Math.max(0, Math.min(TB_SLOTS - duration, slot));
}

/**
 * Moves a planned block to another start slot. This is the one place that
 * changes a block's time, so drag-and-drop and the keyboard handler clamp,
 * warn about overlaps, save and redraw identically.
 * @param {string} blockId - ID of the block to move.
 * @param {number} requestedSlot - Wanted start slot; clamped into the grid.
 * @param {string} dateKey - YYYY-MM-DD of the day in view, for the overlap check.
 * @returns {('moved'|'unchanged'|'declined'|'missing')} `moved` after saving and
 *   redrawing; `unchanged` when the clamped slot is the current one (nothing is
 *   saved or redrawn); `declined` when the user refused the overlap prompt;
 *   `missing` when no block has that ID.
 */
function moveBlockToSlot(blockId, requestedSlot, dateKey) {
  const block = getBlocks().find((candidate) => candidate.id === blockId);
  if (!block) return 'missing';
  const newSlot = clampBlockSlot(requestedSlot, block.duration);
  if (newSlot === block.slot) return 'unchanged';
  const newStart = TB_START * 60 + newSlot * 30;
  const newEnd = newStart + block.duration * 30;
  const hits = tbOverlaps(newStart, newEnd, dateKey, block.id);
  if (hits.length && !confirm(`This overlaps with ${hits}.\n\nMove here anyway?`)) {
    return 'declined';
  }
  block.slot = newSlot;
  saveBlocks();
  renderTimeblock();
  return 'moved';
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
  getBlocks()
    .filter((block) => block.date === dateKey && block.id !== excludeId)
    .forEach((block) => {
      const s = TB_START * 60 + block.slot * 30,
        e = s + block.duration * 30;
      if (newStartMins < e && newEndMins > s) hits.push(block.text);
    });
  // Check against completed log entries
  getEntries()
    .filter((entry) => entry.date === dateKey && entry.tsEnd && entry.tsEnd > entry.ts)
    .forEach((entry) => {
      const s = new Date(entry.ts).getHours() * 60 + new Date(entry.ts).getMinutes();
      const en = new Date(entry.tsEnd).getHours() * 60 + new Date(entry.tsEnd).getMinutes();
      if (newStartMins < en && newEndMins > s) hits.push(entry.text);
    });
  // Deduplicate and format
  const unique = [...new Set(hits)];
  if (!unique.length) return '';
  return unique.map((text) => `"${text}"`).join(', ');
}

/**
 * Creates one selectable emoji button for the picker grid. The emoji is the
 * visible label, but an explicit aria-label ("Select 😀") keeps the name
 * consistent across screen readers, which otherwise announce emoji
 * differently or skip them (WCAG 4.1.2).
 * @param {string} emoji - The emoji character this button selects.
 * @param {Function} onSelect - Called when the button is clicked.
 * @returns {HTMLButtonElement} The button, not yet attached to the DOM.
 */
function createEmojiOptionButton(emoji, onSelect) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = emoji;
  button.setAttribute('aria-label', 'Select ' + emoji);
  button.addEventListener('click', onSelect);
  return button;
}

/**
 * Focuses the emoji trigger button for a planned block after the grid is
 * re-rendered by `renderTimeblock()`. Searches by `data-bid` rather than
 * building a CSS selector from untrusted data (avoids injection risk).
 * @param {string} bid - Block ID.
 * @returns {void}
 */
function focusBlockEmojiButton(bid) {
  const grid = document.getElementById('tbGrid');
  if (!grid) return;
  const blockEl = Array.from(grid.querySelectorAll('.tb-block.plan')).find(
    (el) => el.dataset.bid === bid
  );
  if (blockEl) blockEl.querySelector('.tb-block-emoji')?.focus();
}

/**
 * Opens a floating emoji picker anchored below `anchor` for a time block.
 * The picker is exposed as an ARIA dialog (WCAG 4.1.2 / 2.1.2): it carries
 * `role="dialog"`, `aria-modal`, and `aria-label`; Tab navigation wraps
 * inside via `trapFocusInOverlay()`; Escape closes the picker and returns
 * focus to the trigger.  Calling again for the same block ID closes the
 * picker (toggle).
 * @param {string}      bid    - Block ID.
 * @param {HTMLElement} anchor - Element to position the picker below.
 * @returns {void}
 */
function openBlockEmojiPicker(bid, anchor) {
  const existing = document.getElementById('__emojiPicker');
  if (existing) {
    existing.remove();
    // Reset aria-expanded on whichever block's picker was open
    const prevBid = _emojiPickerPid;
    _emojiPickerPid = null;
    if (prevBid) {
      const tbGrid = document.getElementById('tbGrid');
      const prevEl =
        tbGrid &&
        Array.from(tbGrid.querySelectorAll('.tb-block.plan')).find(
          (el) => el.dataset.bid === prevBid
        );
      prevEl?.querySelector('.tb-block-emoji')?.setAttribute('aria-expanded', 'false');
    }
    if (prevBid === bid) return; // same block: toggled closed
  }

  _emojiPickerPid = bid;
  anchor.setAttribute('aria-expanded', 'true');

  const block = getBlocks().find((timeBlock) => timeBlock.id === bid);
  if (!block) return;

  const picker = document.createElement('div');
  picker.id = '__emojiPicker';
  picker.className = 'emoji-picker';
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', 'Choose emoji');
  picker.setAttribute('aria-modal', 'true');

  const input = document.createElement('input');
  input.className = 'emoji-picker-input';
  input.setAttribute('aria-label', 'Type or paste an emoji');
  input.placeholder = 'type or paste any emoji…';
  input.value = block.emoji || '';
  picker.appendChild(input);

  const grid = document.createElement('div');
  grid.className = 'emoji-picker-grid';
  EMOJI_COMMON.forEach((em) => {
    grid.appendChild(createEmojiOptionButton(em, () => setBlockEmoji(bid, em)));
  });
  picker.appendChild(grid);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'emoji-picker-clear';
  clear.textContent = '✕ remove emoji';
  clear.setAttribute('aria-label', 'Remove emoji');
  clear.addEventListener('click', () => setBlockEmoji(bid, null));
  picker.appendChild(clear);

  document.body.appendChild(picker);
  const rect = anchor.getBoundingClientRect();
  const scrollY = window.scrollY || document.documentElement.scrollTop;
  picker.style.top = rect.bottom + scrollY + 4 + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';

  input.focus();
  input.select();

  // Tab trap: keeps keyboard focus inside the dialog (WCAG 2.1.2)
  picker.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') trapFocusInOverlay(picker, event);
    if (event.key === 'Escape') {
      picker.remove();
      _emojiPickerPid = null;
      anchor.setAttribute('aria-expanded', 'false');
      anchor.focus();
    }
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const v = input.value.trim();
      setBlockEmoji(bid, v || null);
    }
    // Escape is handled by the picker-level keydown above
  });

  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!picker.contains(ev.target)) {
        picker.remove();
        _emojiPickerPid = null;
        anchor.setAttribute('aria-expanded', 'false');
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
  const block = getBlocks().find((timeBlock) => timeBlock.id === bid);
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
  // Return focus to the trigger that opened the picker. The grid was just
  // re-rendered by renderTimeblock(), so we must find the new DOM element.
  focusBlockEmojiButton(bid);
}

/**
 * Checks all of today's time blocks and acts on ones that have just become active:
 * - Meeting blocks: auto-starts a log entry and timer at the scheduled start time.
 * - Task blocks: prompts the user to switch/start within a 3-minute window.
 * Each block is only acted on once (tracked in `notifiedBlocks`).
 * No-ops when not viewing today.
 */
function checkBlockNotifications() {
  if (!isToday(getViewDate())) return;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const todayKey = dk(new Date());
  const entries = getEntries();
  const timer = getActiveTimer();

  const pending = getBlocks().filter(
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
        const curEntry = timer ? entries.find((entry) => entry.id === timer.entryId) : null;
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
      if (timer) {
        const cur = entries.find((entry) => entry.id === timer.entryId);
        const curName = cur ? cur.text : 'current task';
        const sw = confirm(`⏰ Time for: "${b.text}"\n\nSwitch from "${curName}"?`);
        if (sw) {
          tbStartBlock(b.id);
        } else {
          removeBlockById(b.id);
        }
      } else {
        const go = confirm(`⏰ Time for: "${b.text}"\n\nStart timer?`);
        if (go) {
          tbStartBlock(b.id);
        } else {
          removeBlockById(b.id);
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
  const b = getBlocks().find((bl) => bl.id === blockId);
  if (!b) return;
  const todayKey = dk(new Date());
  let task = getPlanTasks().find(
    (planTask) => planTask.date === todayKey && planTask.text.toLowerCase() === b.text.toLowerCase()
  );
  if (!task) {
    task = {
      id: Date.now() + '',
      text: b.text,
      status: 'inprogress',
      tag: b.tag || 'other',
      date: todayKey,
    };
    getPlanTasks().push(task);
  } else if (task.status !== 'done') {
    task.status = 'inprogress';
  }
  savePlan();
  if (getActiveTimer()) stopTimer();
  const ts = overrideTs || safeRoundedStart();
  const entry = {
    id: Date.now() + 1 + '',
    text: b.text,
    tag: b.tag || 'other',
    ts,
    date: todayKey,
  };
  getEntries().push(entry);
  // Set timer startTs so elapsed = time since scheduled start, not since now
  setViewDate(new Date());
  save();
  setActiveTimer({ entryId: entry.id, startTs: ts, accumulatedMs: 0, paused: false });
  save();
  tickTimer();
  setTimerInterval(setInterval(tickTimer, 1000));
  updateTimerBar();
  updateTimerBtn(true);
  render();
}
