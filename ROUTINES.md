# Claude Code routines

Copy-paste-ready configurations for [Claude Code routines](https://code.claude.com/docs/en/routines)
that automate this project's quality workflow. Each routine is a saved prompt
plus a trigger that runs autonomously on Anthropic-managed cloud infrastructure
(Remote) or on your own machine while it is awake (Local).

These prompts assume the committed skills in `.claude/skills/` (`qa-review`,
`pr-review`, `ci-fix`, `dead-code`, `jsdoc-check`, `a11y-audit`, `scss-audit`,
`impact-check`) are available, which they are because the repository is cloned
at the start of every run.

## Local vs Remote

The **Local** routine form only offers schedule triggers (Manual / Hourly /
Daily / Weekdays / Weekly), runs against a local folder, and only runs while
your computer is awake. GitHub-event and API triggers are **Remote only**.

| Routine | Run as | Why |
| --- | --- | --- |
| Daily commit review | **Local** | Read-only digest, no PR, no laptop-awake concern |
| Weekly QA audit | **Remote** | Opens a PR; must run even with the laptop closed |
| PR review on open | **Remote only** | Needs a `pull_request.opened` GitHub trigger |
| Pre-release sweep | **Remote** | Opens a PR |

> **CI auto-fix is intentionally not a routine.** It is already implemented
> in-runner by `.github/workflows/auto-fix-ci.yml`, which installs the Claude
> Code CLI and runs `/ci-fix` directly when a CI run fails on a PR. Adding a
> routine for the same job would create a second auto-fixer racing on the same
> PR. See the **CI auto-fix** section below for details.

## Shared settings (Remote routines)

- **Repository:** `lupinesse/work-log`
- **Environment:** Default (Trusted network is sufficient — the npm registry is
  on the default allowlist). Add a setup script of `npm ci` so `build`, `lint`,
  and `test` work on the fresh clone.
- **Connectors:** remove all unless a routine explicitly needs one.
- **Permissions:** leave "Allow unrestricted branch pushes" off, so changes land
  on `claude/`-prefixed branches and PRs.

Routines run with no approval prompts, so the instructions below are written to
be self-contained and explicit about what success looks like.

---

## 1. Daily commit review (Local)

The only routine that belongs in the Local form. Select your `work-log`
checkout as the folder, leave **Worktree** unchecked (read-only), and keep the
permission mode at **Default**.

**Name**

```
daily-commit-review
```

**Description**

```
Review the last 24h of commits against CLAUDE.md and flag anything concerning
```

**Instructions**

```
Review this repository's activity from the last 24 hours.

1. List commits on all branches from the last 24 hours (git log --since).
   If there are none, say so and stop.
2. For each change, summarise what it touched and why.
3. Flag anything concerning against CLAUDE.md: missing/incomplete JSDoc on
   new exports, source edits with no accompanying unit test, new !important
   or deep nesting in SCSS, hard-coded secrets/paths, or a user-facing change
   with no CHANGELOG entry.
4. Note any follow-ups worth opening an issue for.

This is a read-only review — do not edit files, commit, or push. Output a
short markdown digest with a "Concerns" section and a "Looks good" section.
```

**Schedule:** Daily, at 09:00.

---

## 2. Weekly QA audit (Remote)

**Name**

```
weekly-qa-audit
```

**Description**

```
Run /qa-review, commit the dated report, open a draft PR with regressions vs last week
```

**Schedule:** Weekly, Monday 08:00.

**Instructions**

```
Run a weekly quality-assurance audit of this repository.

1. Invoke the committed /qa-review skill — it scores the repo against the
   Duck Book "Higher" tier and writes a dated report to docs/qa-reports/.
2. Compare against the most recent existing report in docs/qa-reports/.
   Call out anything that has REGRESSED and anything newly RESOLVED.
3. Commit the new report on a claude/-prefixed branch
   ("docs: weekly QA report YYYY-MM-DD").
4. Open a DRAFT PR against main titled "Weekly QA report <date>", with a
   summary of the overall score, top blocking findings, and the
   regressions-vs-last-week list.

Audit only — do not change source code. If /qa-review fails, say so in the
PR body rather than inventing a score.
```

---

## 3. PR review on open (Remote only)

**Name**

```
pr-review-on-open
```

**Description**

```
On every non-draft PR, run /pr-review + jsdoc/a11y/scss checks and post inline review
```

**Trigger:** GitHub event → `pull_request.opened`, filtered to **Is draft =
false** (configured in the web UI; requires the Claude GitHub App installed on
the repository).

**Instructions**

```
A non-draft pull request was just opened. Review it against CLAUDE.md.

1. Run the committed /pr-review skill on this PR's diff.
2. Then run /jsdoc-check, /a11y-audit, and /scss-audit and fold findings in.
3. Post INLINE comments for each blocking issue, anchored to file:line.
4. Post one top-level summary: verdict (approve / request changes), count of
   blocking vs non-blocking, and the single most important fix first.

Review and comment only — do not push commits or edit files. Never approve a
PR that has any blocking finding.
```

---

## 4. CI auto-fix — handled by a workflow, not a routine

CI auto-fix is **deliberately not a routine**. It is already implemented by
`.github/workflows/auto-fix-ci.yml`, which triggers on the CI workflow
completing, and — when a PR run fails — checks out the PR branch, installs the
Claude Code CLI, runs `/ci-fix` in the runner, pushes an `auto-fix:` commit, and
posts a diagnosis comment. A loop-guard skips runs whose last commit already
starts with `auto-fix:` to prevent infinite retry cycles.

Because that workflow does the whole job in-runner, creating a routine for the
same purpose would put a second auto-fixer on the same PR, racing the first and
risking duplicate commits or conflicts. If you ever want to move the logic into
a routine instead, retire the in-runner Claude steps in that workflow first and
replace them with a `curl` that fires the routine's API endpoint with the
failure log — do not run both.

The `/ci-fix` skill itself (`.claude/skills/ci-fix/`) remains the single source
of the fix logic, invoked by the workflow.

---

## 5. Pre-release sweep (Remote)

**Name**

```
pre-release-sweep
```

**Description**

```
Run /dead-code, remove confirmed-unused exports, open a draft cleanup PR
```

**Schedule:** Weekly, Friday 16:00.

**Instructions**

```
Run a pre-release code-hygiene sweep.

1. Invoke the committed /dead-code skill — it writes a dated report to
   docs/dead-code-reports/.
2. Remove ONLY exports the report flags with high confidence as never
   imported. Leave anything ambiguous in place and list it in the PR body.
3. Run npm run build && npm run lint && npm test — all must pass. Revert any
   specific removal that breaks something.
4. Commit on a claude/-prefixed branch and open a DRAFT PR titled
   "Dead-code sweep <date>" summarising what was removed and what was left.

If nothing is removed, still commit the report and open the PR for the record.
```
