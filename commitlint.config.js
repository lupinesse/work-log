/**
 * commitlint configuration — enforces Conventional Commits on every commit.
 *
 * Extends `@commitlint/config-conventional` which provides the standard
 * Conventional Commits 1.0 spec: type, optional scope, colon, description.
 *
 * Allowed types (from the conventional config):
 *   build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test
 *
 * Examples that pass:
 *   feat(rapid): add Space-bar capture overlay
 *   fix: stop weather widget falling back to empty string on null response
 *   docs(contributing): document branching strategy
 *
 * Examples that fail:
 *   Update README                  → missing type prefix
 *   feat - add overlay             → wrong separator (must be ':')
 *   WIP                            → not a recognised type
 *
 * Run manually:
 *   echo "feat: add foo" | npx commitlint
 *
 * The Husky `commit-msg` hook (`.husky/commit-msg`) wires this into git so
 * every local commit is validated automatically.
 */
export default {
  extends: ['@commitlint/config-conventional'],
};
