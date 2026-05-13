# Smoke Test Status

Review this at end of day if any behaviour changed. Each area lists what it validates
and what app changes would require updating it.

---

## 1. Page load (12 tests)
Validates the page opens without JS errors, test harness is accessible, key DOM elements exist
including eodBtn, jiraSection, timer controls, live-info boxes, and weather/calendar widgets.
**Update if:** major structural changes to the IIFE, startup sequence, or key element IDs change.

## 2. roundToNearest30 (9 tests)
Validates all 8 boundary cases: 0, 8, 15, 16, 30, 45, 46, 59 minutes + seconds zeroed.
**Update if:** rounding logic or thresholds change.

## 3. localStorage round-trip (5 tests)
Validates entries and categories survive a page reload. Checks stat counter reflects loaded data.
**Update if:** storage keys (wl_entries_v1, wl_cats_v1) change, or load/save logic changes.

## 4. Timer start & display (3 tests)
Validates timer bar is visible, shows correct task name, and elapsed time is non-zero.
**Update if:** timer bar HTML IDs change or timer display logic changes.

## 5. Timer persistence across reload (3 tests)
Validates a running timer survives a page reload.
**Update if:** timer state storage (wl_timer_v1) or resumeTimerIfActive() changes.

## 6. completedAt (3 tests)
Validates completedAt is set when a task is marked Done, is not the 23:59 sentinel,
and is within 30 minutes of now (accounting for rounding).
**Update if:** completedAt logic, the 23:59 sentinel approach, or Done status handling changes.

## 7. Auto-carry (5 tests)
Validates unfinished tasks carry to today with correct status, done tasks are excluded,
and pending/blocked tasks carry with their status preserved (not reset to inprogress).
**Update if:** autoCarryTasks(), patchCarriedTasks(), or carry key logic changes.

## 8. Sort order (2 tests)
Validates In Progress appears before To Do, and To Do tasks are sorted alphabetically.
**Update if:** sort logic or STATUS_ORDER changes.

## 9. Plan count header (3 tests)
Validates the "X to do · X in progress · X done" format.
**Update if:** planCount text format changes.

## 10. Week number (2 tests)
Validates week number is shown in "Week X/Y" format with a valid range.
**Update if:** week number display or getISOWeek() logic changes.

---

## End-of-day checklist

After a coding session, scan this list and ask:
- Did I change any logic covered by a test area above?
- If yes → update the relevant tests in smoke-tests.js
- Run `node smoke-tests.js` locally to verify before pushing
- Commit updated tests alongside the code change

---

## 11. Distraction tracking (2 tests)
Validates a distraction injected into wl_distractions_v1 appears in distractionSection.
**Update if:** distraction storage key or renderDistractionCount() changes.

## 12. Active task highlighting (tests)
Validates .active-timer CSS class is applied to the plan item whose text matches the running timer.
**Update if:** active-timer class name or renderPlan highlighting logic changes.

## 13–15. Emergency mode (tests)
Validates Ctrl+Shift+F enters emergency focus mode (body.emergency class), non-essential sections
hide, and Escape exits. **Update if:** emergency mode key binding or body class name changes.

## 16. Transition handoff note (tests)
Validates first stop-click shows timerHandoff input, second click saves note to wl_handoff,
and the note does not appear in the quick-pick suggestions.
**Update if:** timerHandoff element ID, wl_handoff storage key, or two-click stop flow changes.

## 17. Day-change fixes & task retirement (tests)
17a: no ReferenceError on load (_lastTickDate TDZ guard).
17b: marking today's task done also retires same-text tasks from past days.
17c: completed section deduplicates same-text tasks, showing only the most recent.
**Update if:** _lastTickDate initialisation, retirement logic, or completed dedup changes.

## 18. Untracked slot boundary (3 tests)
Validates a tsEnd exactly on a 30-min boundary does NOT cover the following slot in the timeblock.
**Update if:** timeToSlot(), covered-slot calculation, or boundary-fix logic changes.

## 19. Paused timer live block cap (3 tests)
Validates a paused timer's timeblock coverage ends at the pause point, not at Date.now().
**Update if:** paused-timer coverage logic in renderTimeblock() changes.

## 20. Pending-carry self-heal (3 tests)
Validates patchCarriedTasks corrects a task carried as inprogress when the most recent past
version was pending — restores correct status and copies statusComments forward.
**Update if:** patchCarriedTasks() self-heal logic or statusComments carry behaviour changes.

## 21. Handoff note not in quick pick (3 tests)
Validates the quick-pick list renders task names but does not expose handoff note content.
**Update if:** quick-pick rendering logic or wl_handoff display logic changes.

## 22. Task emoji (3 tests)
Validates a stored emoji appears in the task name text. Confirms no plan-emoji-btn exists
in the task list (emoji buttons live only in the timeblock since this feature moved).
**Update if:** task name rendering or where emoji buttons are placed changes.

## 23. Start of day button (3 tests)
Validates clicking sodBtn stores a timestamp under wl_sod_YYYY-MM-DD and updates button text
to include "started". **Update if:** sodKey format, renderSodBtn label, or SOD click handler changes.
