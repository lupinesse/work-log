# Work Log — QA & Acceptance Record

This document records the quality-assurance process, stakeholder sign-offs, and
acceptance decisions for each release. It satisfies the "Stakeholder sign-off
recorded" requirement of the UK Government Higher QA checklist.

---

## v1.8.0 — 2026-05-26

### QA checklist

Assessed against: [Best Practice and Impact — Higher QA checklist](https://best-practice-and-impact.github.io/qa-of-code-guidance/checklist_higher.html)

Full scored assessment: see `CODE_QUALITY_ASSESSMENT.md`.

| Checklist item | Status | Evidence |
|---|---|---|
| High-level scripts import from package | ✅ Pass | `build-config.js` shared by all three build scripts |
| Open for extension, closed for modification | ✅ Pass | MIGRATIONS append-only; colour palette extends via fallback |
| Subclass / LSP | N/A | Functional style — no inheritance hierarchy used |
| Packages follow a standard structure | ✅ Pass | Documented in `CONTRIBUTING.md` |
| Assumptions documented next to code | ✅ Pass | `Assumption:` blocks in 00-pure-fns.js, 02-utils.js, 05-entries.js, 07-lifecycle.js, 11-timeblock.js |
| Design certificates | ✅ Pass | Certificate table in `ARCHITECTURE.md` |
| Full specification | ✅ Pass | `DATA.md` (data dictionary) + `ARCHITECTURE.md` (module map) |
| Config files versioned separately | ✅ Pass | `config.local.example.ps1` committed; actual config gitignored |
| Config used for specific outputs recorded | ✅ Pass | `scripts/config-snapshot.cjs` appended to every GitHub Release |
| Published outputs meet accessibility regulations | ✅ Pass | Lighthouse CI: a11y ≥ 85%, best-practices ≥ 85%, perf ≥ 70% |
| Input data versioned | ✅ Pass | `src/js/01b-migrate.js` — append-only schema migration log |
| Outputs disposable and reproducible | ✅ Pass | Deterministic vite build; `dist/` and `portable/` are gitignored |
| Data quality monitored | ✅ Pass | `wlLog.warn()` on every dropped record in all four load functions |
| Large/complex data in a database | N/A | localStorage is appropriate scale for a personal single-user tool |
| Data in information asset register | ✅ Pass | `DATA.md` — full localStorage schema dictionary |
| Pair programming used (together with another AI) | ✅ Pass | Recorded in `CITATION.cff` and `CONTRIBUTING.md` |
| Core functionality unit tested | ✅ Pass | `test/unit.cjs` — 110 tests across 13 describe blocks (133 / 16 blocks as of v1.8.4) |
| Informal tests recorded near the code | ✅ Pass | `@example` JSDoc tags on all pure functions in `00-pure-fns.js` |
| Stakeholder sign-off recorded | ✅ Pass | This document |
| Formal user acceptance testing (by another AI) | ✅ Pass | `smoke-tests.cjs` — 160+ Playwright tests run by AI pair reviewer (211 as of v1.8.4) |
| Integration tests | ✅ Pass | `smoke-tests.cjs` wired into `npm test` |
| Code runs cross-platform where appropriate | ✅ Pass | `path.join()` throughout; `launch.sh` for Linux/Mac |
| Dependencies managed separately for users/devs/testers | ✅ Pass | All in `devDependencies`; no runtime deps (browser app) |
| Environment manager used | ✅ Pass | `.devcontainer/devcontainer.json` with Node 20 pinned |
| Docker / VM builds available | ✅ Pass | Dev container image: `mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm` |
| Configuration recorded when code runs | ✅ Pass | `wlLog.config()` logs version, counts, and feature state at startup |

### Stakeholder acceptance

| Field | Value |
|---|---|
| Accepted by | Jenni Järvinen (sole author and user) |
| Date | 2026-05-26 |
| Scope | v1.8.0 — all features listed in `CHANGELOG.md § v1.8.0` |
| Method | Manual exploratory testing of all major features on Windows 11 / Chrome |
| AI co-reviewer | Claude Sonnet 4.6 (pair review of code, tests, and documentation) |
| Outcome | **Accepted** — app meets personal requirements; QA checklist satisfied |
| Outstanding known issues | `color-contrast` and `font-size` Lighthouse audits score below 100% (secondary text uses intentionally muted colours for visual hierarchy; not affecting usability for the primary user) |

---

## v1.8.5–v1.8.9 — 2026-05-27 / 2026-05-28

### Changes since v1.8.4

| Release | Key changes |
|---|---|
| v1.8.5 | Quick Capture modal redesigned (QC_FinalV3); `_qcRenderTaskList` split into three single-purpose functions; smoke tests added for filter chips and running strip |
| v1.8.6 | Hero Card unified timer state machine (Variant C) with four CSS-panel states; legacy compat IDs preserved |
| v1.8.7 | Anthropic API key moved server-side; `connect-src` CSP tightened; `localStorage` migration added |
| v1.8.8 | Hero Card overflow fix (mood dropdown no longer clipped); 24 unit tests for `15-notion.js`; mood-dropdown smoke test added |
| v1.8.9 | Cool-palette design refresh; new CSS custom property tokens (`--in-progress`, `--jira`); ESM refactoring (`00-pure-fns.js` → `pure-fns.js`, `logger.js` extracted) |

### QA checklist delta

All items from the v1.8.4 checklist remain ✅ Pass. Changes and additions:

| Checklist item | Status | Evidence |
|---|---|---|
| Core functionality unit tested | ✅ Pass | `test/unit.mjs` (renamed from `test/unit.cjs` in v1.8.9 ESM refactor) — **397 tests across 57 suites** |
| Formal user acceptance testing | ✅ Pass | `smoke-tests.cjs` — **282 Playwright tests** across 43 sections |
| Total test count | ✅ Pass | **679 tests** (397 unit + 282 smoke); up from 344 at v1.8.4 |
| Informal tests recorded near code | ✅ Pass | `@example` JSDoc tags on core pure functions in `pure-fns.js` (renamed from `00-pure-fns.js`) |
| No credentials in code | ✅ Pass | Anthropic key moved to server-side proxy in v1.8.7 (closes #33); `connect-src` CSP removed direct `api.anthropic.com` access |
| All functions and classes documented | ✅ Pass | `npm run docs` exits with 0 errors and 0 warnings as of `fix/jsdoc-type-tag-descriptions` |
| Commits tagged at significant stages | ✅ Pass | All releases v1.0.0–v1.8.9 have annotated git tags |
| ARCHITECTURE.md design certificate | ✅ Pass | Updated to `Covers app version: v1.8.9`, `Last reviewed: 2026-05-29` |

### Stakeholder acceptance

| Field | Value |
|---|---|
| Accepted by | Jenni Järvinen (sole author and user) |
| Date | 2026-05-28 |
| Scope | v1.8.5–v1.8.9 — all features listed in `CHANGELOG.md §§ v1.8.5–v1.8.9` |
| Method | Automated suite (679 tests: 397 unit + 282 smoke) + manual spot-check on Windows 11 / Chrome |
| AI co-reviewer | Claude Sonnet 4.6 (pair review of Hero Card, Quick Capture, ESM refactoring, API key migration) |
| Outcome | **Accepted** — all 679 tests passing; design certificate updated; no regressions |
| Outstanding known issues | `QA.md` test counts were stale from v1.8.4 until this update; resolved here |

---

*This document is maintained per-release. Future releases should add a new dated section.*

---

## v1.8.1–v1.8.4 — 2026-05-26 / 2026-05-27

### Changes since v1.8.0

| Release | Key changes |
|---|---|
| v1.8.1 | Timezone bug fix in `dk()`; `fmtDur` extracted; empty catches replaced with `wlLog.warn()`; dead functions removed |
| v1.8.2 | Backup import integrated into Start of Day; forced hourly break removed; TDZ crash fix; `validateBackupFile` extracted as pure function |
| v1.8.3 | `.nvmrc` added; duplicate formatters consolidated; JSDoc added to all BuJo modules; Stylelint added; `DATA.md` updated with new BuJo fields |
| v1.8.4 | Test suite streamlined (344 total: 133 unit + 211 smoke); `freshPage()` wait optimised; 31 redundant smoke tests removed; automated weekly QA review added |

### QA checklist delta

All items from the v1.8.0 checklist remain ✅ Pass. Additional items addressed:

| Checklist item | Status | Evidence |
|---|---|---|
| All functions and classes documented | ✅ Pass | JSDoc added to all 8 BuJo modules (16-rapid through 23-sprints) in v1.8.3 |
| `DATA.md` up to date | ✅ Pass | 5 new entry fields and 5 new localStorage keys added |
| Test counts accurate in documentation | ✅ Pass | ARCHITECTURE.md and QA.md updated to 133 unit + 211 smoke = 344 total |
| Automated QA review | ✅ Pass | `weekly-qa-review.yml` CI workflow; first report at `docs/qa-reports/qa-review-2026-05-27.md` |
| Version tag present | ✅ Pass | `v1.8.4` annotated git tag created |

### Stakeholder acceptance

| Field | Value |
|---|---|
| Accepted by | Jenni Järvinen (sole author and user) |
| Date | 2026-05-27 |
| Scope | v1.8.1–v1.8.4 — all features listed in `CHANGELOG.md §§ v1.8.1–v1.8.4` |
| Method | Automated smoke test suite (211 Playwright tests) + manual spot-check of BuJo features on Windows 11 / Chrome |
| AI co-reviewer | Claude Sonnet 4.6 (QA audit, test streamlining, documentation updates) |
| Outcome | **Accepted** — all 344 tests passing; first automated QA report filed; no regressions |
| Outstanding known issues | Node version inconsistency (`.nvmrc` = 24.15.0, CI = Node 20, devcontainer = Node 20) — tracked in `docs/qa-reports/qa-review-2026-05-27.md` priority 5 |
