/* ── Render — recent-tasks quick-pick bar ── */
// Split out of 04-render.js (QA finding: module size). Self-contained: reads
// entries/qpHidden/getIterationExpiry, no dependency on render()'s internals.

/**
 * Renders the "recent tasks" quick-pick bar below the capture input.
 * Deduplicates entries by text, hides manually-dismissed tasks and tasks past
 * their iteration expiry, and caps the list at 16 items.
 */
function renderQuickPick() {
  const qp = document.getElementById('quickPick');
  const seen = new Set();
  // Build deduplicated recent list, then filter out hidden ones
  const allRecent = [...entries].reverse().filter((entry) => {
    const k = entry.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Hide tasks whose last-logged date is at or past the current iteration boundary
  const todayKeyQp = dk(new Date());
  const expiredQp = new Set(
    allRecent
      .filter((entry) => {
        const expiry = getIterationExpiry(entry.date || '');
        return expiry && todayKeyQp >= expiry;
      })
      .map((entry) => entry.text.toLowerCase())
  );
  const recent = allRecent
    .filter(
      (entry) => !qpHidden.has(entry.text.toLowerCase()) && !expiredQp.has(entry.text.toLowerCase())
    )
    .slice(0, 16);
  // Hidden count is the intersection of qpHidden with task texts actually present in entries
  const hiddenInUse = allRecent.filter((entry) => qpHidden.has(entry.text.toLowerCase())).length;

  if (!recent.length && !hiddenInUse) {
    qp.innerHTML = '';
    return;
  }

  const itemsHtml = recent
    .map((entry) => {
      return (
        `<button class="qp-item" data-text="${escHtml(entry.text)}" data-tag="${entry.tag}">` +
        `<span class="qp-item-text">${escHtml(entry.text)}</span>` +
        `<span class="qp-remove" data-text="${escHtml(entry.text)}" title="remove from recent tasks">&times;</span>` +
        `</button>`
      );
    })
    .join('');
  const restoreHtml = hiddenInUse
    ? `<button class="qp-restore" id="qpRestore" title="show all hidden tasks again">restore ${hiddenInUse} hidden</button>`
    : '';

  qp.innerHTML = `<div class="qp-wrap"><div class="qp-label">recent tasks</div><div class="qp-list">${itemsHtml}${restoreHtml}</div></div>`;

  // Click pill body — fill capture input (only if click wasn't on the ✕)
  qp.querySelectorAll('.qp-item').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      if (event.target.closest('.qp-remove')) return;
      document.getElementById('captureInput').value = btn.dataset.text;
      selectedTag = btn.dataset.tag;
      renderTagRow();
      document.getElementById('captureInput').focus();
    });
  });
  // Click ✕ — hide from recent list
  qp.querySelectorAll('.qp-remove').forEach((removeBtn) => {
    removeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      qpHidden.add(removeBtn.dataset.text.toLowerCase());
      saveQpHidden();
      renderQuickPick();
    });
  });
  // Restore all hidden
  const restoreBtn = document.getElementById('qpRestore');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      qpHidden.clear();
      saveQpHidden();
      renderQuickPick();
    });
  }
}
