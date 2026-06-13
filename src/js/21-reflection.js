// ── 21-reflection.js — End-of-day reflection ──

const STORE_REFLECTION = 'wl_reflection_v1';
const FOCUS_LABELS = [
  '',
  'Very scattered',
  'Mostly distracted',
  'Some drift',
  'Good focus',
  'Deep flow state',
];

let _reflData = {};
let _reflFocus = 0;
let _reflEnergy = 0;

/** Loads reflection data from localStorage into `_reflData`. */
function loadReflection() {
  try {
    _reflData = JSON.parse(localStorage.getItem(STORE_REFLECTION) || '{}');
  } catch (err) {
    _reflData = {};
    wlLog.warn('loadReflection: failed to parse reflection data from localStorage', err);
  }
}

/** Persists the current `_reflData` map to localStorage. */
function saveReflection() {
  localStorage.setItem(STORE_REFLECTION, JSON.stringify(_reflData));
}

/**
 * Opens the end-of-day reflection overlay.
 * Resets star ratings to 0, attaches Save/Skip handlers that call `onComplete`
 * when dismissed.
 * @param {Function} [onComplete] - Callback invoked after Save or Skip.
 */
function openReflection(onComplete) {
  loadReflection();
  _reflFocus = 0;
  _reflEnergy = 0;
  const noteEl = document.getElementById('reflNote');
  if (noteEl) noteEl.value = '';
  renderReflStars('reflFocusStars', _reflFocus);
  renderReflStars('reflEnergyStars', _reflEnergy);
  const overlay = document.getElementById('reflectionOverlay');
  if (overlay) overlay.style.display = 'flex';

  document.getElementById('reflSkip').onclick = () => {
    wlLog.info('openReflection: skipped');
    if (overlay) overlay.style.display = 'none';
    if (onComplete) onComplete();
  };
  document.getElementById('reflSave').onclick = () => {
    const dateKey = dk(new Date());
    _reflData[dateKey] = {
      focus: _reflFocus,
      energy: _reflEnergy,
      note: document.getElementById('reflNote').value.trim(),
    };
    saveReflection();
    wlLog.info('openReflection: saved', {
      dateKey,
      focus: _reflFocus,
      energy: _reflEnergy,
      hasNote: !!_reflData[dateKey].note,
    });
    if (overlay) overlay.style.display = 'none';
    if (onComplete) onComplete();
  };
}

/**
 * Renders a 1–5 star row inside `elId`, marking stars up to `current` as active.
 * @param {string} elId - ID of the container element.
 * @param {number} current - Currently selected value (0 = none selected).
 */
function renderReflStars(elId, current) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<span class="refl-star${n <= current ? ' on' : ''}" data-val="${n}" data-el="${elId}">★</span>`
    )
    .join('');
  el.querySelectorAll('.refl-star').forEach((star) => {
    star.addEventListener('click', () => {
      const val = parseInt(star.dataset.val, 10);
      if (star.dataset.el === 'reflFocusStars') {
        _reflFocus = val;
        renderReflStars('reflFocusStars', _reflFocus);
        const hint = document.getElementById('reflFocusHint');
        if (hint) hint.textContent = FOCUS_LABELS[val] || '';
      } else {
        _reflEnergy = val;
        renderReflStars('reflEnergyStars', _reflEnergy);
      }
    });
  });
}

/**
 * Returns the stored reflection record for a given day, or null if none exists.
 * @param {string} dateKey - YYYY-MM-DD date string.
 * @returns {{ focus: number, energy: number, note: string }|null}
 */
function getReflectionForDate(dateKey) {
  loadReflection();
  return _reflData[dateKey] || null;
}
