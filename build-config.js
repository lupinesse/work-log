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
 * The list now includes the pure-fns sub-modules followed by the pure-fns.js
 * barrel. Order matters for the portable build: it inlines files in list
 * order, and the barrel strips down to comments only — the sub-modules that
 * actually declare the functions must already be in scope when later files run.
 * Change the list here — build.js, vite.config.js, and build-portable.js all
 * import from this single source of truth.
 */
export const LEAF_MODULES = [
  'logger.js',
  'pure-fns-export.js',
  'pure-fns-format.js',
  'pure-fns-tasks.js',
  'pure-fns-validate.js',
  'pure-fns.js',
];

/**
 * Reads named exports from pure-fns.js so the import statement in script.js
 * stays in sync without a hand-maintained list. Parses both declaration
 * exports (regular and async functions, const/let/class) and barrel
 * `export { … } from …` re-export lines — pure-fns.js is now a barrel over
 * the pure-fns-*.js sub-modules.
 * @returns {string[]} Exported symbol names.
 */
export function readPureFnsExports() {
  const src = readFileSync(join(JS_SRC, 'pure-fns.js'), 'utf8');
  const declared = [
    ...src.matchAll(/^export (?:async\s+)?(?:function|const|let|class) (\w+)/gm),
  ].map((m) => m[1]);
  const reExported = [...src.matchAll(/export\s*\{([^}]*)\}\s*from/g)].flatMap((m) =>
    m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return [...declared, ...reExported];
}
