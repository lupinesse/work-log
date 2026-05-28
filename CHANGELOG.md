# Changelog

## v1.8.8 — 2026-05-28

### Fixed

- **Focus / mood dropdown no longer clipped**: removed `overflow: hidden` from `.hero-card` so the absolute-positioned `.tb-mood-panel` can extend past the card's bottom edge. The bottom mood item ("✨ interesting!") is now fully visible and clickable while the timer is running.

### Tests

- Added 16 unit tests for `src/js/15-notion.js` (`addTaskToNotion`, `saveTaskNotionUrl`, `callClaudeWithNotion`, and the delegated per-task button click handler) — closes #34.
- Added smoke test 5c that opens the mood dropdown on a running timer and verifies the bottom menu item is hit-testable at its centre.

---

## v1.8.7 — 2026-05-27

### Security

- **Anthropic API key moved server-side**: the key is no longer stored in or readable from `localStorage`. Both the URL-title fetch (`notionFetchBtn`) and the Notion resource-save call now route through the local server proxies (`/api/ai` and `/api/notion-ai`) which inject the key from `config.local.ps1`. The CSP `connect-src` directive no longer permits direct browser connections to `https://api.anthropic.com`. A one-time `localStorage.removeItem('wl_anthropic_key')` migration clears any previously stored key on load.

---

## v1.8.6 — 2026-05-27

### Hero Card — unified timer state machine (Variant C)

- **Replaces the `#timerBar`** with a single `#heroCard` that has four inner panels driven by CSS state-modifier classes: `hero-card--idle`, `--running`, `--paused`, `--stopped`
- **Idle state**: shows logged-today total, last-session time, a task-composer input with Enter-to-start, and up to 3 recent-task chips for one-click restart
- **Running state**: large monospace elapsed clock, pulsing dot, category + task title, note row, and Break / Lunch / Meeting utility pills — identical affordances to the old bar
- **Paused state**: amber border wash, frozen clock, resume-primary / stop-ghost button pair
- **Stopped state**: 6-second confirmation window with session summary (range, total today), undo, note, and done actions; auto-dismisses to idle
- **Mood dropdown** kept in the running panel so `initBannerControls()` bindings remain valid without changes
- All legacy compat IDs (`#timerStop`, `#timerPause`, `#timerHandoff`, `#emergencyBtn`, etc.) preserved as hidden stubs so `06-focus.js` and other modules need no changes
- `--start-btn` / `--start-btn-hover` CSS custom properties added to `_base.scss` (with dark-mode overrides) for the dusty-blue start button; no hardcoded hex colours

---

## v1.8.5 — 2026-05-27

### Quick Capture modal — QC_FinalV3 redesign

- **Two-state modal** replaces the original rapid-log overlay: idle state shows a grouped task list with hover-reveal ▸ start buttons; running state surfaces a pulsing red strip with the current task name, elapsed time, and a ■ stop button
- **Click-first interaction**: tasks from today's plan and time log appear grouped as In progress / To-do / Recent — click a row to start or switch the timer without typing
- **Filter chips** narrow the task list by category; an "All" chip resets the filter
- **Log without tracking** commits typed text as a time entry with no timer; empty input redirects focus to the ad-hoc log row
- **`_qcRenderTaskList` refactored**: split into three single-purpose functions — `_qcBuildTaskGroups` (data), `_qcTaskListHtml` (HTML rendering), `_qcBindTaskListEvents` (event binding) — satisfying the single-responsibility rule in CLAUDE.md
- **Smoke tests added** for filter chips (category narrowing + All-chip reset), running strip (visibility, task name, CSS class), and task-row start (timer start + overlay close)

---

## v1.8.4 — 2026-05-27

### Test suite streamlining
- **`freshPage()` now waits for app readiness** instead of a fixed 600ms timeout: replaced `waitForTimeout(600)` with `waitForFunction(() => window.__wl?.getState)`, cutting per-page overhead from 600ms to the actual init time (~80–150ms on a modern machine)
- **Same fix applied** to the three other manual page loads in Sections 1, 7, and 17a
- **Removed Section 2 (roundToNearest30) and Section 14 (safeCssColor)** from smoke tests — both pure functions are already covered by 29 unit tests in `test/unit.cjs`; running them via Playwright was pure overhead
- **Removed 4 duplicate `validateBackupFile` smoke assertions** — `test/unit.cjs` already covers 11 cases; only the 3 DOM-presence checks are kept in Section 39
- **All `waitForTimeout(200/300/400)`** reduced to `waitForTimeout(50)`: the app's event handlers call `save()` + `render()` synchronously so the DOM is updated before `page.evaluate()` resolves; 50ms retains a small buffer without paying the full 200–400ms per click
- **Duplicate section 6 renumbered to 40** to make numbering unambiguous
- **Removed sections 26–31** (meeting deletion localStorage round-trip, nameday/flag-day content presence, status carry-over element query, upcoming tasks body-text check, timer input CSS colour check) — these either test browser built-ins, external API availability, or element existence already covered by Section 1; no feature behaviour is lost
- **Trimmed Section 25** to a single `renderCalStrip` behavioural assertion; dropped the 4 element-existence checks
- Net result: **31 smoke tests removed** (covered elsewhere or not testing behaviour), **211 smoke + 133 unit = 344 tests total**, wall-clock runtime roughly halved

---

## v1.8.3 — 2026-05-27

### Code quality — Higher QA checklist pass
- **`.nvmrc`** added at project root (Node 24.15.0)
- **Duplicate formatters removed**: `_fmtDur`, `_mlFmtDur`, `fmtDurMs`, `fmtDurMsL`, and the inline formatter in `07-lifecycle.js` all replaced by `fmtDur` / new `fmtDurLong` in `00-pure-fns.js`; `fmtDurLong` is unit-tested
- **Silent catches fixed**: `loadLogNotes`, `loadTrackers`, `loadReflection`, `loadSprintLog` now call `wlLog.warn()` on parse failure, matching the rest of the codebase
- **JSDoc added** to all public functions in the 8 new BuJo feature modules (`16-rapid`, `10b-signifiers`, `18-dailylog`, `19-monthlylog`, `20-migration`, `21-reflection`, `22-trackers`, `23-sprints`)
- **Stylelint** added (`stylelint-config-standard-scss`); wired into `npm run lint` and lint-staged; 3 genuine CSS bugs fixed (empty block, 2× duplicate properties, deprecated `word-break: break-word`)
- **`DATA.md`** updated with 5 new entry/task fields (`signifier`, `_uncategorised`, `_sprintDuration`, `_sprintOutcome`, `_migrated`) and 5 new localStorage keys (`wl_lognotes_v1`, `wl_reflection_v1`, `wl_sprints_v1`, `wl_trackers_v1`, `wl_migration_v1`)
- **README** fixed: smoke-test command corrected (`smoke-tests.cjs`); BuJo feature section added

---

## v1.8.2 — 2026-05-26

### Features
- **Backup import integrated into Start of Day**: the first click of the day on the 🌅 "start the day" button now asks whether you want to restore a JSON backup before beginning. Choosing OK opens the file picker; the page restores the backup and reloads with the SOD timestamp already set so no data is lost. Subsequent clicks (correcting start time) are unchanged. The standalone "📥 restore backup" button in the export section has been removed — restore is now part of the SOD flow where it belongs.
- **Forced hourly break removed**: the automatic break that fired at XX:50 each hour (stopping the timer, creating a Break entry, starting a 10-minute pomodoro, and entering focus mode) has been removed. The corresponding `checkReminders()` and `playWaterReminderSound()` functions and their state variables have been deleted from `09-clock-weather.js`.

### Bug Fixes
- **TDZ crash on fresh build**: `wlLog.config()` in `07-lifecycle.js` referenced `planTasks` (declared in `10-tasks.js`, concatenated later) at the top level of the IIFE, causing a temporal dead zone error on any freshly built `script.js`. The call is now deferred with `setTimeout(fn, 0)` so it runs after all declarations in the IIFE are initialised.

### Code quality
- `validateBackupFile(backup)` extracted as a pure function in `00-pure-fns.js` so backup validation can be unit-tested independently of the browser `File` API

---

## v1.8.1 — 2026-05-26

### Bug Fixes
- **Timezone bug fix**: `dk()` was using `toISOString()` (UTC midnight) as the date key, causing entries created between local midnight and the UTC offset (e.g. between 00:00–03:00 in Helsinki, UTC+3) to be stored under the previous calendar day. `dk()` now uses local date components (`getFullYear` / `getMonth` / `getDate`). A one-time localStorage migration re-derives `entry.date` from each entry's `ts` timestamp to correct any previously mis-dated entries.
- **`fmtDur` extracted**: duplicated "Xh Ym" duration formatter in `render()`, `renderChart()`, and `renderPlan()` replaced with a single `fmtDur(ms)` pure function in `00-pure-fns.js`
- All empty `catch {}` blocks replaced with either `wlLog.warn()` or an explanatory comment
- Removed dead functions `todayHasUnexportedEntries` and `checkSnapshot` (no call sites)

---

## v1.8.0

### Code Quality & Documentation
- Full JSDoc coverage across all 15 JS source modules (functions, params, return types)
- JSDoc added to structured logger, timer, render, focus, lifecycle, pomodoro, entries, tasks, timeblock, clock/weather, calendar, Jira, Notion, changelog, and misc modules
- Accessibility: ARIA labels on all icon-only buttons, `role="dialog"` / `aria-modal` on modals, `role="region"` on stat and pomodoro sections, `role="list"` on task lists, `aria-live` on dynamic counters
- Keyboard navigation for all collapsible section headers (Enter/Space) with MutationObserver-driven `aria-expanded` sync
- Modal focus management: focus saved on open, restored on close; Escape closes dialogs
- `planHeader` excluded from `role="button"` due to nested interactive button (idkwBtn)

### Automation & Tooling
- Husky pre-commit hook running ESLint + Prettier via lint-staged
- Dependabot auto-update configuration for npm dependencies
- GitHub Releases workflow: auto-extracts CHANGELOG section for the tag and creates a GH Release
- Lighthouse CI workflow: builds, serves via `vite preview`, audits with thresholds (≥85% a11y/best-practices, ≥70% performance)
- `.lighthouserc.json` with `warn`-level thresholds (ready to promote to `error`)
- Break restoration: automated hourly break now auto-restarts the pre-break task when the 10-min pomodoro ends at :00

### Bug Fixes
- Three-state checkpoint toggle (false → 'partial' → true) fixed in focus mode overlay
- Smoke test suite updated for three-state toggle; regression test added (Section 38)

---

## v1.7.0

### Tasks
- Task checkpoints — break any task into steps with a three-state toggle (not done / partial / done)
- Checkpoint steps can be reordered by drag and edited inline with double-click
- Checkpoint badge colour mirrors parent task status
- Edit capability for completed tasks
- Pending/blocked status now propagates correctly through carried copies on day rollover
- Pending/blocked tasks no longer carry over automatically to the next day

### Focus Mode
- Focus mode improvements: auto-expand and transition handoff
- Parked thoughts can be moved between meetings and today's tasks

### Billable Tracking
- Billable/non-billable totals shown under "time by task" in the summary
- Billable emoji hidden on completed tasks (data retained, display cleaned up)

### Calendar
- Meetings sorted by start time
- Delete button for individual meetings in the today's meetings section

### Reliability & QA
- Nameday API proxied through local server to fix CORS issue
- CSP updated to allow any localhost port for server flexibility
- Smoke test suite expanded to 31 sections (161+ tests)
- Screenshots replaced with fully anonymised versions

---

## v1.6.0

### Calendar Integration
- Outlook calendar via COM interop (no sharing or permissions required, Windows only)
- Falls back to M365 ICS if COM unavailable
- Walks all accounts and folders to find calendars including external accounts
- Shows past / now / upcoming states; pulse animation on current meeting
- Recurring and single-occurrence events supported
- Teams join links surfaced; configurable account labels shown per calendar account
- Delete button per meeting; meetings sorted and deduplicated

### Nameday
- Switched to official Nimipäivärajapinta API
- Finnish and Swedish names shown with explicit language labels
- Flag days, holidays, and notable days combined into a single display

### Jira Integration
- Paste a Jira CSV export to bulk-create tasks
- Ticket keys linkified (e.g. PROJ-123 → link)
- Deduplication prevents re-importing existing tickets

### Tasks
- Inline editing for task names (click to edit)
- Hidden tasks toggle — dismiss tasks from view without deleting
- Split feature: group child tasks under a parent
- Upcoming status and section for future-dated work
- Parked thoughts section restored

### Chart
- Time-by-task chart improvements
- Streak counter fixed — now counts from yesterday, not today

### Reliability
- Timer fix: liveEntry undefined crash in renderTimeblock resolved
- CSS fix: duplicate `</style>` tag removed
- 114 smoke tests passing including boundary, paused block cap, and parent invariant

---

## v1.5.0

- Intermediate release consolidating local and remote branches

---

## v1.4.0

### Features
- Emergency / focus mode with transition handoff notes
- Task retirement — completed tasks age out after configurable period

### Reliability
- Critical timer fix: liveEntry undefined crash in renderTimeblock (timer not ticking)
- Banner null crash fixed; `_lastTickDate` TDZ issue resolved
- Start-of-day (SoD) button tracks when the day began
- `safeCssColor` blocks CSS injection from malformed category colours
- Emoji on task names preserved across carries and edits

### Testing
- Smoke test suite expanded: 38 → 53 → 70 → 95 → 114 tests
- New tests cover distraction tracking, active task, tab title, safeCssColor, header elements, save guard, completed section, parent promotion, untracked boundary, and paused block cap

---

## v1.2.1

### Security
- Local server now binds to 127.0.0.1 only — no longer accessible on the local network

### Setup
- `launch.bat` restored (was missing from initial release)
- `launch.sh` added for Linux / Mac users (Python3 HTTP server, auto port detection)

### Testing
- Initial smoke test suite added (38 tests covering load, timer, carry, sort, rounding)
- Morning test automation scripts and test status docs added

---

## v1.1.0

### Header
- Two-box layout: date/time/weather left, week/moon/nameday right
- Week number (ISO format Week X/X) in large monospace font
- Sunrise / Sunset / Day length with bold green/red +/- diff vs yesterday
- Moon phase with emoji, illumination %, phase name, and zodiac sign
- Finnish nameday fetched live from nimipaivat.fi with hardcoded fallback

### Today's Tasks
- Click task name to edit inline
- Add epic inline from the epic picker
- Drag ⋮ handle to make a task a child of another — inherits parent's epic
- Child tasks hide their epic label; restored when detached
- Starting a child task auto-promotes parent to In Progress
- Status colours: amber for In Progress (bold), green for Done, grey for To do
- Sort: active timer → In Progress → To do (deadline, alpha) → Done
- Active timer task pulses and moves to top, bolded with ▶ prefix
- Header shows X to do · X in progress · X done
- Deadline date picker with overdue (red) and due-today (amber) highlighting

### Completed Tasks
- New section below today's tasks — tasks move here when marked Done
- Shows Done pill, epic dot, task name, and completion timestamp
- Rolling 14-day window — visible from completion day, drops off after 14 days

### Timeblock
- Start button on planned blocks — starts timer and sets task In Progress
- Current time red line indicator
- Completed task blocks dim with strikethrough
- Start-time notifications: prompt to start or switch timer when block is due
- Overlap detection on drag, move, and meeting add

### Pomodoro
- Ring now empties clockwise
- Session log: timestamp, duration, active task name

### Reliability
- Critical fix: load() restored to startup sequence
- save() guard prevents overwriting existing data with empty arrays
- Snapshot includes raw entries + categories for auto-restore
- Timer restoration protected against load failures
- patchCarriedTasks preserves status and parent-child on day rollover
- completedAt uses roundToNearest30; 23:59 sentinel shown as date-only

### Weather
- Rain forecast starts from next hour (no past times shown)
- Weather emoji from WMO codes
- Timezone fix for Helsinki local time

## v1.0.0
- Initial release
