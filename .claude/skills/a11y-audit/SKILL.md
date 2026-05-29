---
name: a11y-audit
description: >-
  Audits HTML (work-log.html, src/) and JS (src/js/) for WCAG 2.1 AA
  accessibility violations: missing labels on form controls, missing alt text
  on images, non-semantic interactive elements, absent ARIA attributes,
  unlabelled landmark regions, and keyboard-inaccessible widgets. Use when
  asked to check accessibility, WCAG, or a11y.
allowed-tools: >-
  Read, Grep, Glob,
  Bash(cat:*), Bash(wc:*)
---

# Accessibility Audit (WCAG 2.1 AA)

Your goal is to find WCAG 2.1 AA violations in this project's HTML and
dynamically-generated DOM and report them with exact file names and line
numbers. This is not a full automated audit — it is a targeted static
analysis pass covering the most impactful categories.

## Step 1 — Scope the audit

Check whether `pr.diff` exists:

```bash
wc -l pr.diff 2>/dev/null || echo "missing"
```

- **In CI** (`pr.diff` present): scan files modified in the diff only.
  Read `pr.diff` to identify changed `.html`, `.js`, and `.scss` files.
- **Local run** (`pr.diff` absent): scan all of the following:
  - `work-log.html` (the main HTML entry point)
  - `src/**/*.html` (any HTML files under src/)
  - `src/js/**/*.js` (for dynamically created DOM)
  - `src/css/**/*.scss` (for visibility, focus, and contrast issues)

## Step 2 — HTML static checks

For each `.html` file in scope, read the full file and check:

### 2.1 Form controls (WCAG 1.3.1, 4.1.2)
Every `<input>`, `<select>`, `<textarea>`, and `<button>` must have one of:
- A `<label for="id">` element pointing to it, OR
- An `aria-label` attribute, OR
- An `aria-labelledby` attribute referencing a visible element.

Flag any control that has none of the above.

### 2.2 Images (WCAG 1.1.1)
Every `<img>` must have an `alt` attribute.
- Decorative images: `alt=""` is correct.
- Meaningful images: `alt` must be descriptive (not empty, not "image").

### 2.3 Semantic landmarks (WCAG 1.3.6)
The page must have at least: `<header>` or `role="banner"`, `<main>` or
`role="main"`, `<nav>` or `role="navigation"` (if navigation exists).
Flag if any are absent.

### 2.4 Interactive elements (WCAG 4.1.2)
`<div>`, `<span>`, `<li>`, or `<td>` elements with `onclick` handlers or
`cursor: pointer` are not keyboard accessible. They must instead be
`<button>` or have `role="button"` plus `tabindex="0"` plus a keyboard
event handler.

### 2.5 Focus indicators (WCAG 2.4.7)
Grep for `outline: none` or `outline: 0` without an adjacent custom focus
indicator. Flag occurrences.

## Step 3 — JavaScript dynamic DOM checks

For each `.js` file in scope, read the full file and check:

### 3.1 createElement patterns
Find every `document.createElement(...)` call. For each:
- `createElement('input')`: check the surrounding code sets `id`, and a
  corresponding `label.htmlFor` or `setAttribute('aria-label', ...)` exists.
- `createElement('button')`: check it receives text content or `aria-label`.
- `createElement('img')`: check `setAttribute('alt', ...)` is set.
- `createElement('div')` with an `onclick`/`addEventListener('click')`: check
  it also has `setAttribute('role', 'button')` and `setAttribute('tabindex', '0')`.

### 3.2 innerHTML patterns
Find `innerHTML =` or `insertAdjacentHTML` assignments. Read the HTML string
being inserted and apply the same checks from Step 2 to that string.

## Step 4 — SCSS checks

For each `.scss` file in scope, grep for:
- `outline: none` / `outline: 0` — focus suppression (WCAG 2.4.7)
- `color:` — flag if the surrounding rule might affect text on a background
  (note for manual contrast check; cannot compute ratio statically)
- `display: none` / `visibility: hidden` on elements that might carry
  content for screen readers

## Step 5 — Write the report

Output clean markdown formatted for a GitHub PR comment:

```
## Accessibility Audit (WCAG 2.1 AA)

### Summary
| Severity | Count |
|---|---|
| 🔴 Blocking (clear WCAG failure) | N |
| 🟡 Warning (likely failure, needs manual check) | N |
| 🔵 Note (best-practice improvement) | N |

### 🔴 Blocking issues

**[work-log.html line 204]** `<input id="entry-text">` has no associated label.
Criterion: 1.3.1 Info and Relationships / 4.1.2 Name, Role, Value.

### 🟡 Warnings

**[src/js/05-render.js line 118]** `createElement('div')` with `onclick` handler
has no `role="button"` or `tabindex`. Not keyboard accessible.
Criterion: 4.1.2 Name, Role, Value.

### 🔵 Notes

**[src/css/02-layout.scss line 34]** `outline: none` on `.entry` — verify a
custom focus indicator is visible in all themes.

### ✅ All clear
<!-- Only include this if zero findings of that severity -->
```

## Rules

- Read-only. Never modify any file.
- Every finding must cite: file path, line number, element or pattern, and
  the specific WCAG criterion (number + name).
- Severity: 🔴 if the violation is unambiguous from static analysis.
  🟡 if a manual browser test is needed to confirm. 🔵 for best-practice
  improvements that are not outright failures.
- If the diff scope contains no `.html`, `.js`, or `.scss` changes, output:
  `## Accessibility Audit — no auditable files in scope.`
- Do not flag third-party libraries in `node_modules/`.
