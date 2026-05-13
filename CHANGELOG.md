# Changelog

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
