# Changelog

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
