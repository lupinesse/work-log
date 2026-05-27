// ── 16-rapid.js — Rapid Logging overlay ──

let _rapidOpen = false;
let _rapidCat = null; // selected category id, null = inherit last used

/** Opens the rapid-log overlay and focuses the capture input. */
function openRapid() {
  const overlay = document.getElementById('rapidOverlay');
  if (!overlay) return;
  _rapidOpen = true;
  overlay.style.display = 'flex';
  renderRapidCats();
  const inp = document.getElementById('rapidInput');
  inp.value = '';
  inp.focus();
}

/** Closes the rapid-log overlay. */
function closeRapid() {
  const overlay = document.getElementById('rapidOverlay');
  if (overlay) overlay.style.display = 'none';
  _rapidOpen = false;
}

/** Renders the category chip strip inside the rapid overlay. */
function renderRapidCats() {
  const el = document.getElementById('rapidCats');
  if (!el) return;
  el.innerHTML = categories
    .map(
      (c) =>
        `<button class="qp-chip rapid-cat-btn${_rapidCat === c.id ? ' active' : ''}"
               data-id="${escHtml(c.id)}"
               style="border-color:${c.color}44;color:${c.color};background:${c.color}11">
         ${escHtml(c.label)}
       </button>`
    )
    .join('');
  el.querySelectorAll('.rapid-cat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      _rapidCat = _rapidCat === btn.dataset.id ? null : btn.dataset.id;
      renderRapidCats();
    });
  });
}

/**
 * Commits a new entry from the rapid-log input.
 * Marks the entry `_uncategorised` when no category chip is selected so the
 * review callout can surface it later.
 * @param {boolean} withTimer - If true, starts the timer on the new entry.
 */
function rapidCommit(withTimer) {
  const inp = document.getElementById('rapidInput');
  const text = inp.value.trim();
  if (!text) {
    inp.focus();
    return;
  }

  const entry = {
    id: Date.now() + '',
    text,
    tag: _rapidCat || selectedTag || (categories[0] && categories[0].id) || 'other',
    ts: safeRoundedStart(),
    date: dk(new Date()),
  };
  if (!_rapidCat) entry._uncategorised = true;

  entries.push(entry);
  save();
  closeRapid();
  render();

  if (withTimer) {
    if (activeTimer) stopTimer();
    startTimer(entry.id);
  }
}

/** Registers all event listeners for the rapid-log overlay. Called once on DOMContentLoaded. */
function initRapid() {
  // Escape to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _rapidOpen) closeRapid();
  });

  // Open button (✏️ next to dice in today's tasks)
  document.getElementById('rapidOpenBtn')?.addEventListener('click', openRapid);

  document.getElementById('rapidClose')?.addEventListener('click', closeRapid);
  document.getElementById('rapidLogOnly')?.addEventListener('click', () => rapidCommit(false));
  document.getElementById('rapidStart')?.addEventListener('click', () => rapidCommit(true));

  document.getElementById('rapidInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') rapidCommit(true);
  });

  document.getElementById('rapidOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('rapidOverlay')) closeRapid();
  });
}
