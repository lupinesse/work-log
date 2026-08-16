/**
 * @file _helpers.mjs
 * Shared fixtures for test/unit/*.test.mjs, extracted from the former
 * monolithic test/unit.mjs (issue #334). __dirname is exported so every
 * sandbox-loading test file can resolve src/js/ paths without repeating
 * the dirname(fileURLToPath(import.meta.url)) boilerplate.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const __dirname = dirname(fileURLToPath(import.meta.url));

export function localDate(y, m, d, hh = 0, mm = 0, ss = 0) {
  return new Date(y, m - 1, d, hh, mm, ss, 0);
}

export function localMs(y, m, d, hh = 0, mm = 0, ss = 0) {
  return localDate(y, m, d, hh, mm, ss).getTime();
}

/**
 * Reads the pure-fns sub-modules as classic-script source for the VM sandboxes.
 * pure-fns.js is a barrel of `export { … } from …` re-exports, which are not
 * valid classic-script syntax, so the sandboxes concatenate the sub-modules
 * instead and strip the ESM import lines and `export` declaration prefixes.
 * @returns {string} Concatenated pure-fns source, safe for vm.runInContext.
 */
export function loadPureFnsScriptSource() {
  return (
    ['pure-fns-format.js', 'pure-fns-validate.js', 'pure-fns-tasks.js', 'pure-fns-export.js']
      .map((f) => readFileSync(join(__dirname, '../../src/js/' + f), 'utf8'))
      .join('\n')
      .replace(/^import\s[^;]*;\s*$/gm, '') // single-line imports only; all sub-module imports are single-line
      // eslint-disable-next-line security/detect-unsafe-regex -- strips export keywords from our own pure-fns source; trusted input, no nested quantifiers
      .replace(/^export ((?:async\s+)?(?:const|function|let|class))\b/gm, '$1')
  );
}
