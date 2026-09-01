/**
 * @file 12c-startup.js
 * Top-level app startup orchestration, split out of 12a-changelog.js: loads
 * persisted state, merges the dev changelog, carries tasks forward, runs the
 * initial render/check sequence, and resumes any active timer.
 *
 * Load-order-sensitive: mergeDevLog() dereferences the top-level consts
 * STORE_DEV_LOG and DEV_CHANGES (12b-changelog-data.js) at call time, so this
 * file must sort AFTER 12b. It must also keep sorting after 12a-changelog.js
 * (whose listener bindings it follows) and before 13-calendar.js's own
 * top-level loadParked()/renderParked() calls and window.__wl test handle.
 */

load();
loadExpiryDates();
mergeDevLog();
loadBlocks();
loadPlan();
const carried = autoCarryTasks();
patchCarriedTasks();
// Default to the alphabetically first epic that is still active (not archived)
selectedTag =
  pickableCategories([...categories]).sort((a, b) => a.label.localeCompare(b.label))[0]?.id ||
  'work';
renderTagRow();
checkNewDay();
render();
renderSodBtn();
renderEodBtn();
checkPomoWeeklyClear();
renderPlan();
if (carried > 0) {
  const countEl = document.getElementById('planCount');
  if (countEl)
    countEl.textContent =
      (countEl.textContent ? countEl.textContent + ' · ' : '') +
      `${carried} carried from yesterday`;
}
renderTimeblock();
renderPomoLog();
renderCompleted();
resumeTimerIfActive();
