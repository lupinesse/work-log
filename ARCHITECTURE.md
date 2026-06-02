# Work Log Architecture

<!-- Design certificate -->
| Field | Value |
|---|---|
| Document version | 1.8.9 |
| Covers app version | v1.8.9 |
| Last reviewed | 2026-05-29 |
| Reviewed by | Jenni Järvinen (author) + Claude Sonnet 4.6 (AI pair reviewer) |
| Status | **Approved** — reflects current implementation |

---

## Overview

Work Log is a single-page ADHD-friendly time tracking application built as one HTML file. It uses modular JavaScript (37 source files across 30+ numbered modules) and organised SCSS, bundled via build.js.

**Key Principle**: Client-side only. All data stored in localStorage. Runs in browser, no backend needed.

---

## Module Map

### Core Modules

#### **01-state.js** (118 lines) — Data Store
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

#### **02-utils.js** (250 lines) — Utilities
**Responsibility**: Shared helper functions

**Key Functions**:
- `dk(date)` — Format date as 'YYYY-MM-DD'
- `escHtml(str)` — HTML escape to prevent XSS
- `roundToNearest30(ts)` — Round timestamp to nearest 30 min
- `qa(selector)` — Query all (shorthand for querySelectorAll)
- `qo(selector)` — Query one (shorthand for querySelector)
- `fmtDurMs(ms)` — Format milliseconds as "5h 20min"
- `getCat(id)` — Get category by ID with fallback
- `getCatLabel(id)` — Get category display name
- `safeCssColor(color)` — Validate/sanitize CSS color value

**No External Dependencies**: All pure functions

---

#### **03-timer.js** (237 lines) — Timer Logic
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

#### **04-render.js** (413 lines) — Top-Level UI Rendering
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
  renderChart()              // Activity chart
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
- `isEntryBillable(e)` — Check if entry is billable

**Data Validation**:
- Each entry must have: id, text, ts (timestamp), date
- Optional: tsEnd (end timestamp), billable flag, tag (category)

---

#### **05a-export.js** — Text Export
**Responsibility**: Generate and download the end-of-day plaintext export.

**Key Functions**:
- `exportTxt()` — Orchestrates the export: groups entries by category, computes day bounds, builds the billable summary, and writes the file via `05b-filesystem.js` or a browser download fallback.

**Text Export Format**:
```
Work Log — 2026-05-25
Started: 08:45 | Ended: 17:30 | Workday: 8h 45min
---
8h 20min - Work
    4h 30min - Build form
    3h 50min - Code review
...
```

Pure helpers (`stripJiraPrefix`, `groupEntriesByCategory`, `mergeAdjacentEntries`, `buildBillableSummaryParts`) live in `pure-fns.js` and are unit-tested there.

---

#### **05b-filesystem.js** — File System Access Persistence
**Responsibility**: Persist the user's chosen save folder and write export files via the browser File System Access API; falls back to a `<a download>` click when FSA is unavailable.

**Key Functions**:
- `getSavedDir()` — Retrieve the persisted `FileSystemDirectoryHandle` from IndexedDB (in-memory cached).
- `saveToDir(filename, text)` — Write a text file to the saved directory or trigger a browser download.
- `pickSaveDir()` — Open the directory picker and persist the chosen handle.

**Persistence**: Directory handles stored in IndexedDB (`wl_fs_v1`) so the user is not re-prompted on every export.

---

#### **06-focus.js** (122 lines) — Focus Mode (Emergency Mode)
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

#### **06a-hero.js** — Hero Card State Machine
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

#### **07-lifecycle.js** (128 lines) — App Initialization & Cleanup
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

#### **08-pomodoro.js** (219 lines) — Pomodoro Timer
**Responsibility**: Ring timer with session logging

**Features**:
- 5, 10, 20 minute presets
- Visual ring that empties clockwise
- Sound on completion
- Session log with timestamps

**Separate from Main Timer**: Pomodoro runs independently, doesn't affect work log timer

---

#### **08a-pomo-dashboard.js** — Pomodoro 4-Column Dashboard
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

#### **09-clock-weather.js** (404 lines) — Live Info Widgets
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

#### **10-tasks.js** (142 lines) — Task Management
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

#### **11-timeblock.js** (1 050 lines) — Visual Time Grid
**Responsibility**: 8:00–18:00 grid view for planning

**Features**:
- Drag logged entries to create/move blocks
- Visual overlap detection
- Current time red line indicator
- Start buttons to activate tasks
- Completed blocks shown dimmed with strikethrough

**Grid Format**:
```
08:00 ┌─────────────────────────┐
      │ Design homepage (1h 30m)  │
09:30 └─────────────────────────┘
10:00 ┌─────────────────────────┐
      │ Code review (45min)       │
10:45 └─────────────────────────┘
...
18:00 (end)
```

**Data Structure** (`blocks` array):
```javascript
{ id: 'bk1', text: 'Task name', date: '2026-05-25', 
  slot: 8, duration: 1.5 }  // slot 8 = 08:00, duration in hours
```

---

#### **12-misc.js** (164 lines) — Miscellaneous Features
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

#### **12a-changelog.js** (279 lines) — Changelog Modal
**Responsibility**: Display version history and new features

**Data Source**: Hardcoded changelog object matching CHANGELOG.md

**Modal**: Shows on first load or via help button

---

#### **13-calendar.js** (193 lines) — Outlook Calendar Integration
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
wl_hidden_meetings_YYYY-MM-DD → [subject1, subject2, ...]
```

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

#### **14-jira.js** (279 lines) — Jira Import
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

#### **15-notion.js** — Notion Integration
**Responsibility**: Push tasks and log entries to a Notion database via the Notion API.

**Configuration**: Notion token and database IDs in `src/js/00-config.local.js` (gitignored).

---

### BuJo Modules (v1.8.x)

#### **10b-signifiers.js** — Entry Signifiers
**Responsibility**: Clickable status symbol on each entry row that cycles through: billable → event → flagged → migrated → cancelled → overtime.

**Key functions**: `sigHtml(entry)`, `cycleSignifier(entryId)`, `bindSignifierClicks()`

**Data**: `entry.signifier` field (`'billable' | 'event' | 'flagged' | 'migrated' | 'cancelled' | 'overtime' | null`)

---

#### **10a-tasks-render.js** — Task Rendering
**Responsibility**: HTML generation for the plan list — status `<select>`, priority button, checkpoint badge, deadline picker, and the full task row template. Split from `10-tasks.js` to isolate rendering from business logic.

**Key Functions**: `statusOpts(cur)`, `prioBtnHtml(t)`, `renderPlan()`

---

#### **10b-tasks-events.js** — Task Event Binding
**Responsibility**: Attaches all event listeners to the rendered plan list — status changes, inline editing, drag-to-reorder, checkpoint toggling, deadline, billable flag, and handoff notes. Split from `10-tasks.js` to isolate DOM binding from logic.

**Key Functions**: `bindPlanEvents(lists)`

---

#### **16-rapid.js** — Rapid Logging Overlay
**Responsibility**: `Space` key anywhere (when no input is focused) opens a floating capture panel; `Enter` logs the task and optionally starts the timer immediately.

**Key functions**: `openRapid()`, `closeRapid()`, `rapidCommit(withTimer)`, `initRapid()`, `_qcBuildTaskGroups()`, `_qcTaskListHtml()`, `_qcBindTaskListEvents()`

**Inline token grammar**: Users can type `#<cat>`, `!<sig>`, and `><date>` tokens in the capture input to set category, signifier, and entry date without the mouse. Recognised tokens are stripped from the saved text; a live pill-badge preview (`#qcTokenPreview`) updates on every keystroke. Date tokens support `today`, `tomorrow`, `YYYY-MM-DD`, and weekday abbreviations.

---

#### **11-timeflow.js** — Today's Flow Unified Section
**Responsibility**: The `#todayFlowSection` widget that replaces the separate Timeblock and Daily Log sections with a segmented control offering three views: Flow (chronological cards with duration-scaled accent strips), Log (timeline rail with circle markers), Blocks (the existing timeblock grid). Also renders the day-overview strip (hour ticks + entry footprints + live cursor) and a gap-reminder banner when the largest untracked gap today is ≥ 15 min.

**Key functions**: `renderTodayFlow()` (orchestrator), `renderFlowHeader()`, `renderDayStrip()`, `renderGapReminder()`, `renderFlowView()`, `renderLogView()`, `findLargestGap(dateKey)`, `activeTimerDurationMs(entry)`, `getFlowView()` / `setFlowView()`, `initTodayFlow()` (binds delegated listeners + ARIA tablist keyboard nav).

**localStorage key**: `wl_flow_view` (`'flow' | 'log' | 'blocks'`, default `'flow'`).

**ARIA**: The segmented control uses `role="tablist"` with `role="tab"` buttons, `aria-selected`, `aria-controls`, and roving `tabindex`. Arrow/Home/End keys navigate. Panes use `role="tabpanel"` with `tabindex="0"`.

---

#### **18-dailylog.js** — Daily-log feed builder + note input
**Responsibility**: Pure data helper for the unified Today's Flow Log view. Builds chronological feed items by merging time entries, log notes, and task status comments for the given day; persists user-typed notes.

**Key functions**: `buildDailyLogItems(dateKey)`, `addLogNote()`

**localStorage key**: `wl_lognotes_v1`

---

#### **19-monthlylog.js** — Monthly Log Heatmap
**Responsibility**: A monthly tab with a 28-cell heat map of hours-per-day (colour-coded by intensity) and a sidebar showing task inventory and monthly totals. Tapping a cell navigates `viewDate`.

**Key functions**: `renderMonthlyLog()`, `mlHoursForDay(dateKey)`, `mlHeatColor(hours)`

---

#### **20-migration.js** — End-of-Month Migration
**Responsibility**: Modal flow that surfaces every unresolved task for the viewed month and requires an explicit decision: carry forward, schedule (date picker), or drop. Auto-prompts on the last day of the month.

**Key functions**: `openMigration()`, `renderMigrationStep()`, `carryTask(task)`, `scheduleTask(task, dateStr)`, `dropTask(task)`, `initMigration()`

**localStorage key**: `wl_migration_v1`

---

#### **21-reflection.js** — End-of-Day Reflection
**Responsibility**: After the end-of-day export, shows a modal for a 1–5 focus-quality rating, a 1–5 energy-level rating, and an optional one-sentence note. Ratings are surfaced as indicator dots on Monthly Log heatmap cells.

**Key functions**: `openReflection(onComplete)`, `renderReflStars(elId, current)`, `getReflectionForDate(dateKey)`

**localStorage key**: `wl_reflection_v1`

---

#### **22-trackers.js** — Custom Time-Goal Trackers
**Responsibility**: User-created trackers with a name, daily time target, and associated category tags. A 28-cell grid fills automatically from logged entries; streak counter updates daily.

**Key functions**: `renderTrackers()`, `trackerDayStatus(tracker, dateKey)`, `trackerStreak(tracker)`, `initTrackers()`

**localStorage key**: `wl_trackers_v1`

---

#### **23-sprints.js** — Sprint Mode
**Responsibility**: Enhances the Pomodoro with a sprint mode. User declares an intention; at the end a 3-button review (Yes / Partly / No) is shown and the session logged as a time entry with the intention as description and outcome tagged.

**Key functions**: `openSprintSetup()`, `startSprint()`, `showSprintReview()`, `notifyPomodoroEnd()`, `initSprints()`

**localStorage key**: `wl_sprints_v1`

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
1. **New module**: Create `src/js/24-feature.js` with functions (next available number)
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

**Unit Tests** (397 tests via Node assert):
- `test/unit.mjs` — 57 suites covering pure functions in `pure-fns.js`, `validateBackupFile`, schema migrations; `.github/scripts/test/anthropic-auth.test.mjs` covers CI auth/model helpers

**Smoke Tests** (272 tests via Playwright):
- Load test: Verify no JS errors
- Feature tests: Timer, tasks, persist, UI interactions
- Edge cases: Empty data, malformed data, boundary dates
- BuJo features: Rapid logging, signifiers, daily log, monthly log, reflection, sprints, trackers

**Total: 583 tests (311 unit + 272 smoke)**

**What's NOT tested**:
- Browser-specific issues (Safari, Edge quirks)
- Network errors (assumed reliable local fetch)
- Concurrent tabs (app assumes single tab only)

---

## Future Improvements

1. **Split Module**: `10-tasks.js` is 1 100+ lines — too large for a single file
   - → `10-tasks-ui.js` (rendering + event binding)
   - → `10-tasks-logic.js` (status transitions, nesting, carry-over)

2. **API Validation**: Add schema validators for external API responses
   - Outlook calendar response
   - Weather API response
   - Jira CSV format

3. **BuJo module size**: `renderMonthlyLog()` in `19-monthlylog.js` mixes HTML build, event binding, and summary calculation in one ~120-line function — split into focused sub-functions

4. **Node version alignment**: `.nvmrc` pins 24.15.0 but CI uses Node 20 and `.devcontainer` also uses Node 20; align all three to the same version

This architecture has been stable through v1.0 → v1.1 releases with only feature additions.
