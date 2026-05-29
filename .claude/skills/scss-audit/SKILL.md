---
name: scss-audit
description: >-
  Audits src/css/ SCSS files for architecture violations: nesting deeper than
  3 levels, use of !important, BEM class naming violations, magic numbers
  without a comment, and undeclared variables. Use when asked to check SCSS,
  BEM, CSS architecture, or style quality.
allowed-tools: >-
  Read, Grep, Glob,
  Bash(cat:*), Bash(wc:*)
---

# SCSS/BEM Architecture Audit

Your goal is to find SCSS architecture problems in `src/css/` — specifically
violations of the BEM naming convention, excessive nesting, misuse of
`!important`, and magic numbers — and report them with exact file and line
numbers.

## Step 1 — Scope the audit

Check whether `pr.diff` exists:

```bash
wc -l pr.diff 2>/dev/null || echo "missing"
```

- **In CI** (`pr.diff` present): scan only `.scss` files modified in the diff.
  Read `pr.diff` to extract changed file paths in `src/css/`.
- **Local run** (`pr.diff` absent): scan all files matching `src/css/**/*.scss`.

List the files in scope before proceeding. If no `.scss` files are in scope,
output: `## SCSS Audit — no .scss files in scope.` and stop.

## Step 2 — Read variable and mixin definitions

Before auditing, read the variables and mixins file(s) (typically
`src/css/00-variables.scss` or `_variables.scss`) to build a reference list
of declared variables and mixins. You will use this to identify undeclared
variable references.

## Step 3 — Audit each file

For each `.scss` file in scope, read the full file content. Then apply every
check below.

### 3.1 BEM naming (CLAUDE.md: "use a consistent class naming convention (BEM)")

BEM class names follow the pattern:
- Block: `.block`
- Element: `.block__element`
- Modifier: `.block--modifier` or `.block__element--modifier`

Flag class selectors that:
- Mix BEM and non-BEM names in the same context (e.g. `.entry .title` instead
  of `.entry__title`)
- Use more than two underscores or more than two hyphens in a row
- Use camelCase or PascalCase in the class name (these are BEM violations in
  this project's convention)
- Nest `.block .element` where `.block__element` is the correct BEM form

### 3.2 Excessive nesting (CLAUDE.md: "avoid deep nesting")

Count nesting depth by tracking opening `{` and closing `}` braces. Flag any
selector chain that reaches depth 4 or greater (i.e., 3 levels of nesting is
the maximum allowed). Report the deepest line in the chain.

### 3.3 `!important` usage (CLAUDE.md: "avoid !important")

Grep for `!important` in the file. Flag every occurrence. The only acceptable
uses are in utility/reset classes — even then, note them.

### 3.4 Magic numbers

A **magic number** is a numeric literal in a property value (px, em, rem, %)
that:
- Is not `0`
- Is not referenced as a variable
- Has no inline comment explaining why it is that specific value

Common patterns:
- `margin: 14px` — why 14? should this be a variable?
- `z-index: 99` — unexplained stacking context
- `width: 372px` — hard-coded dimension

Flag each occurrence. Note: `1px` border/outline values and `100%`/`100vh`
full-size values are acceptable without a comment.

### 3.5 Undeclared variables

Grep for `$variable-name` references. Cross-check against the declared
variables list from Step 2. Flag any `$` reference that does not match a
declared variable or a Sass built-in (e.g. `$color`, `$size`).

### 3.6 `@extend` anti-pattern

Grep for `@extend`. Flag every occurrence — `@extend` creates non-obvious
coupling between selectors. The project should use mixins or shared classes
instead.

## Step 4 — Write the report

Output clean markdown formatted for a GitHub PR comment:

```
## SCSS Architecture Audit

### Summary
| Check | Status |
|---|---|
| BEM naming | ✅ / ⚠️ N violations / ❌ N violations |
| Max nesting depth | ✅ (max: N) / ❌ N violations at depth M |
| !important usage | ✅ none / ⚠️ N occurrences |
| Magic numbers | ✅ none / ⚠️ N occurrences |
| Undeclared variables | ✅ none / ❌ N references |
| @extend usage | ✅ none / ⚠️ N occurrences |

### 🔴 Blocking

**[src/css/03-entries.scss line 78]** Nesting depth 5 — exceeds maximum of 3.
`.entry > .header > .meta > .date > span { ... }`
Rule: CLAUDE.md — "avoid deep nesting"

### 🟡 Warnings

**[src/css/05-modal.scss line 34]** `!important` on `.modal-overlay color`.
Rule: CLAUDE.md — "avoid !important"

**[src/css/02-layout.scss line 91]** Magic number `372px` — no comment or variable.
Consider extracting to `$sidebar-width`.

### 🔵 Notes

**[src/css/04-buttons.scss line 12]** `.btn-primary` is not a BEM class name.
Consider `.button--primary` to follow BEM convention.
```

## Rules

- Read-only. Never modify source files.
- Every finding must include file path, line number, the offending code snippet,
  and the CLAUDE.md rule it violates.
- Severity: 🔴 Blocking for nesting >3 and undeclared variables (likely build
  errors). 🟡 Warning for `!important`, magic numbers, BEM violations.
  🔵 Note for `@extend` and naming suggestions.
- BEM check: only flag cases where the violation is clear. Do not flag
  legitimate utility classes like `.sr-only`, `.visually-hidden`, `.hidden`.
- If there are zero findings, output `**Verdict: PASS** — no SCSS architecture violations found.`
