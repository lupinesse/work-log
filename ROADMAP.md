# Roadmap

Planned and in-progress work. See [CHANGELOG.md](CHANGELOG.md) for what has already shipped.

## In preparation (Unreleased → next release)

The following are merged to `main` and accumulating in the **Unreleased** section of CHANGELOG.md, targeting the next version release:

| Feature | Notes |
|---------|-------|
| Today's Flow unified section | Replaces separate Timeblock + Daily Log tabs; three views: Flow / Log / Blocks |
| Hero Card: last-note reference line | "↳ last note X min ago" shown on running/paused panels; `fmtAgo()` added |
| Hero Card: category quick-switch | Faint ▾ caret on category row opens a keyboard-accessible picker panel |
| Header almanac redesign | Almanac-led 3-column layout; session chip replaces tracking-first centre column |
| Auto start-of-day on first task | First task timer silently records SoD if not already started |
| Upcoming task carry fix | `upcoming → inprogress` no longer reverts to `upcoming` on reload |
| CI review pipeline improvements | ChatGPT/Claude dialogue token budget, Phase 4 audit trail, `pa11y` a11y CI |

## Recently shipped

| Version | Feature |
|---------|---------|
| v1.8.8–v1.8.9 | Cool-palette redesign; focus/mood dropdown overflow fix; 24 Notion unit tests |
| v1.8.4–v1.8.7 | BuJo suite (rapid logging, signifiers, daily log, monthly log, migration, trackers, sprints), Hero Card, security hardening |
| v1.8.0–v1.8.3 | Quick Capture modal, SVG arc Pomodoro, JSDoc, Stylelint, automated QA review |

## Planned

| Feature | Priority | Notes |
|---------|----------|-------|
| — | — | Add planned items here as they are decided |

---

*Update this file when work starts or finishes. See [CONTRIBUTING.md](CONTRIBUTING.md) for the branching and PR workflow.*
