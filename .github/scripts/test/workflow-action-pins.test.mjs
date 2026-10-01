/**
 * Regression tests for #503: every third-party action in the PR-review
 * workflows must be pinned to a full-length commit SHA, because a floating
 * tag (e.g. `@v7`) can be re-pointed without any review.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const workflowsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'workflows'
);
const PINNED_WORKFLOWS = ['chatgpt-pr-review.yml', 'pr-review.yml'];
const PINNED_USES_PATTERN = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;

/**
 * Extracts the value of every `uses:` step key in a workflow file.
 *
 * @param {string} workflowFileName - File name inside .github/workflows.
 * @returns {string[]} The `uses:` values, trailing comment included.
 */
function readUsesValues(workflowFileName) {
  const source = readFileSync(path.join(workflowsDirectory, workflowFileName), 'utf8');
  return [...source.matchAll(/^[ \t-]*uses:[ \t]*(.+)$/gm)].map((match) => match[1].trim());
}

describe('workflow action pinning (#503)', () => {
  for (const workflowFileName of PINNED_WORKFLOWS) {
    test(`${workflowFileName} has at least one action reference`, () => {
      assert.ok(readUsesValues(workflowFileName).length > 0);
    });

    test(`${workflowFileName} pins every action to a 40-char SHA with a version comment`, () => {
      const unpinned = readUsesValues(workflowFileName).filter(
        (value) => !PINNED_USES_PATTERN.test(value)
      );
      assert.deepEqual(unpinned, []);
    });
  }
});
