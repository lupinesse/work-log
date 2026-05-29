---
name: impact-check
description: >-
  Analyses which src/js modules are touched by the current PR diff and traces
  which other modules depend on them. Surfaces blast radius and test coverage
  gaps before an edit lands. Use when asked to check impact, trace dependencies,
  or find what a change might break.
allowed-tools: >-
  Read, Grep, Glob,
  Bash(git diff:*), Bash(git log:*), Bash(git show:*),
  Bash(cat:*), Bash(wc:*)
---

# Cross-Module Impact Analysis

Your goal is to identify which `src/js/` modules are modified in the current
branch, then trace which other modules import or depend on them, so the author
knows what else to review and test before merging.

## Step 1 — Get the diff

Check whether `pr.diff` exists (written by the CI workflow):

```bash
wc -l pr.diff 2>/dev/null || echo "missing"
```

- **If `pr.diff` exists**: read it with the Read tool.
- **If missing** (local run): generate it yourself:
  ```bash
  git diff main...HEAD
  ```

From the diff, collect every modified or added file whose path starts with
`src/js/` or `src/css/`. Ignore deletions (they can only reduce dependants).
Record only the **basename** (e.g. `05-render.js`).

If no `src/` files are in the diff, output:

```
## Impact Analysis — no src/ changes detected in this diff.
```

and stop.

## Step 2 — Build the dependency map

The `src/js/` modules are numbered `00-` through `08-` and concatenated by
the build in numeric order. Later modules can import from earlier ones using
named exports; earlier modules cannot import later ones without a circular
dependency.

First, list all source modules using the Glob tool:

```
Glob: src/js/*.js
```

For each **changed** module basename, search all other source files for
references to it using the Grep tool:

```
Grep: the basename (without extension) across src/js/
```

Also grep the basename across:
- `build.js` and `build-portable.js` — it may be listed in the build order
- `smoke-tests.cjs` and `test/unit.cjs` — to check test coverage

Record every file that contains a reference.

## Step 3 — Assess risk

For each changed module, calculate its **dependant count** (how many other
source modules reference it):

- 🔴 **High** — 2 or more source modules import it
- 🟡 **Medium** — 1 source module imports it
- 🟢 **Low** — no other source modules import it (leaf node)

## Step 4 — Check test coverage

For each changed module, check whether it is exercised by a test:

```
Grep: basename in test/unit.cjs and smoke-tests.cjs
```

Report: ✅ covered / ⚠️ partial (referenced but no assertion visible) / ❌ not found.

## Step 5 — Write the report

Output clean markdown formatted for a GitHub PR comment:

```
## Impact Analysis

### Changed modules
- `src/js/<file>.js` — [one-sentence description of what this module does]

### Downstream dependants
| Changed module | Modules that import it | Risk |
|---|---|---|
| 05-render.js | 06-export.js, 07-ui.js | 🔴 High |
| 02-utils.js | (none) | 🟢 Low |

### Test coverage for changed modules
| Module | Test coverage |
|---|---|
| 05-render.js | ✅ smoke-tests.cjs line 42 |
| 02-utils.js | ❌ not found |

### Recommendation
[One paragraph: overall blast radius, which files the reviewer should read
in addition to the changed files, and whether missing tests are a blocker
before merge.]
```

## Rules

- Read-only. Never modify source files, configs, or test files.
- Do not modify `pr.diff`.
- If the diff is empty or only touches non-source files (docs, config,
  workflows), output the "no src/ changes" message above.
- Every table row must name specific files — never write "various" or "multiple".
- Risk level applies per changed module, not globally.
