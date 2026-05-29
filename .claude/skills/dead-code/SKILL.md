---
name: dead-code
description: >-
  Maps all named exports across src/js/ modules against all import sites to
  find exported symbols that are never consumed by any other module or by the
  build. Writes a dated report to docs/dead-code-reports/. Run periodically or
  before a release to keep the codebase lean. Use when asked to find unused
  exports, dead code, or unreachable functions.
allowed-tools: >-
  Read, Grep, Glob, Write,
  Bash(cat:*), Bash(wc:*)
---

# Dead Code Detection

Your goal is to build a complete map of every named export in `src/js/` and
determine which ones are never imported by any other file. These are dead
exports — safe candidates for removal. You will write a dated report to
`docs/dead-code-reports/`.

## Step 1 — Inventory all source modules

List all JS source files:

```
Glob: src/js/*.js
```

Read each file in full. For every file, record:

1. **Exported symbols** — every name appearing in:
   - `export function <name>`
   - `export const <name>`
   - `export class <name>`
   - `export { <name1>, <name2> }` (named re-exports from within the file)
   - `export default` — record as `<filename>:default`

2. **Import sites** — every name consumed via:
   - `import { <name> } from '...'`
   - `import <name> from '...'` (default import)
   - Dynamic: `await import('...')` — note the module as dynamically loaded
     (cannot statically determine which exports are consumed; mark all exports
     from that module as ⚠️ Possibly used)

## Step 2 — Inventory build entry points

Read `build.js` and `build-portable.js`. These files may concatenate modules
directly without ES import syntax. Note any module file listed by name — its
exports are consumed by the build pipeline even if not explicitly imported
elsewhere.

## Step 3 — Cross-reference: find dead exports

For each exported symbol `<file>:<name>`:

1. Grep for `<name>` across all other `src/js/` files, `build.js`,
   `build-portable.js`, `smoke-tests.cjs`, and `test/unit.cjs`.
2. If zero references found outside the declaring file → **Dead export**.
3. If references found only in test files (not in other source or build files)
   → **Test-only export** (note separately — may be intentional).
4. If the declaring module is listed as a dynamic import target → **Possibly
   used** (cannot confirm statically).

**Note:** `export default` functions used as the module's public API may be
called by the build concatenation rather than via ES imports. Cross-check
`build.js` before declaring a default export dead.

## Step 4 — Identify unused local functions

For each file, also identify **non-exported functions** that are defined but
never called within the same file. These are intra-file dead code.

Pattern: `function <name>` or `const <name> = ` that appears exactly once
(the definition) and zero times as a call (`<name>(`) in the same file.

Limit this check to functions with ≥5 lines of body to avoid flagging tiny
one-liners that may be intentional stubs.

## Step 5 — Write the report

Today's date format: `YYYY-MM-DD`. Write the report to:

```
docs/dead-code-reports/dead-code-<YYYY-MM-DD>.md
```

Report structure:

```markdown
# Dead Code Report — <YYYY-MM-DD>

## Summary
| Category | Count |
|---|---|
| Dead exports (never imported) | N |
| Test-only exports | N |
| Possibly used (dynamic import) | N |
| Unused local functions | N |

## Dead exports

These symbols are exported but never imported by any other source or build file.
They are safe to remove unless they form part of a public API consumed outside
this repo.

| File | Symbol | Type |
|---|---|---|
| src/js/05-render.js | `renderDebugInfo` | function |
| src/js/03-storage.js | `STORAGE_VERSION` | const |

## Test-only exports

Exported and consumed only in test files. Consider whether these need to be
exported at all, or whether tests can be refactored to test via the public API.

| File | Symbol | Used in |
|---|---|---|
| src/js/02-utils.js | `_formatDate` | test/unit.cjs |

## Possibly used (dynamic imports)

The following modules are loaded dynamically (`import(...)`), so their exports
cannot be statically confirmed as used or unused.

- `src/js/07-pomodoro.js`

## Unused local functions

Defined but never called within their own file. Verify before removing — they
may be referenced indirectly (e.g. via object property or eval).

| File | Function | Lines |
|---|---|---|
| src/js/04-ui.js | `_debugDumpState` | 12 |

## Methodology notes
- Analysis date: <YYYY-MM-DD>
- Scope: src/js/*.js + build.js + build-portable.js + smoke-tests.cjs + test/unit.cjs
- Dynamic imports: modules loaded via `import(...)` are marked as possibly used
- Default exports: cross-checked against build.js concatenation order
```

## Rules

- Write the report file; do not modify any source file.
- Use today's actual date in ISO 8601 format (YYYY-MM-DD).
- If `docs/dead-code-reports/` does not exist, create the directory by writing
  the report file at that path — the Write tool will create missing directories.
- Do not delete symbols yourself. The report is informational; a human must
  decide what to remove.
- If every export is consumed and no unused locals are found, write a report
  that says so explicitly — a clean report is still a useful data point.
- Grep is case-sensitive. A symbol exported as `renderEntry` and referenced as
  `renderEntry` is correctly matched. Do not treat partial matches as references.
