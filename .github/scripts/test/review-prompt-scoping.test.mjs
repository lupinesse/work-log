/**
 * Regression tests for the reviewer instructions that mention `wlLog`.
 *
 * `wlLog` is a browser global defined in `src/js/00-config.js` and bundled
 * into the page. It is not reachable from Node, so it is wrong for the CI
 * scripts under `.github/scripts/`, which use `console.error`.
 *
 * Both reviewer prompts stated the rule unqualified. On PR #422 that produced
 * a 🔴 *blocking* finding demanding `console.error` in
 * `check-arrow-param-count.mjs` be replaced with `wlLog.error` — a change that
 * would throw ReferenceError and break the check — and, because it filed as
 * blocking, failed the merge gate until it was resolved by hand (#424).
 *
 * These assert the qualification survives future edits to the prompt text.
 *
 * Run: node --test .github/scripts/test/review-prompt-scoping.test.mjs
 */

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** Files that instruct a reviewer and mention `wlLog` as a rule to enforce. */
const REVIEWER_INSTRUCTIONS = [
  path.join('.github', 'scripts', 'chatgpt-review.mjs'),
  path.join('.claude', 'skills', 'pr-review', 'SKILL.md'),
];

/**
 * Splits instruction text into statements and returns those naming `needle`.
 *
 * The qualifier and the rule have to sit in the same instruction, not merely
 * in the same file — a `src/js/` mention paragraphs away would not stop a
 * reviewer applying the rule to a CI script, and `chatgpt-review.mjs` is
 * itself a Node script full of `console.error` calls, so a file-wide search
 * would pass even with the rule left completely unqualified.
 *
 * @param {string} source - Full text of the instruction file.
 * @param {string} needle - Substring identifying the statement of interest.
 * @returns {string[]} Statements containing `needle`, in source order.
 */
function statementsMentioning(source, needle) {
  return source.split(/\n\n|(?<=[.?])\s/).filter((chunk) => chunk.includes(needle));
}

describe('reviewer instructions scope the wlLog rule to src/js/', () => {
  for (const relativePath of REVIEWER_INSTRUCTIONS) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

    test(`${relativePath} names src/js/ wherever it asks for wlLog`, () => {
      assert.ok(source.includes('wlLog.warn'), 'precondition: this file still states the rule');

      const ruleStatements = statementsMentioning(source, 'wlLog.warn');
      assert.ok(ruleStatements.length > 0, 'found the statement stating the rule');

      for (const statement of ruleStatements) {
        assert.match(statement, /src\/js\//, 'the rule names the tree it applies to');
      }
    });

    test(`${relativePath} says CI scripts use console.error instead`, () => {
      const ruleStatements = statementsMentioning(source, 'wlLog.warn');
      assert.ok(ruleStatements.length > 0, 'found the statement stating the rule');

      for (const statement of ruleStatements) {
        assert.match(statement, /\.github\/scripts\//, 'the rule names the CI script tree');
        assert.match(statement, /console\.error/, 'the rule names what those scripts use');
      }
    });

    test(`${relativePath} no longer states the rule unqualified`, () => {
      // The exact phrasings that caused the false blocking finding on #422.
      assert.doesNotMatch(source, /use wlLog\.warn\/error — never silent catch/);
      assert.doesNotMatch(source, /follow project conventions \(`wlLog\.warn`\/`wlLog\.error`\)\?/);
    });
  }
});
