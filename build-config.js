/**
 * @file build-config.js
 * Shared build-time constants imported by build.js, build-portable.js, and
 * deploy-portable.js.  Change a path here and all three scripts stay in sync.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/** Source directory for JS modules. */
export const JS_SRC = 'src/js';

/** Source entry-point for SCSS (imports partials). */
export const CSS_SRC = 'src/css/styles.scss';

/** Generated JS entry module (checked into repo for vite to pick up). */
export const JS_OUT = 'script.js';

/** Generated CSS (compiled from SCSS). */
export const CSS_OUT = 'styles.css';

/** HTML shell that build-portable.js inlines CSS + JS into. */
export const HTML_IN = 'work-log.html';

/** Output directory for the portable (self-contained) build. */
export const PORTABLE_OUT = 'portable';

/** PowerShell API server script copied into the portable build. */
export const PS_SERVER = 'start-server.ps1';

/** Local config file copied into the portable build if it exists. */
export const PS_CONFIG = 'config.local.ps1';

/** Sub-folder inside the portable build that holds JSON backups. */
export const BACKUPS_DIR = 'JSON backups';

/** File that remembers the last deploy-portable destination (gitignored). */
export const DEST_FILE = '.portable-dest';

/**
 * Leaf ES modules imported at the top of script.js and inlined first in the
 * portable build (leaf modules first, then others). Excluded from the main
 * concatenation step in all build scripts.
 * `app-constants.js` has no dependencies on anything else in the list, so its
 * position doesn't matter. The pure-fns sub-modules must precede the
 * pure-fns.js barrel, though: order matters for the portable build, which
 * inlines files in list order, and the barrel strips down to comments only —
 * the sub-modules that actually declare the functions must already be in
 * scope when later files run. `date-labels.js` imports `dk` from
 * `pure-fns.js`, so it's listed after it too (not strictly required — `dk`
 * is a hoisted function declaration — but keeps declaration order matching
 * dependency order for readability).
 * Change the list here — build.js, vite.config.js, and build-portable.js all
 * import from this single source of truth.
 */
export const LEAF_MODULES = [
  'app-constants.js',
  'logger.js',
  'pure-fns-epics.js',
  'pure-fns-export.js',
  'pure-fns-format.js',
  'pure-fns-tasks.js',
  'pure-fns-validate.js',
  'pure-fns.js',
  'date-labels.js',
];

/**
 * Reads a leaf module's named exports so the import statement in script.js
 * stays in sync without a hand-maintained list. Parses both declaration
 * exports (regular and async functions, const/let/class) and barrel
 * `export { … } from …` re-export lines — used for pure-fns.js, which is a
 * barrel over the pure-fns-*.js sub-modules, as well as plain leaf modules
 * like app-constants.js that only have declaration exports.
 * @param {string} filename - Leaf module filename, relative to JS_SRC (e.g. 'pure-fns.js').
 * @returns {string[]} Exported symbol names.
 */
export function readModuleExports(filename) {
  const src = readFileSync(join(JS_SRC, filename), 'utf8');
  const declared = [
    // eslint-disable-next-line security/detect-unsafe-regex -- matches our own leaf-module export lines; trusted input, no nested quantifiers
    ...src.matchAll(/^export (?:async\s+)?(?:function|const|let|class) (\w+)/gm),
  ].map((m) => m[1]);
  const reExported = [...src.matchAll(/export\s*\{([^}]*)\}\s*from/g)].flatMap((m) =>
    m[1]
      .split(',')
      .map((s) => s.replace(/\s+as\s+\S+/, '').trim()) // drop "as alias" suffixes
      .filter(Boolean)
  );
  return [...declared, ...reExported];
}
