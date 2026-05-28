/**
 * commitlint — extends the standard Conventional Commits 1.0 config.
 *
 * Wired into git via the Husky `commit-msg` hook (`.husky/commit-msg`).
 * Allowed types, examples, and the full rule are documented in
 * CONTRIBUTING.md under "Commit messages — Conventional Commits" — keep
 * that section as the single source of truth, not this file.
 */
export default {
  extends: ['@commitlint/config-conventional'],
};
