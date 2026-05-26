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

function loadReflection() {
  try {
    _reflData = JSON.parse(localStorage.getItem(STORE_REFLECTION) || '{}');
  } catch (e) {
    _reflData = {};
  }
}

function saveReflection() {
  localStorage.setItem(STORE_REFLECTION, JSON.stringify(_reflData));
}

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
    if (overlay) overlay.style.display = 'none';
    if (onComplete) onComplete();
  };
}

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

function getReflectionForDate(dateKey) {
  loadReflection();
  return _reflData[dateKey] || null;
}
