/* ── Hero Card — category picker (split out of 06a-hero.js) ──
   Category display cell + interactive picker panel, shared by the running,
   paused, and stopped panels (called from 06a-hero.js's _heroFillRunning/
   _heroFillPaused/_heroFillStopped). */

/**
 * Fills a category display cell with the dot + label (and optional caret/picker).
 * @param {string}  elId        - ID of the `.hero-task-category` element.
 * @param {string}  tag         - Category ID.
 * @param {boolean} [interactive=false] - When true, renders a caret button and picker panel.
 */
function _heroSetCategory(elId, tag, interactive = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  const cat = getCat(tag);

  if (!interactive) {
    el.innerHTML =
      `<span class="hero-task-cat-dot" style="background:${safeCssColor(cat.color)}" aria-hidden="true"></span>` +
      escHtml(cat.label);
    return;
  }

  const panelId = `${elId}-panel`;
  const itemsHtml = categories
    .map(
      (category) =>
        `<button class="hero-cat-item" role="menuitem" data-tag="${escHtml(category.id)}"` +
        ` aria-label="${escHtml(category.label)}">` +
        `<span class="hero-cat-item-dot" style="background:${safeCssColor(category.color)}" aria-hidden="true"></span>` +
        escHtml(category.label) +
        (category.id === tag
          ? `<span class="hero-cat-item-check" aria-hidden="true">&#10003;</span>`
          : '') +
        `</button>`
    )
    .join('');

  el.innerHTML =
    `<div class="hero-cat-wrap">` +
    `<button class="hero-task-cat-btn" aria-label="Change category" aria-haspopup="true" aria-expanded="false">` +
    `<span class="hero-task-cat-dot" style="background:${safeCssColor(cat.color)}" aria-hidden="true"></span>` +
    `<span class="hero-cat-label">${escHtml(cat.label)}</span>` +
    `<span class="hero-cat-caret" aria-hidden="true">&#9660;</span>` +
    `</button>` +
    `<div class="hero-cat-panel" id="${panelId}" role="menu" style="display:none">` +
    itemsHtml +
    `</div>` +
    `</div>`;

  _heroBindCatPicker(el.querySelector('.hero-cat-wrap'));
}

/**
 * Binds open/close/select keyboard and pointer events on a `.hero-cat-wrap` element.
 * @param {HTMLElement} wrap - The `.hero-cat-wrap` container.
 */
function _heroBindCatPicker(wrap) {
  if (!wrap) return;
  const btn = wrap.querySelector('.hero-task-cat-btn');
  const panel = wrap.querySelector('.hero-cat-panel');
  if (!btn || !panel) return;

  function openPanel() {
    panel.style.display = '';
    btn.setAttribute('aria-expanded', 'true');
    const first = panel.querySelector('.hero-cat-item');
    if (first) first.focus();
  }

  function closePanel() {
    panel.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', () => {
    panel.style.display !== 'none' ? closePanel() : openPanel();
  });

  btn.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPanel();
    }
  });

  const items = Array.from(panel.querySelectorAll('.hero-cat-item'));
  items.forEach((item, idx) => {
    item.addEventListener('click', () => {
      _heroCatSelect(item.dataset.tag);
      closePanel();
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        _heroCatSelect(item.dataset.tag);
        closePanel();
      } else if (event.key === 'Escape') {
        closePanel();
        btn.focus();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (items[idx + 1]) items[idx + 1].focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (items[idx - 1]) items[idx - 1].focus();
      }
    });
  });
}

/**
 * Updates the active entry's category, persists, and re-renders.
 * @param {string} newTag - Category ID to apply.
 */
function _heroCatSelect(newTag) {
  if (!activeTimer) return;
  const entry = entries.find((en) => en.id === activeTimer.entryId);
  if (!entry) return;
  entry.tag = newTag;
  save();
  renderHeroCard();
  render();
}
