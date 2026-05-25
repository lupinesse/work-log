# Data Dictionary — Work Log localStorage Schema

All application state is stored in the browser's `localStorage`. No data ever
leaves the device unless you trigger an export or the Notion/AI integration.
Each key is documented below with its data type, shape, and lifetime.

---

## Core time-log data

### `wl_entries`
| Field | Type | Description |
|---|---|---|
| `id` | string | Unique ID (`Date.now() + ''`) |
| `text` | string | Task name as typed |
| `tag` | string | Category ID (references `wl_categories`) |
| `ts` | number | Start timestamp (ms, rounded to nearest 30 min for billable) |
| `tsEnd` | number? | End timestamp (ms); absent while timer is running |
| `date` | string | ISO date `YYYY-MM-DD` of the entry's start day |
| `billable` | boolean? | Override; absent = inherit from plan task or category |

Lifetime: persistent; never auto-deleted. Export trims nothing.

---

### `wl_categories`
Array of category (epic) objects:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique slug (e.g. `work`, `meeting`, `epic_1234_ab`) |
| `label` | string | Display name |
| `color` | string | CSS hex colour |
| `billable` | boolean | Default billable flag for entries in this category |

Lifetime: persistent. Modified by the category editor and Jira importer.

---

### `wl_active_timer`
Single object or `null`:

| Field | Type | Description |
|---|---|---|
| `entryId` | string | ID of the entry being timed |
| `startTs` | number? | Wall-clock timestamp when the current interval started; `null` when paused |
| `accumulatedMs` | number | Total ms elapsed across all previous start/pause cycles |
| `paused` | boolean | True while the timer is paused |

Lifetime: cleared when timer stops; restored on page load by `resumeTimerIfActive`.

---

## Plan / task data

### `wl_plan_v1`
Array of plan task objects:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique ID |
| `text` | string | Task name |
| `status` | string | `todo` \| `inprogress` \| `upcoming` \| `pending` \| `blocked` \| `done` |
| `tag` | string | Category ID |
| `date` | string | Target date `YYYY-MM-DD` |
| `billable` | boolean | Billable flag (default from category on creation) |
| `completedAt` | number? | Timestamp when status was set to `done` |
| `notionUrl` | string? | Notion page URL once the task has been sent |
| `emoji` | string? | Optional leading emoji for visual identification |
| `priority` | number? | `1` = high, `0` = normal (default), `-1` = low |
| `parentId` | string? | ID of parent task if this is a child/subtask |
| `checkpoints` | array? | Array of `{ text: string, done: boolean \| 'partial' }` |
| `statusComments` | array? | Array of `{ text: string, ts: number }` status-change notes |

**Checkpoint `done` states:**
- `false` — not started
- `'partial'` — partially done
- `true` — complete

Lifetime: persistent. `autoCarryTasks` copies unfinished tasks to the next day's date key.

---

## Time-block planner

### `wl_blocks_v1`
Array of time block objects:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique ID |
| `text` | string | Block label |
| `tag` | string | Category ID |
| `date` | string | Date `YYYY-MM-DD` |
| `slot` | number | 0-based half-hour slot index (slot 0 = 07:00) |
| `duration` | number | Length in half-hour units (1 = 30 min) |
| `type` | string? | `'meeting'` for auto-start blocks; absent for task blocks |
| `emoji` | string? | Optional emoji prefix |

Lifetime: persistent; old blocks stay indefinitely (used for chart history).

**Slot formula:** `slot = (hour - 7) * 2 + (minutes >= 30 ? 1 : 0)`

---

## Focus / emergency mode

### `wl_emergency_next_<entryId>`
String. The "next action" note typed in focus mode for a specific entry.
Lifetime: persists until the user edits or deletes it.

---

## Handoff notes

### `wl_handoff`
Object keyed by lowercased task text:

```json
{ "write sprint report": "open confluence, section 3 is missing numbers" }
```

Lifetime: persistent. Values are shown in the EOD modal and restored when the task is restarted.

---

## Pomodoro

### `wl_pomo_log`
Array of session objects:

| Field | Type | Description |
|---|---|---|
| `ts` | number | Session completion timestamp (ms) |
| `mins` | number | Duration in minutes |
| `task` | string? | Active task text at session completion |

### `wl_pomo_week`
String. ISO week key (`YYYY-Www`) of the week the log belongs to.
The log is cleared when the week changes.

### `wl_chime_mins`
Number (stored as string). Chime interval in minutes; `0` = silent.

---

## Distraction tracking

### `wl_distractions_v1`
Array of distraction objects:

| Field | Type | Description |
|---|---|---|
| `ts` | number | Timestamp when logged (ms) |
| `date` | string | `YYYY-MM-DD` |
| `task` | string? | Active task text at time of distraction |
| `note` | string? | Optional free-text description |

---

## Parked thoughts

### `wl_parked_v1`
Array of parked-thought objects:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique ID |
| `text` | string | Thought text |
| `ts` | number | Capture timestamp (ms) |
| `fromTask` | string? | Active task text when thought was captured |
| `done` | boolean | `true` once dismissed or promoted to a task |

---

## Calendar

### `wl_hidden_meetings_<YYYY-MM-DD>`
Array of meeting subject strings hidden for that date.
Lifetime: one key per day; old keys accumulate but are harmless.

### `wl_seen_ended_v1`
Array of `"subject|start"` strings for meetings that have already triggered a
transition-bridge banner in the current session.

---

## Quick-pick

### `wl_qp_hidden`
Array of lowercased task text strings removed from the recent-tasks quick-pick.
Lifetime: persistent until user clicks "restore N hidden".

---

## Make-it-interesting hook

### `wl_hooks`
Object keyed by lowercased task text:

```json
{ "write sprint report": "Treat it like a detective case…\n\nSet a 20-min countdown…" }
```

Lifetime: cached until user clicks ↻ regenerate.

---

## Iteration expiry dates

### `wl_expiry_dates`
JSON array of `YYYY-MM-DD` strings (sorted ascending). Completed tasks are
visible in the Completed section until the next expiry date after their
completion day. Seeded from `EXPIRY_SEED` in `src/js/11-timeblock.js` on first load.

---

## Day lifecycle

### `wl_sod_<YYYY-MM-DD>`
Number (as string). Start-of-day timestamp (ms) for that date.

### `wl_eod_<YYYY-MM-DD>`
Number (as string). End-of-day timestamp (ms) for that date.

### `wl_last_export`
String `YYYY-MM-DD`. The date of the most recent EOD export. Used by
`todayHasUnexportedEntries`.

### `wl_carried_<YYYY-MM-DD>`
Flag string `"1"`. Set once `autoCarryTasks` has run for that date to prevent
duplicate carry-over on repeated page loads.

---

## Auto-backup / snapshot

### `wl_snapshot`
Object written every 30 minutes by `saveSnapshot`:

| Field | Type | Description |
|---|---|---|
| `date` | string | `YYYY-MM-DD` of the snapshot |
| `text` | string | Human-readable plaintext summary of today's log |
| `entries` | array | Full entries array at snapshot time |
| `categories` | array | Full categories array at snapshot time |

To recover from accidental data loss, parse `wl_snapshot` in the browser console
and assign `entries` / `categories` back to localStorage.

---

## File System Access API

### IndexedDB — `wl_fs_v1` / store `handles`
Key `saveDir`: `FileSystemDirectoryHandle`. The folder chosen via "pick save folder";
serialised across sessions by the browser's IndexedDB serialisation for FSA handles.

---

## Development / changelog

### `wl_dev_log`
Array of dev-change objects:

| Field | Type | Description |
|---|---|---|
| `id` | string | `YYYYMMDD-NNN` |
| `date` | string | `YYYY-MM-DD` |
| `desc` | string | Human-readable change description |
| `areas` | number[] | Test area IDs affected |

### `wl_pomo_week` (also listed above)
Shared between the pomodoro module and changelog weekly-clear logic.

---

## Anthropic API key (legacy)

### `wl_anthropic_key`
String. Kept for backward compatibility with the Notion URL-bookmarking form.
No longer required for task-to-Notion imports (handled server-side).

---

## Data recovery

If `wl_entries` is accidentally cleared, restore from `wl_snapshot`:

```js
const snap = JSON.parse(localStorage.getItem('wl_snapshot'));
localStorage.setItem('wl_entries', JSON.stringify(snap.entries));
localStorage.setItem('wl_categories', JSON.stringify(snap.categories));
location.reload();
```

Full JSON backups (written at EOD) contain all arrays and can be imported via the
backup restore button (if implemented) or manually via the console.
