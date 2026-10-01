#!/usr/bin/env node
/**
 * CLI wrapper around selectSupersededPrs() for use from workflow bash.
 *
 * Reads `gh pr list --json number,headRefName` from stdin, takes the current
 * report branch as argv[2], and prints one superseded PR number per line.
 *
 *   gh pr list --state open --limit 100 --json number,headRefName \
 *     | node .github/scripts/list-superseded-qa-prs.mjs "$BRANCH" \
 *     | while read -r pr_number; do gh pr close "$pr_number" ...; done
 *
 * Decision logic is unit-tested in test/superseded-qa-prs.test.mjs; this file
 * is a thin I/O shim, same convention as check-pr-exists.mjs.
 */

import { selectSupersededPrs } from './lib/superseded-qa-prs.mjs';

const currentBranch = process.argv[2] ?? '';
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  data += chunk;
});
process.stdin.on('end', () => {
  try {
    for (const prNumber of selectSupersededPrs(data, currentBranch)) {
      console.log(prNumber);
    }
  } catch (error) {
    // Exit non-zero so the workflow step (bash -e -o pipefail) fails visibly
    // instead of silently leaving stale report PRs open.
    console.error(`list-superseded-qa-prs: ${error.message}`);
    process.exitCode = 1;
  }
});
