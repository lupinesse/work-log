// Build script:
//   src/js/pure-fns.js, src/js/logger.js  → imported as ES modules at top of script.js
//   src/js/*.js (others)  → concatenated into script.js ESM module, alphabetical order
//   src/css/*.scss         → styles.css (compiled by Sass)

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { compile } from 'sass';
import { JS_SRC, JS_OUT, CSS_SRC, CSS_OUT } from './build-config.js';

/**
 * Leaf modules: proper ES modules that export named functions.
 * They are imported at the top of script.js instead of being concatenated.
 */
const LEAF_MODULES = new Set(['pure-fns.js', 'logger.js']);

/**
 * Parse named exports from pure-fns.js at build time so the import statement
 * in script.js stays in sync without a hand-maintained list.
 * @returns {string[]} Exported names.
 */
function readPureFnsExports() {
  const src = readFileSync(join(JS_SRC, 'pure-fns.js'), 'utf8');
  return [...src.matchAll(/^export (?:function|const|class) (\w+)/gm)].map((m) => m[1]);
}

function buildJS() {
  // Guard: every leaf module must exist before we reference it in import statements.
  for (const leaf of LEAF_MODULES) {
    const p = join(JS_SRC, leaf);
    if (!existsSync(p)) throw new Error(`build.js: leaf module not found: ${p}`);
  }

  const pureFnsExports = readPureFnsExports();
  if (!pureFnsExports.length) throw new Error('build.js: no exports found in pure-fns.js');

  const files = readdirSync(JS_SRC)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.example.js') && !LEAF_MODULES.has(f))
    .sort();
  const parts = files.map((f) => {
    const content = readFileSync(join(JS_SRC, f), 'utf8').replace(/\s+$/, '');
    return `// ── ${f} ──\n${content}`;
  });
  const imports = [
    `import { ${pureFnsExports.join(', ')} } from './src/js/pure-fns.js';`,
    `import { wlLog } from './src/js/logger.js';`,
  ].join('\n');
  const output = `${imports}\n\n${parts.join('\n\n')}\n`;
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
