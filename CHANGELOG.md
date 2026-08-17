# Changelog

## Unreleased

### Changed
- **Split the monolithic `test/unit.mjs` (6,568 lines, 659 tests / 102 suites) into `test/unit/*.test.mjs`, one file per feature area (#334)** — mirrors the `src/js` module areas: `pure-fns-format`, `pure-fns-validate`, `pure-fns-export`, `pure-fns-tasks`, `notion`, `tasks-board`, `rapid`, `hero`, `utils-categories`, `tasks-render`, `entries`, `render`, `monthlylog`, `timeflow`, `lifecycle`, `pomodoro`, `clock-weather`, `migration`, `jira`, `state`, `dailylog`, `location`, `logger`, `export` (24 files total). Shared fixtures used across multiple feature areas (`localDate`/`localMs`/`loadPureFnsScriptSource`/`__dirname`) moved to `test/unit/_helpers.mjs`; each split file imports only the `pure-fns.js`/`logger.js`/`app-constants.js` names it actually uses. `package.json`'s `test:unit` script changed to a `node --test` glob (`"test/unit/*.test.mjs"`), matching the existing pattern for `test:scripts`. **Zero test logic changes** — every describe/it block and assertion moved verbatim, confirmed several ways: the post-split suite reports the exact same 659 tests / 102 suites / 0 failures as the pre-split baseline; `assert.` call count (886) and `it(` call count (643) match exactly between the old single file and the sum of the new files; and every one of the original 30 JSDoc comment blocks was verified present somewhere in the split output. The mechanical extraction (deciding which lines belong to which file, and which imports each file needs) was done with an AST-based script (via `acorn`, already a transitive devDependency) rather than by hand, specifically to make "zero logic changes" a structural guarantee rather than a claim to trust — hand-copying 6,500+ lines across 24 files is exactly the kind of task that silently drops or duplicates a line. `smoke-tests.cjs` (3,379 lines, Playwright) is intentionally **not** split in this PR — the issue calls that optional/follow-up scope, and it has a different splitting concern (shared HTTP server + browser lifecycle) worth its own pass.
- **First ES-module extraction beyond `logger.js`/`pure-fns.js`: `01-state.js`'s constants moved to a new `app-constants.js` leaf module (#336)** — `build.js` concatenates most of `src/js/*.js` into one shared-scope bundle; only 6 files were real ES modules imported explicitly at the top. `02-utils.js` was the suggested first candidate for the next extraction, but turned out to be too entangled: it reads module state declared elsewhere (`categories`, `selectedTag`, `entries`, `viewDate`, `planTasks`) and calls functions defined in later-loaded files (`save()`, `render()`, `renderTimeblock()`, `renderCompleted()`, `renderPlan()`, `nextDistinctColor()`, `isEntryBillable()`) — none of which a standalone ES module can reach, since it would have its own isolated scope. Documented in `ARCHITECTURE.md`'s `02-utils.js` entry rather than forced through. `01-state.js`'s constants (9 `STORE_*` localStorage keys, `DEFAULT_CATS`, `CUSTOM_PALETTE`) had no such problem — pure literal values with zero external references — so they moved to `app-constants.js` instead, imported at the top of the bundle exactly like `pure-fns.js`/`logger.js` already are. `build-config.js`'s `readPureFnsExports()` (hardcoded to one file) generalised to `readModuleExports(filename)` so the new leaf module's import line doesn't need a second hand-maintained export list; `build.js` and `vite.config.js` both updated to call it for both leaf modules. `build-portable.js` needed no changes — it was already generic over `LEAF_MODULES`. `eslint.config.js`'s module/script file-pattern lists updated so the new file parses as an ES module. No call-site behaviour changes anywhere in the app. Verified with `npm run build && npm test && npm run lint` and a manual `npm run portable` (syntax-checked the inlined bundle and confirmed no leftover `import`/`export` statements).

### Security
- **Audited the entry-row and "track recent" chip colour interpolations flagged by a code review (#341) — not actually unescaped, but untested** — both sites (`src/js/04-render.js`'s timeline entry dot, `src/js/10a-tasks-render.js`'s recent-task chip dot) interpolate a category colour into a `style="background:${color}"` attribute with no `escHtml`/`escAttr`/`safeCssColor` call visible on the same line, which is what the review's static grep flagged. Tracing `getCatColor()` — the only source either site reads that colour from — shows it already routes through `getCat()`'s `safeCssColor(cat.color)`, so a malicious persisted colour value is neutralised before either template ever sees it; GitHub's CodeQL `js/xss-through-dom` scan, which does trace across function calls, has zero open alerts on either file, corroborating this. What *was* missing: `getCat()`/`getCatColor()` — the single choke point nearly every colour-rendering template in the app depends on — had no direct test coverage of its own. 6 new regression tests close that gap: 4 for `getCat()`/`getCatColor()` directly, 2 exercising `renderTrackRecent()` end-to-end with a malicious persisted colour to prove the chip-dot path specifically. No source change — nothing was broken.

### Removed
- **Deleted the stale `CODE_QUALITY_ASSESSMENT.md` (#335)** — it claimed "15 numbered modules" and "162 tests" from an early-project snapshot; reality was 52 source files and 1,215+ tests. Its 10 "areas for improvement" and 5 "priority fixes" had all since been implemented — JSDoc coverage, `ARCHITECTURE.md`, `CONTRIBUTING.md`, and `src/js/logger.js` (unified logging) all now exist, which is exactly what the file itself was recommending. Nothing in it was still true and unrepresented elsewhere, so it was deleted rather than regenerated. `ARCHITECTURE.md`'s own file/test counts (52 source files, 659 unit / 320 smoke / 276 CI-script tests — 1,255 total) and `CONTRIBUTING.md`'s "(15 files)" module-count comment were also stale and corrected in the same pass; both had drifted since `ARCHITECTURE.md`'s last refresh (#347) as work landed on other branches. `QA.md`'s one reference to the deleted file (in its frozen v1.8.0 historical record) got an inline note rather than a rewrite, since that section documents what evidence existed at sign-off time. README.md had no hard-coded counts to check.

### Fixed
- **The Impact Analysis PR comment stopped finding any unit-test coverage after the #334 test split** — `.github/scripts/impact-check.mjs` searched a hard-coded list of test files (`smoke-tests.cjs`, `test/unit.mjs`, `test/unit.cjs`) filtered by `existsSync`. When #334 split `test/unit.mjs` into `test/unit/*.test.mjs`, the dead path was filtered out *silently* — no crash, no warning — leaving the smoke suite as the only file searched, so every changed module with unit-only coverage reported "❌ not found" on a check that runs on every PR push. Replaced with a new exported `collectTestFiles()` that reads the `test/` directory (root level plus one level of subdirectories, `.mjs`/`.cjs` only, so `test/calendar.Tests.ps1` is skipped) instead of naming files. The run now also logs the number of suites discovered to stderr — which the workflow does not redirect into the PR comment — so a count of 1 is a visible signature of the discovery breaking again rather than a silent downgrade. Verified end-to-end against a synthetic diff: 26 suites discovered, and `11-timeflow.js`/`04-render.js` resolve to `✅ test/unit/timeflow.test.mjs` and `✅ test/unit/render.test.mjs` where both previously reported not-found. 9 new tests (`ci-scripts.test.mjs`, 30 → 39): 6 cover the directory scan (nested layout, root-level layout, non-JS files, directories whose own name ends in `.mjs`/`.cjs` — which would otherwise be collected as files and make the caller's `readFileSync` throw `EISDIR` — root-suite precedence, and a missing directory), 1 is a regression test asserting against the repository's own real `test/` layout — the only form of the test that would have failed before this fix — and 2 cover `toPosixPath()`, which normalises reported paths to forward slashes since `path.join` yields backslashes on Windows and the report is rendered as markdown. The scan deliberately stops at one level of subdirectory, which covers both the old and current layouts; anything nested deeper would be missed just as silently, so the run logs its discovered-suite count to stderr (not into the PR comment) — that count dropping is the tripwire.
- **`launch.sh` (Linux/Mac) picked a fresh random port on every launch, making previously-logged data appear to vanish (#337)** — the tracker's data lives in per-origin `localStorage`, so a changed port means a changed origin, and everything logged under the old port becomes unreachable (not deleted — just stranded). `start-server.ps1` (Windows) already used a fixed port (8080) and never had this problem; `launch.sh` now does too, for the same reason. README gains a note explaining why the port has to stay stable and how to recover apparently-lost data (reload `http://localhost:8080/work-log.html`).
- **`save()` no longer silently loses data on a `localStorage` write failure (#333)** — its three sequential `setItem` calls (entries, active timer, categories) had no error handling: a `QuotaExceededError` on the first call skipped the other two and threw uncaught into whichever of `save()`'s ~48 call sites triggered it, with zero signal to the user that persistence had stopped working — the worst failure mode for a time tracker. The writes are now wrapped in try/catch; a failure is logged via `wlLog.error` and surfaces a persistent, dismissible red banner ("Saving failed — your data may not persist. Export a backup now.") with a one-click button to `exportBackup()` on the spot. The banner clears itself automatically the next time `save()` succeeds, and repeated failures don't stack duplicate banners. The existing empty-array overwrite guard is unchanged. 6 new regression tests in `test/unit.mjs` mock `localStorage.setItem` to throw and assert no exception escapes `save()`, the failure is logged, the banner appears exactly once, and it clears on the next successful save.

### Added
- **CI now fails when one change is documented twice in the CHANGELOG** — two PRs describing the same fix insert their bullets at different line offsets, so git merges both without ever raising a conflict; the duplication is semantic, and nothing was looking for it. That reached `main` on 2026-08-14, when #331 and #332 both documented the Log-view sort fix (#326) eleven minutes apart and a third PR (#340) was needed to remove a copy. `npm run test:changelog` now compares every bullet's bold label against the others and fails the `lint` job on a near-match. Exact string comparison would not have helped — the two real labels were "Log view entries **now** sort by start time…" and "Log view entries sort by start time…", one word apart — so matching is similarity-based (Dice coefficient over normalised word sets). The 0.85 threshold was measured, not guessed: across all 11,628 label pairs in the file, the closest genuinely *different* pair scores 0.667 and the real duplicate scores 1.000. Comparisons are limited to pairs touching one of the two newest sections, since frozen release history cannot gain a duplicate and failing on it would block unrelated PRs. Pure `normalizeEntryLabel()`, `labelSimilarity()`, `parseChangelogEntries()`, `parseChangelogSections()`, and `findDuplicateChangelogEntries()` in `.github/scripts/lib/duplicate-changelog-entries.mjs`, with 27 unit tests — including the verbatim #331/#332 labels as a regression fixture, and a check that the closest real non-duplicate stays below the threshold so the guard cannot quietly start crying wolf.

### Security
- **Fixed 6 high-severity `npm audit` findings in transitive devDependencies** — `nanoid` (via `stylelint`→`postcss`), `linkify-it`, `js-yaml`, `immutable`, `fast-uri`, and `brace-expansion` all had known DoS-class advisories with patched versions already inside `package.json`'s existing semver ranges. `npm audit fix` (no `--force`) resolved all six; `package.json` itself is unchanged, only `package-lock.json`. Dev-tooling only — no runtime dependency was affected. Flagged in the last two QA reviews with zero remediation until now.

### Changed
- **Lowered the `engines.node` floor from `>=24.15.0` to `>=22.22.1` (#337)** — a repo-wide search for Node 24-only APIs found no matches, and none of the direct devDependencies actually require it either: checking each one's own published `engines.node` field, the tightest constraint is `lint-staged`'s `>=22.22.1` (`vite`/`eslint`/`stylelint` all accept Node 22.12–22.19+, `@commitlint/cli` needs `>=22.12.0`). The 24.15.0 floor looks like it was pinned to match the dev machine's installed version rather than a real requirement. `.nvmrc` and `CONTRIBUTING.md`/`README.md`'s Node version mentions updated to match. Verified via each dependency's own `engines` field, not by literally running the suite under Node 22 — no version manager is available in this environment, and CI is currently pinned to Node 24 across every workflow, so there's no automated check that would catch a real Node-22 incompatibility today. That gap is pre-existing and out of scope here.

---

## [1.9.2] — 2026-08-14

### Security
- **Closed a CodeQL `js/xss-through-dom` finding (alert #2) in the epic colour picker** — `renderTagRow()`'s quick colour picker (`src/js/02-utils.js`) read the raw `<input type="color">` value and wrote it straight into `cat.color` (persisted state) and the swatch's `style.background`, bypassing `getCat()`'s existing `safeCssColor()` sanitisation entirely; the `innerHTML` sink for the picker's own `value` attribute relied on that same upstream sanitisation, which CodeQL's dataflow analysis doesn't credit as a barrier across the object spread. All three sites now call `safeCssColor()` explicitly. A real `<input type="color">` clamps its `.value` to valid hex at the DOM level, so this isn't exploitable through normal use today — it closes the gap CodeQL flags and guards against any future code path (e.g. a non-native picker, or a refactor) that could feed an unclamped value through the same handlers. 3 new regression tests in `test/unit.mjs` (VM-sandboxed, since a real browser can't hold an invalid value in a colour input to prove the "before" case). This alert had been open since PR #87 (2026-05); a prior attempt (PR #265) was closed as superseded without merging.

### Removed
- **Dead V5 timer-bar CSS in `_timer.scss`** — the `.timer-bar` layout (circle ticker, task-name block, action pills, note row, utility pills, paused-state variants, and the `.timer-task`/`.timer-elapsed` compat stubs left over from an even earlier layout) was fully superseded by the hero card redesign and had zero references left in any `.js` or `.html` file — confirmed with a full cross-check, not just the `.tb-*` prefix grep the backlog note was based on, which also caught `.timer-pulse`, `.timer-paused-lbl`, `.timer-pause`/`.timer-stop`, and `.timer-distract` as dead too. Kept `.tb-mood-panel`/`.tb-mood-item` (still used by the hero card's own mood picker, interleaved in the middle of the dead block) and `@keyframes pulse` (still used by `.entry.is-timing .edot`'s animation). `_timer.scss` goes from 691 to 344 lines; compiled `styles.css` shrinks by ~4KB gzipped. No behaviour change — verified visually in the browser (mood panel opens with the right styling, `.edot`'s pulse animation still fires) plus the full build/lint/test suite.

### Fixed
- **Log view entries sort by start time, not insertion order** — `viewEntries()` (`src/js/02-utils.js`) produced its newest-first ordering by reversing insertion order, which only matches chronological order when entries are logged in the order they happened. An entry added retroactively — filling in a missed morning slot after the rest of the day was already recorded — therefore landed wherever it happened to be typed rather than at the position its start time called for. It now sorts by `ts` descending, so an entry always appears where its start time says it belongs regardless of when it was added. Knock-on effect: `exportTxt()` derives its oldest-first ordering by re-reversing `viewEntries()`, so the exported timesheet is now genuinely chronological too, rather than reversed-insertion-order. 2 new regression tests cover the `ts` ordering independent of insertion sequence, and the existing viewed-date filter.
- **Gap check (end-of-week report and end-of-day export warnings) no longer flags non-billable entries for a missing note or proof link** — `findGapReportEntries()` and `findExportWarnings()` (`pure-fns-export.js`) previously required every finished, non-cancelled entry to carry a note or link regardless of billing status, so meetings, admin work, and other entries marked internal via the 💰/💸 toggle showed up in the weekly gap report and the export's warnings section even though there's nothing to bill and so nothing to prove. Both functions now skip an entry whose resolved `_billable` status is `false`; callers (`exportTxt()` in `05a-export.js`, `openGapReportOverlay()` in `12c-gapreport.js`) resolve that status via the existing `isEntryBillable()` three-tier lookup before calling in, since the pure module has no access to the category/task state that lookup needs.
- **`smoke-tests.cjs` couldn't run in sandboxes with a pre-provisioned Chromium that lags Playwright's pinned version** — `chromium.launch()` always resolved the browser Playwright's own installer would have downloaded for the currently pinned `playwright` version, with no way to point it at a different binary already on disk. In an offline/sandboxed dev environment where a Chromium build exists at an older revision than `node_modules/playwright-core/browsers.json` expects, and `npx playwright install` can't reach the network to fetch a matching one, this failed with `browserType.launch: Executable doesn't exist at .../chrome-headless-shell`. Real CI is unaffected — `ci.yml`, `auto-fix-ci.yml`, and `auto-chore.yml` all run `npx playwright install --with-deps chromium` before tests, which keeps the download in sync with `package.json`. `chromium.launch()` now accepts an optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` env var; unset (the default everywhere else), behaviour is unchanged.
- **`auto-chore.yml`'s exit-code checks could misfire on an empty string** — the "comment on the issue" step's `elif [ "${{ steps.claude.outputs.exit_code }}" != "0" ]` and the "fail the job" step's `if: steps.claude.outputs.exit_code != '0'` both treat an empty/unset `exit_code` output as "nonzero," since `'' != '0'` is true. In the current workflow the `claude` step always sets this output before finishing (wrapped in `set +e`/`set -e`), so the gap wasn't reachable in practice — but a hard runner kill mid-step (cancellation, timeout) before that final `echo` runs would have produced a spurious 🔴 "CLI crashed" comment and an unwarranted red job, misreporting what actually happened. Both checks now require the output to be non-empty first. Flagged as a nitpick on PR #296's own review and tracked as #297; picked up separately since it edits `auto-chore.yml` itself, which the automation can never push (see the workflow's own header comment).
- **`auto-chore.yml` failed silently when a push failed, and briefly shipped with an invalid `permissions:` entry** — found by dogfooding the workflow on a real test issue (#297) asking it to modify `auto-chore.yml` itself: the default `GITHUB_TOKEN` refused the push ("refusing to allow a GitHub App to create or update workflow ... without `workflows` permission"), and because that push step failed, the "comment on the issue with the outcome" step was skipped too (GitHub Actions skips subsequent steps by default after a failure) — leaving the issue with zero visibility into what happened. The comment step now runs regardless of an earlier step's outcome (`!cancelled()`), with a distinct message for "committed but failed to push" versus the existing "declined to automate" and "CLI itself crashed" cases. A same-day follow-up (#299) first tried adding `workflows: write` to the job's `permissions:` block — `workflows` is not a real GitHub Actions token permission scope, and the invalid key made the *entire* workflow file unparseable, breaking every chore trigger, not just ones touching workflow files. Corrected here: there is no `permissions:` entry that grants this — pushing changes to `.github/workflows/*` is a hard limit of the default `GITHUB_TOKEN`, now documented as a known limitation in the workflow file's header comment. The distinct failure comment above is what actually surfaces this case.
- **`auto-chore.yml` no longer silently swallows a Claude CLI crash** — `> chore-output.txt 2>&1 || true` discarded the CLI's real exit code, so a crash or auth failure looked identical to Claude correctly declining to act: same green run, same generic issue comment. The step now captures the actual exit code; a nonzero exit posts a distinct 🔴 comment and fails the job outright, while a zero exit with no commit still reports the original "declined to automate" message. Also added a `concurrency: auto-chore-<issue-number>` group so a fast label-remove-then-reapply can't race two overlapping runs past the existing-branch/PR guard into duplicate PRs, and a `${SLUG:-untitled}` fallback for issue titles with no ASCII alphanumeric characters (previously produced a branch name with a trailing dash). Found via `/pr-review` on #291 after it had already merged.

### Added
- **CI now lints the workflow files themselves (`actionlint`)** — an invalid key in a workflow does not fail loudly: GitHub refuses to parse the file, schedules **zero jobs**, and reports no error anywhere, so the run reads as "nothing to do". That has silently broken this repo twice — PR #256 (`if: secrets.CLAUDE_REVIEWER_APP_ID != ''`, a context unavailable in step-level `if:`, which left `a11y-audit.yml` dead for weeks without ever posting a check) and PR #299 (`workflows: write` in a `permissions:` block, which killed every chore trigger until #300). Both were found only by checking `gh api .../jobs` by hand and noticing an empty list. The `lint` job now runs actionlint, pinned to v1.7.12 and SHA256-verified before it executes. Because a linter that silently stops enforcing is worse than none, `npm run test:actionlint` also re-runs actionlint against two fixtures reproducing those exact bugs and fails if either rule stops firing — matching on actionlint's message text rather than its rule tag, since tags have been renamed upstream before. Pure `parseActionlintFindings()`, `interpretFixtureRun()`, `interpretWorkflowsRun()` and `interpretSelfTest()` in `.github/scripts/lib/actionlint-selftest.mjs`, 20 unit tests that need no binary installed. Linting of `run:` block *contents* (shellcheck, pyflakes) is deliberately left off for now — that is a separate, much larger cleanup. Two `actions/create-github-app-token` input findings are also muted: actionlint v1.7.12 ships a stale schema for that action and reports `client-id` as undefined and `app-id` as required, when the action's own `action.yml` deprecates `app-id` in favour of `client-id` — acting on those 18 findings would have moved every workflow onto a deprecated input. The suppression names that one action explicitly, and a unit test asserts no ignore pattern can swallow either fixture's expected finding.
- **The end-of-day export now shows when work happened, not just how long** — the plaintext report grouped entries into totals only, so a task worked in two separate sessions (say, morning and afternoon) rendered as one time-blind block, and a proof link recorded on an entry (existing `entry.link` field) was captured but never actually shown in the file — leaving worklog-vs-report cross-checks to memory. Each task's individual tracked sessions now render as indented `HH:MM–HH:MM` lines, and its proof link(s) as an indented `link:` line, same convention as the existing `note:` line. The header also gains a `Breaks (untracked): Xh Ym` line (workday span minus tracked time) so a day with no real break stops disappearing into the totals. New `sessions` field on `groupEntriesByCategory()`'s per-task output; new pure `buildEntryLinkMap()`.
- **End-of-day export warnings section** — a day's totals can look fine while hiding real anomalies (undocumented work, a suspiciously long unbroken stretch, no break in a full day). The export now appends a `⚠ Warnings` section flagging entries with neither a note nor a link, single blocks over 4h (reusing the existing `isLongRunningTimer()` threshold), and a ≥6h day with under 15 minutes of untracked time — so the person logging the day finds the gap before anyone else has to ask about it. Omitted entirely on a clean day. New pure `findExportWarnings()` in `pure-fns-export.js`, unit tested.
- **Restarting a timer carries its proof link forward and asks about the note** — every "restart with timer" action (the log's ▶ button, the kanban board's "▸ track" button, and the "+ track recent" chips) used to start a completely blank entry, discarding any proof link or note recorded on the previous run of the same task. All three now go through a shared `createRestartedEntry()` (`05-entries.js`): the most recent matching entry's proof link is carried over silently, while its note — which may no longer describe what you're about to do — opens the new entry's editor with a "same note as last time?" banner (Yes, keep it / No, clear) instead of being copied automatically. 11 new unit tests cover the lookup, the copy/prompt logic, and the confirmation banner's rendering.
- **Auto-chore GitHub Actions workflow** — applying the new `chore` issue label now triggers `auto-chore.yml`, which checks out a fresh `chore/issue-<N>-<slug>` branch, runs Claude against the new `/chore-start` skill to implement the issue (only when it judges the change small and mechanical — it comments and makes no commit otherwise), verifies with build/lint/test, and — if a commit resulted — pushes the branch and opens a PR that closes the issue. The PR then goes through the existing chatgpt-pr-review / pr-review pipeline like any human-opened PR; nothing merges without that review and explicit approval. A guard skips issues that already have a branch or PR so relabeling doesn't start duplicate runs.
- **CI now guards commitlint against dependency skew** — the `commit-msg` hook is the only thing enforcing Conventional Commits and it runs solely on contributors' machines, so when #251 bumped `@commitlint/config-conventional` without a matching `@commitlint/cli`, *every* local `git commit` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` and nothing noticed for weeks (QA 2026-08-03, priority 3). #290 pinned the transitive dependency; this adds the missing guard. A new `npm run test:commitlint` runs commitlint against one conforming and one non-conforming sample message, asserting that the preset still loads *and* that rules are still enforced — a preset that loads but matches nothing would otherwise wave any message through. Wired into the `lint` job in `ci.yml`, so the breakage now fails a required check instead of surfacing on someone's next clean checkout. Deliberately does not lint the PR's real commit messages: the point is detecting dependency breakage, not policing contributors. Pure `interpretSelfTest()`, `isPresetResolutionFailure()` and `selectCommitlintBinPath()` in `.github/scripts/lib/commitlint-selftest.mjs`, 36 unit tests.

### Changed
- **End-of-day export's pasteable summary line redesigned around per-ticket totals** — previously grouped by category as `Category (task, task)` with no per-item duration and the Jira key stripped from each task name, which suited a client-facing read but not the line's real job: checking logged hours against ticket worklogs. Now one semicolon-separated `Label (duration)` item per distinct task, full-day total (a task worked in two sessions still collapses to a single line, matching a Jira worklog), Jira key kept intact, and internal (non-billable) items marked `, internal` so that split — already in the header totals — is checkable line by line too. Removes `buildBillableSummaryParts()`, `stripJiraPrefix()`, and `mergeAdjacentEntries()` (the last was dead once summary totals moved to whole-day-per-task instead of gap-based adjacency merging, which had a latent bug: an unrelated entry logged between two sessions of the same task broke the adjacency and silently produced two line items instead of one). New pure `buildTimesheetSummaryLine()` in `pure-fns-export.js`, unit tested.

---

## [1.9.1] — 2026-08-03

### Changed
- **Non-billable relabeled as "internal"** — the billable/non-billable boolean already covered the distinction that mattered (client-billable vs. not), so rather than add a redundant third field, "non-billable" is now labelled "internal" everywhere it appears: the entry-row toggle, the task-row toggle, the category-manager button, and the export summary line. The underlying `billable` boolean and its entry → task → category inheritance (`isEntryBillable()` in `05-entries.js`) are unchanged.

### Added
- **Weekly report draft** — a new "📝 weekly report" button in the export row opens a copy-to-clipboard panel summarising this calendar week (Mon–Sun) grouped by Jira ticket key, with tracked time and any notes/links per ticket, so the "what did I touch" reconstruction needed for a status report no longer means cross-referencing three systems by hand. Untracked/non-ticketed work is grouped into its own "No ticket" bucket rather than dropped; break/lunch/meeting entries are excluded, matching the gap report. This is the feature the proof-link/note fields (PR #276) were captured for. New pure `buildWeeklyTicketSummary()` and `formatWeeklyTicketSummaryText()` in `pure-fns-export.js`, both unit tested; new `12d-weeklyreport.js`.
- **Weekly plan review checklist** — planned-ahead ("upcoming") tasks sometimes turned out to already be finished elsewhere by the time their week actually arrived, since nothing ever re-checked them beforehand. A dismissible banner now appears once a new ISO week begins if any "upcoming" task is dated within it, opening a checklist (ticket key via the existing `parseJiraLabel()`, date, and "✓ done" / "✕ drop" actions per row) to reconcile the plan against reality. This app has no live Jira connection, so the checklist only ever prompts — it can't auto-detect completion. New pure `findWeeklyPlanReviewTasks()` in `pure-fns-tasks.js`; new file `10e-weeklyplan-review.js`.
- **End-of-day export reminder** — exports were always taken mid-afternoon, so the last day's JSON backup was always incomplete. A dismissible banner now appears in the export section once today's workday looks like it may be over (day-start + 8 hours, using the existing start-of-day timestamp — adapts to whenever the day actually began rather than assuming a fixed clock time), with an "🌙 end the day" action that triggers the real export flow. This is a reminder, not a silent auto-export — the app still never writes a file without an explicit click. Pure, unit-tested `isWorkdayLikelyOver()` in `pure-fns-export.js`; re-checked every 5 minutes so it can appear while idle.
- **End-of-week gap report** — a new "🔍 gap report" button in the export row lists this calendar week's (Mon–Sun) finished, non-cancelled entries that have neither a proof link nor a note, so gaps in documentation surface before a weekly report is due instead of after. Clicking a flagged entry ("+ fix") jumps straight to it in the Log view with its proof-link/note editor already open. Break/lunch/meeting utility entries are excluded, since they never need documentation. New pure `findGapReportEntries()` in `pure-fns-export.js` and `mondayOfWeek()` in `pure-fns-format.js` (the latter also replaces a duplicated inline calculation in the `statWeek` header stat); both unit tested.
- **Timer long-running safety warning** — the two longest-ever log entries (12h and 7h) both ended exactly when a JSON backup was taken, a strong signal of a timer left running unattended. The Hero Card now shows a dismissible amber warning once a running timer passes 4 hours (`LONG_RUNNING_MINS` in `03-timer.js`), with a "stop timer" action; the threshold check is a pure, unit-tested `isLongRunningTimer()` in `pure-fns-format.js`. Separately, returning to the tab after it was hidden for more than 30 minutes while a timer was running now asks (via `confirm()`) whether to stop it — this only ever asks, it never changes timer data on its own. Both checks reset per timer session (`startTimer()`).
- **Proof link and note fields on log entries** — each time-log entry can now carry a `link` (the concrete artefact the work touched: Confluence page id, Zephyr case/cycle key, filename, or a URL) and a `note` (a one-line "what I did," written at the time). Both are optional and edited via a new 📎 button on the entry row, which opens an inline panel with a link input and a note textarea — populated fields show as 🔗/📝 indicators instead, and a link starting with `http(s)://` renders as a clickable anchor. Entry notes are exported to the `.txt` timesheet alongside any plan-task note for the same task (new `buildEntryNoteMap()` and `mergeNoteMaps()` in `pure-fns-export.js`); the proof link is captured for now and will feed the planned JSON report-draft generator. New unit tests for `validEntry`'s optional `link`/`note` type-checking and both new pure functions.
- **Task notes exported to the timesheet** — `exportTxt()` now appends each task's plan note as an indented `note:` line under that task's entry in the `.txt` export, so context you jot on an in-progress task (via the existing 📝 note button) travels with the day's timesheet instead of staying trapped in the board. Matching is by date + case-insensitive task text (the same convention the app already uses to link a tracked entry back to its plan row — there is no shared `taskId`). New pure `buildTaskNoteMap()` in `pure-fns-export.js`, wired into `formatGroupedLines()`'s existing `taskNotes` parameter; 9 new unit tests.

### Fixed
- **`npm ci` + commit broken on any fresh clone or worktree** — `@commitlint/config-conventional@21.2.0` pulls in `conventional-changelog-conventionalcommits@10.x`, whose `package.json` only exposes an ESM-only `"exports"` field (`import`/`types`, no `require`). That broke `@commitlint/resolve-extends`'s CJS `require.resolve()` call with `ERR_PACKAGE_PATH_NOT_EXPORTED`, failing the `commit-msg` hook on every fresh install. It went unnoticed because the main working directory's stale `node_modules` still had the older, CJS-compatible `9.3.1` installed. Pinned back via a `package.json` `overrides` entry — `parser.js` (the file commitlint actually consumes) is byte-identical between the two versions, so the pin is behaviourally safe.
- **Log entries couldn't create a new epic** — the category picker on the task board has always had a "+ new epic" control, but the equivalent picker on log entries (opened via the `● category ▾` button under a Log-view entry) never got one. In practice this meant epics could only be created from a task card, so tasks logged straight from the timer/adhoc-log input — as opposed to Jira-imported tasks, whose epics were already set up on the board — had no way to be tagged under a new epic. `buildEntryCatPickerHtml()` extracted into `04-render.js` (matching `catOpts` in `10a-tasks-row.js`) and given the same inline "+ new epic" creator, wired up with matching event handlers. The board's and the entry's "+ new epic" handlers previously duplicated the same create/dedupe/colour-pick logic; both now call a shared `createCategory()` in `01-state.js`. 9 new unit tests.
- **Ad-hoc "+ log" row did nothing on a zero-entry day** — `render()`'s empty-state branch rendered the inline quick-add row into `#timeline` but returned before its click/Enter bindings ran, so logging something on a fresh day (or any day with nothing logged yet) silently did nothing. Binding logic extracted into `bindAdHocRow()` and called from both branches; 4 new regression tests in `test/unit.mjs`.
- **JSON backups no longer grow without bound** — the 21-day retention window was only applied to `entries`, while `planTasks`, `blocks`, `devLog`, and `distractions` were bundled in full. Those arrays grow every day (carried tasks, per-day time blocks, appended distraction/dev-log records), so the `work-log-backup-21d-*.json` file kept getting bigger despite its name. All five time-series arrays are now trimmed to the same window; `categories`, `qpHidden`, and the source-capped `pomoLog` are still kept whole. Retention now runs through a pure, unit-tested `buildBackupPayload()` in `pure-fns.js` (7 new tests), and the per-array count of excluded records is logged at export time.
- **Tabbed task board fills the full panel width** — the To Do / In Progress / Done tab bar and the active lane (with its cards) were collapsing to content width and left-aligning, leaving the right side of the panel empty. The tabbed flex-column layout was inheriting `align-items: start` from the base `.board-cols` grid; it now resets to `align-items: stretch` so tabs and lane span the whole width. Regression test added in `smoke-tests.cjs`.
- **Manually-added tasks never showed as "In progress" on the Kanban board** — the board's own "▸ track" button correctly promoted a task's status when starting its timer, but the three other ways to start tracking — the hero "WHAT'S NEXT?" composer, its recent-task chips, and the quick-capture overlay — only created a log entry and never touched the matching `planTasks` row, so the card stayed in To Do no matter how long the timer ran. Jira-imported tasks weren't spared either, but were rarely affected in practice since importing already seeds their status from Jira and users tend to interact with them via the board's own controls. New shared `findPromotableTask()` (pure, in `pure-fns-tasks.js`) and `promoteMatchingTaskToInProgress()` (`10-tasks.js`) wrapper, now called from all four start-tracking entry points — `addEntry()`, `_heroHandleStart()`, `_heroStartFromChip()`, `_qcActivateRow()`, and the board's own handler (deduplicating its previous inline copy of the same logic). New unit tests cover the lookup, the mutation (status flip, `completedAt` clearing, parent-task promotion), and that every entry point actually calls through.

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
