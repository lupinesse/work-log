/**
 * @file build-config.js
 * Shared build-time constants imported by build.js, build-portable.js, and
 * deploy-portable.js.  Change a path here and all three scripts stay in sync.
 */

/** Source directory for JS modules (concatenated alphabetically into one IIFE). */
export const JS_SRC = 'src/js';

/** Source entry-point for SCSS (imports partials). */
export const CSS_SRC = 'src/css/styles.scss';

/** Generated JS bundle (IIFE, checked into repo for vite to pick up). */
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
