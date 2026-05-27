---
name: qa-review
description: >-
  Weekly quality-assurance audit. Inspects the repository against the "Higher"
  quality-assurance checklist from the Quality Assurance of Code for Analysis
  and Research guidance (the "Duck Book"), scores every item with evidence, and
  writes a dated report to docs/qa-reports/. Use when asked to run a QA review,
  quality check, code audit, or the weekly quality review.
allowed-tools: >-
  Read, Grep, Glob, Write,
  Bash(git log:*), Bash(git branch:*), Bash(git tag:*), Bash(git status:*),
  Bash(git remote:*), Bash(git rev-parse:*), Bash(ls:*), Bash(find:*),
  Bash(cat:*), Bash(head:*), Bash(test:*), Bash(wc:*)
---

# Weekly QA Review

You are running a scheduled quality-assurance audit of this repository. Your job
is to honestly assess the code against the checklist below, write a dated
report, and flag anything that has regressed since the last review. The goal is
to keep quality consistent over time — so accuracy matters more than a high
score. Do not inflate ratings.

## How to run the review

### Step 1 — Establish context

- Get the current state: `git rev-parse --short HEAD`, `git branch --show-current`,
  `git log -1 --format=%cd --date=short`.
- Look in `docs/qa-reports/` for the most recent existing report. If one exists,
  read it — you will diff against it in the report's "Regressions" section.
  If the directory does not exist, create it; this is the first review.
- Detect the stack (Python, R, JS, etc.) from files like `pyproject.toml`,
  `requirements.txt`, `DESCRIPTION`, `package.json`. Apply the relevant
  language conventions when judging style and documentation items.

### Step 2 — Audit every item

For each item in the checklist below, inspect the repo and assign **one** status:

- ✅ **Met** — clear evidence the item is satisfied.
- ⚠️ **Partial** — partially done, or done inconsistently.
- ❌ **Not met** — no evidence, or clearly violated.
- ➖ **N/A** — genuinely does not apply (explain why).

Every judgement must rest on **evidence** — a file path, a config entry, a git
fact. Never guess. If you cannot verify an item, mark it ⚠️ and state what is
missing. Keep notes to one or two sentences.

### Step 3 — Write the report

Write the report to `docs/qa-reports/qa-review-<YYYY-MM-DD>.md` using today's
date. This is the **only** file you may create or modify. Use this structure:

```
# QA Review — <YYYY-MM-DD>

- Commit: <short-sha> on `<branch>`
- Checklist: Higher quality assurance (Duck Book)
- Reviewer: Claude Code (automated weekly QA review)

## Scoreboard

| Status        | Count |
|---------------|-------|
| ✅ Met        |   N   |
| ⚠️ Partial    |   N   |
| ❌ Not met    |   N   |
| ➖ N/A        |   N   |

## Regressions since last review (<prev date, or "none — first review">)

List any item that dropped from ✅ to ⚠️/❌, or ⚠️ to ❌. If none, say so.

## Improvements since last review

List any item that rose in status. If none, say so.

## Priorities for this week

1–5 highest-impact items to fix next, most important first, each with a concrete
next step.

## Full results

One section per checklist heading below, each as a table:

| Item | Status | Evidence / notes |
|------|--------|------------------|
```

### Step 4 — Print a summary

After writing the file, print a short summary to the terminal: the scoreboard
counts, the number of regressions, and the top 3 priorities. Link the report path.

## Rules

- **Read-only.** Do not modify code, configs, tests, or documentation. The dated
  report file is the only thing you write.
- **Do not fix anything.** This is an audit. If the user wants fixes, they will
  ask in a separate session.
- Cite specific file paths. Be concise and specific over comprehensive prose.
- When in doubt, score lower and flag it. An honest ⚠️ is more useful than an
  optimistic ✅.

---

## Checklist — Higher quality assurance

### Modular code

- [ ] Individual pieces of logic are written as functions; classes are used where more appropriate.
- [ ] Code is grouped into themed files (modules) and packaged for easier use.
- [ ] Main analysis scripts import and run high-level functions from the package.
- [ ] Low-level functions and classes each carry out one specific task — only one reason to change each.
- [ ] Repetition is minimised; reusable code is moved into functions or classes.
- [ ] Objects and functions are open for extension but closed for modification.
- [ ] Subclasses retain parent-class behaviour while adding new functionality; a parent can be replaced by a subclass and still work.

### Good coding practices

- [ ] Names in the code are informative and concise.
- [ ] Names are explicit rather than implicit.
- [ ] Code logic is clear and avoids unnecessary complexity.
- [ ] Code follows a standard style (e.g. PEP8 for Python; Google or tidyverse for R). Check for a linter/formatter config.

### Project structure

- [ ] A clear, standard directory structure separates input data, outputs, code, and documentation.
- [ ] Packages follow a standard structure.

### Code documentation

- [ ] Comments explain *why* code is written a certain way, not *what* it does.
- [ ] Comments are up to date and not misleading.
- [ ] Code is not commented out to control which lines run.
- [ ] All functions and classes are documented — purpose, inputs, and returns.
- [ ] Python code uses docstrings; R code uses roxygen2 comments.
- [ ] Human-readable (preferably HTML) documentation is generated automatically from code documentation.
- [ ] Documentation is hosted for easy access (e.g. GitHub Pages, Read the Docs).

### Project documentation

- [ ] A README covers the project's purpose, basic installation, and usage examples.
- [ ] Where appropriate, contributor guidance and a code of conduct exist.
- [ ] Desk instructions guide lead users through example use cases where users are unfamiliar with the code.
- [ ] The extent of analytical QA conducted is clearly documented.
- [ ] Assumptions and their quality are documented next to the code implementing them, and made available to users.
- [ ] Copyright and licences are specified for both documentation and code.
- [ ] Instructions for citing the project are given.
- [ ] Releases used for reports/publications are versioned with a standard pattern (e.g. semantic versioning).
- [ ] A changelog summarises functionality changes following releases and is available to users.
- [ ] Example usage of the package and underlying functionality is documented for developers and users.
- [ ] Design certificates confirm the design is compliant with requirements (if applicable).
- [ ] If appropriate, the software is fully specified.

### Version control

- [ ] Code is version controlled using Git.
- [ ] Code is committed regularly, preferably per discrete unit of work.
- [ ] An appropriate branching strategy is defined and used.
- [ ] Code is open-sourced; sensitive data is omitted or replaced with dummy data.
- [ ] Committing standards are followed (appropriate commit summary and message).
- [ ] Commits are tagged at significant stages to mark releases or model versions.
- [ ] Continuous integration is applied (e.g. GitHub Actions) so each change integrates smoothly.

### Configuration

- [ ] Credentials and secrets are not in code; they are configured as environment variables.
- [ ] Configuration lives in a dedicated config file, separate from the code.
- [ ] Where appropriate, multiple config files are used per system/local/user.
- [ ] Config files are version controlled separately from analysis code so they can be updated independently.
- [ ] The configuration used to generate particular outputs, releases, and publications is recorded.
- [ ] Example configuration templates are provided alongside the code, without real data.

### Data management

- [ ] Published outputs meet accessibility regulations.
- [ ] Analysis data is stored in an open format so no specific software is required to read it.
- [ ] Input data is stored safely and treated as read-only.
- [ ] Input data is versioned; changes create new versions or new records.
- [ ] All input data is documented in a data register (origin and importance to the analysis).
- [ ] Outputs are disposable — regularly deleted and regenerated; the code can reproduce them at any time.
- [ ] Non-sensitive data (or dummy data, if sensitive) is available so others can run the code.
- [ ] Data quality is monitored, per the government data quality framework.
- [ ] Fields in input and output datasets are documented in a data dictionary.
- [ ] Large or complex data is stored in a database.
- [ ] Data is documented in an information asset register.

### Peer review

- [ ] Peer review is conducted and recorded near the code; merge/pull requests document review where relevant.
- [ ] Pair programming is used to review code and share knowledge.
- [ ] Users are encouraged to participate in peer review.

### Testing

- [ ] Core functionality is unit tested as code (e.g. pytest for Python, testthat for R).
- [ ] Code-based tests are run regularly and after every significant change.
- [ ] Bug fixes add new unit tests so the same bug cannot recur.
- [ ] Informal tests are recorded near the code.
- [ ] Stakeholder or user-acceptance sign-offs are recorded near the code.
- [ ] Tests are run and recorded automatically via continuous integration or git hooks.
- [ ] The whole process is tested end to end with one or more realistic tests.
- [ ] Test code is clean and readable; fixtures and parameterisation reduce repetition.
- [ ] Formal user-acceptance testing is conducted and recorded.
- [ ] Integration tests confirm multiple units work together as expected.

### Dependency management

- [ ] Required passwords, secrets, and tokens are documented but stored outside version control.
- [ ] Required libraries and packages are documented, including versions.
- [ ] Working operating-system environments are documented.
- [ ] Example configuration files are provided.
- [ ] Where appropriate, code runs independently of the operating system (e.g. safe file-path handling).
- [ ] Dependencies are managed separately for users, developers, and testers.
- [ ] There are as few dependencies as possible.
- [ ] Package dependencies are managed with an environment manager (e.g. virtualenv for Python, renv for R).
- [ ] Docker containers or VM builds for the execution environment exist and are version controlled.

### Logging

- [ ] Misuse or failure produces informative error messages.
- [ ] Code configuration is recorded when the code runs.
- [ ] The pipeline route is recorded when decisions are made in code.

### Project management

- [ ] Roles and responsibilities of team members are clearly defined.
- [ ] An issue tracker (e.g. GitHub Projects, Trello, Jira) records development tasks.
- [ ] New issues/tasks are guided by users' needs and stories.
- [ ] Issue templates ensure proper logging of title, description, labels, and comments.
- [ ] Acceptance criteria are noted for issues/tasks, and their fulfilment is recorded.
- [ ] QA standards and processes for the project are defined, based on the Duck Book guidance.
