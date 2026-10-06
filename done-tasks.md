# Done tasks log

Chronological record of tasks completed by AI agents in this repository.

---

## 2026-10-06

### Session `9d75ef0b` / `session_01Km7H4FBfwm6RwywZxsGhT4`

**09:00–10:15 UTC (approx)**

#### PR #643 — Null-guard fix in `04b-render-stats.js`
- **Issue:** Entries without a `text` field caused `.toLowerCase()` to throw,
  crashing the stats render.
- **Fix:** Added `entry.text != null` guards in `renderHeaderStatTiles()` and
  `renderSubStatTiles()` before any `.toLowerCase()` call.
- **Also fixed during CI iteration:**
  - Renamed single-letter sort comparators `(a, b)` → `(taskA, taskB)` ×2
    (CI annotation check flags single-letter arrow params)
  - Updated ARCHITECTURE.md line count for `04b-render-stats.js` from 171 to
    163 (learned that CI uses `grep -c .`, not `wc -l`)
- **Merged:** squash commit `e112e116`

#### PR #644 — CodeQL `js/xss-through-dom` closures (#624)
- **Issue:** Three open CodeQL alerts for `js/xss-through-dom` in
  `src/js/12-misc.js` and `src/js/22-trackers.js`.
- **Fix:** Added a local CodeQL `safeCssColor` barrier model (`.github/codeql/`),
  updated `codeql.yml` to use local model path.
- **Merged:** squash commit `21684e8a`

#### PR #647 — CodeQL `js/file-access-to-http` suppressions (#625)
- **Issue:** Four open CodeQL alerts in `.github/scripts/` for
  `js/file-access-to-http`. All are false positives — `diff` content flows
  into `body:`, not the URL.
- **Triage findings:**
  - Alerts #16 (`claude-convergence-summary.mjs`) and #17
    (`claude-chatgpt-dialogue.mjs`) already had correct `codeql[...]`
    suppressions — no change needed.
  - Alerts #33 (`chatgpt-claude-dialogue.mjs`) and #34 (`chatgpt-review.mjs`)
    used legacy `// lgtm[...]` syntax (not recognised by CodeQL v2) AND placed
    the comment on the `fetch()` line instead of the `body:` line where the
    alert actually fires.
- **Fix:** Updated #33 and #34 to use `// codeql[js/file-access-to-http]`
  immediately before the `body:` line.
- **Complications:**
  - `origin/main` advanced after the branch was created; CHANGELOG.md had a
    merge conflict (both sides added entries to `### Fixed`). Resolved by
    keeping both entries.
- **Merged:** squash commit `46d16428`

#### Knowledge capture (this session)
- Updated `CLAUDE.md` with agent operational notes (line-count convention,
  commit type requirement, draft PR pitfall, CodeQL syntax, arrow param naming,
  merge conflict procedure).
- Created `agents.md` — reference doc for future agents.
- Created `done-tasks.md` — this file.
