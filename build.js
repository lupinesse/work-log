// Build script:
//   Leaf modules (LEAF_MODULES in build-config.js) → imported as ES modules at top of script.js
//   src/js/*.js (others)  → concatenated into script.js ESM module, alphabetical order
//   src/css/*.scss         → styles.css (compiled by Sass)

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { compile } from 'sass';
import {
  JS_SRC,
  JS_OUT,
  CSS_SRC,
  CSS_OUT,
  LEAF_MODULES,
  readModuleExports,
} from './build-config.js';

function buildJS() {
  // Guard: every leaf module must exist before we reference it in import statements.
  for (const leaf of LEAF_MODULES) {
    const p = join(JS_SRC, leaf);
    if (!existsSync(p)) throw new Error(`build.js: leaf module not found: ${p}`);
  }

  const pureFnsExports = readModuleExports('pure-fns.js');
  if (!pureFnsExports.length) throw new Error('build.js: no exports found in pure-fns.js');
  const appConstantsExports = readModuleExports('app-constants.js');
  if (!appConstantsExports.length)
    throw new Error('build.js: no exports found in app-constants.js');

  const files = readdirSync(JS_SRC)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.example.js') && !LEAF_MODULES.includes(f))
    .sort();
  const parts = files.map((f) => {
    const content = readFileSync(join(JS_SRC, f), 'utf8').replace(/\s+$/, '');
    return `// ── ${f} ──\n${content}`;
  });
  const imports = [
    `import { ${pureFnsExports.join(', ')} } from './src/js/pure-fns.js';`,
    `import { wlLog } from './src/js/logger.js';`,
    `import { ${appConstantsExports.join(', ')} } from './src/js/app-constants.js';`,
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
