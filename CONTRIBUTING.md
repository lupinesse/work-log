# Contributing to Work Log

## AI pair programming

This project is developed using **AI pair programming**: the human author (Jenni Järvinen)
directs the work, reviews every change, and makes all design decisions.
Claude (Anthropic) acts as an AI collaborator — drafting code, writing tests, catching bugs,
and improving documentation — with every output reviewed and approved before merging.

This matches the "pair programming used (together with another AI)" practice from the
[UK Government Higher QA checklist](https://best-practice-and-impact.github.io/qa-of-code-guidance/checklist_higher.html).

---

## Development Setup

### Prerequisites
- Node.js ≥ 22.12 (matches `engines` in `package.json`; `.nvmrc` pins the dev version)
- A text editor or IDE (VS Code recommended)
- Git

### Getting Started

1. **Clone or download the repository**
   ```bash
   git clone <repository-url>
   cd worklog
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```
   This runs `build.js` to concatenate source files and compile SCSS:
   - `src/js/*.js` → `script.js`
   - `src/css/styles.scss` → `styles.css`

4. **Start the development server**
   ```bash
   npm run dev
   ```
   Then open http://localhost:5173 in your browser

### Project Structure

```
worklog/
├── src/
│   ├── js/           # Source JavaScript modules (15 files)
│   │   ├── 01-state.js
│   │   ├── 02-utils.js
│   │   ├── 03-timer.js
│   │   └── ...
│   └── css/          # SCSS files (modular, compiled to styles.css)
│       ├── _base.scss
│       ├── _tasks.scss
│       └── ...
├── work-log.html     # Single-file HTML entry point
├── script.js         # Built JavaScript (generated)
├── styles.css        # Built CSS (generated)
├── smoke-tests.cjs   # Test suite
├── build.js          # Build script
└── package.json      # Dependencies
```

## Branching Strategy

The repository uses a trunk-based workflow with **no direct commits to `main`** — every change ships via a pull request. The full PR workflow (build/lint/test, `/pr-review`, ChatGPT-review triage, merge) is documented in `CLAUDE.md` Steps 1–7.

| Branch prefix | Use for | Example |
|---|---|---|
| `feature/` | New user-facing functionality | `feature/rapid-logging` |
| `fix/` | Bug fixes; reference the issue number when one exists | `fix/issue-11-commitlint` |
| `docs/` | Documentation-only changes (README, CONTRIBUTING, CHANGELOG, CLAUDE.md) | `docs/branching-strategy` |
| `refactor/` | Structural changes with no behaviour change | `refactor/split-render-monthly-log` |
| `chore/` | Build, tooling, dependency updates | `chore/bump-vite` |

- **`main`** is always releasable. CI runs on every PR; merge only when checks are green.
- **Feature branches** branch from `main` and merge back via squash-merge. Keep them short-lived (days, not weeks).
- **Releases** are tagged commits on `main` following [Semantic Versioning](https://semver.org/) (see `CHANGELOG.md`).

### Commit messages — Conventional Commits

Every commit must follow the [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/) spec. A Husky `commit-msg` hook (`.husky/commit-msg`) enforces this locally via [`@commitlint/config-conventional`](https://github.com/conventional-changelog/commitlint) — non-conformant messages are rejected before the commit lands.

```
<type>(<optional-scope>): <description>

<optional body — explain why, not what; wrap at 72 chars>

<optional footer — Refs #123, Closes #456, BREAKING CHANGE: …>
```

**Allowed types:** `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.

**Examples that pass:**

```
feat(rapid): add Space-bar capture overlay
fix: stop weather widget falling back to empty string on null response
docs(contributing): document branching strategy and conventional commits
chore(deps): bump vite to 8.0.14
```

**Examples that fail:**

```
Update README                  → missing type prefix
feat - add overlay             → wrong separator (must be ':')
WIP                            → not a recognised type
```

- **Subject line:** ≤ 72 characters, imperative mood, no full stop at the end.
- **Body:** wrap at 72 chars; explain *why* the change is needed, not *what* (the diff shows what).
- **Footer:** reference issues (`Refs #N`, `Closes #N`); use `BREAKING CHANGE:` for incompatible changes.

Do not use `--no-verify` to bypass the hook unless the user has explicitly approved.

### Other commit rules

- **Commit often** — each logical change is its own commit; avoid "big-bang" commits that mix unrelated changes.
- **Never commit secrets**: `config.local.ps1` is gitignored; API tokens must never be committed.
- **`.gitignore`** covers: `node_modules/`, `dist/`, `portable/`, `config.local.ps1`, `.env`, crash logs — update it before adding any new generated or sensitive file.

### Commit hygiene — one discrete unit of work

A **discrete unit of work** is a change that is independently understandable and reviewable:

- one bug fix (and its regression test)
- one new function or module
- one refactor step (rename, extract, move)
- one documentation update

**Bad examples — do not bundle:**

| What to avoid | Why |
|---|---|
| CSS fix + new feature + test in one commit | Impossible to revert the fix without losing the feature |
| Renaming a variable across 6 files + fixing an unrelated bug | The revert of one change carries the other |
| "WIP" or "various fixes" commit | Provides no information; makes `git bisect` unreliable |

**Staging selectively with `git add -p`**

When you've made several changes at once, use `git add -p` (patch mode) to stage individual hunks and split the work into focused commits before pushing:

```bash
git add -p src/js/05-entries.js   # choose which hunks to stage
git commit -m "fix: correct date key in buildDailyLogItems"
git add -p src/js/05-entries.js   # stage the remaining hunks
git commit -m "refactor: extract buildEntryHtml from renderEntries"
```

This is the primary tool for keeping the commit log readable on a solo project where you often make several related changes before stepping back to commit.

## Code Style Guidelines

### JavaScript
- **Naming**: camelCase for variables and functions
  ```javascript
  let activeTimer = null;           // ✓ Good
  let active_timer = null;          // ✗ Avoid
  ```

- **Functions**: Descriptive names, no abbreviations unless consistently used
  ```javascript
  function renderCalendarStrip(meetings) { }    // ✓ Good
  function renderCal(meetings) { }              // ✗ Unclear
  ```

- **Variables**: Prefix related variables with scope
  ```javascript
  let _cpEditId  = null;   // Checkpoint edit scope
  let _pendingCommentId = null;  // Pending comment scope
  ```

- **Comments**: Explain *why*, not *what*
  ```javascript
  // ✓ Good: explains decision
  // Strip malformed records instead of rejecting entire array
  entries = raw.filter(validEntry);
  
  // ✗ Bad: restates code
  // Filter entries to make sure they're valid
  entries = raw.filter(validEntry);
  ```

### CSS/SCSS
- **File organization**: One feature per file (e.g., `_tasks.scss`, `_timer.scss`)
- **Nesting**: Keep nesting shallow (max 3 levels)
- **Variables**: Define color variables at top of file
  ```scss
  $color-success: #1D9E75;
  $color-warning: #FFB830;
  ```

## Adding a Feature

### Step 1: Create the module (if needed)
If adding a major feature, create a new numbered file:
- `src/js/15-new-feature.js`

### Step 2: Add HTML (if UI changes needed)
- Edit `work-log.html` to add necessary elements
- Use semantic IDs and classes for targeting

### Step 3: Implement JavaScript
- Add functions to appropriate module
- Export via `window.__wl` object in `13-calendar.js` if needed for tests

### Step 4: Add styling
- Create or update SCSS file in `src/css/`
- Follow naming convention: `.new-feature-element`

### Step 5: Build and test
```bash
npm run build
npm run preview  # Test build output
node smoke-tests.cjs  # Run test suite
```

### Step 6: Add tests
- Update `smoke-tests.js` with test cases for new feature
- Aim for >95% test pass rate

### Step 7: Update documentation
- Update CHANGELOG.md (add to v-next section)
- Update README.md if user-facing feature

## Testing

### Run All Tests
```bash
node smoke-tests.cjs
```

### Test Categories Covered
- Page load and initialization
- Timer functionality (start, pause, resume, stop)
- Data persistence (save/load from localStorage)
- UI rendering and interactions
- Complex features (focus mode, pomodoro, calendar)
- Error handling and recovery

### Writing New Tests
Tests use Playwright for browser automation. Example:
```javascript
console.log('\nYour feature');
{
  const today = dk(new Date());
  const page = await freshPage(ctx);
  
  // Test setup
  await page.evaluate(() => {
    // Browser code here
  });
  
  // Assertions
  assert('Feature works', 
    await page.evaluate(() => expectedCondition));
  
  await page.close();
}
```

## Using the Issue Tracker

All bugs and feature requests should be filed as **GitHub Issues** before work begins. This keeps decisions transparent and acceptance criteria agreed on upfront.

### Reporting a bug
Use the **Bug report** template. Fill in the reproduction steps and at least one acceptance criterion — that criterion is what a reviewer will check when closing the issue.

### Requesting a feature
Use the **Feature request** template. Frame the request as a user story:

> As a [type of user], I want [goal] so that [reason].

This keeps the scope grounded in a real need rather than an implementation idea. Add acceptance criteria before starting work so the definition of done is clear.

### Acceptance criteria
Every issue should have at least one acceptance criterion — a specific, testable condition that must be true for the issue to be closed. Write them as checkboxes in the issue body. Copy them into the pull request description and tick them off as you verify each one.

## Pull Request Process

1. **Branch naming**: Use descriptive names
   - `feature/three-state-checkpoints`
   - `fix/calendar-timezone-bug`
   - `docs/update-readme`

2. **Commit messages**: Clear and descriptive
   ```
   Add three-state checkpoint toggle for partial progress tracking
   
   - Checkbox cycles through: not done → partial → done → not done
   - Partial state shows orange indicator with dash character
   - Data persists in planTasks[].checkpoints[].done as false/'partial'/true
   ```

3. **Before submitting**:
   - Run `npm run build`
   - Run `npm run lint` (no new errors)
   - Run `npm test` (must pass 100%)
   - Test manually in browser
   - Update CHANGELOG.md

4. **Description**: Explain
   - What the change does
   - Why it's needed
   - How it was tested

## Data Storage

Data persists in localStorage with versioned keys:

```javascript
wl_entries_v1         // Work log entries array
wl_timer_v1          // Active timer state
wl_plan_v1           // Today's tasks (with checkpoints)
wl_cats_v1           // Custom categories
wl_distractions_v1   // Distraction tracking
wl_pomoLog_v1        // Pomodoro session log
wl_handoff           // End-of-day handoff notes
```

**Important**: Version the key if changing data structure:
- Change `wl_entries_v1` to `wl_entries_v2` if schema changes
- Old data won't be accessible, but won't cause errors

## Performance Guidelines

- Render calls should complete in <100ms
- Keep functions <200 lines (break into smaller functions)
- Use efficient DOM selectors (avoid multiple scans)
- Batch DOM updates when modifying multiple elements

## Known Limitations

1. **Windows-only features**
   - Outlook calendar integration (requires Windows PowerShell)
   - Portable build (uses Windows-specific scripts)

2. **Timeouts**
   - Calendar API fetches every 10 minutes
   - Smoke tests may timeout on slow systems (increase timeout in smoke-tests.js)

3. **API Rate Limits**
   - nimipaivat.fi API has rate limits (fallback included)
   - Weather API has rate limits

## QA Standards

The following standards apply to all contributions. They reflect the processes that keep the codebase reliable for a single-developer, locally-run tool.

### What must pass before merging
| Check | Command | Standard |
|-------|---------|----------|
| Build | `npm run build` | No errors |
| Lint | `npm run lint` | No new errors introduced |
| Smoke tests | `npm test` | 100% pass rate |
| Manual test | Browser | Golden path and changed feature work as expected |

### When to write new tests
- Every bug fix should add a smoke-test case that would have caught it
- Every new user-facing feature should add at least one end-to-end test scenario

### Code review
- All changes go through a pull request, even on a solo project — it creates a record of decisions
- The PR description must reference the issue and confirm each acceptance criterion is met
- Self-review is acceptable; use the PR checklist in `.github/PULL_REQUEST_TEMPLATE.md`

### Community review
This is primarily a solo, AI-paired project, but the repository is public and MIT-licensed, and
outside review is genuinely welcome, not just tolerated:
- **Open a PR** for a bug fix or feature — it doesn't need to be perfect; the automated
  ChatGPT/Claude review dialogue (`CLAUDE.md` Step 5b) and the human maintainer will review it.
- **Open an issue** using the Bug report or Feature request template even if you don't plan to
  submit code — a second pair of eyes on the reproduction steps or the proposed acceptance
  criteria is itself a form of review, and is credited the same as a code contribution.
- **Comment on an open PR or issue** — questioning an assumption, an edge case, or an acceptance
  criterion before it merges is exactly the kind of review this checklist wants, and doesn't
  require write access to the repository.

### Accessibility
- New UI elements must be keyboard-reachable and have a visible focus state
- Interactive elements need descriptive labels (`aria-label` or visible text) for screen readers

### Security
- User-supplied text must be escaped through `escHtml()` before insertion into the DOM
- Colours from localStorage pass through `safeCssColor()` before use in `style` attributes
- API tokens live in `config.local.ps1` only — never committed to git

### Versioning and changelog
- Version numbers follow [Semantic Versioning](https://semver.org/)
- Every release updates `CHANGELOG.md` and creates a git tag matching the version

---

## Questions?

- Check existing code in `src/js/` for patterns
- Review smoke tests for expected behavior
- See ARCHITECTURE.md for module interactions

Thank you for contributing!
