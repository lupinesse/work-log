# Project quality standard

All code you write, edit, or generate in this project must comply with the
**Higher quality assurance** tier of the UK Government Analysis Function's
*Quality Assurance of Code for Analysis and Research* ("the Duck Book").

Reference (for humans, not auto-fetched):
https://best-practice-and-impact.github.io/qa-of-code-guidance/checklist_higher.html

Treat the rules below as the operative version of that checklist, adapted to
this project's stack: JavaScript, SCSS/CSS, HTML, and PowerShell (with minor
Batch/Shell scripts). When a request conflicts with these rules, follow these
rules and flag the conflict.

---

## Rules — apply to everything you create

### Modular code
- Write logic as small, single-purpose functions; use classes/modules only
  when they genuinely fit better.
- Each function does exactly one thing — one reason to change.
- Group related code into themed ES modules; export a clear public surface.
- Entry-point scripts only import and orchestrate higher-level functions — no
  business logic inline.
- Remove repetition: extract reusable code into shared functions/modules.
  In SCSS, factor shared rules into mixins, placeholders, and variables.
- Design for extension without modifying internals.

### Coding style
- Names are informative, concise, and explicit — no cryptic abbreviations.
- Keep logic clear; reject unnecessary complexity and clever one-liners.
- JavaScript: follow the project's ESLint + Prettier config; prefer `const`,
  avoid `var`, handle Promises explicitly, no unused code.
- SCSS/CSS: follow the project's Stylelint config; use a consistent class
  naming convention (e.g. BEM); avoid deep nesting and `!important`.
- HTML: use semantic elements; meet accessibility requirements (WCAG) —
  labels, alt text, landmarks, keyboard operability.
- PowerShell: follow PSScriptAnalyzer; use approved verbs (`Get-`, `Set-`,
  `New-`...), PascalCase for functions, full parameter names, `Set-StrictMode`.
- Assume linters/formatters are part of the definition of "done".

### Project structure
- Use a clear, standard layout that separates source code, build output,
  assets, and documentation. Never write build output into source directories.
- Build artefacts are disposable and regenerable — they are not committed.

### Code documentation
- Document every exported function/module: purpose, parameters, return value.
- JavaScript: JSDoc comments. PowerShell: comment-based help
  (`.SYNOPSIS`, `.PARAMETER`, `.EXAMPLE`).
- Comments explain *why*, not *what*. Keep them accurate when code changes.
- Never comment out code to toggle behaviour — delete it; version control
  keeps the history.

### Configuration
- Never hard-code credentials, secrets, tokens, or API keys. Read them from
  environment variables or an untracked secrets store.
- Keep configuration in dedicated config files, separate from code.
- Provide an example config file (e.g. `.env.example`) with dummy values only.
- Make file paths OS-independent (`path.join`, `Join-Path`) — this repo is
  used on Windows; never assume a path separator.

### Data management
- Treat any input/fixture data as read-only; never modify it in place.
- Use open, software-agnostic data formats.
- Generated outputs are disposable: code must regenerate them at any time.
- Never commit sensitive data. If a runnable example needs data, generate
  dummy data instead.

### Testing — required, not optional
- For every piece of core functionality, write unit tests in the same change.
  JavaScript: Jest or Vitest. PowerShell: Pester.
- Every bug fix ships with a regression test that fails before the fix.
- Add integration tests where modules interact, and at least one realistic
  end-to-end test for the main user flow.
- Test code is clean and readable; use fixtures, mocks, and parameterised
  (table-driven) cases to cut repetition. Tests are first-class code.

### Logging & error handling
- Failures and misuse must produce informative errors — never swallow errors
  with empty `catch` blocks or silent `$ErrorActionPreference` overrides.
- Log the configuration in effect when a run starts.
- If the code branches on decisions, log which path was taken.

### Dependency management
- Keep dependencies as few as possible; justify each new one.
- Pin dependencies and always commit the lockfile (`package-lock.json`).
- Pin the Node version (`.nvmrc` / `engines` in `package.json`); document
  required PowerShell version and modules.
- Separate runtime vs. dev dependencies (`dependencies` vs `devDependencies`).

### Version control hygiene
- Propose small, focused commits scoped to one discrete unit of work.
- Write clear commit messages: concise summary line plus a body explaining why.
- Never commit secrets, sensitive data, build output, or `node_modules`.

### Documentation deliverables
- Keep the README current: purpose, install steps, usage examples.
- Update the CHANGELOG (Keep a Changelog format) for any user-facing change.
- Document non-obvious assumptions next to the code that implements them.

---

## Definition of done — self-check before finishing any task

Before reporting a task complete, confirm:
1. Logic is modular, single-purpose, and free of needless repetition.
2. Names and style follow ESLint/Stylelint/PSScriptAnalyzer; no lint errors.
3. Every new exported function/module has JSDoc or comment-based help.
4. Unit tests exist and cover the new/changed behaviour (plus a regression
   test for any bug fix).
5. No secrets, credentials, or real sensitive data in code or config.
6. Errors are handled with informative messages; key decisions are logged.
7. New dependencies are minimal, justified, pinned, and the lockfile updated.
8. HTML/CSS changes preserve semantic markup and accessibility.
9. README / CHANGELOG updated if behaviour changed.

State explicitly which of these you have and have not satisfied, and why.

---

## Out of scope for you (team responsibility — do not fake these)

The Higher QA tier also requires process controls owned by the team, not by
code generation: formal peer review and pull-request records, pair
programming, an issue tracker with templated issues and acceptance criteria,
hosted auto-generated documentation, branching strategy, CI pipelines, and
formal user acceptance testing.

Do not pretend to perform these. When your change would normally trigger one,
say so — e.g. "this needs peer review before merge" or "add a CI job to run
these tests".
