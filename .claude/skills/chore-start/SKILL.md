---
name: chore-start
description: >-
  Implements a GitHub issue labeled "chore" end-to-end: reads the issue via
  the ISSUE_NUMBER env var, makes the smallest correct change, verifies with
  build/lint/test, and commits on the already-checked-out
  chore/issue-<N>-<slug> branch. Invoked automatically by the auto-chore
  GitHub Actions workflow when the "chore" label is applied to an issue.
  Never pushes or opens the PR itself — the workflow does that after
  confirming a commit exists.
allowed-tools: >-
  Read, Edit, Write, Glob, Grep,
  Bash(npm run build), Bash(npm run lint), Bash(npm test),
  Bash(git add:*), Bash(git commit:*), Bash(git log:*),
  Bash(git diff:*), Bash(git status:*),
  Bash(gh issue view:*), Bash(gh issue comment:*),
  Bash(cat:*), Bash(wc:*)
---

# Chore Auto-Start

You are implementing a repository chore unattended, on a branch the workflow
has already created and checked out. `ISSUE_NUMBER` names the GitHub issue
driving this run. Nobody will answer follow-up questions — if the issue is
too ambiguous to implement safely, stop and say so (Step 5) rather than
guessing.

## Step 1 — Read the issue

```bash
gh issue view "$ISSUE_NUMBER" --json title,body,labels,comments
```

## Step 2 — Judge whether this is safe to automate

Proceed only if the issue describes a small, mechanical, low-risk change
(the kind "chore" implies: dependency bump, config tweak, dead-code removal,
rename, doc fix, lint-rule cleanup). If it requires a design decision, touches
data schemas, or the scope is unclear, do not guess — go to Step 5 instead.

## Step 3 — Implement

Follow every rule in `CLAUDE.md` (modular code, naming, JSDoc, no build
artefacts committed, etc.). Make the smallest change that fully addresses
the issue. Add or update tests for any behavioural change — this is not
optional per the project's quality standard.

## Step 4 — Verify and commit

```bash
npm run build
npm run lint
npm test
```

All three must pass. If a check fails, fix it and re-run before committing —
do not commit failing code. Stage only source files (never `script.js`,
`styles.css`, `node_modules`, `docs/*.html`), then commit with a message
starting with `chore:` and a body explaining why, e.g.:

```
chore: <short summary>

<why this change, referencing the issue>
```

If `CHANGELOG.md` should record this (any user-facing behaviour change),
add an entry in the same commit.

## Step 5 — If you can't safely proceed

Post a comment explaining what's unclear or why this needs a human judgment
call, and make **no commit**:

```bash
gh issue comment "$ISSUE_NUMBER" --body "..."
```

The workflow checks for a new commit afterwards; if there isn't one, it skips
opening a PR and leaves the label in place for a human to pick up.
