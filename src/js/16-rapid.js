// ── 16-rapid.js — Rapid Logging overlay ──

let _rapidOpen = false;
let _rapidCat = null; // selected category id, null = inherit last used

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

function closeRapid() {
  const overlay = document.getElementById('rapidOverlay');
  if (overlay) overlay.style.display = 'none';
  document.getElementById('rapidInput')?.blur();
  _rapidOpen = false;
}

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

function initRapid() {
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable) return;
    e.preventDefault();
    _rapidOpen ? closeRapid() : openRapid();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _rapidOpen) closeRapid();
  });

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
