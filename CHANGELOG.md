# Changelog

## v1.2.0 — 15 May 2026

### Tasks
- **Upcoming status** — new 🔜 status moves tasks to a dedicated "Upcoming Tasks" section below Pending/Blocked; upcoming tasks are excluded from overnight auto-carry (they are future-dated, not overdue)
- **Pending & Blocked statuses** — dedicated tinted section with amber/red accent; each status change prompts for an optional reason; full comment history with timestamps and expand/collapse toggle
- **Subtasks** — ⊕ split button on any task creates indented child tasks with `parentId`; child tasks grouped under their parent in render order; starting a child auto-promotes parent to In Progress; all children done auto-completes the parent
- **IDKW button** — 🎲 in the plan header picks a random To Do task when you can't decide what to work on
- **Plan section headers** — restyled to smaller uppercase with icon prefixes; sections are collapsible
- **Auto-stop timer on done** — marking a task Done while its timer is running automatically stops the timer and closes the log entry with a rounded timestamp

### Calendar & Meetings
- **M365 calendar strip** — today's meetings shown above tasks with start time, duration, and Teams Join link; powered by `/api/calendar` from the local PowerShell server (reads Outlook COM, no data leaves the machine)
- **Past / Upcoming split** — meetings grouped into "Upcoming" (not-yet-ended) and "Past" (ended) sub-sections with group headers; re-evaluates every 60 seconds
- **Finnish calendar events** — flag days, public holidays, and notable days fetched from the official Finnish calendar API; SVG Finnish flag for flag days, 📅 for holidays/notable days; "Upcoming:" prefix for non-today events
- **Nameday** — switched from HTML scraping to the official Nimipäivärajapinta API; Finnish names shown plain, Swedish names smaller and dimmed with `sv:` label; "Today's name day:" prefix restored; `nimipaivarajapinta.fi` added to CSP `connect-src`
- **Flag day display** — restored SVG Finnish flag and "Next flag day:" prefix; full month name (e.g. "June 4") instead of numeric date

### Header & Stats
- **Streak fix** — streak sub-stat now starts counting from yesterday, consistent with the main streak counter (avoids a false "0" at the start of a new day before any entries are logged)
- **statToday** — counts unique task names rather than raw entry count

### Timer
- **Parked thoughts** — 💭 button in the timer bar captures a thought without breaking flow; parked items appear in their own section with → task (adds to today's plan) and ✓ dismiss actions; park capture auto-closes when the timer stops
- **safeRoundedStart()** — new entry start times are prevented from overlapping the `tsEnd` of the previous entry; avoids negative-duration display in the timelog
- **Pomodoro in focus mode** — Pomodoro ring and controls remain visible during Emergency/focus mode alongside the active task name

### Timeblock
- **Extended hours** — grid expanded from 08:00–18:00 to 07:00–21:00; existing slots migrated automatically on first load
- **Emoji picker** — each timeblock slot has an emoji picker (✦ button) for quick visual labelling
- **Simplified editing** — standalone meeting-add form removed; all blocks added and edited directly on the grid

### Jira Integration
- **CSV importer** — drag-and-drop a Jira export CSV onto the app to load issues; supports category mapping, select/deselect before import, and duplicate detection
- **Clickable ticket links** — `AITO-XXXXX` prefixes in task names become hyperlinks to `lahitapiola.atlassian.net`

### Quick Pick
- **Hide tasks** — × button on each recent task removes it from the quick pick list; hidden list persists in localStorage
- **Restore hidden** — "show N hidden" link restores all hidden tasks at once

### Timelog
- **Inline editing** — click any log entry's text to edit it in place; updates both entries and matching plan tasks
- **Timelog header** — section header added above the entry list for visual clarity
- **Chart label width** — widened from 120 px to 200 px to fit longer task names

### Exports
- **Workday length** — `.txt` exports now include day started, day ended, and total workday duration
- **File System Access API** — exports are saved directly to `timesheets/` and `backups/` subfolders on disk via the File System Access API (no browser download dialog)
- **Day start/end tracking** — Start of Day / End of Day timestamps recorded and included in exports

### Smoke Tests
- Suite grown from 114 to 136 assertions
- Test 1: added checks for `parkSection`, `idkwBtn`, `upcomingSection`, `calSection`, CSP, nameday and flag day elements
- Test 7: upcoming task excluded from auto-carry
- Test 8: upcoming task routes to `#upcomingList`, not main plan list
- Test 25 (new): full Upcoming status lifecycle — routing, count badge, status change back to todo, section hide when empty
- Test 26 (new): timer auto-stops when task marked done, `tsEnd` set on entry

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

---

## v1.0.0
- Initial release
