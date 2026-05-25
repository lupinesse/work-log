// Build script:
//   src/js/*.js   → script.js  (concatenated into one IIFE, alphabetical order)
//   src/css/*.scss → styles.css (compiled by Sass)

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { compile } from 'sass';
import { JS_SRC, JS_OUT, CSS_SRC, CSS_OUT } from './build-config.js';

function buildJS() {
  const files = readdirSync(JS_SRC)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.example.js'))
    .sort();
  const parts = files.map((f) => {
    const content = readFileSync(join(JS_SRC, f), 'utf8').replace(/\s+$/, '');
    return `// ── ${f} ──\n${content}`;
  });
  const output = '(function() {\n' + parts.join('\n\n') + '\n})();\n';
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
