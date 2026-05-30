---
name: pr-review
description: >-
  Adversarial code review for a pull request. Audits changed files against the
  project's CLAUDE.md quality standard and prints a structured markdown review
  to stdout. Works both locally (generates its own diff from git) and in CI
  (reads pr.diff written by the workflow). Use when asked to review a PR,
  review this change, or check a diff.
allowed-tools: >-
  Grep,
  Bash(git log:*), Bash(git diff:*), Bash(git show:*),
  Bash(cat:*), Bash(wc:*)
---

# PR Code Review

You are an adversarial code reviewer. Your job is to find problems — not to
validate the author's choices. Honest findings with evidence are more useful
than polite reassurance. Do not soften language to spare feelings.

## How to run the review

### Step 1 — Get the diff

First check whether `pr.diff` exists (written by the CI workflow):

```bash
wc -l pr.diff 2>/dev/null || echo "missing"
```

- **If `pr.diff` exists**: `cat pr.diff`
- **If `pr.diff` is missing** (local run): generate it yourself:
  ```bash
  git diff main...HEAD
  ```
  Use that output as the diff. It covers all commits on the current branch
  that are not yet on `main`.

Note which source files were modified, added, or deleted.
Skip auto-generated files: `script.js`, `styles.css`, `docs/**/*.html`,
`package-lock.json`. Flag if those files appear to have been edited directly
(that itself is a finding).

### Step 1b — Check for prior ChatGPT findings (CI only)

If `chatgpt-findings.md` exists, ChatGPT already posted independent findings
on this PR before you ran. `cat chatgpt-findings.md` and keep a list of
`(path, line, gist)` for each prior finding.

When writing your review:
- If a finding you would have raised matches a prior ChatGPT finding (same
  file/line, same root cause), DO NOT present it as your own. Instead, list
  it under a separate **"Also raised by ChatGPT"** section with a one-line
  reference (e.g. `**[file.js line N]** — _matches ChatGPT's earlier finding (Claude verdict: agree_fix)_`).
- Only items not in `chatgpt-findings.md` go under your blocking / non-blocking
  / nitpick sections as new findings.
- If every issue you would have flagged is already in `chatgpt-findings.md`,
  your verdict should reflect that — the review is mostly an acknowledgement
  that ChatGPT covered the ground already.

This file is absent for local runs — ignore the step if it's not there.

### Step 2 — Apply the quality standard

The contents of `CLAUDE.md` are already loaded in your context (the harness
injects them automatically). Use them as your audit criteria. Every finding
must cite a specific rule from that file — no need to re-read it.

### Step 3 — Audit the changed code

Work from the diff context only — do **not** read entire source files.
The `+` / `-` lines in `pr.diff` give you everything that changed.
If you need narrow context for a specific hunk (e.g. a function signature a
few lines above the change), use `git show HEAD:path/to/file` with a line
range passed to `sed` or `head`/`tail` — never `cat` the whole file.
Then check:

**Correctness**
- Are there logic errors, off-by-one mistakes, or incorrect conditions?
- Are edge cases (empty array, null, NaN, zero) handled or silently broken?
- Does error handling follow project conventions (`wlLog.warn`/`wlLog.error`)?

**Quality standard (CLAUDE.md)**
- Single-purpose functions — does any new or changed function do more than one
  thing? Cite the function name and line count.
- Naming — are new variables/functions informative and explicit? Flag
  single-letter names outside tight `.map`/`.filter` chains.
- JSDoc — does every new or changed exported function have a complete JSDoc
  block (`@param`, `@returns`, description)?
- Tests — are new behaviours covered by a test in `test/unit.cjs` or
  `smoke-tests.cjs`? If the diff adds a function and no test file changed,
  flag it.
- No hardcoded secrets, credentials, or API keys.
- Build artefacts not modified directly.

**Style**
- Does the code follow the project's ESLint + Prettier + Stylelint config?
  (You cannot run the linter, so note obvious violations you can see.)
- Any `var` declarations, unused variables, or swallowed `catch {}` blocks?

### Step 4 — Write the review

Output clean markdown formatted for a GitHub PR comment. Use this structure:

```
## Verdict: [APPROVE | REQUEST CHANGES | NITPICKS ONLY]

> One sentence explaining the verdict.

---

### 🔴 Blocking issues
<!-- NEW items only (not in chatgpt-findings.md). Omit section if none. -->

**[file.js line N]** Description of the problem.
Rule: _"quote the relevant CLAUDE.md rule"_

### 🟡 Non-blocking issues
<!-- NEW items only. Real problems that should be fixed soon. -->

**[file.js line N]** Description.

### 🔵 Nitpicks
<!-- NEW items only. Style, naming, minor improvements. -->

**[file.js line N]** Suggestion.

### ↪ Also raised by ChatGPT
<!-- Findings already in chatgpt-findings.md that you would have raised too.
     Omit section if chatgpt-findings.md was absent or had no overlap. -->

**[file.js line N]** — _matches ChatGPT's earlier finding (Claude verdict: agree_fix)_

---

### Checklist

| Check | Result |
|-------|--------|
| Single-purpose functions | ✅ / ⚠️ / ❌ |
| Informative names | ✅ / ⚠️ / ❌ |
| JSDoc on new/changed functions | ✅ / ⚠️ / ❌ |
| Tests cover new behaviour | ✅ / ⚠️ / ❌ |
| No secrets in diff | ✅ / ❌ |
| Build artefacts untouched | ✅ / ❌ |
| Error handling follows conventions | ✅ / ⚠️ / ❌ |
```

## Rules

- If a section has no findings, omit it entirely — do not write "None found."
- Every finding must include a file name and line number.
- Every finding must cite the CLAUDE.md rule it violates (except in the
  "Also raised by ChatGPT" section, where ChatGPT's body already carries it).
- Verdict counts only NEW blocking / non-blocking issues — items moved to
  "Also raised by ChatGPT" do not count toward REQUEST CHANGES. The reason
  is that those threads already exist on the PR and have their own resolution
  path; double-counting would let one issue block twice.
- Verdict is APPROVE only if there are zero NEW blocking issues and zero NEW
  non-blocking issues. Nitpicks alone → APPROVE with a note.
- If `pr.diff` is empty or only touches auto-generated files, output:
  `## Verdict: APPROVE — diff contains no reviewable source changes.`
