#!/usr/bin/env node
/**
 * CLI wrapper around hasOpenPr() for use from workflow bash.
 *
 * Reads `gh pr list --json number` output from stdin and exits 0 if an open
 * PR already exists for the branch, exits 1 if none does. Bash usage:
 *
 *   if gh pr list --head "$BRANCH" --state open --json number \
 *        | node .github/scripts/check-pr-exists.mjs; then
 *     echo "PR already open"
 *   else
 *     gh pr create ...
 *   fi
 *
 * The decision logic itself (hasOpenPr) is unit-tested in
 * test/parse-pr-list.test.mjs; this file is a thin, untested I/O shim, same
 * convention as the rest of .github/scripts/.
 */

import { hasOpenPr } from './lib/parse-pr-list.mjs';

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  data += chunk;
});
process.stdin.on('end', () => {
  process.exit(hasOpenPr(data) ? 0 : 1);
});
