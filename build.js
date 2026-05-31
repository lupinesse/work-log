// Build script:
//   src/js/pure-fns.js, src/js/logger.js  → imported as ES modules at top of script.js
//   src/js/*.js (others)  → concatenated into script.js ESM module, alphabetical order
//   src/css/*.scss         → styles.css (compiled by Sass)

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { compile } from 'sass';
import { JS_SRC, JS_OUT, CSS_SRC, CSS_OUT } from './build-config.js';

/**
 * Leaf modules: proper ES modules that export named functions.
 * They are imported at the top of script.js instead of being concatenated.
 */
const LEAF_MODULES = new Set(['pure-fns.js', 'logger.js']);

/**
 * Named exports from pure-fns.js that the concatenated source files reference
 * as bare names (no module prefix). Listed here so the import statement at the
 * top of script.js brings them all into scope.
 */
const PURE_FNS_EXPORTS = [
  'safeCssColor',
  'escHtml',
  'dk',
  'fmtTime',
  'fmtElapsed',
  'fmtDur',
  'fmtDurLong',
  'roundUp30',
  'roundToNearest30',
  'validEntry',
  'validCategory',
  'validPlanTask',
  'validBlock',
  'validTimer',
  'validPomoEntry',
  'validateBackupFile',
  'validWeatherResponse',
  'validCalendarMeeting',
  'validJiraCsvRow',
  'resolveRapidDate',
  'parseRapidTokens',
  'stripJiraPrefix',
  'groupEntriesByCategory',
  'mergeAdjacentEntries',
  'buildBillableSummaryParts',
  'computeDayBounds',
  'formatGroupedLines',
];

function buildJS() {
  const files = readdirSync(JS_SRC)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.example.js') && !LEAF_MODULES.has(f))
    .sort();
  const parts = files.map((f) => {
    const content = readFileSync(join(JS_SRC, f), 'utf8').replace(/\s+$/, '');
    return `// ── ${f} ──\n${content}`;
  });
  const imports = [
    `import { ${PURE_FNS_EXPORTS.join(', ')} } from './src/js/pure-fns.js';`,
    `import { wlLog } from './src/js/logger.js';`,
  ].join('\n');
  const output = imports + '\n\n' + parts.join('\n\n') + '\n';
  writeFileSync(JS_OUT, output);
  console.log(`✓ Built ${JS_OUT} (${output.split('\n').length} lines from ${files.length} files)`);
}

function buildCSS() {
  const result = compile(CSS_SRC, { style: 'expanded' });
  writeFileSync(CSS_OUT, result.css);
  console.log(`✓ Built ${CSS_OUT} (${result.css.split('\n').length} lines)`);
}

buildJS();
buildCSS();
