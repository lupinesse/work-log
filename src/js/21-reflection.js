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

const REFL_STAR_LABELS = {
  reflFocusStars: 'Focus quality',
  reflEnergyStars: 'Energy level',
};

/**
 * Renders a 1–5 star rating widget inside `elId`, marking stars up to `current`
 * as active. The container gets `role="radiogroup"` and each star gets
 * `role="radio"` with keyboard-accessible roving tabindex (WCAG 2.1 SC 4.1.2).
 * @param {string} elId - ID of the container element.
 * @param {number} current - Currently selected value (0 = none selected).
 */
function renderReflStars(elId, current) {
  const el = document.getElementById(elId);
  if (!el) return;

  el.setAttribute('role', 'radiogroup');
  el.setAttribute('aria-label', REFL_STAR_LABELS[elId] || elId);

  // Roving tabindex: the selected star (or star 1 if none) is in the tab order
  const focusVal = current || 1;
  el.innerHTML = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<span class="refl-star${n <= current ? ' on' : ''}"
              role="radio"
              aria-checked="${n === current ? 'true' : 'false'}"
              aria-label="${n} star${n > 1 ? 's' : ''}"
              tabindex="${n === focusVal ? '0' : '-1'}"
              data-val="${n}" data-el="${elId}">★</span>`
    )
    .join('');

  function selectStar(val) {
    if (elId === 'reflFocusStars') {
      _reflFocus = val;
      renderReflStars('reflFocusStars', _reflFocus);
      const hint = document.getElementById('reflFocusHint');
      if (hint) hint.textContent = FOCUS_LABELS[val] || '';
    } else {
      _reflEnergy = val;
      renderReflStars('reflEnergyStars', _reflEnergy);
    }
  }

  el.querySelectorAll('.refl-star').forEach((star) => {
    star.addEventListener('click', () => selectStar(parseInt(star.dataset.val, 10)));
  });

  // Arrow-key navigation between stars (WCAG SC 2.1.1)
  el.addEventListener('keydown', (e) => {
    const stars = [...el.querySelectorAll('.refl-star')];
    const idx = stars.findIndex((s) => s === document.activeElement);
    if (idx === -1) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = stars[Math.min(idx + 1, stars.length - 1)];
      next.focus();
      selectStar(parseInt(next.dataset.val, 10));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const prev = stars[Math.max(idx - 1, 0)];
      prev.focus();
      selectStar(parseInt(prev.dataset.val, 10));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectStar(parseInt(stars[idx].dataset.val, 10));
    }
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
