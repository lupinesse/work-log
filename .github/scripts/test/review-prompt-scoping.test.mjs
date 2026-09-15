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
 * Instruction files are **discovered**, not listed: the bug was a rule nobody
 * noticed was unqualified, so a hard-coded list of files to check would miss
 * the next one added. A new prompt is therefore covered by default, and the
 * only way out is an explicit entry in `EXAMPLE_ONLY_FILES` below.
 *
 * Run: node --test .github/scripts/test/review-prompt-scoping.test.mjs
 */

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * Files whose `wlLog` mentions are illustrative, not rules to enforce.
 *
 * Both quote a sample reply an agent might write ("e.g. \"Will replace the
 * silent catch with wlLog.warn at line 73\"") rather than instructing the
 * reviewer to demand `wlLog`. Kept as an explicit exemption so the scan
 * stays opt-out: anything not named here must qualify the rule.
 */
const EXAMPLE_ONLY_FILES = [
  path.join('.github', 'scripts', 'claude-chatgpt-dialogue.mjs'),
  path.join('.github', 'scripts', 'chatgpt-claude-dialogue.mjs'),
];

/**
 * Lists candidate instruction files: prompts sent to a reviewer and the
 * skill definitions a reviewer follows.
 *
 * `.github/scripts/test/` is excluded — this suite quotes the rule text it
 * asserts on, and would otherwise flag itself.
 *
 * @returns {string[]} Repo-relative paths, in directory order.
 */
function instructionFiles() {
  const scriptsDir = path.join(repoRoot, '.github', 'scripts');
  const scripts = fs
    .readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => path.join('.github', 'scripts', entry.name));

  const skillsDir = path.join(repoRoot, '.claude', 'skills');
  const skills = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join('.claude', 'skills', entry.name, 'SKILL.md'))
    .filter((relativePath) => fs.existsSync(path.join(repoRoot, relativePath)));

  return [...scripts, ...skills];
}

/**
 * Splits instruction text into statements and returns those naming `needle`.
 *
 * The qualifier and the rule have to sit in the same statement, not merely in
 * the same file — a `src/js/` mention paragraphs away would not stop a
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

const candidates = instructionFiles();
const statingTheRule = candidates.filter((relativePath) => {
  if (EXAMPLE_ONLY_FILES.includes(relativePath)) {
    return false;
  }
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').includes('wlLog.warn');
});

describe('reviewer instructions scope the wlLog rule to src/js/', () => {
  test('the scan actually found instruction files to check', () => {
    assert.ok(candidates.length > 0, 'discovered candidate instruction files');
    assert.ok(
      statingTheRule.length > 0,
      'at least one file still states the wlLog rule — if this fails the rule moved, ' +
        'and this suite is guarding nothing'
    );
  });

  for (const relativePath of EXAMPLE_ONLY_FILES) {
    test(`${relativePath} is exempt and still exists`, () => {
      // An exemption that outlives its file would silently widen the hole.
      assert.ok(
        fs.existsSync(path.join(repoRoot, relativePath)),
        'exempt file still exists — otherwise drop it from EXAMPLE_ONLY_FILES'
      );
    });
  }

  for (const relativePath of statingTheRule) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    const ruleStatements = statementsMentioning(source, 'wlLog.warn');

    test(`${relativePath} names src/js/ wherever it asks for wlLog`, () => {
      assert.ok(ruleStatements.length > 0, 'found the statement stating the rule');

      for (const statement of ruleStatements) {
        assert.match(statement, /src\/js\//, 'the rule names the tree it applies to');
      }
    });

    test(`${relativePath} says CI scripts use console.error instead`, () => {
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
