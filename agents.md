# Agent knowledge base

Reference for AI agents working in this repository. Updated as new
patterns and pitfalls are discovered. Entries are ordered from most
frequently relevant to most situational.

---

## Repository overview

- **App:** Single-page time-tracking / work-log web app (`work-log.html`)
- **Source:** `src/js/` (ES modules), `src/css/` (SCSS)
- **Build output (never commit):** `script.js`, `styles.css`, `docs/**/*.html`
- **Tests:** `test/unit/*.test.mjs` (Jest/Vitest), `smoke-tests.cjs`
- **CI scripts:** `.github/scripts/` (Node.js `.mjs`)
- **GitHub MCP tools** (`mcp__github__*`) are available and preferred over
  `gh` CLI for all GitHub operations in this environment.

---

## PR lifecycle (step by step)

1. Branch from `main`: `fix/issue-N-description` or `feat/description`
2. Implement → `npm run build && npm run lint && npm test` (all green before pushing)
3. Commit with conventional type (`fix:`, `feat:`, `chore:`, etc.)
4. Push: `git push -u origin <branch>`
5. Open PR as **draft** via `mcp__github__create_pull_request`
6. Wait for CI (`chatgpt-pr-review` workflow — ~5–8 min). Fix any blocking findings.
7. Un-draft: `mcp__github__update_pull_request(draft: false)`
8. Merge (squash): `mcp__github__merge_pull_request(merge_method: "squash")`

**Never push to `main` directly.**

---

## Commit messages

Must pass commitlint. Valid types:
`build` · `chore` · `ci` · `docs` · `feat` · `fix` · `perf` ·
`refactor` · `revert` · `style` · `test`

Use `chore:` for merge-conflict resolution commits.

Attribution footer (required on every commit):
```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_<id>
```

---

## ARCHITECTURE.md maintenance

Every code change to a tracked file must update **two entries** in
`ARCHITECTURE.md`:
- `#### **filename** (N lines)` — section heading
- `- \`filename\` (N lines)` — module list entry

**Line count convention:** `grep -c . src/js/<file>` (non-empty lines).
**Do not** use `wc -l` — CI uses `grep -c .` and will fail if counts diverge.

---

## CodeQL suppressions

Current syntax (CodeQL v2):
```javascript
// codeql[js/rule-id] — reason
flaggedLine();
```

**Do not** use `// lgtm[...]` — that is legacy and no longer recognised.

The comment must be on the line **immediately before** the flagged line.
For `js/file-access-to-http` in `fetch()` calls, the alert fires on the
`body:` line, not on `fetch()` itself.

### Known false positives (`js/file-access-to-http`)
All alerts in `.github/scripts/` are false positives — CI diff content
flows into `body:`, not into the URL.

| File | Suppression line |
|------|-----------------|
| `claude-convergence-summary.mjs` | 164 |
| `claude-chatgpt-dialogue.mjs` | 225 |
| `chatgpt-claude-dialogue.mjs` | ~296 |
| `chatgpt-review.mjs` | ~145 |

---

## Common CI failures and fixes

### "documented N lines, actual M"
ARCHITECTURE.md line count is wrong. Fix:
```bash
grep -c . src/js/<file>   # get actual count
# then update both entries in ARCHITECTURE.md
```

### "type must be one of [...]"
Commit message type is invalid. Use one of the conventional types above.
`merge:` is not valid — use `chore:` instead.

### "Arrow function parameters should be named informatively"
Single-letter params (`a`, `b`) in arrow functions outside tight
`.map`/`.filter` chains. Rename: `(taskA, taskB)`, `(entryA, entryB)`, etc.

### Merging a draft PR returns 405
Un-draft first:
```
mcp__github__update_pull_request(pullNumber: N, draft: false)
```
then merge.

### Merge conflict after `origin/main` advanced
```bash
git fetch origin main
git merge origin/main     # resolve conflicts
git add <resolved files>
git commit -m "chore: resolve merge conflict with origin/main"
git push -u origin <branch>
```

---

## `src/js/04b-render-stats.js` — known patterns

- `renderHeaderStatTiles()` and `renderSubStatTiles()` read `getEntries()`
- Entry null guards: always filter with `entry.text != null` before
  calling `.toLowerCase()` — entries without a task text exist in the store
- Sort comparators must use descriptive param names: `(taskA, taskB)`,
  not `(a, b)` — CI annotation check will flag single-letter params

---

## GitHub MCP tools quick reference

| Operation | Tool |
|-----------|------|
| Read PR / issues | `mcp__github__pull_request_read` / `mcp__github__issue_read` |
| Create PR | `mcp__github__create_pull_request` |
| Update PR (un-draft, title, body) | `mcp__github__update_pull_request` |
| Merge PR | `mcp__github__merge_pull_request` |
| Post PR comment | `mcp__github__add_issue_comment` |
| List PRs | `mcp__github__list_pull_requests` |
| Get file contents | `mcp__github__get_file_contents` |
| Check CI status | `mcp__github__actions_list` / `mcp__github__actions_get` |

---

## Session-start checklist

1. `npm run session:claim` — claim the shared checkout
2. `git status` — verify no stale/foreign changes
3. Check open issues: `mcp__github__list_issues`
4. After work: `npm run session:release`
