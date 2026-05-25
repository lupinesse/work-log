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
| Core functionality unit tested | ✅ Pass | `test/unit.cjs` — 110 tests across 13 describe blocks |
| Informal tests recorded near the code | ✅ Pass | `@example` JSDoc tags on all pure functions in `00-pure-fns.js` |
| Stakeholder sign-off recorded | ✅ Pass | This document |
| Formal user acceptance testing (by another AI) | ✅ Pass | `smoke-tests.cjs` — 160+ Playwright tests run by AI pair reviewer |
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

*This document is maintained per-release. Future releases should add a new dated section.*
