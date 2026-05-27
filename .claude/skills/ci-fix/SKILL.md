---
name: ci-fix
description: >-
  Reads ci-failure.log, diagnoses the CI failure, fixes the source files,
  verifies with build/lint/test, and commits. Invoked automatically by the
  auto-fix-ci GitHub Actions workflow when a PR's CI run fails. Never edits
  build artefacts (script.js, styles.css). Commit message must start with
  "auto-fix:" so the loop-guard in the workflow can detect repeated fixes.
allowed-tools: >-
  Read, Edit, Write, Glob, Grep,
  Bash(npm run build), Bash(npm run lint), Bash(npm test),
  Bash(git add:*), Bash(git commit:*), Bash(git log:*),
  Bash(git diff:*), Bash(git status:*), Bash(cat:*), Bash(wc:*)
---

# CI Auto-Fix

You are fixing a CI failure on a pull request. Your only goal is to make
`npm run build`, `npm run lint`, and `npm test` pass with the minimum change
needed. Do not refactor, rename, or improve unrelated code — make a surgical
fix and nothing else.

## Step 1 — Read the failure log

```bash
cat ci-failure.log
```

Identify:
- Which CI job failed: **test** (build + smoke tests) or **lint**
- The exact error message, file path, and line number
- Whether multiple independent errors exist

## Step 2 — Understand the codebase context

- Source files live in `src/js/*.js` (numbered, concatenated in order by the
  build into `script.js`) and `src/css/*.scss` (compiled into `styles.css`).
- **Never edit `script.js` or `styles.css` directly** — they are regenerated
  by `npm run build` and any direct edits will be overwritten.
- Read the failing source file in full before editing, to understand context.

## Step 3 — Fix the error

Apply the smallest change that resolves the failure. Common cases:

| Failure type | Where to fix |
|---|---|
| ESLint error (`no-unused-vars`, `prefer-const`, missing semicolon, etc.) | `src/js/<file>.js` |
| Sass/build error (invalid syntax, missing `@use`, etc.) | `src/css/<file>.scss` |
| Smoke test assertion failed | `src/js/<file>.js` (fix the behaviour the test checks) |
| Missing function / undefined reference | Correct source file in `src/js/` |

If multiple errors exist in the same file, fix them all in one edit pass.

## Step 4 — Verify

Run all three checks in order. Stop at the first failure and re-diagnose:

```bash
npm run build
npm run lint
npm test
```

If the same error reappears, re-read the file and try again.
If a new, different error appears, treat it as a new step-2 cycle.
Stop after **3 full fix cycles** and report what you tried if CI is still red.

## Step 5 — Commit

Stage only source files — never `script.js`, `styles.css`, `node_modules`,
`docs/`, or `*.png`. Check what changed first:

```bash
git diff --stat
git status
```

Then commit:

```bash
git add src/ work-log.html   # adjust to the actual changed files
git commit -m "auto-fix: <one-line description of what was broken>

- Root cause: <what caused the failure>
- Fix: <what was changed>

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

**The commit message MUST start with `auto-fix:`** — the workflow uses this
prefix to detect repeated fix attempts and break the retry loop.

## Rules

- Fix only what CI reports as broken. Ignore style nits or pre-existing issues.
- If you genuinely cannot fix the failure (e.g. flaky Playwright timing, an
  external service outage, a test that is testing the wrong thing), do NOT
  commit anything. Instead output a clear diagnosis: what failed, what you
  tried, and what a human needs to do.
- Never commit secrets, credentials, or build artefacts.
- Never `--force` push or run destructive git commands.
