---
name: jsdoc-check
description: >-
  Scans all exported functions and classes in src/js/ for missing or incomplete
  JSDoc. Enforces the CLAUDE.md rule that every exported function must have a
  description, @param for each parameter, and @returns. Reports findings as a
  structured PR comment with blocking and non-blocking categories. Use before
  opening a PR or when asked to check docs, JSDoc, or documentation coverage.
allowed-tools: >-
  Read, Grep, Glob,
  Bash(cat:*), Bash(wc:*)
---

# JSDoc Completeness Check

Your goal is to find every exported function, class, and constant in
`src/js/` that is missing or has incomplete JSDoc, and report the gaps
with exact file names and line numbers.

## Step 1 — Scope the scan

Check whether `pr.diff` exists:

```bash
wc -l pr.diff 2>/dev/null || echo "missing"
```

- **In CI** (`pr.diff` present): scan only the files modified in the diff.
  Read `pr.diff` to get the list of changed `src/js/` files.
- **Local run** (`pr.diff` absent): scan all `src/js/*.js` files.

List the files in scope before proceeding.

## Step 2 — Identify exported symbols

For each file in scope, read the full file. Then find every **exported**
symbol using these patterns:

- `export function <name>` — named exported function
- `export const <name> = function` or `export const <name> = (` — exported
  function expression or arrow function
- `export class <name>` — exported class
- `export default function` — default exported function
- Re-exports (`export { x } from`) — skip; these are covered by the source.

Record each exported symbol with its **name**, **line number**, **parameter
names** (from the signature), and whether it has a `return` statement.

## Step 3 — Evaluate JSDoc completeness

Immediately above each exported symbol, check for a `/** ... */` block.
A block is **complete** if it has all of the following:

1. A non-empty description on the first line (not just `@param` tags).
2. One `@param {type} name — description` tag for each parameter in the
   signature (variadic `...args` counts as one param).
3. A `@returns {type} description` tag if the function has a `return`
   statement (void functions: `@returns` optional but appreciated).

Classify each exported symbol:

- ✅ **Complete** — all three requirements met.
- ⚠️ **Partial** — block exists but missing at least one `@param` or
  `@returns`, or description is absent/empty.
- ❌ **Missing** — no `/** ... */` block immediately above the export.

## Step 4 — Write the report

Output clean markdown formatted for a GitHub PR comment:

```
## JSDoc Coverage

### Summary
| Status | Count |
|---|---|
| ✅ Complete | N |
| ⚠️ Partial | N |
| ❌ Missing | N |

### 🔴 Blocking — missing JSDoc (CLAUDE.md: "document every exported function")

**[src/js/05-render.js line 47]** `renderEntry(entry, options)`
Missing JSDoc block entirely.

### 🟡 Partial — incomplete JSDoc

**[src/js/03-storage.js line 12]** `saveEntry(key, value)`
Has description but missing `@param key` and `@param value`.

### ✅ All clear
<!-- Only write this line if every exported symbol is complete -->
All exported symbols in scope have complete JSDoc.
```

## Rules

- Report only **exported** symbols. Private (non-exported) functions are not
  in scope for this check.
- Never modify source files.
- Every finding must include the file path, line number, and function name.
- If `pr.diff` scopes the check to zero `src/js/` files, output:
  `## JSDoc Coverage — no src/js changes in scope.`
- The report verdict: if there are any ❌ Missing items, the verdict is
  **FAIL** (blocking). If only ⚠️ Partial, the verdict is **WARN**. If all
  ✅, the verdict is **PASS**.
- Add the verdict as the last line:
  `**Verdict: PASS | WARN | FAIL**`
