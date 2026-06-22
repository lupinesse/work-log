# Changelog

## Unreleased

### Fixed
- **Tabbed task board fills the full panel width** — the To Do / In Progress / Done tab bar and the active lane (with its cards) were collapsing to content width and left-aligning, leaving the right side of the panel empty. The tabbed flex-column layout was inheriting `align-items: start` from the base `.board-cols` grid; it now resets to `align-items: stretch` so tabs and lane span the whole width. Regression test added in `smoke-tests.cjs`.

---

## [1.9.0] — 2026-06-12

### Added
- **Merge entries from backup** — a "⇣ merge backup" button in the export bar lets you import entries from a backup made on another machine without replacing any existing data. Only entries whose ID is absent from the current store are added; categories, tasks, and all other backup fields are ignored. Resolves the office/home machine split where a day's work is only in the remote machine's JSON backup.
- **JSON backup 21-day retention window** — `exportBackup()` now trims the backup to the last 21 days of entries at export time; entries older than that remain in localStorage but are excluded from the file to keep it a manageable size. The window is visible in the filename (`work-log-backup-21d-YYYY-MM-DD.json`). The backup schema gains a `retentionDays` field (currently `21`) so the window is self-documenting.
- **Rolling Summary tab in Today's Flow** — a fifth view (Flow / Log / Blocks / Month / Summary) showing the last 7 days at a glance: one row per day with tracked total, start/end times, location emoji, and a week total. Pure data calculation lives in `buildRollingSummary()` in `pure-fns.js` (covered by unit tests); rendering and a "copy as text" action live in `25-rollingsummary.js`.
- **Auto start-of-day on first task timer** — clicking the start-timer button on any task now silently records start-of-day if the day has not already been started (no backup-restore dialog required).
- **Starting an upcoming task moves it to in-progress** — the start-timer button previously only promoted `todo → inprogress`; it now also promotes `upcoming → inprogress`.
- **Hero Card: last-note reference line** — after saving a quick note (↵ in the note row), the running and paused panels now show "↳ last note X min ago" below the task title. The line stays blank when no notes have been added. `fmtAgo()` added to `pure-fns.js` with 10 unit tests.
- **Hero Card: category quick-switch** — the category row on running and paused panels now shows a faint ▾ caret and opens a picker panel on click. Selecting a category re-tags the live session and updates the UI immediately. Keyboard-accessible (Enter/Space opens; arrows navigate; Esc closes; outside-click dismisses).
- **`lib/parse-phase4-response.mjs`** — pure parser for Phase 4 JSON, extracted for testability. Rejects `type: "new"` actions. 19 unit tests in `test/parse-phase4-response.test.mjs`.
- **Duplicate ChatGPT review findings suppressed with 👀 reaction** — when the Phase 1 or Phase 4 ChatGPT bot generates a "new" inline finding at a `path:line` already covered by an existing review thread, the runtime now suppresses the verbose duplicate and adds a `👀` (`eyes`) reaction to the original comment instead. Adds `addReactionToComment()` to `lib/github-threads.mjs` with 2 unit tests.
- **Section collapse state persisted across page reloads** — all collapsible sections (Analytics, Parked thoughts, Pomodoro, Today's tasks, Upcoming, Pending, Completed, Meetings, Jira, Notion links) save their open/collapsed state to `localStorage` under `tt-open2-{id}` keys and restore it on the next load. Sections default to their design-spec defaults when no stored key exists.
- **Five automated code-quality agents** — new slash commands and matching GitHub Actions workflows that run on every PR push (or weekly, for dead-code detection):
  - `/impact-check` — traces which `src/js/` modules depend on the changed files and surfaces test-coverage gaps; posts an impact report as a PR comment.
  - `/jsdoc-check` — scans exported functions in changed `src/js/` files for missing or incomplete JSDoc (`@param`, `@returns`); posts a PASS / WARN / FAIL verdict.
  - `/a11y-audit` — static WCAG 2.1 AA analysis of changed HTML, JS DOM creation, and SCSS focus rules; posts findings by severity.
  - `/scss-audit` — checks changed SCSS for BEM violations, nesting depth > 3, `!important`, magic numbers, and undeclared variables.
  - `/dead-code` — maps all exports vs. imports across `src/js/` and commits a dated report to `docs/dead-code-reports/` every Monday at 09:30 UTC.
  All PR workflows post idempotent comments (updated on re-push) via the Claude Reviewer GitHub App and use the OAuth + API-key fallback auth pattern.
- **Rapid-logging inline token grammar** — users can type `#<cat>`, `!<sig>`, and `><date>` directly in the quick-capture input to set category, signifier, and entry date without touching the mouse. Recognised tokens are stripped from the saved text; unrecognised tokens are left in place so nothing is silently discarded. A live pill-badge preview (`#qcTokenPreview`) updates on every keystroke. Date tokens support `today`, `tomorrow`, `YYYY-MM-DD`, and weekday abbreviations (`mon`–`sun`, always the *next* occurrence). The category chip auto-activates when a `#cat` token is typed and clears again when the token is deleted.
- **Pomodoro 4-column card** — the `.pomo-body` is restructured into a CSS grid with four columns: clock face (ring + duration buttons), composer (task label + controls + chime), 28-day focus sparkline, and session ledger. A ribbon footer below the grid shows a 5-dot recent-session indicator, a "Peak Focus" / session-count status pill, and a "View all sessions" scroll link. The sparkline and ribbon refresh after every completed session. All colours respond to the OS dark-mode preference via `--pomo-spark-fill` / `--pomo-spark-empty` CSS variables.
- **Today's Flow unified section** — replaces the separate Timeblock and Daily Log tabs with a single `#todayFlowSection` offering three views: Flow (chronological cards with colour-coded accent strips), Log (timeline rail with circle markers), and Blocks (the existing timeblock grid). The section also renders a day-overview strip (hour ticks + entry footprints + live cursor) and a gap reminder when the largest unlogged gap today is ≥ 15 minutes. Closes #44.
- `SECURITY.md`: security policy, supported versions, and responsible disclosure process.
- **Conventional Commits enforced** via a new Husky `commit-msg` hook backed by `@commitlint/config-conventional`; `commitlint.config.js` committed at repo root and the rules + examples are documented in `CONTRIBUTING.md`. Non-conformant commit messages are now rejected locally before they can be pushed — closes #11.
- **PR workflow Step 5b** (`CLAUDE.md`): after each PR is opened, the `chatgpt-review` CI check's inline comments are fetched via GraphQL, triaged alongside the `/pr-review` output, and every thread is replied to and resolved — closes the inline-review loop so threads no longer linger unresolved on merged PRs.
- `ROADMAP.md` — forward-looking feature plan; addresses the "communication" gap in DevOps checklist
- `docs/delivery-metrics.md` generated weekly by new `delivery-metrics.yml` CI workflow — tracks issues opened vs closed (Say/Do ratio) each Monday
- README documentation index linking ARCHITECTURE.md, DATA.md, CONTRIBUTING.md, ROADMAP.md, QA.md
- `npm run clean-branches` — PowerShell script to prune local branches already merged into main
- 19 unit tests for `flatSort` (`10-tasks.js`), `_qcBuildTaskGroups`, and `_qcTaskListHtml` (`16-rapid.js`).

### Changed
- **Session start/end times follow the day you're viewing** — the "started HH:MM" session chip and the "🌙 ended HH:MM" end-the-day button now reflect whichever day is in view, not always today. Navigating with ← → updates them to that day's recorded start and end. Recording actions stay anchored to today: starting a timer and "end the day" always record against the current day, while editing the chip lets you set or correct the start time for the day in view (including back-filling a past day). `sodKey`/`getDayStart`/`eodKey`/`getEodTs` now take an optional day argument defaulting to the viewed day; covered by new unit and smoke tests.
- **Date-nav header shows work location instead of the ISO week** — the small "Week N/53" line above the day navigator is replaced by a Remote / Office toggle (🏠 Remote / 🏢 Office). Location is tracked per day, so navigating with ← → shows that day's location; unset days default to Remote. Click (or focus + Enter/Space) to switch. The ISO week number is still shown in the almanac header (`#liveWeek`). New pure helpers `locationFor()` and `nextLocation()` in `pure-fns.js` with unit tests.
- **Responsive layout** — header columns wrap at ≤680px with the almanac moving to its own row; stats grid reflows 3→2→1 columns at ≤640px/≤420px; kanban board steps 3→2 columns at ≤768px (Done spans full width below) then 1 column at ≤580px; body padding reduces to 10px at ≤480px. Compact kanban card chrome (tighter padding, narrower status dropdown, hidden category label) activates only at ≤768px. Kanban task names capped at 2 lines at all widths.
- **3-column kanban board** — the four stacked task sections (Today's Tasks, Upcoming, Pending/Blocked, Completed) are replaced by a lean To Do / In Progress / Done board. Pending and blocked tasks absorb into the To Do column with their existing badge/comment treatment; the Done column shows today's completed tasks and a collapsible expander for older iteration history. Drag-and-drop between columns starts or stops the active timer automatically.
- **Soft WIP warn** — when more than one task is In Progress the column gains an amber tint and a dismissable "N in progress — pick one to focus" banner.
- **Kanban status accent colours moved to design tokens** — the four hard-coded hex values on the kanban card left-border (done / pending / blocked / upcoming) are replaced by `--status-done` / `--status-pending` / `--status-blocked` / `--status-upcoming` tokens in `_base.scss`. Light mode is unchanged; dark mode now renders brighter accent variants instead of reusing the light-mode hex, matching the existing signifier-colour convention.
- **Header restored to almanac-led 3-column layout** (top-zone ITEM 1) — the tracking-first centre column (tracked-total hero + pace bar) is removed. LEFT shows date/clock/weather/rain; CENTRE shows four calm almanac lines (sunrise-sunset, week/moon, flag day, name day); RIGHT shows date-nav + a session chip. `updateHeaderTracking()` is now a no-op; daylight-delta colours use `--sig-event` / `--sig-overtime` tokens instead of hardcoded hex.
- **Hero Card task category and title refined** (top-zone ITEM 2) — category label bumped to 12.5 px / `--text2`; category dot to 8 px; task title to 17 px / weight 600 / line-height 1.3.
- **Phases 2 and 3 switched back to `claude-haiku-4-5-20251001`** — Haiku is ~20× cheaper than Sonnet 4.6 and sufficient for thread replies; use the `MODEL` env override to restore Sonnet for individual runs if needed.
- **CLAUDE.md injected as cached system prefix in Phases 2 & 3** — `claude-chatgpt-dialogue.mjs` and `claude-convergence-summary.mjs` now load the project quality standard and pass it as the first (cached) system block, so Claude applies project-specific rules when reviewing threads and writing summaries. Also pushes the combined system prompt above the 2 048-token prompt-caching minimum.
- **Docs-only PRs skip the AI review dialogue** — `chatgpt-pr-review.yml` and `pr-review.yml` now detect PRs that only change documentation files (`.md`, `.txt`, `.rst`, `LICENSE`, `CODEOWNERS`) and exit early without calling any AI, saving API credits.
- **`pr-review.yml` max-turns reduced 8 → 4** — the standalone Claude review rarely needs more than 4 turns to read the diff and produce a verdict.
- **Removed `anthropic-beta: prompt-caching-2024-07-31` header** — prompt caching is now GA; the beta header is no longer required.
- **`weekly-qa-review.yml` renamed to "QA Review"** — the workflow no longer runs on a weekly cron; the name "Weekly" was misleading.
- **`chatgpt-pr-review.yml` no longer re-runs on every push** — the full AI dialogue now fires once on PR open/reopen; add the `chatgpt-review` label to re-trigger manually. This prevents 4-phase API calls for every interim commit.
- **`MAX_DIFF_CHARS` for Phases 2 and 3 reduced from 30 000 to 15 000** — halves input tokens for large diffs; diffs longer than 15 000 characters are truncated at that point.
- **`pr-review.yml` reduced to `--max-turns 8`** — standalone Claude review for small PRs now caps at 8 agentic turns instead of 15.
- **`weekly-qa-review.yml` schedule removed** — QA review must now be triggered manually via the Actions tab; the weekly cron is gone.
- **`pure-fns.js` and `logger.js` extracted as leaf ES modules** — the 27 pure utility functions and the `wlLog` structured logger now live in their own files under `src/js/` and are imported at the top of `script.js`. `script.js` is now a proper ES module (`<script type="module">`), not a concatenated IIFE. The build step (`build.js`) auto-discovers exports from `pure-fns.js` so the import list stays in sync without manual maintenance.
- **`build-portable.js` updated for ESM source layout** — the portable build no longer reads the generated `script.js`. It reads source files from `src/js/` directly, strips `export` keywords from leaf modules, and wraps the result in an IIFE — preserving the single-file offline format.
- **`test/unit.cjs` replaced by `test/unit.mjs`** — unit tests now import `pure-fns.js` directly as an ES module and run with Node's built-in test runner (`node --test`). The old CommonJS test shim is removed.
- **Variable names humanised in `01-state.js`, `02-utils.js`, `03-timer.js`, `04-render.js`** — one-letter and short abbreviations (`raw`, `inp`, `ni`, `c`, `mon2`) replaced with descriptive names (`parsedEntries`, `editInput`, `newCatInput`, `canvas`, `weekStart`).
- **CI review dialogue Phase 3 now posts a convergence summary** — `claude-final-review` no longer runs `/pr-review` independently. Instead, `claude-convergence-summary.mjs` synthesises the Phase 1–2 threads (agreed-fix, deferred, disagreed, partial) and surfaces any gaps Claude notices. Phase 4 receives a structured summary rather than a second independent verdict.
- **Phase 4 is now reply-only** — `chatgpt-claude-dialogue.mjs` no longer accepts `type: "new"` actions from ChatGPT. Phase 4's role is strictly verification, accepting/challenging counter-positions, and flagging regressions. `parsePhase4Response` from the new `lib/parse-phase4-response.mjs` enforces this at parse time.
- **`claude-chatgpt-dialogue.mjs` token budget raised to 3000** — Phase 2 Claude replies now have 3000 max output tokens (up from 1500) and a rewritten system prompt that emphasises substantive dialogue over mere verdicts.
- **`chatgpt-pr-review` no longer re-runs on `synchronize`** — the workflow trigger list is now `[labeled, opened, reopened]`. ChatGPT's review runs once on first open; pushing additional commits does not restart the dialogue. This avoids redundant API usage and duplicate review threads for follow-up commits.
- **Weekly QA cron removed** — `weekly-qa-review.yml` no longer fires on a Monday schedule. The job is still available via `workflow_dispatch` for manual on-demand runs. This prevents wasted CI minutes when the API is unavailable or credits are exhausted.
- **`LEAF_MODULES` and `readPureFnsExports` centralised in `build-config.js`** — previously duplicated across `build.js`, `vite.config.js`, and `build-portable.js`; now a single source of truth. All build scripts import from `build-config.js`.
- **Export-stripping regex extended to cover `async function`** — `build-portable.js` and the VM sandbox helpers in `test/unit.mjs` now use `/^export ((?:async\s+)?(?:const|function|let|class))\b/gm` instead of the original pattern that silently broke on async exports.
- **Wired behaviours: favicon wedge, auto-pause on tab switch, park-a-distraction** (Item 5) — (a) The browser favicon now mirrors the depleting pomodoro wedge while a session runs: `setPomoFavicon()` in `08-pomodoro.js` redraws a 32×32 canvas (gray ring → red remaining sector → white hole) on each pomo tick. (b) A `visibilitychange` listener in `07-lifecycle.js` auto-pauses a running timer when the tab becomes hidden; controlled by `AUTO_PAUSE_ON_TAB_SWITCH` (new in `00-config.js`, default `true`). (c) A "park a distraction" inline input (`#heroParkInput`) was added to the running hero panel; pressing ↵ writes to the Parked Thoughts store without stopping the timer, reusing the existing `parkedThoughts` / `saveParked()` / `renderParked()` path.
- **Pomodoro running & done visual states** (Item 4) — the pomodoro card now applies state-modifier classes (`pomo--running`, `pomo--done`, `pomo--idle`) to `.pomo-body` on every display update, driving distinct layouts via CSS. Running state: ring enlarges to 190 px, sparkline/ledger columns hide, a progress affirmation ("33% in · keep going") appears, and two new buttons are shown — "+2 min" (extends the live session by 120s) and "tap out" (logs a partial session and transitions to done). Done state: the ring shows a green checkmark overlay, regular controls hide, and three soft buttons replace them — "↻ Another 5" (restart 5-min), "💧 1-min breather" (start a 60-s session), and "Done" (return to idle). `pomoTapOut()` and `pomoAddTime()` added to `08-pomodoro.js`.
- **Section header icons converted from emoji to SVG line icons** (May-2026 refinement #3) — all seven section-header emoji/unicode glyphs (`🏆` analytics, `📅` meetings, `◉` tasks, `🔜` upcoming, `◐` pending, `⊕` jira, `⏱` time log) are replaced with consistent single-weight Lucide inline SVGs rendered via `<span class="section-icon">`. The `::before content:` CSS rules have been removed. Icons are tinted `--live` through a `.plan-header .section-icon` / `.timelog-header .section-icon` colour rule. Task-row emoji markers and SoD/EoD buttons are untouched.
- **Tracking-first app header** (May-2026 refinement #1) — the header is now a 3-column CSS grid (`220px 1fr 220px`). Left: date + 30px tabular wall-clock + sunrise/sunset. Centre: day-total in monospace + sky-blue pace bar (fills against a configurable `DAILY_GOAL_MS` in `00-config.js`, default 7h 30m) + two demoted ambient lines (weather/rain; week/moon/nameday/flagday). Right: date-nav + start-of-day button. `updateHeaderTracking()` refreshes on each 10-second clock tick and on every timer tick while running.
- **Active / in-progress task row recoloured to the cool `--live` family** (May-2026 refinement #2) — the row now shows a 3px sky-blue left edge (`--live`) with no background tint on its default state, and a very faint `--live-softer` wash on hover. The "In progress" status pill uses `--live-soft` background, `--live-deep` ink, and `--live` border. The previous amber/lemon palette tokens (`--in-progress*`) are retained so Jira badge styles are unaffected.
- **3rd preset epic colour swapped from red (`#E74C3C`) to teal (`#0d9488`)** — the red slot in `CUSTOM_PALETTE` conflicted with error-state and overtime signifier colours; teal matches the existing `--epic-teal` design token and is visually distinct from the surrounding purple and blue slots. Applies only to newly created epics; existing epics are unaffected.
- **ESLint now covers `.github/scripts/**/*.mjs`** — the CI dialogue scripts (`chatgpt-review.mjs`, `claude-chatgpt-dialogue.mjs`, `chatgpt-claude-dialogue.mjs`, and the shared `lib/` modules) were previously invisible to the `lint` CI job, meaning any lint errors in those files produced a false green. A new flat-config block in `eslint.config.js` applies `globals.node` (giving `process`, `console`, `fetch`, `URL` etc.) and suppresses `security/detect-non-literal-fs-filename` and `security/detect-object-injection` for the same trusted-input reasons documented on the existing Node blocks. The `lint` script glob is updated to match.
- **`05-entries.js` split by responsibility (internal refactor, no behaviour change)** — the 526-line file mixed entry creation, export/import, and File System Access persistence. Export/import moved to `05a-export.js` and the FSA layer to `05b-filesystem.js`; `05-entries.js` now holds only `addEntry` and the `isEntryBillable` rule. The 137-line `exportTxt` is decomposed into focused helpers: the pure, now unit-tested `stripJiraPrefix`, `groupEntriesByCategory`, `mergeAdjacentEntries`, and `buildBillableSummaryParts` live in `00-pure-fns.js`, leaving `exportTxt` an orchestrator. Addresses #18 (the original finding referenced a `renderEntries()` that no longer exists). Adds 21 unit tests.
- **Checkpoint badge format unified to `✓ K/N`** — the badge now shows the fraction in all states: `+ steps` (no checkpoints), `K/N` (no steps ticked), `✓ K/N` (some done), `✓ N/N` (all done). Previously all-done showed `✓ N` (count only, no denominator) and partial showed `K/N` (no checkmark prefix), making the two states visually inconsistent.
- **`#analyticsSummary` is no longer `aria-hidden`** — screen-reader users now receive the same collapsed-state stats summary (e.g. "2 tasks today · 1 epics this week · 3-day streak") that sighted users see when the Analytics section is collapsed.
- **Minimum Node version bumped from ≥20 to ≥22.12** in `engines.node`, README, and CONTRIBUTING — pulled forward by `@commitlint/cli@21`'s own engines floor. Anyone still on Node 20 or 21 will see install warnings; upgrade `nvm install 24` (matches `.nvmrc`).
- **Review bots now post under dedicated GitHub App identities.** `pr-review.yml` mints an installation token for the "Claude Reviewer" App and `chatgpt-pr-review.yml` mints one for the "ChatGPT Reviewer" App via `actions/create-github-app-token@v3`. Comments and reviews are attributed to those Apps (with custom names + avatars) instead of the generic `github-actions[bot]`, so the two reviewers are visually distinct on PRs. Requires four new repo secrets: `CLAUDE_REVIEWER_APP_ID`, `CLAUDE_REVIEWER_PRIVATE_KEY`, `CHATGPT_REVIEWER_APP_ID`, `CHATGPT_REVIEWER_PRIVATE_KEY`.
- **ChatGPT review model bumped from `gpt-4o` to `gpt-5.5`** — OpenAI's current top model for "coding and professional work" (released April 2026), with built-in reasoning and a 1M context window. $5/$30 per M tokens; at ~10 big PRs/month this is ~$2.10/month. Picked over the cheaper `gpt-5.4` ($2.50/$15) because chatgpt-review only fires on big PRs where the depth premium matters most — exactly the case where `gpt-4o` missed the `engines.node` mismatch on PR #61.
- Renamed CSS token `--in-progress-border` to `--in-progress-highlight` — its only usages set `background` / `background-color`, never a border.
- Split `renderMonthlyLog()` into `renderMonthlyCalendar()`, `renderMonthlySummary()`, `renderMonthlyTasks()`, plus a 12-line orchestrator — closes #9.
- BuJo modules (`10b-signifiers.js`, `10b-tasks-events.js`, `16-rapid.js`, `18-dailylog.js`, `19-monthlylog.js`, `20-migration.js`, `21-reflection.js`, `22-trackers.js`, `23-sprints.js`) now emit `wlLog.info` at branch-decision points (empty state, skip/save, auto-prompt, input rejection, status transitions). Closes #12.

### Fixed
- **Month tab now renders inside Today's Flow** — `#monthlyLogSection` was placed ~200 lines after `#todayFlowSection`'s closing tag, so clicking the Month tab caused the calendar to appear at the bottom of the page rather than inside the tab panel. Moved the element inside `#todayFlowSection` alongside the other four `tf-pane` divs and added matching `role="tabpanel"`, `aria-labelledby="tfTab-month"`, and `tabindex="0"` attributes for WCAG consistency.
- **Recurring meetings now appear in the calendar strip** — the Outlook calendar fetch in `start-server.ps1` set `IncludeRecurrences` *after* `Sort`, so recurring occurrences were silently dropped; it now sorts after enabling recurrences. The fetch also no longer relies on `Restrict` for recurring items (it matched each series' original master date rather than today's occurrence on some Outlook versions) and instead walks sorted occurrences via `Find`/`FindNext`, deduplicating against non-recurring items with a `$seen` map.
- **Upcoming tasks no longer revert on reload** — `patchCarriedTasks` was reverting `inprogress` tasks back to `upcoming` on every page reload when an older past version carried `upcoming` status. The fix restricts the `upcoming` override to `todo` placeholders only; an explicitly started task's `inprogress` status is now preserved across reloads.
- **`chatgpt-pr-review.yml` now handles force-pushed PRs** — added `synchronize` as a trigger type with an idempotency guard: on each push the workflow checks whether ChatGPT has already posted a review; if yes it skips cleanly, if no it runs the full dialogue. This closes the race where a rapid force push cancelled the `opened` event run before Phase 1 could start, leaving the PR without any AI review despite the `chatgpt-review` label being present.
- **Jira category dot colour sanitised** — `jiraRenderTasks` in `14-jira.js` now wraps `cat.color` with `safeCssColor()` instead of `escHtml()`, preventing a stored colour value from injecting arbitrary CSS into the `style` attribute. This was the one instance missed by the earlier `safeCssColor` rollout.
- **Migration step colour dot sanitised** — `renderMigrationStep` in `20-migration.js` now wraps `cat.color` with `safeCssColor()`, closing the final unsanitised inline style colour interpolation. `safeCssColor` coverage is now complete across all files.
- **Remaining inline colour interpolations wrapped with `safeCssColor`** — hero chip dots, hero task-category dots, plan task category picker and label, timeblock completed-item dot, and rapid-log category chips and token preview (`06a-hero.js`, `10a-tasks-render.js`, `11-timeblock.js`, `16-rapid.js`).
- **Tracker card colour dot now sanitised** — `renderTrackers` wraps `t.color` with `safeCssColor()` so a stored colour value cannot inject arbitrary CSS into the `style` attribute (closes the last remaining unsanitised inline colour in `22-trackers.js`).
- **CI skill workflows soft-fail when the API is unavailable** — `jsdoc-check`, `impact-check`, and `a11y-audit` now wrap the `claude -p` invocation in an `if !` guard: on non-zero exit the output file is removed and the step exits 0 so the PR is not blocked. The PR-comment skip message now reads "API unavailable (credentials may be expired or credits exhausted)".
- **`completedAt` now records the exact completion timestamp** — tasks marked done store `Date.now()` directly rather than rounding to the nearest 30 minutes; `roundToNearest30` is for display/timeblock positioning only.
- **`roundToNearest30` no longer crosses day boundaries** — times between 23:46 and 23:59 now clamp to 23:30 instead of rolling over to 00:00 of the next day. This prevented completed tasks from appearing in the current day's completed section when marked done in the last 14 minutes of the day.
- **Pomodoro favicon now respects the colour theme** — `setPomoFavicon()` now reads `--pomo-spark-empty`, `--pomo-spark-fill`, and `--bg` CSS custom properties instead of hardcoded hex values, so the favicon ring and wedge match the app's light/dark colour scheme.
- **Pomodoro favicon now resets when the session ends or is tapped out** — `setPomoFavicon()` now creates a dedicated `<link rel="icon" data-pomo>` element rather than overwriting the page's existing favicon; when pomo stops (done, tapped out, or paused) `updatePomoDisplay()` removes that element so the original favicon is restored automatically.
- **`.hero-park-row` now has the correct flex layout** — the park-a-distraction row in the running hero panel was missing its CSS rule and rendered without alignment. It now shares the same `display:flex / align-items:center` rules as the adjacent `.hero-note-row` via a grouped selector.
- **`postInlineComment` moved to `lib/github-threads.mjs` and now sends `X-GitHub-Api-Version: 2022-11-28`** — the function existed as a private duplicate in both `chatgpt-review.mjs` and `chatgpt-claude-dialogue.mjs`, and the Phase 1 copy was building GitHub headers manually, omitting `X-GitHub-Api-Version: 2022-11-28`. Extracted to a single exported `postInlineComment()` in the shared lib (matching the JSDoc style of `replyToThread`), updated both callers to import it, and removed the now-unused `GH_HEADERS` constant from `chatgpt-claude-dialogue.mjs`. A regression test (`github-threads.test.mjs`) asserts the header is present — the test fails against the old private implementation. `format` and `format:check` scripts extended to cover `.github/scripts/**/*.mjs` alongside the existing `lint` coverage.
- **Blank thread indices in AI dialogue responses are no longer misrouted to thread 0.** Both `chatgpt-review.mjs` (Phase 1 reply actions) and `claude-chatgpt-dialogue.mjs` (Phase 2 thread responses) coerced the model-supplied index with bare `Number(…)`, but `Number('')` and `Number('   ')` evaluate to `0` — so a malformed response carrying a blank `thread_index`/`index` would silently post a reply to thread 0 instead of being rejected to the fallback bucket. The trim-and-reject guard already used by `normaliseReplyAction` is extracted into a shared, unit-tested `coerceThreadIndex()` helper in `lib/parse-reply-action.mjs` and applied at both call sites. Covered by 9 new unit tests.
- **ESLint and Prettier now cover the CI dialogue scripts (`.github/scripts/**/*.mjs`).** `npm run lint` previously only scanned `src/js/`, `*.js`, and `*.cjs`, so these files were never linted. A new flat-config block lints them as Node ES modules, the `lint` script glob now includes them, and `format`/`format:check`/`lint-staged` are extended to match.
- **Phase 2 dialogue (`claude-chatgpt-dialogue.mjs`) no longer hard-fails when `CLAUDE_CODE_OAUTH_TOKEN` is absent, expired, or rate-limited.** The `claude-responds` job previously failed immediately in those cases, leaving ChatGPT's review threads un-triaged and blocking the merge-gate. Credentials now form an ordered chain (`resolveAnthropicAuthChain()` in `lib/anthropic-auth.mjs`): the request tries the OAuth token first and, on a `401`/`403` (rejected) or `429` (rate-limited), automatically falls through to `ANTHROPIC_API_KEY` via `shouldFallThrough()` — so an expired-but-present token or a momentarily exhausted quota is recovered without failing the job. The model defaults per auth source via `selectModel()`: Opus on the flat-rate OAuth path, Haiku on the metered API-key path (a `MODEL` env var overrides either); an unrecognised source defaults to Haiku (cost-safe). Covered by 20 unit tests in `test/anthropic-auth.test.mjs`.
- **Review workflows no longer post a spurious "neither secret is set" skip notice on large PRs.** Both `pr-review.yml` and `chatgpt-pr-review.yml` gated their "mint app token" and "post review comment" steps on `steps.key-check.result != 'skipped'`, but a step context exposes `conclusion`/`outcome`, *not* `result` — so the expression was always truthy and the post step ran even when the auth check had been skipped (e.g. on a large PR, where `pr-review.yml` deliberately hands the review to the dialogue pipeline). The result was a misleading comment claiming no Anthropic credential was configured, regardless of whether one was. Corrected to `steps.key-check.conclusion != 'skipped'` in all four step guards.
- **Phase 4 dialogue (`chatgpt-claude-dialogue.mjs`) now finds Claude's comments on high-volume PRs.** `fetchClaudeIssueComments()` previously fetched only the first 100 issue comments (`?per_page=100` with no pagination), so Claude's synthesis and final verdict were invisible on PRs with ≥ 101 comments. A new `fetchAllIssueComments()` helper in `lib/github-threads.mjs` paginates until the API returns a partial page, and both `fetchClaudeIssueComments()` and `upsertIssueComment()` now use it. The `/pr-review` string fallback (which could false-positive on bare user-invocation comments) is replaced with `claude.ai/claude-code`, a string that only appears in Claude-generated attribution footers.
- **Phase 4 prompt now scans threads, verifies fix claims, and posts an explicit audit trail.** The Phase 4 system prompt now: (a) instructs ChatGPT to scan both resolved and open threads before choosing any action; (b) requires ChatGPT to locate Claude's promised fix in the diff at the relevant file/line before trusting any `✅ agree_fix` reply (or synthesis / `/pr-review` claim like "now fixed in commit X"); (c) on confirmed fixes, ChatGPT posts a reply starting with `✅ Verified as fixed` and sets `resolve: true` so the thread closes and the merge-gate clears; (d) on regressions (fix promised earlier but no longer in the diff), ChatGPT posts a reply starting with `🔁 Reopened —` and sets `unresolve: true`; (e) when a prior run already posted "Verified as fixed" and nothing has changed, ChatGPT omits — confirmations are idempotent; (f) anchors verdict selection so APPROVE is chosen when nothing genuinely novel remains, REQUEST_CHANGES only for novel blocking concerns or blocking regressions. The `resolve` / `unresolve` flag mechanism shipped in the previous commit; this commit teaches the model when to emit each.
- Malformed Outlook calendar meeting objects (e.g. missing `subject`, `start`, or `end`) are now filtered out before rendering rather than appearing as `"undefined"` in the meeting strip
- Weather API responses with an unexpected shape now fall back to showing the city name (same as a network error) instead of leaving the weather widget empty
- Jira CSV files with a wrong delimiter (e.g. semicolons) now log a console warning and show the "No tasks found" message rather than silently dropping all rows
- Jira invalid-row warning now logs the full list of malformed rows instead of only the first row, so all problem rows are visible in a single DevTools entry
- **`chatgpt-pr-review.yml` now posts reviews reliably.** Replaced `anc95/ChatGPT-CodeReview@main` (Node.js 20 — deprecated June 2026, silently exited without calling the API) with a direct OpenAI `chat/completions` call. The review logic now lives in a standalone `.github/scripts/chatgpt-review.mjs` (native `fetch`, no external deps) rather than inline YAML, so it's readable and testable. Passes `reasoning_effort: high` so the model applies deep reasoning on every review. Both workflow files updated `app-id` → `client-id` in `actions/create-github-app-token@v3` (the `app-id` input was deprecated in v3).

---

## v1.8.9 — 2026-05-28

### Visual — Unified cool-palette redesign

- **Base tokens updated to cool palette**: `--text`, `--text2`, `--text3`, `--bg2`, `--bg3`, `--border`, `--border2` all shifted from warm-grey to cool blue-grey to match the unified style spec
- **New in-progress tokens**: `--in-progress` (#ffffdf lemon), `--in-progress-accent` (#ca8a04 mustard), `--in-progress-border` (#fef08a), `--in-progress-ink` (#713f12) — dark-mode equivalents included
- **New `--jira` token** (#1d4ed8 / #60a5fa dark) for Jira ticket link colour
- **Active-timer task row**: pulsing amber animation replaced with a static lemon-yellow (`--in-progress`) background and 3px mustard (`--in-progress-accent`) left border; hover tints to `--in-progress-border`
- **In-progress status pill**: updated from warm amber to mustard/lemon palette using the new in-progress tokens
- **Live entry tint**: `.entry.is-timing` rows now receive a `--live-softer` (#f0f9ff) background so the active entry is softly distinguished in the time log
- **Hero Card idle shadow**: subtle two-layer box-shadow added to `.hero-card--idle` per design spec
- **Hero Card middle divider**: `.hero-middle` border changed from `--line-strong` to `--border` (lighter hairline)
- **`.plan-text` colour**: hardcoded warm `#383836` replaced with `var(--text)` (tokens now carry the correct value in both modes)
- **`.jira-task-key` colour**: migrated from `var(--info-text)` to `var(--jira)` for semantic correctness

---

## v1.8.8 — 2026-05-28

### Fixed

- **Focus / mood dropdown no longer clipped**: removed `overflow: hidden` from `.hero-card` so the absolute-positioned `.tb-mood-panel` can extend past the card's bottom edge. The bottom mood item ("✨ interesting!") is now fully visible and clickable while the timer is running.

### Added

- 24 unit tests for `src/js/15-notion.js` (`addTaskToNotion`, `saveTaskNotionUrl`, `callClaudeWithNotion`, and the delegated per-task button click handler) — closes #34.
- Smoke test 5c that opens the mood dropdown on a running timer and verifies the bottom menu item is hit-testable at its centre.

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
