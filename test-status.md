# Smoke Test Status

Review this at end of day if any behaviour changed. Each area lists what it validates
and what app changes would require updating it.

---

## 1. Page load (3 tests)
Validates the page opens without JS errors and the test harness is accessible.
**Update if:** major structural changes to the IIFE or startup sequence.

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
and child tasks have their parentId remapped to today's parent.
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
