# Work Log Architecture

<!-- Design certificate -->
| Field | Value |
|---|---|
| Document version | 1.9.2-r3 |
| Covers app version | v1.9.2 (main, 2026-08-16) |
| Last reviewed | 2026-08-16 |
| Reviewed by | Claude Sonnet 5 (extracted date-labels.js from 02-utils.js, issue #336 — updated the 02-utils.js and app-constants.js entries, added a date-labels.js entry, and refreshed the source file count and test counts touched by that change. Not a full re-audit of every per-module line count) |
| Status | **Approved** — reflects current implementation |

Per-module line counts below exclude blank lines (`grep -c .`, not `wc -l`).

---

## Overview

Work Log is a single-page ADHD-friendly time tracking application built as one HTML file. It uses modular JavaScript (54 source files across 30+ numbered modules — a handful of which are real ES modules, see `LEAF_MODULES` in `build-config.js`) and organised SCSS, bundled via build.js.

**Key Principle**: Client-side only. All data stored in localStorage. Runs in browser, no backend needed.

---

## Module Map

### Core Modules

#### **00-config.js** (82 lines) — App Configuration
**Responsibility**: Centralised constants and feature flags that operators may need to adjust (no secrets).

**Key constants**:
- `AUTO_PAUSE_ON_TAB_SWITCH` — Whether the timer auto-pauses when the tab is hidden (default `true`)
- `CAL_ACCOUNT_LABELS` — Map of calendar account keys to display names
- `DEFAULT_WORK_LOCATION` — Fallback location when none is recorded (default `'remote'`)

**Not for**: credentials, tokens, or user-specific paths — those go in `00-config.local.js` (gitignored).

---

#### **01-state.js** (214 lines) — Data Store
**Responsibility**: Single source of truth for all application state

**Exports**:
- `entries` — Array of logged work entries (with timestamps)
- `planTasks` — Array of today's tasks (with status, checkpoints, deadline)
- `categories` — Custom work categories (epic colors)
- `activeTimer` — Current timer state or null
- `blocks` — Timeblock UI objects

**Key Functions**:
- `load()` — Restore state from localStorage with validation
- `save()` — Persist entries/timer/timer backup
- `savePlan()` — Persist tasks to localStorage
- `validEntry()`, `validPlanTask()`, `validTimer()` — Schema validators (guards against corrupted data)

**Data Format**:
```javascript
// Entry: logged work activity
{ id: '123', text: 'Design homepage', tag: 'work', ts: 1234567890, 
  tsEnd: 1234567900, date: '2026-05-25', billable: true }

// Task: planned activity for today
{ id: 'pk1', text: 'Build form', date: '2026-05-25', status: 'inprogress',
  tag: 'work', checkpoints: [{id: 'c1', text: 'Step 1', done: 'partial'}, ...],
  deadline: '2026-05-25', billable: true }

// Category: visual grouping (epic)
{ id: 'work', label: 'Work', color: '#378ADD' }
```

**localStorage Keys** (versioned):
```
wl_entries_v1      → entries array
wl_timer_v1        → activeTimer object
wl_plan_v1         → planTasks array
wl_cats_v1         → categories array
wl_snapshot        → backup (auto-restore on failure)
```

---

#### **01b-migrate.js** (97 lines) — Data Migration
**Responsibility**: One-shot localStorage migrations that run on startup to upgrade stored data to the current schema. Each migration is idempotent and guarded by a version key so it only runs once.

**Pattern**: `migrate()` is called from `load()` in `01-state.js` before any data is read; each sub-migration patches entries/tasks/categories in place and sets a `wl_migrated_<name>` flag.

---

#### **logger.js** (47 lines) — Structured Logger (LEAF MODULE)
**Responsibility**: `wlLog` — the application's single logging interface. Wraps `console` with level filtering and structured output. Imported as an ES module at the top of `script.js`.

**API**: `wlLog.debug()`, `wlLog.info()`, `wlLog.config()`, `wlLog.warn()`, `wlLog.error()` — each accepts a message string and an optional data object.

---

#### **pure-fns.js** (65 lines) — Pure Utility Library (LEAF MODULE — barrel)
**Responsibility**: Re-exports all stateless, side-effect-free helpers from four themed sub-modules. Imported as an ES module; exports are auto-discovered by the build system.

**Sub-modules**:
- `pure-fns-format.js` (216 lines) — String, colour, and duration formatters: `escHtml`, `safeCssColor`, `dk`, `fmtTime`, `fmtElapsed`, `fmtDur`, `fmtDurLong`, `fmtAgo`, `roundToNearest30`
- `pure-fns-export.js` (745 lines) — Entry grouping, export helpers, rolling summary, backup retention, weekly ticket summary, and gap-report/export-warning entry filters: `parseJiraLabel`, `groupEntriesByCategory`, `buildTimesheetSummaryLine`, `buildEntryLinkMap`, `findExportWarnings`, `buildRollingSummary`, `applyBackupRetention`, `computeDayBounds`, `formatGroupedLines`, `findGapReportEntries`, `buildWeeklyTicketSummary`, `formatWeeklyTicketSummaryText`
- `pure-fns-tasks.js` (269 lines) — Rapid-log token parser, task carry status, and work-location helpers: `parseRapidTokens`, `resolveCarryStatus`, `locationFor`, `nextLocation`, `WORK_LOCATIONS`
- `pure-fns-validate.js` (264 lines) — Per-record validators and backup integrity: `validEntry`, `validCategory`, `validPlanTask`, `validBlock`, `validTimer`, `validPomoEntry`, `validateBackupFile`, `filterNewBackupEntries`, `validWeatherResponse`, `validCalendarMeeting`, `validJiraCsvRow`

---

#### **02-utils.js** (305 lines) — Category Lookup, Epic Manager UI, and Date/Billing Helpers
**Responsibility**: Category (epic) lookup/sanitisation, the epic picker/manager UI, and a handful of billing/entry helpers that don't fit elsewhere.

**Key Functions**:
- `getCat(id)`, `getCatColor(id)`, `getCatLabel(id)` — category lookup by ID with fallback to `'other'`; colour always passes through `safeCssColor()`
- `renderTagRow()` — renders and wires the epic dropdown, quick colour picker, and rename/delete/add manage row
- `roundToNearest30IfBillable(ts, entry)`, `safeRoundedStart()` — billing-aware timestamp rounding
- `viewEntries()` — entries for the currently viewed date, sorted newest-first by start time
- `calcStreak()` — consecutive logged-work-day streak, looking backwards from yesterday

**Dependencies**: not a leaf-module candidate — checked during issue #336's ES-module extraction and found too entangled to extract as one file. Reads/writes module state declared elsewhere (`categories`, `selectedTag`, `entries`, `viewDate`, `planTasks`) and calls functions defined in later-loaded files (`save()`, `render()`, `renderTimeblock()`, `renderCompleted()`, `renderPlan()`, `nextDistinctColor()` in `01-state.js`/`04-render.js`/`10a-tasks-render.js`/`11-timeblock.js`, `isEntryBillable()` in `05-entries.js`). Only `dk`, `escHtml`, `safeCssColor`, `roundToNearest30` come from the `pure-fns.js` leaf module. The genuinely stateless date helpers that used to live here (`isToday`, `fmtLabel`) were extracted to `date-labels.js` — see below.

---

#### **app-constants.js** (63 lines) — Static Config Constants (LEAF MODULE)
**Responsibility**: `localStorage` key names and the built-in category seed/palette data. Pure literal values with no dependencies — imported as an ES module at the top of `script.js`. Extracted from `01-state.js` (issue #336), the first ES-module extraction beyond the original `logger.js`/`pure-fns.js` set.

**Exports**: `STORE_ENTRIES`, `STORE_TIMER`, `STORE_POMO_LOG`, `STORE_CATS`, `STORE_QP_HIDDEN`, `STORE_LOGNOTES`, `STORE_TRACKERS`, `STORE_MIGRATION`, `STORE_LOCATION`, `DEFAULT_CATS`, `CUSTOM_PALETTE`

---

#### **date-labels.js** (31 lines) — Date-to-Label Helpers (LEAF MODULE)
**Responsibility**: `isToday(d)` and `fmtLabel(d)` — stateless date helpers used across 8 files (`04-render.js`, `07-lifecycle.js`, `08-pomodoro.js`, `10a-tasks-render.js`, `11-timeblock.js`, `11-timeflow.js`, `11a-timeblock-render.js`, and formerly `02-utils.js` itself). Only depends on `dk()` from the `pure-fns.js` leaf module. Extracted from `02-utils.js` (issue #336) — the second ES-module extraction, and the model case for "pull the stateless part out, leave the entangled part alone" rather than forcing a whole-file extraction.

**Exports**: `isToday`, `fmtLabel`

---

#### **03-timer.js** (572 lines) — Timer Logic
**Responsibility**: Track active work session timing

**Exports**:
- `activeTimer` — Current running timer state
- `startTimer(entryId)` — Start timer on entry, update UI
- `stopTimer()` — End session, calculate duration
- `pauseTimer()` — Pause (keeps running state)

**Internals**:
- `tickTimer()` — Called every 100ms to update elapsed time
- `timerInterval` — setInterval reference for cleanup
- Tab title updates with format: `▶ 0:30 Timer task` (running) or `⏸ 0:30 Timer task` (paused)

**Data Persistence**:
- Timer state saved to `wl_timer_v1` so it persists across reloads
- On reload, timer resumes automatically if still active

---

#### **04-render.js** (892 lines) — Top-Level UI Rendering
**Responsibility**: Orchestrate rendering of all visible sections

**Main Function**:
- `render()` — Master render function called after every state change

**Sections Rendered**:
```
render() → {
  renderStats()              // Top bar: today's counts
  renderEntries()            // Entries timeline
  renderPlan()               // Today's tasks section
  renderCompleted()          // Recently completed tasks
  renderParked()             // Parked thoughts
  renderNowNext()            // Timer display
  renderCalStrip()           // Calendar meetings
  // ... others
}
```

**Rendering Pattern**:
1. Gather data from state
2. Build HTML strings
3. Set innerHTML on DOM element
4. Attach event listeners

**No Virtual DOM**: Direct DOM manipulation for simplicity

---

### Feature Modules

#### **05-entries.js** — Work Log Entry Management
**Responsibility**: Create new log entries and apply the billable rule. Export/import and File System Access persistence were split to `05a-export.js` and `05b-filesystem.js`.

**Key Functions**:
- `addEntry(withTimer)` — Create new entry from capture input
- `isEntryBillable(entry)` — Check if entry is billable

**Data Validation**:
- Each entry must have: id, text, ts (timestamp), date
- Optional: tsEnd (end timestamp), billable flag, tag (category)

---

#### **05a-export.js** — Text Export
**Responsibility**: Generate and download the end-of-day plaintext export.

**Key Functions**:
- `exportTxt()` — Orchestrates the export: groups entries by category (with each task's individual tracked sessions, notes, and proof links), computes day bounds and the implied break time, builds the per-task summary line and any anomaly warnings, and writes the file via `05b-filesystem.js` or a browser download fallback.

**Text Export Format**:
```
Work Log — 2026-05-25
Started: 08:45  |  Ended: 17:30
Workday: 8h 45min
Total tracked: 8h 20min  |  💰 Billable: 7h 50min  |  💸 Internal: 30min
Breaks (untracked): 25min
---
8h 20min - Work
    4h 30min - Build form
        08:45–13:15
        note: waiting on staging creds
        link: T197797
    3h 50min - Code review
...
---
Build form (4h 30min); Code review (3h 50min, internal)
---
⚠ Warnings:
  - Long unbroken block: Build form (4h 30min)
```

The `Breaks (untracked)` header line and the `⚠ Warnings` section are omitted
when there is nothing to show (no computable workday span, or a clean day
respectively).

Pure helpers (`groupEntriesByCategory`, `buildTimesheetSummaryLine`, `buildEntryLinkMap`,
`findExportWarnings`) live in `pure-fns.js` and are unit-tested there.

---

#### **05b-filesystem.js** (171 lines) — File System Access Persistence
**Responsibility**: Persist the user's chosen save folder and write export files via the browser File System Access API; falls back to a `<a download>` click when FSA is unavailable.

**Key Functions**:
- `getSavedDir()` — Retrieve the persisted `FileSystemDirectoryHandle` from IndexedDB (in-memory cached).
- `saveToDir(filename, text)` — Write a text file to the saved directory or trigger a browser download.
- `pickSaveDir()` — Open the directory picker and persist the chosen handle.

**Persistence**: Directory handles stored in IndexedDB (`wl_fs_v1`) so the user is not re-prompted on every export.

---

#### **06-focus.js** (168 lines) — Focus Mode (Emergency Mode)
**Responsibility**: Distraction-free focus interface

**Features**:
- Full-screen "emergency" mode showing only active task
- Parked thoughts capture without leaving focus
- Shows next task hints

**DOM Elements**:
```
emergencyScreen    → Hidden normally, shown on focus toggle
emergencyTask      → Current task name
emergencyNext      → Input for next action
parkedThoughts     → List of captured thoughts
```

**Keyboard**: Escape key exits focus mode

---

#### **06a-hero.js** (515 lines) — Hero Card State Machine
**Responsibility**: Drive the four visual states of the `#heroCard` widget that replaced the legacy `#timerBar`.

**States**:
| State | Appearance |
|---|---|
| `idle` | Logged-today total, last-session time, task-composer input, 3 recent-task chips |
| `running` | Large elapsed clock, pulsing dot, category + task title, note row, Break/Lunch/Meeting pills |
| `paused` | Amber border wash, frozen clock, resume/stop button pair |
| `stopped` | 6-second confirmation window with session summary (range, total today), undo, note, done |

**Key Functions**:
- `renderHeroCard()` — Full re-render; called after any state change.
- `heroUpdateClock()` — Updates the running clock label every tick (called from `tickTimer`).
- `heroEnterStopped()` — Transitions to stopped state; called by `stopTimer()`.
- `initHero()` — Binds button events; called once from `DOMContentLoaded`.

**Compat**: Legacy IDs (`#timerStop`, `#timerPause`, `#emergencyBtn`, etc.) are preserved as hidden stubs so `06-focus.js` and other modules need no changes.

---

#### **07-lifecycle.js** (385 lines) — App Initialization & Cleanup
**Responsibility**: Startup, shutdown, and day-boundary handling

**On Load**:
1. `load()` from localStorage
2. Check if date changed (new day)
3. Auto-carry unfinished tasks
4. Start periodic updates (calendar, weather)

**Auto-Carry Logic**:
- Unfinished tasks from yesterday → today
- Tasks keep their status (inprogress stays inprogress)
- Done tasks not carried
- Pending/blocked tasks carried with status preserved

**Day Boundary**:
- Triggered at midnight or on page load if date changed
- Runs `autoCarryTasks()` from state module

---

#### **08-pomodoro.js** (382 lines) — Pomodoro Timer
**Responsibility**: Ring timer with session logging

**Features**:
- 5, 10, 20 minute presets
- Visual ring that empties clockwise
- Sound on completion
- Session log with timestamps

**Separate from Main Timer**: Pomodoro runs independently, doesn't affect work log timer

---

#### **08a-pomo-dashboard.js** (166 lines) — Pomodoro 4-Column Dashboard
**Responsibility**: Draws the sparkline and ribbon footer below the `.pomo-grid` 4-column card layout; runs after `08-pomodoro.js` in the build concatenation.

**Layout columns** (CSS grid in `_pomo.scss`):
| Col | Width | Content |
|---|---|---|
| Clock face | 140 px | Ring SVG + duration buttons |
| Composer | 1fr | Task label, controls, chime selector |
| Sparkline | 170 px | 28-day focus density bar chart (`<canvas>`) |
| Ledger | 220 px | Recent-session log |

**Key Functions**:
- `renderPomoSparkline()` — Draws the 28-day `<canvas>` bar chart; reads `--pomo-spark-fill`/`--pomo-spark-empty` CSS variables so it responds to dark-mode automatically.
- `renderPomoRibbon()` — Updates the ribbon footer: last-5-session dot sequence (`#pomoRibbonDots`), Peak Focus / session-count pill (`#pomoRibbonPill`), and "View all sessions" scroll link.
- `updatePomoTaskLabel()` — Shows the currently running timer task name in the composer column.
- `refreshPomoDashboard()` — Orchestrator; called on load and after every session completion.

**CSS variables** (defined in `_pomo.scss`):
```css
--pomo-spark-fill:  #c62828   /* dark: #e5615b */
--pomo-spark-empty: #e8edf4   /* dark: #252e3d */
```

---

#### **09-clock-weather.js** (565 lines) — Live Info Widgets
**Responsibility**: Display current time, weather, moon phase, nameday

**Data Sources**:
- **Time**: Browser `Date` object
- **Weather**: OpenWeather API (Helsinki)
- **Moon**: Astronomical calculations
- **Nameday**: nimipaivat.fi API
- **Flag Days**: Hardcoded Finnish flag days

**Fallbacks**:
- Weather fails → "unavailable"
- Nameday API fails → hardcoded fallback list
- Moon calculations always work (no API)

**Rendering**: Updates every 1 minute, refreshes weather every 10 minutes

---

#### **10-tasks.js** (170 lines) — Task Management
**Responsibility**: Plan tasks, status transitions, checkpoints, deadlines

**Task Statuses**:
```
todo        → Not started
inprogress  → Currently working
done        → Completed
pending     → Waiting on external blocker
blocked     → Waiting on internal dependency
upcoming    → Scheduled for future date
```

**Checkpoints** (Subtasks):
- Each task can have child steps
- Three-state toggle: false (not done) → 'partial' (in progress) → true (done)
- Visual progress indicator (X/Y completed)

**Features**:
- Inline editing (task name, deadline, status)
- Drag to reorder or nest (parent-child)
- Deadline date picker (red if overdue, amber if due today)
- Billable flag per task
- Handoff notes (carry-over text for next day)
- Status comment capture (why it's blocked, pending, etc.)

**Rendering Pattern**:
1. Separate lists for active (todo/inprogress) and passive (done/pending/blocked)
2. Render with inline edit buttons, status selectors
3. Attach event listeners for drag, status change, delete

---

#### **10a-tasks-render.js** (267 lines) — Task Rendering
**Responsibility**: HTML generation for the plan board — column headers, card shells, and the public `renderPlan()` orchestrator.

**Key Functions**: `renderPlan()`, `renderBoardDoneHistory()`, `checkpointBadgeHtml()`

---

#### **10a-tasks-row.js** (307 lines) — Per-Row Card HTML
**Responsibility**: Per-task card HTML builders for the kanban board. Module-level state variables (`editingPlanId`, `_noteOpenIds`, `_cpOpenIds`) live in `10-tasks.js`; callers live in `10a-tasks-render.js`.

**Key Functions**: `statusOpts()`, `prioBtnHtml()`, `notionBtnHtml()`, `noteBtnHtml()`, `noteAreaHtml()`, `billBtnHtml()`, `renderRow()`

---

#### **10b-tasks-events.js** (334 lines) — Task Event Binding
**Responsibility**: Attaches event listeners to the rendered plan board — status changes, inline editing, drag-to-reorder, checkpoint toggling, deadline, billable flag, and handoff notes. Per-card editor bindings (comments, notes, checkpoints) were split to `10d-tasks-editors.js`.

**Key Functions**: `bindPlanEvents(lists)`, `bindPlanCommentEvents()`, `bindPlanNoteEvents()`, `bindPlanCheckpointEvents()`

---

#### **10b-signifiers.js** (83 lines) — Entry Signifiers
**Responsibility**: Clickable status symbol on each entry row that cycles through: billable → event → flagged → migrated → cancelled → overtime.

**Key functions**: `sigHtml(entry)`, `cycleSignifier(entryId)`, `bindSignifierClicks()`

**Data**: `entry.signifier` field (`'billable' | 'event' | 'flagged' | 'migrated' | 'cancelled' | 'overtime' | null`)

---

#### **10c-tasks-board.js** (223 lines) — Kanban Board Drag-and-Drop
**Responsibility**: Board-level drag-and-drop between columns, column tab switching, and the live "N in progress" WIP badge. Extracted from `10b-tasks-events.js` so column logic stays separate from card-level event binding.

**Key Functions**: `moveTaskToColumn()`, `bindBoardColumnDnD()`, `initBoardColumnDnD()`, `initBoardTabs()`, `updateBoardLive()`

---

#### **10d-tasks-editors.js** (355 lines) — Per-Card Inline Editors
**Responsibility**: Binds the inline comment, note, and checkpoint editors for individual task cards. One function per editor type; called from `10b-tasks-events.js`.

**Key Functions**: `bindPlanCommentEvents(qa)`, `bindPlanNoteEvents(qa)`, `bindPlanCheckpointEvents(qa)`

---

#### **10e-weeklyplan-review.js** (173 lines) — Weekly Plan Review Checklist
**Responsibility**: Surfaces plan tasks marked `upcoming` whose date falls within the current ISO week as a dismissible banner once a new week begins, so tasks planned ahead that turned out to already be finished elsewhere get caught before they silently resurface. Opens a checklist with "✓ done" / "✕ drop" actions per row; the app has no live Jira connection, so this only ever prompts — it never auto-detects completion.

**Key Functions**: `renderPlanReviewReminder()`, `openPlanReviewOverlay()`, `markPlanReviewedThisWeek()`, `currentPlanReviewWeekKey()`

---

#### **11-timeblock.js** (310 lines) — Visual Time Grid Orchestrator
**Responsibility**: 8:00–18:00 grid view for planning. Orchestrates the three sub-modules below; owns block add/edit form, overlap detection (`tbOverlaps`), and the slot/time converters (`slotToTime`, `timeToSlot`).

**Sub-modules**:
- `11a-timeblock-render.js` (329 lines) — Full grid render loop: time labels, auto-blocks from log entries, manual planned blocks, untracked-time labels, now-line; all grid drag/drop wiring.
- `11b-timeblock-carry.js` (363 lines) — Plan-task day-boundary lifecycle: `autoCarryTasks`, `patchCarriedTasks`, iteration expiry dates (seed/load/edit/save), completed-task history renderer.

**Features**:
- Drag logged entries to create/move blocks
- Visual overlap detection
- Current time red line indicator
- Start buttons to activate tasks
- Completed blocks shown dimmed with strikethrough

**Data Structure** (`blocks` array):
```javascript
{ id: 'bk1', text: 'Task name', date: '2026-05-25', 
  slot: 8, duration: 1.5 }  // slot 8 = 08:00, duration in hours
```

---

#### **12-misc.js** (431 lines) — Miscellaneous Features
**Responsibility**: Distraction logging, daily stats, quick pick

**Features**:
- Distraction tracking (note & timestamp)
- Quick pick (recently logged tasks as chips)
- Daily stats (total tasks, work hours)
- Hide/show dismissed entries

**Distraction Flow**:
1. User clicks distraction button during timer
2. Enter distraction note (e.g., "Twitter")
3. Saved to localStorage with timestamp
4. Shown in distraction feed

---

#### **12a-changelog.js** (254 lines) — Changelog Modal & EOD Orchestration
**Responsibility**: EOD modal (handoff notes, dev-log entry, Notion deploy trigger) and app startup orchestration.

**Sub-modules**:
- `12b-changelog-data.js` (631 lines) — `DEV_CHANGES` dataset: the full version-history entries rendered in the changelog modal.
- `12c-startup.js` (39 lines) — Top-level bootstrap: calls `loadExpiryDates`, `autoCarryTasks`, `patchCarriedTasks`, `renderCompleted`, and `renderTimeblock` on page load.
- `12c-gapreport.js` (124 lines) — End-of-week gap report: lists this week's finished, non-cancelled, billable entries missing a proof link or note, via `findGapReportEntries()`; "+ fix" jumps to the entry's editor in the Log view.
- `12d-weeklyreport.js` (104 lines) — Weekly report draft: groups this calendar week's finished, non-cancelled, non-utility entries by Jira ticket key via `buildWeeklyTicketSummary()`/`formatWeeklyTicketSummaryText()`, and opens a modal with the rendered text and a copy-to-clipboard button.

**Key Functions**: `mergeDevLog()`, `openEodModal()`, `saveEodHandoffNotes()`, `triggerPortableDeploy()`

---

#### **13-calendar.js** (537 lines) — Outlook Calendar Integration
**Responsibility**: Fetch and display today's calendar meetings

**Data Source**:
- Windows: PowerShell server fetches Outlook COM
- macOS/Linux: Not available (shows placeholder)

**Polling**:
- Full refresh every 10 minutes
- Quick re-render every 1 minute (updates past/now/upcoming states)

**Meeting Display**:
- Time, duration, title
- Account label (distinguishes personal vs. work calendar)
- Join button (for Teams/Zoom links)
- Delete button (hides meeting from today)

**Hidden Meetings** (localStorage):
```
wl_hidden_meetings_YYYY-MM-DD → ["subject|start", ...]
```
Keyed per occurrence, so hiding one instance of a recurring meeting leaves the
day's other instances on the strip. Entries written before this were bare
subjects and are still honoured; the store is keyed by date, so they expire on
their own.

**Collection rules** (`server-helpers.ps1`, exercised by `test/calendar.Tests.ps1`):
the decisions that determine which meetings arrive — day overlap, when a folder
scan may stop early, dedup identity, subject and Teams-link normalisation, the
recursive calendar-folder walk, and the recurring-occurrence probe — live in the
shared helpers file rather than inside `start-server.ps1`'s COM runspace, so they
are unit-tested with PSCustomObject stand-ins and need no Outlook install.

**Account Label Mapping** (configured in `src/js/00-config.js`):
```javascript
const CAL_ACCOUNT_LABELS = { 
  acme: 'Acme Corp',
  contractor: 'My Contractor' 
};
```
Tries 3 lookup strategies:
1. Exact match on key
2. Email domain match (x@acme.com → acme)
3. Substring match (contains "acme")

---

#### **14-jira.js** (463 lines) — Jira Import
**Responsibility**: Bulk-import Jira tickets as tasks

**Flow**:
1. User pastes Jira CSV export
2. Parser extracts: Key, Summary, Assignee, Status, Due Date
3. Creates tasks with status mapping:
   - Jira "To Do" → Task "todo"
   - Jira "In Progress" → Task "inprogress"
   - etc.
4. Deduplicates by task text

**CSV Format Expected**:
```
Key,Summary,Assignee,Status,Due Date
PRJ-123,Build login form,User,To Do,2026-05-30
```

---

#### **15-notion.js** (112 lines) — Notion Integration
**Responsibility**: Push tasks and log entries to a Notion database via the Notion API.

**Configuration**: Notion token and database IDs in `src/js/00-config.local.js` (gitignored).

---

### BuJo Modules (v1.8.x)

#### **16-rapid.js** (474 lines) — Rapid Logging Overlay
**Responsibility**: `Space` key anywhere (when no input is focused) opens a floating capture panel; `Enter` logs the task and optionally starts the timer immediately.

**Key functions**: `openRapid()`, `closeRapid()`, `rapidCommit(withTimer)`, `initRapid()`, `_qcBuildTaskGroups()`, `_qcTaskListHtml()`, `_qcBindTaskListEvents()`

**Inline token grammar**: Users can type `#<cat>`, `!<sig>`, and `><date>` tokens in the capture input to set category, signifier, and entry date without the mouse. Recognised tokens are stripped from the saved text; a live pill-badge preview (`#qcTokenPreview`) updates on every keystroke. Date tokens support `today`, `tomorrow`, `YYYY-MM-DD`, and weekday abbreviations.

---

#### **11-timeflow.js** (536 lines) — Today's Flow Unified Section
**Responsibility**: The `#todayFlowSection` widget that replaces the separate Timeblock and Daily Log sections with a segmented control offering three views: Flow (chronological cards with duration-scaled accent strips), Log (timeline rail with circle markers), Blocks (the existing timeblock grid). Also renders the day-overview strip (hour ticks + entry footprints + live cursor) and a gap-reminder banner when the largest untracked gap today is ≥ 15 min.

**Key functions**: `renderTodayFlow()` (orchestrator), `renderFlowHeader()`, `renderDayStrip()`, `renderGapReminder()`, `renderFlowView()`, `renderLogView()`, `findLargestGap(dateKey)`, `activeTimerDurationMs(entry)`, `getFlowView()` / `setFlowView()`, `initTodayFlow()` (binds delegated listeners + ARIA tablist keyboard nav).

**localStorage key**: `wl_flow_view` (`'flow' | 'log' | 'blocks'`, default `'flow'`).

**ARIA**: The segmented control uses `role="tablist"` with `role="tab"` buttons, `aria-selected`, `aria-controls`, and roving `tabindex`. Arrow/Home/End keys navigate. Panes use `role="tabpanel"` with `tabindex="0"`.

---

#### **18-dailylog.js** (87 lines) — Daily-log feed builder + note input
**Responsibility**: Pure data helper for the unified Today's Flow Log view. Builds chronological feed items by merging time entries, log notes, and task status comments for the given day; persists user-typed notes.

**Key functions**: `buildDailyLogItems(dateKey)`, `addLogNote()`

**localStorage key**: `wl_lognotes_v1`

---

#### **19-monthlylog.js** (246 lines) — Monthly Log Heatmap
**Responsibility**: A monthly tab with a 28-cell heat map of hours-per-day (colour-coded by intensity) and a sidebar showing task inventory and monthly totals. Tapping a cell navigates `viewDate`.

**Key functions**: `renderMonthlyLog()`, `mlHoursForDay(dateKey)`, `mlHeatColor(hours)`

---

#### **20-migration.js** (190 lines) — End-of-Month Migration
**Responsibility**: Modal flow that surfaces every unresolved task for the viewed month and requires an explicit decision: carry forward, schedule (date picker), or drop. Auto-prompts on the last day of the month.

**Key functions**: `openMigration()`, `renderMigrationStep()`, `carryTask(task)`, `scheduleTask(task, dateStr)`, `dropTask(task)`, `initMigration()`

**localStorage key**: `wl_migration_v1`

---

#### **21-reflection.js** (143 lines) — End-of-Day Reflection
**Responsibility**: After the end-of-day export, shows a modal for a 1–5 focus-quality rating, a 1–5 energy-level rating, and an optional one-sentence note. Ratings are surfaced as indicator dots on Monthly Log heatmap cells.

**Key functions**: `openReflection(onComplete)`, `renderReflStars(elId, current)`, `getReflectionForDate(dateKey)`

**localStorage key**: `wl_reflection_v1`

---

#### **22-trackers.js** (235 lines) — Custom Time-Goal Trackers
**Responsibility**: User-created trackers with a name, daily time target, and associated category tags. A 28-cell grid fills automatically from logged entries; streak counter updates daily.

**Key functions**: `renderTrackers()`, `trackerDayStatus(tracker, dateKey)`, `trackerStreak(tracker)`, `initTrackers()`

**localStorage key**: `wl_trackers_v1`

---

#### **23-sprints.js** (206 lines) — Sprint Mode
**Responsibility**: Enhances the Pomodoro with a sprint mode. User declares an intention; at the end a 3-button review (Yes / Partly / No) is shown and the session logged as a time entry with the intention as description and outcome tagged.

**Key functions**: `openSprintSetup()`, `startSprint()`, `showSprintReview()`, `notifyPomodoroEnd()`, `initSprints()`

**localStorage key**: `wl_sprints_v1`

---

#### **24-location.js** (91 lines) — Work Location Tracker
**Responsibility**: Tracks whether the user is working remotely or in the office on each day. Location is stored per-day and shown in the date-nav header in place of the ISO week number.

**Key Functions**: `renderLocation()`, `bindLocationToggle()`

**Pure helpers** (`locationFor`, `nextLocation`) live in `pure-fns.js` with unit tests.

**localStorage key**: `wl_location_v1` — object keyed by `YYYY-MM-DD`, values `"remote" | "office"`.

---

#### **25-rollingsummary.js** (162 lines) — Rolling Summary
**Responsibility**: Renders the Rolling Summary tab inside the Today's Flow section. Builds a compact, categorised digest of recent entries (current sprint or last 7 days) grouped by task and epic, showing time totals and a sparkline of daily activity.

**Key export**: `renderRollingSummary()`

**Dependencies**: `buildRollingSummary()` in `pure-fns.js`; reads `entries`, `categories` from `01-state.js`.

---

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────┐
│ Browser (localStorage)                                       │
│  • wl_entries_v1 (work log)                                  │
│  • wl_timer_v1 (active timer)                                │
│  • wl_plan_v1 (tasks)                                        │
│  • wl_lognotes_v1 (daily log notes)                          │
│  • wl_reflection_v1 (end-of-day ratings)                     │
│  • wl_sprints_v1 (sprint history)                            │
│  • wl_trackers_v1 (tracker definitions)                      │
│  • wl_migration_v1 (month close-out record)                  │
│  • wl_location_v1 (work location per day)                    │
└─────────────┬──────────────────────────────────────────────┘
              │
              ↓
    ┌─────────────────────┐
    │ 01-state.js         │
    │ (load/save/validate)│
    └──────────┬──────────┘
              │
    ┌─────────┴─────────┬──────────────────┐
    │                   │                  │
    ↓                   ↓                  ↓
entries[]          planTasks[]        categories[]
(timeline)         (today's tasks)    (epics)
    │                   │                  │
    └─────────┬─────────┴──────────────────┘
              │
              ↓
    ┌──────────────────────┐
    │ 04-render.js         │
    │ (master render)      │
    └──────────┬───────────┘
              │
    ┌─────────┴─────────────────────────────────┐
    │                                           │
    ↓                                           ↓
renderEntries()                          renderPlan()
    │                                           │
    ├→ 05-entries.js                      ├→ 10-tasks.js
    │  (log display)                      │  (task UI)
    │                                     │
    ├→ 03-timer.js                       ├→ 11-timeblock.js
    │  (timer display)                    │  (grid view)
    │                                     │
    └→ 11-timeblock.js                   ├→ 06-focus.js
       (visual grid)                      │  (focus mode)
                                         │
                                         └→ 08-pomodoro.js
                                            (ring timer)

External APIs:
├→ 09-clock-weather.js (OpenWeather, nimipaivat.fi)
├→ 13-calendar.js (Outlook PowerShell server)
└→ 14-jira.js (User pastes CSV)
```

---

## Key Design Patterns

### 1. State ← Render Loop
Every state change triggers `render()`:
```javascript
// User clicks checkbox
statusSelect.addEventListener('change', () => {
  task.status = newStatus;
  savePlan();
  render();  // ← Entire UI updates
});
```

**Benefit**: No async/observable complexity. Simple, predictable.
**Trade-off**: Full re-render on each change (fast enough with <5000 DOM nodes)

### 2. Validation on Load
All data validated with schema validators:
```javascript
entries = raw.filter(validEntry);  // ← Strips invalid records
```

**Benefit**: Corrupted data won't crash app, just gets silently dropped
**Safety Net**: Auto-restore from snapshot if entries become empty

### 3. Graceful Degradation
APIs that fail show user-friendly messages:
```javascript
try {
  const cal = await fetch('/api/calendar');
  // ...
} catch(err) {
  el.innerHTML = '📅 Calendar unavailable — restart server with Outlook open';
}
```

**Benefit**: App stays usable even if one feature breaks

### 4. Event Delegation (Limited)
Direct event listeners instead of delegation:
```javascript
qa('.plan-item').forEach(el => {
  el.addEventListener('click', handler);
});
```

Avoided because:
- Small number of items (<100)
- Clearer to bind directly
- Re-render clears listeners anyway

### 5. localStorage as Persistence
No backend, all data in browser:
```javascript
localStorage.setItem('wl_entries_v1', JSON.stringify(entries));
```

**Benefit**: No server needed, fully offline-capable
**Limitation**: Max ~5-10MB per browser

---

## Performance Considerations

### Render Speed
- `render()` call completes in <100ms (even with 1000 entries)
- Re-renders on every state change (acceptable given size)
- DOM methods: `.innerHTML` (fast bulk update), `.addEventListener` (set once, cleared on next render)

### Timer Accuracy
- `tickTimer()` called every 100ms (not setInterval of 1000ms, which drifts)
- Tab title updates, but not `window.title` every tick (batched every 100ms)

### Memory
- No memory leaks (event listeners cleared on re-render)
- Entries kept in RAM (acceptable for <10k entries)
- Old entries pruned after 14 days (completed tasks archived)

---

## Extension Points

### Adding a New Feature
1. **New module**: Create `src/js/26-feature.js` with functions (next available number)
2. **UI**: Add HTML to `work-log.html`
3. **State**: If persists, add to localStorage and validators
4. **Rendering**: Add function in `04-render.js` call stack
5. **Tests**: Add test case to `smoke-tests.js`

### Adding an External API
Example: Weather API fetch in `09-clock-weather.js`
```javascript
async function fetchWeather() {
  try {
    const res = await fetch(`https://api.openweathermap.org/...`);
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch(err) {
    console.warn('[wl] Weather API failed:', err.message);
    return null;  // Graceful fallback
  }
}
```

**Pattern**: Try/catch, fallback to null, render handles null gracefully

---

## Testing Strategy

**Unit Tests** (669 tests, 104 suites via Node built-in test runner):
- `test/unit/*.test.mjs` (`npm run test:unit`) — one file per feature area, mirroring the `src/js` module areas (`pure-fns-format`, `pure-fns-validate`, `pure-fns-export`, `pure-fns-tasks`, `date-labels`, `notion`, `tasks-board`, `rapid`, `hero`, `utils-categories`, `tasks-render`, `entries`, `render`, `monthlylog`, `timeflow`, `lifecycle`, `pomodoro`, `clock-weather`, `migration`, `jira`, `state`, `dailylog`, `location`, `logger`, `export`), split from the former monolithic `test/unit.mjs` (issue #334). Shared fixtures (`localDate`/`localMs`/`loadPureFnsScriptSource`/`__dirname`) live in `test/unit/_helpers.mjs`. `.github/scripts/test/` covers CI auth/model helpers

**Smoke Tests** (320 tests via Playwright):
- Load test: Verify no JS errors
- Feature tests: Timer, tasks, persist, UI interactions
- Edge cases: Empty data, malformed data, boundary dates
- BuJo features: Rapid logging, signifiers, daily log, monthly log, reflection, sprints, trackers

**CI Script Tests** (276 tests, 56 suites via Node built-in test runner):
- `.github/scripts/test/*.test.mjs` (`npm run test:scripts`) — commitlint/actionlint self-tests, CI auth/model helpers, GitHub thread parsing. `npm test`'s own bundled run only exercises `ci-scripts.test.mjs` (30 of these 276, covering `jsdoc-check.mjs`/`impact-check.mjs`); the full suite runs as a separate `test:scripts` step in `ci.yml`.

**Total: 1,265 tests (669 unit + 320 smoke + 276 CI-script)**

**What's NOT tested**:
- Browser-specific issues (Safari, Edge quirks)
- Network errors (assumed reliable local fetch)
- Concurrent tabs (app assumes single tab only)

---

## Future Improvements

1. **API Validation**: Add schema validators for external API responses
   - Outlook calendar response
   - Weather API response
   - Jira CSV format

2. **Consolidate CHANGELOG duplicate headings** — the v1.9.0 section still contains multiple `### Added / Changed / Fixed` groups; a follow-up PR should merge them into single headings per type.

This architecture has been stable through v1.0 → v1.9 releases with only feature additions.
